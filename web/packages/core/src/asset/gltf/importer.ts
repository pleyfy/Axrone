import type {
    SceneActorSnapshot,
    SceneComponentSnapshot,
    SceneMaterialDefinition,
    SceneMeshDefinition,
    ScenePrefabDefinition,
} from '../../scene/types';
import { FilterMode, TextureFormat, WrapMode } from '../../renderer/webgl2/texture/interfaces';
import type { AssetImportDiagnostic, AssetImportResult, AssetImportSource, AssetWriteInput } from '../types';
import { GltfAccessorError, GltfContainerError, GltfResourceError, GltfSchemaError, GltfTopologyError } from './errors';
import type {
    GltfAccessorJson,
    GltfAssetSchema,
    GltfAssetSchemaLike,
    GltfCompressedTexturePayload,
    GltfDocumentAsset,
    GltfDocumentSceneAsset,
    GltfImporter,
    GltfImporterOptions,
    GltfMaterialAlphaMode,
    GltfMaterialAsset,
    GltfMaterialJson,
    GltfMaterialTextureBinding,
    GltfMeshAsset,
    GltfMeshBounds,
    GltfNodeJson,
    GltfPackageInput,
    GltfPackageResourceInput,
    GltfPackageSource,
    GltfPrimitiveJson,
    GltfResolvedResource,
    GltfResourceRequest,
    GltfRootJson,
    GltfSamplerJson,
    GltfTextureAsset,
    GltfTextureBindingJson,
    GltfTexturePayload,
    GltfTextureSampler,
    GltfTextureTranscodeRequest,
    GltfTextureTranscodeResult,
    GltfTextureTranscodeStageOptions,
    GltfTextureTranscoder,
    GltfTextureTransform,
    GltfTextureUsage,
    GltfTranscodeStage,
} from './types';

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const EMPTY_ARRAY = Object.freeze([]) as readonly never[];
const DEFAULT_SAMPLER_ID = 'gltf/sampler/default';
const DEFAULT_MATERIAL_KEY_SUFFIX = 'material/default';
const DEFAULT_MATERIAL_NAME = 'Default Material';
const DEFAULT_DOCUMENT_NAME = 'glTF Document';
const SUPPORTED_ATTRIBUTE_SEMANTICS = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0'] as const;

type SupportedAttributeSemantic = (typeof SUPPORTED_ATTRIBUTE_SEMANTICS)[number];

interface NormalizedGltfSource {
    readonly format: 'gltf' | 'glb';
    readonly json: GltfRootJson;
    readonly sourceUri?: string;
    readonly binChunk?: Uint8Array;
    readonly resources: ReadonlyMap<string, GltfResolvedResource>;
}

interface AttributeStream {
    readonly semantic: SupportedAttributeSemantic;
    readonly componentCount: number;
    readonly values: Float32Array;
}

interface DecodedAccessor {
    readonly count: number;
    readonly componentCount: number;
    readonly values: Float32Array;
    readonly min?: readonly number[];
    readonly max?: readonly number[];
}

interface PrefabBuildResult {
    readonly prefab: ScenePrefabDefinition;
    readonly rootNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly meshKeys: readonly string[];
    readonly materialKeys: readonly string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const isTypedArray = (value: unknown): value is ArrayBufferView =>
    ArrayBuffer.isView(value) && (value instanceof DataView === false);

const freezeDeep = <T>(value: T): T => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (value instanceof ArrayBuffer || isTypedArray(value) || value instanceof DataView) {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            freezeDeep(item);
        }
        return Object.freeze(value) as T;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
        freezeDeep(nested);
    }

    return Object.freeze(value);
};

const maybeFreeze = <T>(value: T, enabled: boolean): T => (enabled ? freezeDeep(value) : value);

const toUint8Array = (value: string | ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array => {
    if (typeof value === 'string') {
        return new TextEncoder().encode(value);
    }

    if (value instanceof Uint8Array) {
        return value;
    }

    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    return new Uint8Array(value);
};

const decodeUtf8 = (value: Uint8Array): string => new TextDecoder().decode(value);

const trimNullCharacters = (value: string): string => value.replace(/\u0000+$/u, '');

const hasScheme = (value: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);

const normalizeUri = (value: string): string => value.replace(/\\/gu, '/');

const dirnameOfUri = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = normalizeUri(value);
    const queryIndex = normalized.indexOf('?');
    const hashIndex = normalized.indexOf('#');
    const boundary =
        queryIndex === -1
            ? hashIndex === -1
                ? normalized.length
                : hashIndex
            : hashIndex === -1
              ? queryIndex
              : Math.min(queryIndex, hashIndex);
    const body = normalized.slice(0, boundary);
    const slashIndex = body.lastIndexOf('/');
    if (slashIndex === -1) {
        return '';
    }

    return body.slice(0, slashIndex + 1);
};

const resolveRelativeUri = (baseUri: string | undefined, value: string): string => {
    const normalized = normalizeUri(value);
    if (normalized.startsWith('data:') || hasScheme(normalized) || normalized.startsWith('/')) {
        return normalized;
    }

    const base = dirnameOfUri(baseUri);
    if (base === undefined) {
        return normalized;
    }

    if (hasScheme(base)) {
        return new URL(normalized, base).toString();
    }

    return `${base}${normalized}`;
};

const basenameOfUri = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = normalizeUri(value);
    const body = normalized.split(/[?#]/u, 1)[0] ?? normalized;
    const slashIndex = body.lastIndexOf('/');
    const candidate = slashIndex >= 0 ? body.slice(slashIndex + 1) : body;
    return candidate || undefined;
};

const stripExtension = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const index = value.lastIndexOf('.');
    return index > 0 ? value.slice(0, index) : value;
};

const sanitizeName = (value: string | undefined, fallback: string): string => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const parseDataUri = (
    value: string
): {
    readonly mimeType?: string;
    readonly bytes: Uint8Array;
} => {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/isu.exec(value);
    if (!match) {
        throw new GltfResourceError(`Invalid data URI: ${value}`, value, 'buffer');
    }

    const [, mimeType, base64Flag, payload] = match;
    if (base64Flag) {
        const decoded = atob(payload);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            bytes[index] = decoded.charCodeAt(index);
        }
        return {
            mimeType,
            bytes,
        };
    }

    return {
        mimeType,
        bytes: new TextEncoder().encode(decodeURIComponent(payload)),
    };
};

const inferFormatFromSource = (source: AssetImportSource): 'gltf' | 'glb' | undefined => {
    if (source.mimeType === 'model/gltf-binary') {
        return 'glb';
    }

    const fileName = basenameOfUri(source.uri)?.toLowerCase();
    if (fileName?.endsWith('.glb')) {
        return 'glb';
    }
    if (fileName?.endsWith('.gltf')) {
        return 'gltf';
    }

    if (source.kind === 'bytes') {
        const bytes = toUint8Array(source.data);
        if (
            bytes.byteLength >= 4 &&
            new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) ===
                GLB_MAGIC
        ) {
            return 'glb';
        }
    }

    return undefined;
};

const isGltfPackageInput = (value: unknown): value is GltfPackageInput =>
    isPlainObject(value) && 'json' in value;

