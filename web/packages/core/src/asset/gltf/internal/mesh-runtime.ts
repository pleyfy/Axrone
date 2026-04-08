import type { SceneMeshDefinition } from '../../../scene/types';
import type { AssetImportDiagnostic } from '../../types';
import { GltfSchemaError, GltfTopologyError } from '../errors';
import type { GltfMeshBounds, GltfPrimitiveJson } from '../types';
import { type DecodedAccessor, GltfAccessorRuntime } from './accessor-runtime';

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

const isSupportedAttributeSemantic = (value: string): value is SupportedAttributeSemantic =>
    (SUPPORTED_ATTRIBUTE_SEMANTICS as readonly string[]).includes(value);

export const collectPrimitiveDiagnostics = (
    primitive: GltfPrimitiveJson,
    meshIndex: number,
    primitiveIndex: number
): readonly AssetImportDiagnostic[] => {
    const diagnostics: AssetImportDiagnostic[] = [];
    const unsupportedAttributes = Object.keys(primitive.attributes)
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

const collectPrimitiveAttributes = async (
    primitive: GltfPrimitiveJson,
    accessors: GltfAccessorRuntime
): Promise<readonly AttributeStream[]> => {
    const result: AttributeStream[] = [];

    for (const semantic of SUPPORTED_ATTRIBUTE_SEMANTICS) {
        const accessorIndex = primitive.attributes[semantic];
        if (accessorIndex === undefined) {
            continue;
        }

        const decoded = await accessors.decodeAccessor(accessorIndex);
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

    return Object.freeze(result);
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
    accessors: GltfAccessorRuntime
): Promise<{
    readonly definition: SceneMeshDefinition;
    readonly bounds?: GltfMeshBounds;
}> => {
    const attributeStreams = await collectPrimitiveAttributes(primitive, accessors);
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

    const topologyMode = primitive.mode ?? 4;
    const indices =
        primitive.indices !== undefined
            ? await accessors.decodeIndices(primitive.indices)
            : undefined;
    const expandedIndices = expandPrimitiveIndices(topologyMode, vertexCount, indices);
    const positionAccessor = await accessors.decodeAccessor(primitive.attributes.POSITION);

    return {
        definition: Object.freeze({
            id: '',
            vertices: interleaved,
            attributes: Object.freeze(attributes),
            ...(expandedIndices && expandedIndices.length > 0
                ? { indices: toSmallestIndexArray(expandedIndices) }
                : {}),
            vertexCount,
            topology: topologicalModeToSceneTopology(topologyMode),
        }),
        bounds: computeBoundsFromAccessor(positionAccessor),
    };
};