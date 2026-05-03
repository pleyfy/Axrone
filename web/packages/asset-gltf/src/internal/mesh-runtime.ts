import type { AssetImportDiagnostic } from '../asset-contract';
import { GltfSchemaError, GltfTopologyError } from '../errors';
import type { GltfMeshDefinition } from '../asset-ir';
import type {
    GltfAccessorJson,
    GltfDracoDecoderOptions,
    GltfMeshBounds,
    GltfPrimitiveJson,
} from '../types';
import { type DecodedAccessor, GltfAccessorRuntime } from './accessor-runtime';
import { GltfResourceRuntime } from './source-runtime';

const SUPPORTED_ATTRIBUTE_SEMANTICS = [
    'POSITION',
    'NORMAL',
    'TANGENT',
    'TEXCOORD_0',
    'TEXCOORD_1',
    'COLOR_0',
    'JOINTS_0',
    'WEIGHTS_0',
] as const;

const SUPPORTED_MORPH_TARGET_SEMANTICS = ['POSITION', 'NORMAL', 'TANGENT'] as const;

type SupportedAttributeSemantic = (typeof SUPPORTED_ATTRIBUTE_SEMANTICS)[number];
type SupportedMorphTargetSemantic = (typeof SUPPORTED_MORPH_TARGET_SEMANTICS)[number];

interface AttributeStream {
    readonly semantic: SupportedAttributeSemantic;
    readonly componentCount: number;
    readonly componentType: GltfAccessorJson['componentType'];
    readonly normalized: boolean;
    readonly values: Float32Array;
}

interface MorphTargetAttributeStream {
    readonly semantic: SupportedMorphTargetSemantic;
    readonly componentCount: 3;
    readonly values: Float32Array;
}

interface MorphTargetStream {
    readonly name?: string;
    readonly attributes: readonly MorphTargetAttributeStream[];
}

interface DracoPrimitiveGeometry {
    readonly attributes: ReadonlyMap<string, Float32Array>;
    readonly indices: Uint32Array;
}

interface ResolvedPrimitiveGeometry {
    readonly attributeStreams: readonly AttributeStream[];
    readonly morphTargets: readonly MorphTargetStream[];
    readonly indices?: Uint32Array;
    readonly positionAccessor?: DecodedAccessor;
    readonly topologyMode: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

type DracoDecoderModuleFactory = NonNullable<GltfDracoDecoderOptions['moduleFactory']>;
type DracoDecoderModuleConfig = Parameters<DracoDecoderModuleFactory>[0];

let dracoDecoderModulePromise: Promise<any> | undefined;
let browserDracoDecoderModuleFactoryPromise: Promise<DracoDecoderModuleFactory> | undefined;
const dracoDecoderModulePromisesByWasmUrl = new Map<string, Promise<any>>();
const dracoDecoderModulePromisesByFactory = new WeakMap<DracoDecoderModuleFactory, Promise<any>>();

const isSupportedAttributeSemantic = (value: string): value is SupportedAttributeSemantic =>
    (SUPPORTED_ATTRIBUTE_SEMANTICS as readonly string[]).includes(value);

const isSupportedMorphTargetSemantic = (value: string): value is SupportedMorphTargetSemantic =>
    (SUPPORTED_MORPH_TARGET_SEMANTICS as readonly string[]).includes(value);

const createDracoDecoderModuleConfig = (
    options: GltfDracoDecoderOptions | undefined
): DracoDecoderModuleConfig | undefined => {
    if (!options?.wasmUrl) {
        return undefined;
    }

    return {
        locateFile: (path: string, scriptDirectory: string) =>
            path === 'draco_decoder_gltf.wasm'
                ? options.wasmUrl!
                : `${scriptDirectory}${path}`,
    };
};

const isLikelyHtmlWasmResponseError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return (
        message.includes('WebAssembly.instantiate(): expected magic word 00 61 73 6d') &&
        message.includes('found 3c 21 64 6f')
    );
};

const withDracoDecoderHint = (
    error: unknown,
    options: GltfDracoDecoderOptions | undefined
): never => {
    if (!options?.wasmUrl && isLikelyHtmlWasmResponseError(error)) {
        throw new Error(
            'Failed to initialize the browser Draco decoder because the wasm request resolved to HTML instead of draco_decoder_gltf.wasm. Configure createGltfImporter({ dracoDecoder: { wasmUrl } }) for browser imports that use KHR_draco_mesh_compression.',
            {
                cause: error instanceof Error ? error : undefined,
            }
        );
    }

    throw error;
};

const loadBrowserDracoDecoderModuleFactory = async (): Promise<DracoDecoderModuleFactory> => {
    browserDracoDecoderModuleFactoryPromise ??= import(
        'draco3dgltf/draco_decoder_gltf_nodejs.js'
    ).then((module) => {
        const candidate =
            (module as { default?: unknown }).default ??
            (module as { DracoDecoderModule?: unknown }).DracoDecoderModule;
        if (typeof candidate !== 'function') {
            throw new Error('draco3dgltf browser decoder module factory could not be resolved');
        }
        return candidate as DracoDecoderModuleFactory;
    });

    return browserDracoDecoderModuleFactoryPromise;
};