const isGltfPackageSource = (source: AssetImportSource): source is GltfPackageSource =>
    source.kind === 'custom' && source.format === 'gltf-package' && isGltfPackageInput(source.data);

const parseRootJson = (value: unknown): GltfRootJson => {
    if (!isPlainObject(value) || !isPlainObject(value.asset) || typeof value.asset.version !== 'string') {
        throw new GltfSchemaError('Invalid glTF asset root');
    }

    const version = value.asset.version.trim();
    if (version.startsWith('2.') === false && version !== '2.0') {
        throw new GltfSchemaError(`Unsupported glTF version: ${version}`);
    }

    return value as unknown as GltfRootJson;
};

const parseJsonText = (value: string): GltfRootJson => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch (error) {
        throw new GltfSchemaError('Failed to parse glTF JSON', error);
    }

    return parseRootJson(parsed);
};

const parseGlb = (bytes: Uint8Array): Pick<NormalizedGltfSource, 'format' | 'json' | 'binChunk'> => {
    if (bytes.byteLength < 20) {
        throw new GltfContainerError('GLB payload is too small');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    const version = view.getUint32(4, true);
    const length = view.getUint32(8, true);

    if (magic !== GLB_MAGIC) {
        throw new GltfContainerError('GLB magic header is invalid');
    }

    if (version !== 2) {
        throw new GltfContainerError(`Unsupported GLB version: ${version}`);
    }

    if (length > bytes.byteLength) {
        throw new GltfContainerError('GLB declared length exceeds payload size');
    }

    let offset = 12;
    let jsonChunk: Uint8Array | undefined;
    let binChunk: Uint8Array | undefined;

    while (offset + 8 <= length) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        offset += 8;

        if (offset + chunkLength > length) {
            throw new GltfContainerError('GLB chunk exceeds declared container length');
        }

        const chunk = new Uint8Array(bytes.buffer, bytes.byteOffset + offset, chunkLength);
        if (chunkType === GLB_JSON_CHUNK) {
            jsonChunk = new Uint8Array(chunk);
        } else if (chunkType === GLB_BIN_CHUNK && !binChunk) {
            binChunk = new Uint8Array(chunk);
        }

        offset += chunkLength;
    }

    if (!jsonChunk) {
        throw new GltfContainerError('GLB container does not contain a JSON chunk');
    }

    return {
        format: 'glb',
        json: parseJsonText(trimNullCharacters(decodeUtf8(jsonChunk))),
        binChunk,
    };
};

const normalizePackageResources = (
    resources: readonly GltfPackageResourceInput[] | undefined,
    sourceUri: string | undefined
): ReadonlyMap<string, GltfResolvedResource> => {
    const map = new Map<string, GltfResolvedResource>();
    for (const resource of resources ?? EMPTY_ARRAY) {
        const bytes = toUint8Array(resource.data);
        const absoluteUri = resolveRelativeUri(sourceUri, resource.uri);
        const resolved = Object.freeze({
            uri: absoluteUri,
            bytes,
            mimeType: resource.mimeType,
        }) as GltfResolvedResource;
        map.set(resource.uri, resolved);
        map.set(absoluteUri, resolved);
    }
    return map;
};

const normalizeGltfSource = (source: AssetImportSource): NormalizedGltfSource => {
    if (isGltfPackageSource(source)) {
        const json =
            typeof source.data.json === 'string'
                ? parseJsonText(source.data.json)
                : parseRootJson(source.data.json);
        return {
            format: 'gltf',
            json,
            sourceUri: source.uri,
            resources: normalizePackageResources(source.data.resources, source.uri),
        };
    }

    if (source.kind === 'json') {
        return {
            format: inferFormatFromSource(source) ?? 'gltf',
            json: parseRootJson(source.data),
            sourceUri: source.uri,
            resources: new Map<string, GltfResolvedResource>(),
        };
    }

    if (source.kind === 'text') {
        return {
            format: inferFormatFromSource(source) ?? 'gltf',
            json: parseJsonText(source.data),
            sourceUri: source.uri,
            resources: new Map<string, GltfResolvedResource>(),
        };
    }

    if (source.kind === 'bytes') {
        const bytes = toUint8Array(source.data);
        if (inferFormatFromSource(source) === 'glb') {
            const parsed = parseGlb(bytes);
            return {
                ...parsed,
                sourceUri: source.uri,
                resources: new Map<string, GltfResolvedResource>(),
            };
        }

        return {
            format: 'gltf',
            json: parseJsonText(decodeUtf8(bytes)),
            sourceUri: source.uri,
            resources: new Map<string, GltfResolvedResource>(),
        };
    }

    throw new GltfSchemaError(`Unsupported source kind for glTF importer: ${source.kind}`);
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

const readComponent = (
    view: DataView,
    offset: number,
    componentType: GltfAccessorJson['componentType']
): number => {
    switch (componentType) {
        case 5120:
            return view.getInt8(offset);
        case 5121:
            return view.getUint8(offset);
        case 5122:
            return view.getInt16(offset, true);
        case 5123:
            return view.getUint16(offset, true);
        case 5125:
            return view.getUint32(offset, true);
        case 5126:
            return view.getFloat32(offset, true);
    }
};

const normalizeComponent = (
    value: number,
    componentType: GltfAccessorJson['componentType']
): number => {
    switch (componentType) {
        case 5120:
            return Math.max(value / 127, -1);
        case 5121:
            return value / 255;
        case 5122:
            return Math.max(value / 32767, -1);
        case 5123:
            return value / 65535;
        case 5125:
            return value / 4294967295;
        default:
            return value;
    }
};

const decodeIndicesBuffer = (
    data: Uint8Array,
    componentType: 5121 | 5123 | 5125,
    count: number
): Uint32Array => {
    const result = new Uint32Array(count);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stride = componentTypeByteSize(componentType);

    for (let index = 0; index < count; index += 1) {
        result[index] = readComponent(view, index * stride, componentType);
    }

    return result;
};

const mapWrapMode = (
    value: GltfSamplerJson['wrapS'] | GltfSamplerJson['wrapT'] | undefined
): WrapMode => {
    switch (value) {
        case 33071:
            return WrapMode.CLAMP_TO_EDGE;
        case 33648:
            return WrapMode.MIRRORED_REPEAT;
        case 10497:
        default:
            return WrapMode.REPEAT;
    }
};

const mapMinFilter = (value: GltfSamplerJson['minFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
            return FilterMode.LINEAR;
        case 9984:
            return FilterMode.NEAREST_MIPMAP_NEAREST;
        case 9985:
            return FilterMode.LINEAR_MIPMAP_NEAREST;
        case 9986:
            return FilterMode.NEAREST_MIPMAP_LINEAR;
        case 9987:
        default:
            return FilterMode.LINEAR_MIPMAP_LINEAR;
    }
};

const mapMagFilter = (value: GltfSamplerJson['magFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
        default:
            return FilterMode.LINEAR;
    }
};

const inferTextureFormat = (payload: GltfTexturePayload): TextureFormat | undefined => {
    if (payload.kind === 'compressed') {
        return payload.targetFormat;
    }

    const mimeType = payload.mimeType?.toLowerCase();
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        return TextureFormat.RGB8;
    }
    if (mimeType === 'image/png' || mimeType === 'image/webp') {
        return TextureFormat.RGBA8;
    }
    if (mimeType === 'image/ktx2') {
        return TextureFormat.RGBA8;
    }
    return undefined;
};

