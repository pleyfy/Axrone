import type { SceneMeshDefinition } from '../../../scene/types';
import type { AssetImportDiagnostic } from '../../types';
import { GltfSchemaError, GltfTopologyError } from '../errors';
import type { GltfAccessorJson, GltfMeshBounds, GltfPrimitiveJson } from '../types';
import { type DecodedAccessor, GltfAccessorRuntime } from './accessor-runtime';
import { GltfResourceRuntime } from './source-runtime';

const SUPPORTED_ATTRIBUTE_SEMANTICS = [
    'POSITION',
    'NORMAL',
    'TANGENT',
    'TEXCOORD_0',
    'TEXCOORD_1',
    'COLOR_0',
] as const;

type SupportedAttributeSemantic = (typeof SUPPORTED_ATTRIBUTE_SEMANTICS)[number];

interface AttributeStream {
    readonly semantic: SupportedAttributeSemantic;
    readonly componentCount: number;
    readonly values: Float32Array;
}

interface DracoPrimitiveGeometry {
    readonly attributes: ReadonlyMap<string, Float32Array>;
    readonly indices: Uint32Array;
}

interface ResolvedPrimitiveGeometry {
    readonly attributeStreams: readonly AttributeStream[];
    readonly indices?: Uint32Array;
    readonly positionAccessor?: DecodedAccessor;
    readonly topologyMode: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

let dracoDecoderModulePromise: Promise<any> | undefined;

const isSupportedAttributeSemantic = (value: string): value is SupportedAttributeSemantic =>
    (SUPPORTED_ATTRIBUTE_SEMANTICS as readonly string[]).includes(value);

const loadDracoDecoderModule = async (): Promise<any> => {
    dracoDecoderModulePromise ??= import('draco3dgltf').then((module) =>
        module.createDecoderModule({})
    );
    return dracoDecoderModulePromise;
};

const accessorComponentCount = (type: GltfAccessorJson['type']): number => {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
        case 'MAT2':
            return 4;
        case 'MAT3':
            return 9;
        case 'MAT4':
            return 16;
    }
};

const collectPrimitiveAttributeSemantics = (primitive: GltfPrimitiveJson): readonly string[] => {
    const semantics = new Set<string>(Object.keys(primitive.attributes));

    for (const semantic of Object.keys(
        primitive.extensions?.KHR_draco_mesh_compression?.attributes ?? {}
    )) {
        semantics.add(semantic);
    }

    return [...semantics];
};

export const collectPrimitiveDiagnostics = (
    primitive: GltfPrimitiveJson,
    meshIndex: number,
    primitiveIndex: number
): readonly AssetImportDiagnostic[] => {
    const diagnostics: AssetImportDiagnostic[] = [];
    const unsupportedAttributes = collectPrimitiveAttributeSemantics(primitive)
        .filter((semantic) => isSupportedAttributeSemantic(semantic) === false)
        .sort((left, right) => left.localeCompare(right));

    for (const semantic of unsupportedAttributes) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.mesh.attribute.unsupported',
                message: `Mesh ${meshIndex} primitive ${primitiveIndex} attribute ${semantic} is not supported and will be ignored`,
            } satisfies AssetImportDiagnostic)
        );
    }

    if (primitive.targets && primitive.targets.length > 0) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.mesh.targets.unsupported',
                message: `Mesh ${meshIndex} primitive ${primitiveIndex} morph targets are not supported and will be ignored`,
            } satisfies AssetImportDiagnostic)
        );
    }

    return Object.freeze(diagnostics);
};

const mapAttributeSemantic = (
    value: SupportedAttributeSemantic
): SceneMeshDefinition['attributes'][number]['semantic'] => {
    switch (value) {
        case 'POSITION':
            return 'position';
        case 'NORMAL':
            return 'normal';
        case 'TANGENT':
            return 'tangent';
        case 'TEXCOORD_0':
            return 'uv0';
        case 'TEXCOORD_1':
            return 'uv1';
        case 'COLOR_0':
            return 'color0';
    }
};

const computeBoundsFromValues = (
    values: Float32Array,
    componentCount: number
): GltfMeshBounds | undefined => {
    if (componentCount < 3 || values.length < componentCount) {
        return undefined;
    }

    let minX = values[0]!;
    let minY = values[1]!;
    let minZ = values[2]!;
    let maxX = minX;
    let maxY = minY;
    let maxZ = minZ;

    for (let index = componentCount; index < values.length; index += componentCount) {
        const x = values[index]!;
        const y = values[index + 1]!;
        const z = values[index + 2]!;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }

    return Object.freeze({
        min: Object.freeze([minX, minY, minZ]) as readonly [number, number, number],
        max: Object.freeze([maxX, maxY, maxZ]) as readonly [number, number, number],
    });
};

