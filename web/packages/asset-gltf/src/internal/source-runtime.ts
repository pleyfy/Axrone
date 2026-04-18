import type { AssetImportSource } from '../asset-contract';
import { MeshoptDecoder } from 'meshoptimizer';
import {
    GltfContainerError,
    GltfResourceError,
    GltfSchemaError,
} from '../errors';
import type {
    GltfBufferViewJson,
    GltfCompressedTexturePayload,
    GltfImporterOptions,
    GltfPackageInput,
    GltfPackageResourceInput,
    GltfPackageSource,
    GltfResolvedResource,
    GltfResourceRequest,
    GltfRootJson,
    GltfTexturePayload,
} from '../types';

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const EMPTY_ARRAY = Object.freeze([]) as readonly never[];

export interface NormalizedGltfSource {
    readonly format: 'gltf' | 'glb';
    readonly json: GltfRootJson;
    readonly sourceUri?: string;
    readonly binChunk?: Uint8Array;
    readonly resources: ReadonlyMap<string, GltfResolvedResource>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

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

const sliceBufferRange = (
    buffer: Uint8Array,
    byteOffset: number,
    byteLength: number,
    label: string
): Uint8Array => {
    if (byteOffset < 0 || byteLength < 0 || byteOffset + byteLength > buffer.byteLength) {
        throw new GltfSchemaError(`${label} exceeds its parent buffer range`);
    }

    return buffer.subarray(byteOffset, byteOffset + byteLength);
};

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

export const basenameOfUri = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = normalizeUri(value);
    const body = normalized.split(/[?#]/u, 1)[0] ?? normalized;
    const slashIndex = body.lastIndexOf('/');
    const candidate = slashIndex >= 0 ? body.slice(slashIndex + 1) : body;
    return candidate || undefined;
};

export const stripExtension = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const index = value.lastIndexOf('.');
    return index > 0 ? value.slice(0, index) : value;
};

const parseDataUri = (
    value: string,
    resourceKind: 'buffer' | 'image'
): {
    readonly mimeType?: string;
    readonly bytes: Uint8Array;
} => {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/isu.exec(value);
    if (!match) {
        throw new GltfResourceError(`Invalid data URI: ${value}`, value, resourceKind);
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

export const inferFormatFromSource = (source: AssetImportSource): 'gltf' | 'glb' | undefined => {
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

export const isGltfPackageSource = (source: AssetImportSource): source is GltfPackageSource =>
    source.kind === 'custom' && source.format === 'gltf-package' && isGltfPackageInput(source.data);

const parseRootJson = (value: unknown): GltfRootJson => {
    if (
        !isPlainObject(value) ||
        !isPlainObject(value.asset) ||
        typeof value.asset.version !== 'string'
    ) {
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

export const normalizeGltfSource = (source: AssetImportSource): NormalizedGltfSource => {
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

export class GltfResourceRuntime {
    private readonly _buffers = new Map<number, Promise<Uint8Array>>();
    private readonly _bufferViews = new Map<number, Promise<Uint8Array>>();

    constructor(
        readonly source: NormalizedGltfSource,
        readonly importSource: AssetImportSource,
        readonly resourceResolver: GltfImporterOptions['resourceResolver'],
        readonly dracoDecoder: GltfImporterOptions['dracoDecoder']
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
            const decoded = parseDataUri(image.uri, 'image');
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
            return parseDataUri(buffer.uri, 'buffer').bytes;
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

        const meshopt = bufferView.extensions?.EXT_meshopt_compression;
        if (meshopt) {
            return this._decodeMeshoptBufferView(index, bufferView, meshopt);
        }

        const buffer = await this.resolveBuffer(bufferView.buffer);
        const byteOffset = bufferView.byteOffset ?? 0;
        return sliceBufferRange(buffer, byteOffset, bufferView.byteLength, `bufferView ${index}`);
    }

    private async _decodeMeshoptBufferView(
        index: number,
        bufferView: GltfBufferViewJson,
        meshopt: NonNullable<GltfBufferViewJson['extensions']>['EXT_meshopt_compression']
    ): Promise<Uint8Array> {
        if (!meshopt) {
            throw new GltfSchemaError(`bufferView ${index} is missing EXT_meshopt_compression payload`);
        }

        if (bufferView.byteStride !== undefined && bufferView.byteStride !== meshopt.byteStride) {
            throw new GltfSchemaError(
                `bufferView ${index} EXT_meshopt_compression byteStride must match the parent bufferView`
            );
        }

        const expectedByteLength = meshopt.byteStride * meshopt.count;
        if (bufferView.byteLength !== expectedByteLength) {
            throw new GltfSchemaError(
                `bufferView ${index} EXT_meshopt_compression byteLength must equal byteStride * count`
            );
        }

        if (!MeshoptDecoder.supported) {
            throw new GltfResourceError(
                `EXT_meshopt_compression is not available in this runtime environment`,
                `bufferView:${index}`,
                'buffer'
            );
        }

        await MeshoptDecoder.ready;
        const sourceBuffer = await this.resolveBuffer(meshopt.buffer);
        const compressedBytes = sliceBufferRange(
            sourceBuffer,
            meshopt.byteOffset ?? 0,
            meshopt.byteLength,
            `bufferView ${index} EXT_meshopt_compression`
        );
        const decoded = new Uint8Array(expectedByteLength);

        try {
            MeshoptDecoder.decodeGltfBuffer(
                decoded,
                meshopt.count,
                meshopt.byteStride,
                compressedBytes,
                meshopt.mode,
                meshopt.filter && meshopt.filter !== 'NONE' ? meshopt.filter : undefined
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new GltfSchemaError(
                `Failed to decode EXT_meshopt_compression bufferView ${index}: ${message}`
            );
        }

        return decoded;
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