const inferCompressedContainer = (
    mimeType: string | undefined,
    uri: string | undefined
): 'ktx2' | 'basisu' | undefined => {
    const normalizedMime = mimeType?.toLowerCase();
    const normalizedUri = uri?.toLowerCase();
    if (normalizedMime === 'image/ktx2' || normalizedUri?.endsWith('.ktx2')) {
        return 'ktx2';
    }
    if (normalizedMime === 'image/basis' || normalizedUri?.endsWith('.basis')) {
        return 'basisu';
    }
    return undefined;
};

const createTextureTransform = (binding: GltfTextureBindingJson | undefined): GltfTextureTransform | undefined => {
    const transform = binding?.extensions?.KHR_texture_transform;
    if (!transform && binding?.texCoord === undefined) {
        return undefined;
    }

    return Object.freeze({
        offset: Object.freeze([...(transform?.offset ?? [0, 0])]) as readonly [number, number],
        scale: Object.freeze([...(transform?.scale ?? [1, 1])]) as readonly [number, number],
        rotation: transform?.rotation ?? 0,
        texCoord: transform?.texCoord ?? binding?.texCoord ?? 0,
    });
};

const createMaterialTextureBinding = (
    usage: GltfTextureUsage,
    key: string,
    json: GltfTextureBindingJson,
    colorSpace: 'linear' | 'srgb'
): GltfMaterialTextureBinding =>
    Object.freeze({
        textureKey: key,
        usage,
        texCoord: json.texCoord ?? 0,
        colorSpace,
        transform: createTextureTransform(json),
        ...(json.scale !== undefined ? { scale: json.scale } : {}),
        ...(json.strength !== undefined ? { strength: json.strength } : {}),
    });

const topologicalModeToSceneTopology = (
    mode: number
): 'triangles' | 'lines' | 'points' => {
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

const decomposeNodeTransform = (
    node: GltfNodeJson
): {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
} => {
    if (node.matrix && node.matrix.length === 16) {
        const m = node.matrix;
        const sx = Math.hypot(m[0], m[1], m[2]);
        const sy = Math.hypot(m[4], m[5], m[6]);
        const sz = Math.hypot(m[8], m[9], m[10]);
        const rm00 = sx === 0 ? 1 : m[0] / sx;
        const rm01 = sx === 0 ? 0 : m[1] / sx;
        const rm02 = sx === 0 ? 0 : m[2] / sx;
        const rm10 = sy === 0 ? 0 : m[4] / sy;
        const rm11 = sy === 0 ? 1 : m[5] / sy;
        const rm12 = sy === 0 ? 0 : m[6] / sy;
        const rm20 = sz === 0 ? 0 : m[8] / sz;
        const rm21 = sz === 0 ? 0 : m[9] / sz;
        const rm22 = sz === 0 ? 1 : m[10] / sz;
        const trace = rm00 + rm11 + rm22;
        let x = 0;
        let y = 0;
        let z = 0;
        let w = 1;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (rm21 - rm12) / s;
            y = (rm02 - rm20) / s;
            z = (rm10 - rm01) / s;
        } else if (rm00 > rm11 && rm00 > rm22) {
            const s = Math.sqrt(1 + rm00 - rm11 - rm22) * 2;
            w = (rm21 - rm12) / s;
            x = 0.25 * s;
            y = (rm01 + rm10) / s;
            z = (rm02 + rm20) / s;
        } else if (rm11 > rm22) {
            const s = Math.sqrt(1 + rm11 - rm00 - rm22) * 2;
            w = (rm02 - rm20) / s;
            x = (rm01 + rm10) / s;
            y = 0.25 * s;
            z = (rm12 + rm21) / s;
        } else {
            const s = Math.sqrt(1 + rm22 - rm00 - rm11) * 2;
            w = (rm10 - rm01) / s;
            x = (rm02 + rm20) / s;
            y = (rm12 + rm21) / s;
            z = 0.25 * s;
        }

        return {
            position: [m[12], m[13], m[14]],
            rotation: [x, y, z, w],
            scale: [sx || 1, sy || 1, sz || 1],
        };
    }

    return {
        position: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
    };
};

const createTransformSnapshot = (node: GltfNodeJson): SceneComponentSnapshot => {
    const transform = decomposeNodeTransform(node);
    return Object.freeze({
        type: 'Transform',
        data: Object.freeze({
            position: Object.freeze([...transform.position]),
            rotation: Object.freeze([...transform.rotation]),
            scale: Object.freeze([...transform.scale]),
        }),
    });
};

const createMeshRendererSnapshot = (
    meshKey: string,
    materialKey: string | undefined
): SceneComponentSnapshot =>
    Object.freeze({
        type: 'MeshRenderer',
        data: Object.freeze({
            meshId: meshKey,
            materialId: materialKey ?? null,
            visible: true,
            renderOrder: 0,
            passId: 'main',
            receiveLighting: true,
            uniformOverrides: Object.freeze({}),
        }),
    });

class GltfResourceRuntime {
    private readonly _buffers = new Map<number, Promise<Uint8Array>>();
    private readonly _bufferViews = new Map<number, Promise<Uint8Array>>();

    constructor(
        readonly source: NormalizedGltfSource,
        readonly importSource: AssetImportSource,
        readonly resourceResolver: GltfImporterOptions['resourceResolver']
    ) {}

    async resolveBuffer(index: number): Promise<Uint8Array> {
        const existing = this._buffers.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._loadBuffer(index);
        this._buffers.set(index, promise);
        return promise;
    }

    async resolveBufferView(index: number): Promise<Uint8Array> {
        const existing = this._bufferViews.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._loadBufferView(index);
        this._bufferViews.set(index, promise);
        return promise;
    }

    async resolveImage(imageIndex: number): Promise<GltfTexturePayload> {
        const image = this.source.json.images?.[imageIndex];
        if (!image) {
            throw new GltfSchemaError(`Missing image ${imageIndex}`);
        }

        if (image.bufferView !== undefined) {
            const bytes = await this.resolveBufferView(image.bufferView);
            const container = inferCompressedContainer(image.mimeType, image.uri);
            if (container) {
                return Object.freeze({
                    kind: 'compressed',
                    bytes,
                    container,
                    mimeType: image.mimeType,
                    uri: image.uri,
                } satisfies GltfCompressedTexturePayload);
            }

            return Object.freeze({
                kind: 'raw',
                bytes,
                mimeType: image.mimeType,
                uri: image.uri,
            });
        }

        if (image.uri?.startsWith('data:')) {
            const decoded = parseDataUri(image.uri);
            const container = inferCompressedContainer(decoded.mimeType ?? image.mimeType, image.uri);
            if (container) {
                return Object.freeze({
                    kind: 'compressed',
                    bytes: decoded.bytes,
                    container,
                    mimeType: decoded.mimeType ?? image.mimeType,
                    uri: image.uri,
                } satisfies GltfCompressedTexturePayload);
            }

            return Object.freeze({
                kind: 'raw',
                bytes: decoded.bytes,
                mimeType: decoded.mimeType ?? image.mimeType,
                uri: image.uri,
            });
        }

        if (!image.uri) {
            throw new GltfResourceError(
                `Image ${imageIndex} does not provide data`,
                `image:${imageIndex}`,
                'image'
            );
        }

        const resource = await this._resolveExternalResource(image.uri, 'image', image.mimeType);
        if (!resource) {
            return Object.freeze({
                kind: 'external',
                uri: resolveRelativeUri(this.source.sourceUri, image.uri),
                mimeType: image.mimeType,
            });
        }

        const container = inferCompressedContainer(resource.mimeType ?? image.mimeType, resource.uri);
        if (container) {
            return Object.freeze({
                kind: 'compressed',
                bytes: resource.bytes,
                container,
                mimeType: resource.mimeType ?? image.mimeType,
                uri: resource.uri,
            } satisfies GltfCompressedTexturePayload);
        }

        return Object.freeze({
            kind: 'raw',
            bytes: resource.bytes,
            mimeType: resource.mimeType ?? image.mimeType,
            uri: resource.uri,
        });
    }