const loadConfiguredDracoDecoderModule = async (
    options: GltfDracoDecoderOptions
): Promise<any> => {
    const moduleFactory = options.moduleFactory ?? (await loadBrowserDracoDecoderModuleFactory());
    const cacheKey = options.wasmUrl;

    if (cacheKey) {
        const cached = dracoDecoderModulePromisesByWasmUrl.get(cacheKey);
        if (cached) {
            return cached;
        }
    } else {
        const cached = dracoDecoderModulePromisesByFactory.get(moduleFactory);
        if (cached) {
            return cached;
        }
    }

    const promise = Promise.resolve(moduleFactory(createDracoDecoderModuleConfig(options))).catch(
        (error) => withDracoDecoderHint(error, options)
    );

    if (cacheKey) {
        dracoDecoderModulePromisesByWasmUrl.set(cacheKey, promise);
    } else {
        dracoDecoderModulePromisesByFactory.set(moduleFactory, promise);
    }

    return promise;
};

const loadDracoDecoderModule = async (runtime: GltfResourceRuntime): Promise<any> => {
    if (runtime.dracoDecoder?.moduleFactory || runtime.dracoDecoder?.wasmUrl) {
        return loadConfiguredDracoDecoderModule(runtime.dracoDecoder);
    }

    dracoDecoderModulePromise ??= import('draco3dgltf').then((module) =>
        module.createDecoderModule({})
    );
    try {
        return await dracoDecoderModulePromise;
    } catch (error) {
        return withDracoDecoderHint(error, runtime.dracoDecoder);
    }
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

const collectPrimitiveMorphTargetSemantics = (
    primitive: GltfPrimitiveJson
): readonly string[] => {
    const semantics = new Set<string>();

    for (const target of primitive.targets ?? []) {
        for (const semantic of Object.keys(target)) {
            semantics.add(semantic);
        }
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

    const unsupportedTargetSemantics = collectPrimitiveMorphTargetSemantics(primitive)
        .filter((semantic) => isSupportedMorphTargetSemantic(semantic) === false)
        .sort((left, right) => left.localeCompare(right));

    for (const semantic of unsupportedTargetSemantics) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.mesh.target.attribute.unsupported',
                message: `Mesh ${meshIndex} primitive ${primitiveIndex} morph target attribute ${semantic} is not supported and will be ignored`,
            } satisfies AssetImportDiagnostic)
        );
    }

    for (const semantic of collectPrimitiveMorphTargetSemantics(primitive)) {
        if (
            isSupportedMorphTargetSemantic(semantic) &&
            primitive.attributes[semantic] === undefined
        ) {
            diagnostics.push(
                Object.freeze({
                    level: 'warning',
                    code: 'gltf.mesh.target.attribute.base-missing',
                    message: `Mesh ${meshIndex} primitive ${primitiveIndex} morph target attribute ${semantic} is ignored because the base primitive does not define ${semantic}`,
                } satisfies AssetImportDiagnostic)
            );
        }
    }

    return Object.freeze(diagnostics);
};

const mapAttributeSemantic = (
    value: SupportedAttributeSemantic
): GltfMeshDefinition['attributes'][number]['semantic'] => {
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
        case 'JOINTS_0':
            return 'joints0';
        case 'WEIGHTS_0':
            return 'weights0';
    }
};

const mapMorphTargetSemantic = (
    value: SupportedMorphTargetSemantic
): NonNullable<GltfMeshDefinition['morphTargets']>[number]['attributes'][number]['semantic'] => {
    switch (value) {
        case 'POSITION':
            return 'position';
        case 'NORMAL':
            return 'normal';
        case 'TANGENT':
            return 'tangent';
    }
};

const componentTypeByteSize = (
    componentType: GltfAccessorJson['componentType']
): 1 | 2 | 4 => {
    switch (componentType) {
        case 5120:
        case 5121:
            return 1;
        case 5122:
        case 5123:
            return 2;
        case 5125:
        case 5126:
            return 4;
    }
};