const decodeDracoPrimitive = async (
    primitive: GltfPrimitiveJson,
    runtime: GltfResourceRuntime
): Promise<DracoPrimitiveGeometry | undefined> => {
    const extension = primitive.extensions?.KHR_draco_mesh_compression;
    if (!extension) {
        return undefined;
    }

    const compressedBytes = await runtime.resolveBufferView(extension.bufferView);
    const decoderModule = await loadDracoDecoderModule();
    const decoderBuffer = new decoderModule.DecoderBuffer();
    const decoder = new decoderModule.Decoder();
    const mesh = new decoderModule.Mesh();
    const face = new decoderModule.DracoInt32Array();

    try {
        decoderBuffer.Init(
            new Int8Array(
                compressedBytes.buffer,
                compressedBytes.byteOffset,
                compressedBytes.byteLength
            ),
            compressedBytes.byteLength
        );

        const geometryType = decoder.GetEncodedGeometryType(decoderBuffer);
        if (geometryType !== decoderModule.TRIANGULAR_MESH) {
            throw new GltfSchemaError(
                'KHR_draco_mesh_compression only supports triangular mesh payloads'
            );
        }

        const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
        if (!status.ok()) {
            throw new GltfSchemaError(
                `Failed to decode KHR_draco_mesh_compression payload: ${status.error_msg()}`
            );
        }

        const attributes = new Map<string, Float32Array>();
        for (const [semantic, uniqueId] of Object.entries(extension.attributes)) {
            const accessorIndex = primitive.attributes[semantic];
            if (accessorIndex === undefined) {
                throw new GltfSchemaError(
                    `KHR_draco_mesh_compression attribute ${semantic} is missing its matching accessor`
                );
            }

            const accessor = runtime.source.json.accessors?.[accessorIndex];
            if (!accessor) {
                throw new GltfSchemaError(
                    `KHR_draco_mesh_compression attribute ${semantic} references a missing accessor`
                );
            }

            const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
            if (!attribute || attribute.ptr === 0) {
                throw new GltfSchemaError(
                    `KHR_draco_mesh_compression attribute ${semantic} could not be resolved from the decoder output`
                );
            }

            const values = new Float32Array(accessor.count * accessorComponentCount(accessor.type));
            const attributeData = new decoderModule.DracoFloat32Array();

            try {
                const decoded = decoder.GetAttributeFloatForAllPoints(mesh, attribute, attributeData);
                if (!decoded) {
                    throw new GltfSchemaError(
                        `KHR_draco_mesh_compression attribute ${semantic} could not be decoded`
                    );
                }

                if (attributeData.size() !== values.length) {
                    throw new GltfSchemaError(
                        `KHR_draco_mesh_compression attribute ${semantic} did not match accessor metadata`
                    );
                }

                for (let index = 0; index < values.length; index += 1) {
                    values[index] = attributeData.GetValue(index);
                }
            } finally {
                decoderModule.destroy(attributeData);
            }

            attributes.set(semantic, values);
        }

        const faceCount = mesh.num_faces();
        const indices = new Uint32Array(faceCount * 3);
        for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
            const decoded = decoder.GetFaceFromMesh(mesh, faceIndex, face);
            if (!decoded) {
                throw new GltfSchemaError(
                    'KHR_draco_mesh_compression indices could not be decoded'
                );
            }

            const cursor = faceIndex * 3;
            indices[cursor] = face.GetValue(0);
            indices[cursor + 1] = face.GetValue(1);
            indices[cursor + 2] = face.GetValue(2);
        }

        return Object.freeze({
            attributes,
            indices,
        });
    } finally {
        decoderModule.destroy(face);
        decoderModule.destroy(mesh);
        decoderModule.destroy(decoder);
        decoderModule.destroy(decoderBuffer);
    }
};