    private async _loadBuffer(index: number): Promise<Uint8Array> {
        const buffer = this.source.json.buffers?.[index];
        if (!buffer) {
            throw new GltfSchemaError(`Missing buffer ${index}`);
        }

        if (!buffer.uri) {
            if (index === 0 && this.source.binChunk) {
                return this.source.binChunk.byteLength === buffer.byteLength
                    ? this.source.binChunk
                    : this.source.binChunk.subarray(0, buffer.byteLength);
            }

            throw new GltfResourceError(
                `Buffer ${index} is missing inline data and no GLB BIN chunk is available`,
                `buffer:${index}`,
                'buffer'
            );
        }

        if (buffer.uri.startsWith('data:')) {
            return parseDataUri(buffer.uri).bytes;
        }

        const resource = await this._resolveExternalResource(buffer.uri, 'buffer');
        if (!resource) {
            throw new GltfResourceError(
                `Unable to resolve external buffer: ${buffer.uri}`,
                buffer.uri,
                'buffer'
            );
        }

        return resource.bytes;
    }

    private async _loadBufferView(index: number): Promise<Uint8Array> {
        const bufferView = this.source.json.bufferViews?.[index];
        if (!bufferView) {
            throw new GltfSchemaError(`Missing bufferView ${index}`);
        }

        const buffer = await this.resolveBuffer(bufferView.buffer);
        const byteOffset = bufferView.byteOffset ?? 0;
        return buffer.subarray(byteOffset, byteOffset + bufferView.byteLength);
    }

    private async _resolveExternalResource(
        resourceUri: string,
        kind: 'buffer' | 'image',
        mimeType?: string
    ): Promise<GltfResolvedResource | undefined> {
        const absoluteUri = resolveRelativeUri(this.source.sourceUri, resourceUri);
        const preloaded =
            this.source.resources.get(resourceUri) ?? this.source.resources.get(absoluteUri);
        if (preloaded) {
            return preloaded;
        }

        if (!this.resourceResolver) {
            return undefined;
        }

        const request = Object.freeze({
            uri: resourceUri,
            absoluteUri,
            kind,
            mimeType,
            source: this.importSource,
        } satisfies GltfResourceRequest);
        const resolved = await this.resourceResolver(request);
        if (!resolved) {
            return undefined;
        }

        return Object.freeze({
            uri: resolved.uri || absoluteUri,
            bytes: resolved.bytes,
            mimeType: resolved.mimeType ?? mimeType,
        });
    }
}

class GltfAccessorRuntime {
    private readonly _accessors = new Map<number, Promise<DecodedAccessor>>();
    private readonly _indices = new Map<number, Promise<Uint32Array>>();

    constructor(readonly runtime: GltfResourceRuntime) {}

    async decodeAccessor(index: number): Promise<DecodedAccessor> {
        const existing = this._accessors.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._decodeAccessor(index);
        this._accessors.set(index, promise);
        return promise;
    }

    async decodeIndices(index: number): Promise<Uint32Array> {
        const existing = this._indices.get(index);
        if (existing) {
            return existing;
        }

        const promise = this._decodeIndices(index);
        this._indices.set(index, promise);
        return promise;
    }

    private async _decodeAccessor(index: number): Promise<DecodedAccessor> {
        const accessor = this.runtime.source.json.accessors?.[index];
        if (!accessor) {
            throw new GltfAccessorError(`Missing accessor ${index}`, index);
        }

        const componentCount = accessorComponentCount(accessor.type);
        const elementSize = componentCount * componentTypeByteSize(accessor.componentType);
        const values = new Float32Array(accessor.count * componentCount);

        if (accessor.bufferView !== undefined) {
            const bufferView = this.runtime.source.json.bufferViews?.[accessor.bufferView];
            if (!bufferView) {
                throw new GltfAccessorError(
                    `Accessor ${index} references a missing bufferView`,
                    index
                );
            }

            const bytes = await this.runtime.resolveBufferView(accessor.bufferView);
            const stride = bufferView.byteStride ?? elementSize;
            if (stride < elementSize) {
                throw new GltfAccessorError(`Accessor ${index} has an invalid byteStride`, index);
            }

            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const accessorOffset = accessor.byteOffset ?? 0;

            for (let element = 0; element < accessor.count; element += 1) {
                const elementOffset = accessorOffset + element * stride;
                for (let component = 0; component < componentCount; component += 1) {
                    const raw = readComponent(
                        view,
                        elementOffset + component * componentTypeByteSize(accessor.componentType),
                        accessor.componentType
                    );
                    values[element * componentCount + component] = accessor.normalized
                        ? normalizeComponent(raw, accessor.componentType)
                        : raw;
                }
            }
        }

        if (accessor.sparse) {
            await this._applySparse(accessor, index, values, componentCount);
        }

        return Object.freeze({
            count: accessor.count,
            componentCount,
            values,
            min: accessor.min ? Object.freeze([...accessor.min]) : undefined,
            max: accessor.max ? Object.freeze([...accessor.max]) : undefined,
        });
    }

    private async _decodeIndices(index: number): Promise<Uint32Array> {
        const accessor = this.runtime.source.json.accessors?.[index];
        if (!accessor) {
            throw new GltfAccessorError(`Missing accessor ${index}`, index);
        }

        if (accessor.type !== 'SCALAR') {
            throw new GltfAccessorError(`Index accessor ${index} must use SCALAR type`, index);
        }

        if (
            accessor.componentType !== 5121 &&
            accessor.componentType !== 5123 &&
            accessor.componentType !== 5125
        ) {
            throw new GltfAccessorError(
                `Index accessor ${index} has an invalid component type`,
                index
            );
        }

        const values = new Uint32Array(accessor.count);
        if (accessor.bufferView !== undefined) {
            const bufferView = this.runtime.source.json.bufferViews?.[accessor.bufferView];
            if (!bufferView) {
                throw new GltfAccessorError(
                    `Accessor ${index} references a missing bufferView`,
                    index
                );
            }

            const bytes = await this.runtime.resolveBufferView(accessor.bufferView);
            const stride = bufferView.byteStride ?? componentTypeByteSize(accessor.componentType);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const accessorOffset = accessor.byteOffset ?? 0;

            for (let element = 0; element < accessor.count; element += 1) {
                values[element] = readComponent(
                    view,
                    accessorOffset + element * stride,
                    accessor.componentType
                );
            }
        }

        if (accessor.sparse) {
            const sparseIndicesBytes = await this.runtime.resolveBufferView(
                accessor.sparse.indices.bufferView
            );
            const sparseIndices = decodeIndicesBuffer(
                sparseIndicesBytes.subarray(accessor.sparse.indices.byteOffset ?? 0),
                accessor.sparse.indices.componentType,
                accessor.sparse.count
            );
            const sparseValuesBytes = await this.runtime.resolveBufferView(
                accessor.sparse.values.bufferView
            );
            const sparseView = new DataView(
                sparseValuesBytes.buffer,
                sparseValuesBytes.byteOffset + (accessor.sparse.values.byteOffset ?? 0),
                sparseValuesBytes.byteLength - (accessor.sparse.values.byteOffset ?? 0)
            );
            const stride = componentTypeByteSize(accessor.componentType);

            for (let element = 0; element < sparseIndices.length; element += 1) {
                const targetIndex = sparseIndices[element]!;
                values[targetIndex] = readComponent(
                    sparseView,
                    element * stride,
                    accessor.componentType
                );
            }
        }

        return values;
    }