const writeIntegerComponent = (
    view: DataView,
    offset: number,
    componentType: GltfAccessorJson['componentType'],
    value: number
): void => {
    const rounded = Math.round(value);
    switch (componentType) {
        case 5120:
            view.setInt8(offset, rounded);
            return;
        case 5121:
            view.setUint8(offset, rounded);
            return;
        case 5122:
            view.setInt16(offset, rounded, true);
            return;
        case 5123:
            view.setUint16(offset, rounded, true);
            return;
        case 5125:
            view.setUint32(offset, rounded, true);
            return;
        default:
            view.setFloat32(offset, value, true);
            return;
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
    const decoderModule = await loadDracoDecoderModule(runtime);
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
                componentType: accessor.componentType,
                normalized: accessor.normalized ?? false,
                values: decoded.values,
            })
        );
    }

    if (result.length === 0 || result[0]?.semantic !== 'POSITION') {
        throw new GltfSchemaError('Mesh primitive is missing POSITION attribute');
    }

    const vertexCount = result[0]!.values.length / result[0]!.componentCount;
    const morphTargets: MorphTargetStream[] = [];
    for (let targetIndex = 0; targetIndex < (primitive.targets?.length ?? 0); targetIndex += 1) {
        const target = primitive.targets?.[targetIndex];
        if (!target) {
            continue;
        }

        const targetAttributes: MorphTargetAttributeStream[] = [];
        for (const semantic of SUPPORTED_MORPH_TARGET_SEMANTICS) {
            const accessorIndex = target[semantic];
            if (accessorIndex === undefined || primitive.attributes[semantic] === undefined) {
                continue;
            }

            const accessor = runtime.source.json.accessors?.[accessorIndex];
            if (!accessor) {
                throw new GltfSchemaError(
                    `Mesh primitive morph target ${targetIndex} attribute ${semantic} references a missing accessor`
                );
            }

            const decoded = await accessors.decodeAccessor(accessorIndex);
            if (decoded.componentCount !== 3) {
                throw new GltfSchemaError(
                    `Mesh primitive morph target ${targetIndex} attribute ${semantic} must use VEC3 accessors`
                );
            }

            if (decoded.values.length !== vertexCount * 3) {
                throw new GltfSchemaError(
                    `Mesh primitive morph target ${targetIndex} attribute ${semantic} does not match the base vertex count`
                );
            }

            targetAttributes.push(
                Object.freeze({
                    semantic,
                    componentCount: 3,
                    values: decoded.values,
                })
            );
        }

        if (targetAttributes.length === 0) {
            continue;
        }

        morphTargets.push(
            Object.freeze({
                attributes: Object.freeze(targetAttributes),
            })
        );
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
        morphTargets: Object.freeze(morphTargets),
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
    readonly definition: GltfMeshDefinition;
    readonly bounds?: GltfMeshBounds;
}> => {
    const resolved = await collectPrimitiveAttributes(primitive, accessors, runtime);
    const attributeStreams = resolved.attributeStreams;
    const vertexCount =
        attributeStreams[0]!.values.length / attributeStreams[0]!.componentCount;
    const attributeLayouts = attributeStreams.map((attribute) => {
        const integer = attribute.semantic === 'JOINTS_0' && attribute.componentType !== 5126;
        const componentByteSize = integer
            ? componentTypeByteSize(attribute.componentType)
            : Float32Array.BYTES_PER_ELEMENT;
        return {
            attribute,
            integer,
            componentByteSize,
            byteLength: attribute.componentCount * componentByteSize,
        };
    });
    const hasIntegerAttributes = attributeLayouts.some((layout) => layout.integer);
    const strideBytes = attributeLayouts.reduce((total, layout) => total + layout.byteLength, 0);
    const attributes: GltfMeshDefinition['attributes'][number][] = [];
    const vertices = hasIntegerAttributes
        ? (() => {
              const bytes = new Uint8Array(vertexCount * strideBytes);
              const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
              let byteOffset = 0;

              for (const layout of attributeLayouts) {
                  const { attribute, integer, componentByteSize, byteLength } = layout;
                  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
                      const baseOffset = vertex * strideBytes + byteOffset;
                      for (let component = 0; component < attribute.componentCount; component += 1) {
                          const value =
                              attribute.values[vertex * attribute.componentCount + component] ?? 0;
                          const componentOffset = baseOffset + component * componentByteSize;
                          if (integer) {
                              writeIntegerComponent(
                                  view,
                                  componentOffset,
                                  attribute.componentType,
                                  value
                              );
                          } else {
                              view.setFloat32(componentOffset, value, true);
                          }
                      }
                  }

                  attributes.push(
                      Object.freeze({
                          semantic: mapAttributeSemantic(attribute.semantic),
                          componentCount: attribute.componentCount as 1 | 2 | 3 | 4,
                          offset: byteOffset,
                          stride: strideBytes,
                          type: integer ? attribute.componentType : 5126,
                          normalized: false,
                          integer: integer || undefined,
                      })
                  );
                  byteOffset += byteLength;
              }

              return bytes;
          })()
        : (() => {
              const strideComponents = attributeStreams.reduce(
                  (total, attribute) => total + attribute.componentCount,
                  0
              );
              const interleaved = new Float32Array(vertexCount * strideComponents);
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

              return interleaved;
          })();

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
            vertices,
            attributes: Object.freeze(attributes),
            ...(resolved.morphTargets.length > 0
                ? {
                      morphTargets: Object.freeze(
                          resolved.morphTargets.map((target) =>
                              Object.freeze({
                                  ...(typeof target.name === 'string'
                                      ? { name: target.name }
                                      : {}),
                                  attributes: Object.freeze(
                                      target.attributes.map((attribute) =>
                                          Object.freeze({
                                              semantic: mapMorphTargetSemantic(
                                                  attribute.semantic
                                              ),
                                              componentCount: attribute.componentCount,
                                              values: new Float32Array(attribute.values),
                                          })
                                      )
                                  ),
                              })
                          )
                      ),
                  }
                : {}),
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