const collectPrimitiveAttributes = async (
    primitive: GltfPrimitiveJson,
    accessors: GltfAccessorRuntime,
    runtime: GltfResourceRuntime
): Promise<ResolvedPrimitiveGeometry> => {
    const topologyMode = primitive.mode ?? 4;
    if (
        primitive.extensions?.KHR_draco_mesh_compression &&
        topologyMode !== 4 &&
        topologyMode !== 5
    ) {
        throw new GltfTopologyError(
            'KHR_draco_mesh_compression only supports TRIANGLES and TRIANGLE_STRIP primitives',
            topologyMode
        );
    }

    const dracoGeometry = await decodeDracoPrimitive(primitive, runtime);
    const result: AttributeStream[] = [];

    for (const semantic of SUPPORTED_ATTRIBUTE_SEMANTICS) {
        const accessorIndex = primitive.attributes[semantic];
        if (accessorIndex === undefined) {
            continue;
        }

        const accessor = runtime.source.json.accessors?.[accessorIndex];
        if (!accessor) {
            throw new GltfSchemaError(`Mesh primitive attribute ${semantic} references a missing accessor`);
        }

        const dracoValues = dracoGeometry?.attributes.get(semantic);
        const decoded =
            dracoValues !== undefined
                ? {
                      componentCount: accessorComponentCount(accessor.type),
                      values: dracoValues,
                  }
                : await accessors.decodeAccessor(accessorIndex);

        if (decoded.values.length !== accessor.count * decoded.componentCount) {
            throw new GltfSchemaError(
                `Mesh primitive attribute ${semantic} does not match its accessor metadata`
            );
        }

        result.push(
            Object.freeze({
                semantic,
                componentCount: decoded.componentCount,
                values: decoded.values,
            })
        );
    }

    if (result.length === 0 || result[0]?.semantic !== 'POSITION') {
        throw new GltfSchemaError('Mesh primitive is missing POSITION attribute');
    }

    const positionAccessorIndex = primitive.attributes.POSITION;
    const positionAccessor =
        positionAccessorIndex !== undefined
            ? await accessors.decodeAccessor(positionAccessorIndex)
            : undefined;
    const indices =
        dracoGeometry?.indices ??
        (primitive.indices !== undefined ? await accessors.decodeIndices(primitive.indices) : undefined);

    return Object.freeze({
        attributeStreams: Object.freeze(result),
        indices,
        positionAccessor,
        topologyMode: dracoGeometry && topologyMode === 5 ? 4 : topologyMode,
    });
};

const computeBoundsFromAccessor = (decoded: DecodedAccessor): GltfMeshBounds | undefined => {
    if (decoded.componentCount < 3 || !decoded.min || !decoded.max) {
        return undefined;
    }

    return Object.freeze({
        min: Object.freeze([
            decoded.min[0] ?? 0,
            decoded.min[1] ?? 0,
            decoded.min[2] ?? 0,
        ]) as readonly [number, number, number],
        max: Object.freeze([
            decoded.max[0] ?? 0,
            decoded.max[1] ?? 0,
            decoded.max[2] ?? 0,
        ]) as readonly [number, number, number],
    });
};

const topologicalModeToSceneTopology = (mode: number): 'triangles' | 'lines' | 'points' => {
    switch (mode) {
        case 0:
            return 'points';
        case 1:
        case 2:
        case 3:
            return 'lines';
        case 4:
        case 5:
        case 6:
            return 'triangles';
        default:
            throw new GltfTopologyError(`Unsupported primitive mode: ${mode}`, mode);
    }
};

const expandSequentialIndices = (vertexCount: number): Uint32Array => {
    const indices = new Uint32Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) {
        indices[index] = index;
    }
    return indices;
};