    private async _applySparse(
        accessor: GltfAccessorJson,
        accessorIndex: number,
        target: Float32Array,
        componentCount: number
    ): Promise<void> {
        if (!accessor.sparse) {
            return;
        }

        const indexBytes = await this.runtime.resolveBufferView(accessor.sparse.indices.bufferView);
        const sparseIndices = decodeIndicesBuffer(
            indexBytes.subarray(accessor.sparse.indices.byteOffset ?? 0),
            accessor.sparse.indices.componentType,
            accessor.sparse.count
        );
        const valueBytes = await this.runtime.resolveBufferView(accessor.sparse.values.bufferView);
        const elementSize = componentCount * componentTypeByteSize(accessor.componentType);
        const view = new DataView(
            valueBytes.buffer,
            valueBytes.byteOffset + (accessor.sparse.values.byteOffset ?? 0),
            valueBytes.byteLength - (accessor.sparse.values.byteOffset ?? 0)
        );

        for (let element = 0; element < sparseIndices.length; element += 1) {
            const targetIndex = sparseIndices[element]!;
            const elementOffset = element * elementSize;
            for (let component = 0; component < componentCount; component += 1) {
                const raw = readComponent(
                    view,
                    elementOffset + component * componentTypeByteSize(accessor.componentType),
                    accessor.componentType
                );
                target[targetIndex * componentCount + component] = accessor.normalized
                    ? normalizeComponent(raw, accessor.componentType)
                    : raw;
            }
        }
    }
}

const collectTextureUsages = (root: GltfRootJson): Map<number, Set<GltfTextureUsage>> => {
    const usages = new Map<number, Set<GltfTextureUsage>>();
    const addUsage = (textureIndex: number | undefined, usage: GltfTextureUsage): void => {
        if (textureIndex === undefined) {
            return;
        }

        const set = usages.get(textureIndex) ?? new Set<GltfTextureUsage>();
        if (!usages.has(textureIndex)) {
            usages.set(textureIndex, set);
        }
        set.add(usage);
    };

    for (const material of root.materials ?? EMPTY_ARRAY) {
        addUsage(material.pbrMetallicRoughness?.baseColorTexture?.index, 'baseColor');
        addUsage(
            material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
            'metallicRoughness'
        );
        addUsage(material.normalTexture?.index, 'normal');
        addUsage(material.occlusionTexture?.index, 'occlusion');
        addUsage(material.emissiveTexture?.index, 'emissive');
    }

    return usages;
};

const createSamplerDefinition = (
    index: number | undefined,
    sampler: GltfSamplerJson | undefined,
    fallbackId: string
): GltfTextureSampler =>
    Object.freeze({
        id: index === undefined ? fallbackId : `gltf/sampler/${index}`,
        minFilter: mapMinFilter(sampler?.minFilter),
        magFilter: mapMagFilter(sampler?.magFilter),
        wrapS: mapWrapMode(sampler?.wrapS),
        wrapT: mapWrapMode(sampler?.wrapT),
    });

const createDocumentName = (
    normalized: NormalizedGltfSource,
    explicitName: string | undefined
): string =>
    sanitizeName(
        explicitName ??
            normalized.json.scenes?.[normalized.json.scene ?? 0]?.name ??
            stripExtension(basenameOfUri(normalized.sourceUri)) ??
            normalized.json.asset.generator,
        DEFAULT_DOCUMENT_NAME
    );

const ensureArray = <T>(value: readonly T[] | undefined): readonly T[] => value ?? EMPTY_ARRAY;