const expandPrimitiveIndices = (
    mode: number,
    vertexCount: number,
    sourceIndices: Uint32Array | undefined
): Uint32Array | undefined => {
    const indices = sourceIndices ?? expandSequentialIndices(vertexCount);

    switch (mode) {
        case 0:
        case 1:
        case 4:
            return sourceIndices;
        case 2: {
            const expanded = new Uint32Array(indices.length * 2);
            let cursor = 0;
            for (let index = 0; index < indices.length; index += 1) {
                expanded[cursor] = indices[index]!;
                expanded[cursor + 1] = indices[(index + 1) % indices.length]!;
                cursor += 2;
            }
            return expanded;
        }
        case 3: {
            if (indices.length < 2) {
                return new Uint32Array(0);
            }
            const expanded = new Uint32Array((indices.length - 1) * 2);
            let cursor = 0;
            for (let index = 0; index < indices.length - 1; index += 1) {
                expanded[cursor] = indices[index]!;
                expanded[cursor + 1] = indices[index + 1]!;
                cursor += 2;
            }
            return expanded;
        }
        case 5: {
            if (indices.length < 3) {
                return new Uint32Array(0);
            }
            const expanded = new Uint32Array((indices.length - 2) * 3);
            let cursor = 0;
            for (let index = 0; index < indices.length - 2; index += 1) {
                const a = indices[index]!;
                const b = indices[index + 1]!;
                const c = indices[index + 2]!;
                if (index % 2 === 0) {
                    expanded[cursor] = a;
                    expanded[cursor + 1] = b;
                    expanded[cursor + 2] = c;
                } else {
                    expanded[cursor] = b;
                    expanded[cursor + 1] = a;
                    expanded[cursor + 2] = c;
                }
                cursor += 3;
            }
            return expanded;
        }
        case 6: {
            if (indices.length < 3) {
                return new Uint32Array(0);
            }
            const expanded = new Uint32Array((indices.length - 2) * 3);
            let cursor = 0;
            const origin = indices[0]!;
            for (let index = 1; index < indices.length - 1; index += 1) {
                expanded[cursor] = origin;
                expanded[cursor + 1] = indices[index]!;
                expanded[cursor + 2] = indices[index + 1]!;
                cursor += 3;
            }
            return expanded;
        }
        default:
            throw new GltfTopologyError(`Unsupported primitive mode: ${mode}`, mode);
    }
};

const toSmallestIndexArray = (
    indices: Uint32Array | undefined
): Uint16Array | Uint32Array | undefined => {
    if (!indices || indices.length === 0) {
        return indices;
    }

    let max = 0;
    for (let index = 0; index < indices.length; index += 1) {
        max = Math.max(max, indices[index]!);
    }

    return max <= 65535 ? new Uint16Array(indices) : indices;
};

export const buildMeshDefinition = async (
    primitive: GltfPrimitiveJson,
    accessors: GltfAccessorRuntime,
    runtime: GltfResourceRuntime
): Promise<{
    readonly definition: SceneMeshDefinition;
    readonly bounds?: GltfMeshBounds;
}> => {
    const resolved = await collectPrimitiveAttributes(primitive, accessors, runtime);
    const attributeStreams = resolved.attributeStreams;
    const vertexCount =
        attributeStreams[0]!.values.length / attributeStreams[0]!.componentCount;
    const strideComponents = attributeStreams.reduce(
        (total, attribute) => total + attribute.componentCount,
        0
    );
    const interleaved = new Float32Array(vertexCount * strideComponents);
    const attributes: SceneMeshDefinition['attributes'][number][] = [];
    let componentOffset = 0;

    for (const attribute of attributeStreams) {
        const offsetBytes = componentOffset * Float32Array.BYTES_PER_ELEMENT;
        for (let vertex = 0; vertex < vertexCount; vertex += 1) {
            interleaved.set(
                attribute.values.subarray(
                    vertex * attribute.componentCount,
                    vertex * attribute.componentCount + attribute.componentCount
                ),
                vertex * strideComponents + componentOffset
            );
        }

        attributes.push(
            Object.freeze({
                semantic: mapAttributeSemantic(attribute.semantic),
                componentCount: attribute.componentCount as 1 | 2 | 3 | 4,
                offset: offsetBytes,
                stride: strideComponents * Float32Array.BYTES_PER_ELEMENT,
                type: 5126,
                normalized: false,
            })
        );
        componentOffset += attribute.componentCount;
    }

    const expandedIndices = expandPrimitiveIndices(
        resolved.topologyMode,
        vertexCount,
        resolved.indices
    );
    const positionAccessor = resolved.positionAccessor;
    const positionStream = attributeStreams.find((attribute) => attribute.semantic === 'POSITION');

    return {
        definition: Object.freeze({
            id: '',
            vertices: interleaved,
            attributes: Object.freeze(attributes),
            ...(expandedIndices && expandedIndices.length > 0
                ? { indices: toSmallestIndexArray(expandedIndices) }
                : {}),
            vertexCount,
            topology: topologicalModeToSceneTopology(resolved.topologyMode),
        }),
        bounds:
            (positionAccessor ? computeBoundsFromAccessor(positionAccessor) : undefined) ??
            (positionStream
                ? computeBoundsFromValues(positionStream.values, positionStream.componentCount)
                : undefined),
    };
};