const mapAttributeSemantic = (
    value: SupportedAttributeSemantic
): SceneMeshDefinition['attributes'][number]['semantic'] => {
    switch (value) {
        case 'POSITION':
            return 'position';
        case 'NORMAL':
            return 'normal';
        case 'TEXCOORD_0':
            return 'uv0';
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

const buildMeshDefinition = async (
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

const createDefaultMaterialDefinition = (
    shaderId: string
): SceneMaterialDefinition =>
    Object.freeze({
        id: '',
        shaderId,
        uniforms: Object.freeze({
            _BaseColorFactor: Object.freeze([1, 1, 1, 1]),
            _MetallicFactor: 1,
            _RoughnessFactor: 1,
            _EmissiveFactor: Object.freeze([0, 0, 0]),
            _AlphaMode: 0,
            _AlphaCutoff: 0.5,
            _DoubleSided: 0,
        }),
        textures: Object.freeze({}),
    });

const createMaterialDefinition = (
    material: GltfMaterialJson,
    shaderId: string,
    textureKeys: readonly string[]
): {
    readonly definition: SceneMaterialDefinition;
    readonly textures: Readonly<Record<GltfTextureUsage, GltfMaterialTextureBinding>>;
    readonly alphaMode: GltfMaterialAlphaMode;
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
    readonly unlit: boolean;
} => {
    const uniforms: Record<string, number | readonly number[]> = {
        _BaseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
        _MetallicFactor: material.pbrMetallicRoughness?.metallicFactor ?? 1,
        _RoughnessFactor: material.pbrMetallicRoughness?.roughnessFactor ?? 1,
        _EmissiveFactor: material.emissiveFactor ?? [0, 0, 0],
        _AlphaMode:
            material.alphaMode === 'MASK' ? 1 : material.alphaMode === 'BLEND' ? 2 : 0,
        _AlphaCutoff: material.alphaCutoff ?? 0.5,
        _DoubleSided: material.doubleSided ? 1 : 0,
    };
    const textureBindings: Record<string, string> = {};
    const textures: Partial<Record<GltfTextureUsage, GltfMaterialTextureBinding>> = {};

    const addTexture = (
        slot: GltfTextureUsage,
        source: GltfTextureBindingJson | undefined,
        uniformName: string,
        colorSpace: 'linear' | 'srgb'
    ): void => {
        if (!source) {
            return;
        }

        const textureKey = textureKeys[source.index];
        if (!textureKey) {
            throw new GltfSchemaError(
                `Material references missing texture ${source.index}`
            );
        }

        textureBindings[uniformName] = textureKey;
        const binding = createMaterialTextureBinding(slot, textureKey, source, colorSpace);
        textures[slot] = binding;
        if (binding.transform) {
            uniforms[`${uniformName}_ST`] = Object.freeze([
                binding.transform.scale[0],
                binding.transform.scale[1],
                binding.transform.offset[0],
                binding.transform.offset[1],
            ]);
        }
        if (binding.scale !== undefined) {
            uniforms[`${uniformName}_Scale`] = binding.scale;
        }
        if (binding.strength !== undefined) {
            uniforms[`${uniformName}_Strength`] = binding.strength;
        }
    };

    addTexture(
        'baseColor',
        material.pbrMetallicRoughness?.baseColorTexture,
        '_BaseColorTexture',
        'srgb'
    );
    addTexture(
        'metallicRoughness',
        material.pbrMetallicRoughness?.metallicRoughnessTexture,
        '_MetallicRoughnessTexture',
        'linear'
    );
    addTexture('normal', material.normalTexture, '_NormalTexture', 'linear');
    addTexture('occlusion', material.occlusionTexture, '_OcclusionTexture', 'linear');
    addTexture('emissive', material.emissiveTexture, '_EmissiveTexture', 'srgb');

    const unlit = material.extensions?.KHR_materials_unlit !== undefined;

    return {
        definition: Object.freeze({
            id: '',
            shaderId: unlit ? 'gltf/unlit' : shaderId,
            uniforms: Object.freeze(uniforms),
            textures: Object.freeze(textureBindings),
        }),
        textures: Object.freeze(
            textures as Record<GltfTextureUsage, GltfMaterialTextureBinding>
        ),
        alphaMode: material.alphaMode ?? 'OPAQUE',
        alphaCutoff: material.alphaCutoff ?? 0.5,
        doubleSided: material.doubleSided ?? false,
        unlit,
    };
};

const createActorSnapshot = (
    nodeId: string,
    parentNodeId: string | null,
    name: string,
    components: readonly SceneComponentSnapshot[]
): SceneActorSnapshot =>
    Object.freeze({
        nodeId,
        parentNodeId,
        name,
        layer: 0,
        tag: 'Default',
        active: true,
        persistent: false,
        pooled: false,
        components,
    });

const buildPrefabDefinition = (
    root: GltfRootJson,
    sceneIndex: number,
    meshKeysByMesh: readonly (readonly string[])[],
    materialKeysByMesh: readonly (readonly (string | undefined)[])[]
): PrefabBuildResult => {
    const scene = root.scenes?.[sceneIndex];
    if (!scene) {
        throw new GltfSchemaError(`Missing scene ${sceneIndex}`);
    }

    const actors: SceneActorSnapshot[] = [];
    const rootNodeIds: string[] = [];
    const nodeIds: string[] = [];
    const meshKeys = new Set<string>();
    const materialKeys = new Set<string>();

    const visitNode = (nodeIndex: number, parentNodeId: string | null): void => {
        const node = root.nodes?.[nodeIndex];
        if (!node) {
            throw new GltfSchemaError(`Missing node ${nodeIndex}`);
        }

        const baseNodeId = `node/${nodeIndex}`;
        if (parentNodeId === null) {
            rootNodeIds.push(baseNodeId);
        }

        const primitives =
            node.mesh !== undefined ? meshKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const primitiveMaterials =
            node.mesh !== undefined ? materialKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const transformComponent = createTransformSnapshot(node);
        const nodeName = sanitizeName(node.name, `Node ${nodeIndex}`);

        if (primitives.length <= 1) {
            const components =
                primitives.length === 1
                    ? Object.freeze([
                          transformComponent,
                          createMeshRendererSnapshot(
                              primitives[0]!,
                              primitiveMaterials[0]
                          ),
                      ])
                    : Object.freeze([transformComponent]);

            actors.push(createActorSnapshot(baseNodeId, parentNodeId, nodeName, components));
            nodeIds.push(baseNodeId);

            if (primitives.length === 1) {
                meshKeys.add(primitives[0]!);
                if (primitiveMaterials[0]) {
                    materialKeys.add(primitiveMaterials[0]!);
                }
            }
        } else {
            actors.push(
                createActorSnapshot(
                    baseNodeId,
                    parentNodeId,
                    nodeName,
                    Object.freeze([transformComponent])
                )
            );
            nodeIds.push(baseNodeId);

            for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
                const primitiveNodeId = `${baseNodeId}/primitive/${primitiveIndex}`;
                actors.push(
                    createActorSnapshot(
                        primitiveNodeId,
                        baseNodeId,
                        `${nodeName} Primitive ${primitiveIndex}`,
                        Object.freeze([
                            Object.freeze({
                                type: 'Transform',
                                data: Object.freeze({
                                    position: Object.freeze([0, 0, 0]),
                                    rotation: Object.freeze([0, 0, 0, 1]),
                                    scale: Object.freeze([1, 1, 1]),
                                }),
                            }),
                            createMeshRendererSnapshot(
                                primitives[primitiveIndex]!,
                                primitiveMaterials[primitiveIndex]
                            ),
                        ])
                    )
                );
                nodeIds.push(primitiveNodeId);
                meshKeys.add(primitives[primitiveIndex]!);
                if (primitiveMaterials[primitiveIndex]) {
                    materialKeys.add(primitiveMaterials[primitiveIndex]!);
                }
            }
        }

        for (const child of ensureArray(node.children)) {
            visitNode(child, baseNodeId);
        }
    };

    for (const rootNode of ensureArray(scene.nodes)) {
        visitNode(rootNode, null);
    }

    return {
        prefab: Object.freeze({
            id: `gltf/scene/${sceneIndex}`,
            actors: Object.freeze(actors),
        }),
        rootNodeIds: Object.freeze(rootNodeIds),
        nodeIds: Object.freeze(nodeIds),
        meshKeys: Object.freeze([...meshKeys]),
        materialKeys: Object.freeze([...materialKeys]),
    };
};

export class GltfTextureTranscoderRegistry {
    private readonly _transcoders = new Map<string, GltfTextureTranscoder>();

    constructor(transcoders: readonly GltfTextureTranscoder[] = EMPTY_ARRAY) {
        for (const transcoder of transcoders) {
            this.register(transcoder);
        }
    }

    register(transcoder: GltfTextureTranscoder): this {
        this._transcoders.set(transcoder.id, transcoder);
        return this;
    }

    unregister(id: string): boolean {
        return this._transcoders.delete(id);
    }

    list(): readonly GltfTextureTranscoder[] {
        return Object.freeze(
            [...this._transcoders.values()].sort(
                (left, right) =>
                    (right.priority ?? 0) - (left.priority ?? 0) ||
                    left.id.localeCompare(right.id)
            )
        );
    }

    resolve(request: Readonly<GltfTextureTranscodeRequest>): GltfTextureTranscoder | undefined {
        return this.list().find((transcoder) => transcoder.canTranscode(request));
    }

    async transcode(
        request: Readonly<GltfTextureTranscodeRequest>
    ): Promise<GltfTextureTranscodeResult | undefined> {
        const transcoder = this.resolve(request);
        return transcoder ? transcoder.transcode(request) : undefined;
    }
}

const isTextureWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>
): boolean => input.kind === 'gltf.texture';

const applyTextureTranscode = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>,
    result: GltfTextureTranscodeResult
): AssetWriteInput<TSchema> => {
    const data = input.data as unknown as GltfTextureAsset;
    const updated = Object.freeze({
        ...data,
        payload: result.payload ?? data.payload,
        runtimeFormat: result.runtimeFormat ?? data.runtimeFormat,
        transcode: result.state,
    }) as unknown as TSchema['gltf.texture'];

    return Object.freeze({
        ...input,
        data: updated,
    }) as unknown as AssetWriteInput<TSchema>;
};

const asWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<any>
): AssetWriteInput<TSchema> => input as unknown as AssetWriteInput<TSchema>;

export const createGltfTextureTranscodeStage = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfTextureTranscodeStageOptions<TSchema> = {}
): GltfTranscodeStage<TSchema> => {
    const registry = options.registry ?? new GltfTextureTranscoderRegistry();

    return {
        id: options.id ?? 'gltf.texture.transcode',
        phases: ['after-import'],
        run: async (context) => {
            if (context.phase !== 'after-import') {
                return {};
            }

            const { result, signal } = context;
            const diagnostics: AssetImportDiagnostic[] = [];
            let primary = result.primary;
            let primaryChanged = false;
            let additionalChanged = false;
            const additional = result.additional ? [...result.additional] : undefined;

            if (isTextureWrite(primary)) {
                const transcode = await registry.transcode({
                    texture: primary.data as unknown as GltfTextureAsset,
                    signal,
                });
                if (transcode) {
                    primary = applyTextureTranscode(primary, transcode);
                    primaryChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (additional) {
                for (let index = 0; index < additional.length; index += 1) {
                    const entry = additional[index]!;
                    if (!isTextureWrite(entry)) {
                        continue;
                    }

                    const transcode = await registry.transcode({
                        texture: entry.data as unknown as GltfTextureAsset,
                        signal,
                    });
                    if (!transcode) {
                        continue;
                    }

                    additional[index] = applyTextureTranscode(entry, transcode);
                    additionalChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (!primaryChanged && !additionalChanged && diagnostics.length === 0) {
                return {};
            }

            return {
                result: Object.freeze({
                    ...result,
                    primary,
                    ...(additional
                        ? {
                              additional: Object.freeze(additional),
                          }
                        : {}),
                    diagnostics:
                        diagnostics.length > 0
                            ? Object.freeze([
                                  ...(result.diagnostics ?? EMPTY_ARRAY),
                                  ...diagnostics,
                              ])
                            : result.diagnostics,
                }),
            };
        },
    };
};

export const createPassthroughGltfTextureTranscoder = (
    targetFormat?: TextureFormat
): GltfTextureTranscoder => ({
    id: 'gltf.texture.passthrough',
    priority: -100,
    canTranscode: () => true,
    transcode: ({ texture }) => ({
        runtimeFormat: texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        state: {
            status: 'source',
            transcoderId: 'gltf.texture.passthrough',
            targetFormat:
                texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        },
    }),
});

export const createGltfImporter = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfImporterOptions<TSchema> = {}
): GltfImporter<TSchema> => {
    const freeze = options.freeze !== false;
    const materialShaderId = options.materialShaderId ?? 'gltf/pbr';
    const fallbackSamplerId = options.defaultSamplerId ?? DEFAULT_SAMPLER_ID;

    const importer = {
        id: options.id ?? 'asset.gltf',
        sourceKinds: ['bytes', 'text', 'json', 'custom'],
        extensions: ['gltf', 'glb'],
        mimeTypes: ['model/gltf+json', 'model/gltf-binary', 'application/json'],
        canImport: (context: Readonly<{ source: AssetImportSource }>) => {
            const { source } = context;
            if (isGltfPackageSource(source)) {
                return true;
            }

            if (source.kind === 'json') {
                return isPlainObject(source.data) && isPlainObject(source.data.asset);
            }

            if (source.kind === 'text') {
                return source.data.trimStart().startsWith('{');
            }

            if (source.kind === 'bytes') {
                const inferred = inferFormatFromSource(source);
                return inferred === 'glb' || inferred === 'gltf';
            }

            return false;
        },
        import: async (
            context: Readonly<{
                source: AssetImportSource;
                createSubKey: (suffix: string) => string;
            }>
        ) => {
            const { source, createSubKey } = context;
            const normalized = normalizeGltfSource(source);
            const runtime = new GltfResourceRuntime(normalized, source, options.resourceResolver);
            const accessors = new GltfAccessorRuntime(runtime);
            const diagnostics: AssetImportDiagnostic[] = [];
            const textureUsageMap = collectTextureUsages(normalized.json);
            const explicitTextures = normalized.json.textures ?? EMPTY_ARRAY;
            const explicitMaterials = normalized.json.materials ?? EMPTY_ARRAY;
            const explicitMeshes = normalized.json.meshes ?? EMPTY_ARRAY;
            const textureKeys = explicitTextures.map((_, index) =>
                String(createSubKey(`texture/${index}`))
            );
            const materialKeys = explicitMaterials.map((_, index) =>
                String(createSubKey(`material/${index}`))
            );
            const meshKeysByMesh: string[][] = [];
            const materialKeysByMesh: Array<Array<string | undefined>> = [];
            const additional: AssetWriteInput<TSchema>[] = [];
            let defaultMaterialKey: string | undefined;

            for (let textureIndex = 0; textureIndex < explicitTextures.length; textureIndex += 1) {
                const texture = explicitTextures[textureIndex]!;
                if (texture.source === undefined) {
                    diagnostics.push({
                        level: 'warning',
                        code: 'gltf.texture.missing-source',
                        message: `Texture ${textureIndex} does not declare an image source`,
                    });
                    continue;
                }

                const payload = await runtime.resolveImage(texture.source);
                const sampler = createSamplerDefinition(
                    texture.sampler,
                    texture.sampler !== undefined
                        ? normalized.json.samplers?.[texture.sampler]
                        : undefined,
                    fallbackSamplerId
                );
                const usageHints = Object.freeze([
                    ...(textureUsageMap.get(textureIndex) ?? EMPTY_ARRAY),
                ]);
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(texture.name, `Texture ${textureIndex}`),
                        textureIndex,
                        imageIndex: texture.source,
                        sampler,
                        payload,
                        usageHints,
                        runtimeFormat: inferTextureFormat(payload),
                        transcode: Object.freeze({
                            status: 'source',
                            targetFormat: inferTextureFormat(payload),
                        }),
                    } satisfies GltfTextureAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.texture',
                        stableKey: textureKeys[textureIndex],
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.texture'],
                    }))
                );
            }

            const requiresDefaultMaterial = explicitMeshes.some((mesh) =>
                mesh.primitives.some((primitive) => primitive.material === undefined)
            );
            if (requiresDefaultMaterial) {
                defaultMaterialKey = String(createSubKey(DEFAULT_MATERIAL_KEY_SUFFIX));
                const definition = createDefaultMaterialDefinition(materialShaderId);
                const asset = maybeFreeze(
                    {
                        id: DEFAULT_MATERIAL_NAME,
                        materialIndex: -1,
                        definition: Object.freeze({
                            ...definition,
                            id: defaultMaterialKey,
                        }),
                        alphaMode: 'OPAQUE',
                        alphaCutoff: 0.5,
                        doubleSided: false,
                        unlit: false,
                        textures: Object.freeze({}),
                    } satisfies GltfMaterialAsset,
                    freeze
                );
                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: defaultMaterialKey,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                    }))
                );
            }

            for (let materialIndex = 0; materialIndex < explicitMaterials.length; materialIndex += 1) {
                const material = explicitMaterials[materialIndex]!;
                const built = createMaterialDefinition(material, materialShaderId, textureKeys);
                const key = materialKeys[materialIndex]!;
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(material.name, `Material ${materialIndex}`),
                        materialIndex,
                        definition: Object.freeze({
                            ...built.definition,
                            id: key,
                        }),
                        alphaMode: built.alphaMode,
                        alphaCutoff: built.alphaCutoff,
                        doubleSided: built.doubleSided,
                        unlit: built.unlit,
                        textures: built.textures,
                    } satisfies GltfMaterialAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                        dependencies: Object.freeze(
                            Object.values(asset.textures).map((binding) => binding.textureKey)
                        ),
                    }))
                );
            }

            for (let meshIndex = 0; meshIndex < explicitMeshes.length; meshIndex += 1) {
                const mesh = explicitMeshes[meshIndex]!;
                const primitiveKeys: string[] = [];
                const primitiveMaterialKeys: Array<string | undefined> = [];

                for (
                    let primitiveIndex = 0;
                    primitiveIndex < mesh.primitives.length;
                    primitiveIndex += 1
                ) {
                    const primitive = mesh.primitives[primitiveIndex]!;
                    const built = await buildMeshDefinition(primitive, accessors);
                    const key = String(
                        createSubKey(`mesh/${meshIndex}/primitive/${primitiveIndex}`)
                    );
                    const materialKey =
                        primitive.material !== undefined
                            ? materialKeys[primitive.material]
                            : defaultMaterialKey;
                    const meshAsset = maybeFreeze(
                        {
                            id: sanitizeName(
                                mesh.name,
                                `${sanitizeName(mesh.name, `Mesh ${meshIndex}`)} Primitive ${primitiveIndex}`
                            ),
                            meshIndex,
                            primitiveIndex,
                            definition: Object.freeze({
                                ...built.definition,
                                id: key,
                            }),
                            ...(built.bounds ? { bounds: built.bounds } : {}),
                            ...(materialKey ? { materialKey } : {}),
                            ...(primitive.extras ? { extras: primitive.extras } : {}),
                        } satisfies GltfMeshAsset,
                        freeze
                    );

                    additional.push(
                        asWrite<TSchema>(Object.freeze({
                            kind: 'gltf.mesh',
                            stableKey: key,
                            name: meshAsset.id,
                            data: meshAsset as unknown as TSchema['gltf.mesh'],
                            ...(materialKey
                                ? {
                                      dependencies: Object.freeze([materialKey]),
                                  }
                                : {}),
                        }))
                    );
                    primitiveKeys.push(key);
                    primitiveMaterialKeys.push(materialKey);
                }

                meshKeysByMesh[meshIndex] = primitiveKeys;
                materialKeysByMesh[meshIndex] = primitiveMaterialKeys;
            }

            const scenes =
                normalized.json.scenes && normalized.json.scenes.length > 0
                    ? normalized.json.scenes
                    : Object.freeze([
                          Object.freeze({
                              name: 'Scene 0',
                              nodes: Object.freeze(
                                  ensureArray(normalized.json.nodes).map((_, index) => index)
                              ),
                          }),
                      ]);
            const sceneEntries: GltfDocumentSceneAsset[] = [];

            for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
                const built = buildPrefabDefinition(
                    normalized.json,
                    sceneIndex,
                    meshKeysByMesh,
                    materialKeysByMesh
                );
                const key = String(createSubKey(`scene/${sceneIndex}/prefab`));
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(scenes[sceneIndex]?.name, `Scene ${sceneIndex}`),
                        sceneIndex,
                        definition: Object.freeze({
                            ...built.prefab,
                            id: key,
                        }),
                        rootNodeIds: built.rootNodeIds,
                        nodeIds: built.nodeIds,
                        meshKeys: built.meshKeys,
                        materialKeys: built.materialKeys,
                    },
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.prefab',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.prefab'],
                        dependencies: Object.freeze([
                            ...built.meshKeys,
                            ...built.materialKeys,
                        ]),
                    }))
                );
                sceneEntries.push(
                    maybeFreeze(
                        {
                            sceneIndex,
                            name: asset.id,
                            prefabKey: key,
                            rootNodeIds: built.rootNodeIds,
                        } satisfies GltfDocumentSceneAsset,
                        freeze
                    )
                );
            }

            const document = maybeFreeze(
                {
                    id: createDocumentName(normalized, options.documentName),
                    uri: normalized.sourceUri,
                    name: createDocumentName(normalized, options.documentName),
                    format: normalized.format,
                    version: normalized.json.asset.version,
                    ...(normalized.json.asset.generator
                        ? { generator: normalized.json.asset.generator }
                        : {}),
                    ...(normalized.json.asset.copyright
                        ? { copyright: normalized.json.asset.copyright }
                        : {}),
                    defaultScene: Math.min(
                        Math.max(normalized.json.scene ?? 0, 0),
                        Math.max(0, sceneEntries.length - 1)
                    ),
                    scenes: Object.freeze(sceneEntries),
                    meshKeys: Object.freeze(meshKeysByMesh.flat()),
                    materialKeys: Object.freeze(
                        [
                            ...(defaultMaterialKey ? [defaultMaterialKey] : EMPTY_ARRAY),
                            ...materialKeys,
                        ].filter((value): value is string => Boolean(value))
                    ),
                    textureKeys: Object.freeze(textureKeys.filter(Boolean)),
                    extensionsUsed: Object.freeze([
                        ...(normalized.json.extensionsUsed ?? EMPTY_ARRAY),
                    ]),
                    extensionsRequired: Object.freeze([
                        ...(normalized.json.extensionsRequired ?? EMPTY_ARRAY),
                    ]),
                    stats: Object.freeze({
                        sceneCount: sceneEntries.length,
                        nodeCount: ensureArray(normalized.json.nodes).length,
                        meshCount: explicitMeshes.length,
                        primitiveCount: meshKeysByMesh.reduce(
                            (total, entries) => total + entries.length,
                            0
                        ),
                        materialCount:
                            explicitMaterials.length + (defaultMaterialKey ? 1 : 0),
                        textureCount: textureKeys.length,
                    }),
                } satisfies GltfDocumentAsset,
                freeze
            );

            return Object.freeze({
                primary: asWrite<TSchema>(Object.freeze({
                    kind: 'gltf.document',
                    stableKey: String(createSubKey('document')),
                    name: document.name,
                    data: document as unknown as TSchema['gltf.document'],
                    dependencies: Object.freeze([
                        ...document.textureKeys,
                        ...document.materialKeys,
                        ...document.meshKeys,
                        ...document.scenes.map((scene) => scene.prefabKey),
                    ]),
                })),
                additional: Object.freeze(additional),
                diagnostics: Object.freeze(diagnostics),
            }) as AssetImportResult<TSchema>;
        },
    };

    return importer as unknown as GltfImporter<TSchema>;
};
