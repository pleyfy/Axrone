import { createRandom } from '@axrone/random';
import { AssetImportPipeline } from './importer';
import {
    AssetConflictError,
    AssetConfigurationError,
    AssetDependencyError,
    AssetDisposedError,
    AssetLifecycleError,
    AssetReferenceError,
    AssetSnapshotError,
    resolveAssetMessage,
} from './errors';
import {
    asAssetFingerprint,
    asAssetId,
    asAssetRevision,
    canonicalizeAssetKey,
    createAssetReference,
    createVersionedAssetReference,
    isAssetReference,
    isAssetReferenceToken,
    isAssetVersionedReference,
    isAssetVersionedReferenceToken,
    normalizeAssetLocale,
    normalizeAssetUri,
    parseAssetReferenceToken,
    parseAssetVersionedReferenceToken,
} from './reference';
import type {
    AssetBinaryCodec,
    AssetBinaryPersistenceOptions,
    AssetBinaryStoreReadRequest,
    AssetBinaryStoreWriteRequest,
    AssetBinaryValue,
    AssetChangeEvent,
    AssetCodec,
    AssetCodecMap,
    AssetData,
    AssetDatabaseOptions,
    AssetDatabaseSnapshot,
    AssetDeleteOptions,
    AssetDependencyInput,
    AssetDisposer,
    AssetDisposerMap,
    AssetHydrateOptions,
    AssetImporter,
    AssetImportManyOptions,
    AssetImportReceipt,
    AssetImportSource,
    AssetJsonValue,
    AssetKind,
    AssetKey,
    AssetLeafChangeEvent,
    AssetListener,
    AssetLookupByKey,
    AssetMetadata,
    AssetMetadataInput,
    AssetQuery,
    AssetRecord,
    AssetReference,
    AssetSchema,
    AssetSelector,
    AssetSnapshotRecord,
    AssetSnapshotRevisionRecord,
    AssetSubscription,
    AssetSerializedValue,
    AssetVersionedReference,
    AssetWriteInput,
} from './types';

const ASSET_SNAPSHOT_VERSION = 3 as const;
const LEGACY_ASSET_SNAPSHOT_VERSIONS = Object.freeze([1, 2] as const);
const DEFAULT_BINARY_INLINE_THRESHOLD_BYTES = 64 * 1024;
const EMPTY_STRING_ARRAY = Object.freeze([]) as readonly string[];
const EMPTY_PROPERTIES = Object.freeze({}) as Readonly<Record<string, AssetJsonValue>>;
const RANDOM = createRandom();
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_CODES = (() => {
    const table = new Int16Array(123);
    table.fill(-1);

    for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
        table[BASE64_ALPHABET.charCodeAt(index)!] = index;
    }

    return table;
})();

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!isRecord(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const isAssetJsonValue = (value: unknown): value is AssetJsonValue => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
    ) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every(isAssetJsonValue);
    }

    if (isPlainObject(value)) {
        return Object.values(value).every(isAssetJsonValue);
    }

    return false;
};

const uniqueStrings = (values: readonly string[]): readonly string[] => {
    if (values.length === 0) {
        return EMPTY_STRING_ARRAY;
    }

    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }

        seen.add(trimmed);
        result.push(trimmed);
    }

    return Object.freeze(result);
};

const sortPropertyRecord = (
    value: Readonly<Record<string, AssetJsonValue>>
): Readonly<Record<string, AssetJsonValue>> => {
    const entries = Object.keys(value)
        .sort()
        .map((key) => [key, value[key]] as const);

    return Object.freeze(Object.fromEntries(entries) as Record<string, AssetJsonValue>);
};

const normalizeMetadata = (input?: AssetMetadataInput): AssetMetadata =>
    Object.freeze({
        uri: normalizeAssetUri(input?.uri),
        mimeType: input?.mimeType?.trim() || undefined,
        locale: normalizeAssetLocale(input?.locale),
        tags: uniqueStrings([...(input?.tags ?? EMPTY_STRING_ARRAY)]),
        properties: sortPropertyRecord(input?.properties ?? EMPTY_PROPERTIES),
    });

const isTypedArrayView = (value: unknown): value is ArrayBufferView =>
    typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value as ArrayBufferView);

const getBytes = (value: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array =>
    value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

const encodeBase64 = (bytes: Uint8Array): string => {
    if (bytes.length === 0) {
        return '';
    }

    let result = '';
    let index = 0;

    for (; index + 2 < bytes.length; index += 3) {
        const block = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
        result +=
            BASE64_ALPHABET[(block >>> 18) & 63] +
            BASE64_ALPHABET[(block >>> 12) & 63] +
            BASE64_ALPHABET[(block >>> 6) & 63] +
            BASE64_ALPHABET[block & 63];
    }

    const remaining = bytes.length - index;
    if (remaining === 1) {
        const block = bytes[index]! << 16;
        result +=
            BASE64_ALPHABET[(block >>> 18) & 63] +
            BASE64_ALPHABET[(block >>> 12) & 63] +
            '==';
    } else if (remaining === 2) {
        const block = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
        result +=
            BASE64_ALPHABET[(block >>> 18) & 63] +
            BASE64_ALPHABET[(block >>> 12) & 63] +
            BASE64_ALPHABET[(block >>> 6) & 63] +
            '=';
    }

    return result;
};

const getBase64Code = (value: string): number => {
    const code = value.charCodeAt(0);
    return code < BASE64_CODES.length ? BASE64_CODES[code]! : -1;
};

const decodeBase64 = (value: string): Uint8Array => {
    if (value.length === 0) {
        return new Uint8Array(0);
    }

    if (value.length % 4 !== 0) {
        throw new Error('Invalid base64 payload length');
    }

    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const output = new Uint8Array((value.length / 4) * 3 - padding);
    let outputIndex = 0;

    for (let index = 0; index < value.length; index += 4) {
        const char0 = value[index]!;
        const char1 = value[index + 1]!;
        const char2 = value[index + 2]!;
        const char3 = value[index + 3]!;
        const code0 = getBase64Code(char0);
        const code1 = getBase64Code(char1);
        const code2 = char2 === '=' ? 0 : getBase64Code(char2);
        const code3 = char3 === '=' ? 0 : getBase64Code(char3);
        const isLastChunk = index + 4 === value.length;

        if (
            code0 < 0 ||
            code1 < 0 ||
            (char2 !== '=' && code2 < 0) ||
            (char3 !== '=' && code3 < 0) ||
            (!isLastChunk && (char2 === '=' || char3 === '='))
        ) {
            throw new Error('Invalid base64 payload');
        }

        const block = (code0 << 18) | (code1 << 12) | (code2 << 6) | code3;
        output[outputIndex++] = (block >>> 16) & 255;

        if (char2 !== '=') {
            output[outputIndex++] = (block >>> 8) & 255;
        }

        if (char3 !== '=') {
            output[outputIndex++] = block & 255;
        }
    }

    return output;
};

const isBinaryCodec = <TData>(codec: AssetCodec<TData>): codec is AssetBinaryCodec<TData> =>
    codec.format === 'binary';

const isAssetBinaryValue = (value: unknown): value is AssetBinaryValue =>
    isPlainObject(value) &&
    value.__asset === 'axrone.binary' &&
    Number.isSafeInteger(value.byteLength) &&
    Number(value.byteLength) >= 0 &&
    ((value.storage === 'inline' &&
        value.encoding === 'base64' &&
        typeof value.data === 'string') ||
        (value.storage === 'external' && typeof value.storageKey === 'string'));

const stableStringify = (value: unknown, seen = new WeakSet<object>()): string => {
    if (value === null) {
        return 'null';
    }

    switch (typeof value) {
        case 'string':
            return JSON.stringify(value);
        case 'number':
            return Number.isNaN(value) ? '"NaN"' : JSON.stringify(value);
        case 'boolean':
            return value ? 'true' : 'false';
        case 'undefined':
            return '"undefined"';
        case 'bigint':
            return `"${value}n"`;
        case 'symbol':
            return `"${String(value)}"`;
        case 'function':
            return `"${value.name || 'anonymous'}"`;
        default:
            break;
    }

    if (value instanceof Date) {
        return JSON.stringify(value.toISOString());
    }

    if (value instanceof ArrayBuffer || isTypedArrayView(value)) {
        const bytes = getBytes(value as ArrayBuffer | ArrayBufferView);
        let result = '[';

        for (let index = 0; index < bytes.length; index += 1) {
            if (index > 0) {
                result += ',';
            }

            result += bytes[index]!.toString(16).padStart(2, '0');
        }

        return `${Object.prototype.toString.call(value)}:${result}]`;
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry, seen)).join(',')}]`;
    }

    if (isRecord(value)) {
        if (seen.has(value)) {
            return '"[Circular]"';
        }

        seen.add(value);

        if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
            return stableStringify((value as { toJSON: () => unknown }).toJSON(), seen);
        }

        const keys = Object.keys(value).sort();
        const body = keys
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`)
            .join(',');

        seen.delete(value);
        return `{${body}}`;
    }

    return JSON.stringify(String(value));
};

const hashString = (value: string): string => {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)!;
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
};

const computeFingerprint = (
    kind: string,
    key: AssetKey,
    data: unknown,
    metadata: AssetMetadata
): string =>
    `fp:${hashString(`${kind}|${key}|${stableStringify(data)}|${stableStringify(metadata)}`)}`;

type InternalAssetDisposer<TSchema extends AssetSchema> = (
    data: unknown,
    record: Readonly<AssetRecord<TSchema>>
) => void;

const inferAssetName = (kind: string, key: AssetKey, explicitName?: string): string => {
    const trimmed = explicitName?.trim();
    if (trimmed) {
        return trimmed;
    }

    const normalized = String(key);
    const withoutFragment = normalized.split('#', 1)[0] ?? normalized;
    const segment = withoutFragment.split('/').filter(Boolean).pop();
    return segment ?? kind;
};

interface StoredAssetConfig<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id: string;
    readonly kind: TKind;
    readonly key: AssetKey;
    readonly aliases: readonly AssetKey[];
    readonly name: string;
    readonly data: TSchema[TKind];
    readonly revision: number;
    readonly fingerprint: string;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: AssetMetadata;
    readonly dependencyIds: readonly string[];
    readonly disposer?: InternalAssetDisposer<TSchema>;
}

class StoredAsset<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id = asAssetId(this._config.id);
    readonly kind = this._config.kind;
    readonly key = this._config.key;
    readonly aliases = this._config.aliases;
    readonly name = this._config.name;
    readonly data = this._config.data;
    readonly revision = asAssetRevision(this._config.revision);
    readonly fingerprint = asAssetFingerprint(this._config.fingerprint);
    readonly createdAtEpochMs = this._config.createdAtEpochMs;
    readonly updatedAtEpochMs = this._config.updatedAtEpochMs;
    readonly metadata = this._config.metadata;
    readonly dependencyIds = Object.freeze([...this._config.dependencyIds].map(asAssetId));
    readonly disposer = this._config.disposer;
    private _reference?: AssetReference<TKind>;
    private _versionedReference?: AssetVersionedReference<TKind>;
    private _record?: AssetRecord<TSchema, TKind>;

    constructor(private readonly _config: StoredAssetConfig<TSchema, TKind>) {}

    get reference(): AssetReference<TKind> {
        this._reference ??= createAssetReference(this.kind, this.id);
        return this._reference;
    }

    get versionedReference(): AssetVersionedReference<TKind> {
        this._versionedReference ??= createVersionedAssetReference(
            this.kind,
            this.id,
            this.revision
        );
        return this._versionedReference;
    }

    toRecord(): AssetRecord<TSchema, TKind> {
        this._record ??= Object.freeze({
            kind: this.kind,
            id: this.id,
            key: this.key,
            aliases: this.aliases,
            name: this.name,
            data: this.data,
            revision: this.revision,
            fingerprint: this.fingerprint,
            createdAtEpochMs: this.createdAtEpochMs,
            updatedAtEpochMs: this.updatedAtEpochMs,
            metadata: this.metadata,
            dependencyIds: this.dependencyIds,
            reference: this.reference,
            versionedReference: this.versionedReference,
        });

        return this._record;
    }
}

interface PreparedWrite<TSchema extends AssetSchema> {
    readonly id: string;
    readonly kind: AssetKind<TSchema>;
    readonly key: AssetKey;
    readonly aliases: readonly AssetKey[];
    readonly name: string;
    readonly data: AssetData<TSchema>;
    readonly revision: number;
    readonly fingerprint: string;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: AssetMetadata;
    readonly dependencyInputs: readonly AssetDependencyInput<TSchema>[];
    readonly disposer?: InternalAssetDisposer<TSchema>;
}

const isLookupByKey = <TSchema extends AssetSchema>(
    value: unknown
): value is AssetLookupByKey<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetLookupByKey<TSchema>).key === 'string';

const isAssetRecordValue = <TSchema extends AssetSchema>(
    value: unknown
): value is AssetRecord<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetRecord<TSchema>).kind === 'string' &&
    typeof (value as AssetRecord<TSchema>).id === 'string' &&
    typeof (value as AssetRecord<TSchema>).key === 'string' &&
    'reference' in (value as AssetRecord<TSchema>);

export const isAssetDatabaseSnapshot = <TKind extends string = string>(
    value: unknown
): value is AssetDatabaseSnapshot<TKind> =>
    value !== null &&
    typeof value === 'object' &&
    (((value as AssetDatabaseSnapshot<TKind>).version as number) === ASSET_SNAPSHOT_VERSION ||
        LEGACY_ASSET_SNAPSHOT_VERSIONS.includes(
            (value as AssetDatabaseSnapshot<TKind>).version as 1 | 2
        )) &&
    Array.isArray((value as AssetDatabaseSnapshot<TKind>).assets);

export class AssetDatabase<TSchema extends AssetSchema = AssetSchema> {
    private readonly _assetsById = new Map<string, StoredAsset<TSchema>>();
    private readonly _revisionsById = new Map<string, StoredAsset<TSchema>[]>();
    private readonly _keyIndex = new Map<string, string>();
    private readonly _aliasIndex = new Map<string, string>();
    private readonly _fingerprintIndex = new Map<string, Set<string>>();
    private readonly _metadataUriIndex = new Map<string, Set<string>>();
    private readonly _metadataMimeTypeIndex = new Map<string, Set<string>>();
    private readonly _metadataLocaleIndex = new Map<string, Set<string>>();
    private readonly _metadataTagIndex = new Map<string, Set<string>>();
    private readonly _metadataPropertyIndex = new Map<string, Map<string, Set<string>>>();
    private readonly _dependentsById = new Map<string, Set<string>>();
    private readonly _listeners = new Set<AssetListener<TSchema>>();
    private readonly _codecs: AssetCodecMap<TSchema>;
    private readonly _disposers: AssetDisposerMap<TSchema>;
    private readonly _binary: Required<
        Pick<AssetBinaryPersistenceOptions, 'mode' | 'inlineThresholdBytes'>
    > &
        Pick<AssetBinaryPersistenceOptions, 'store'>;
    private readonly _pipeline: AssetImportPipeline<TSchema>;
    private readonly _ownPipeline: boolean;
    private readonly _messageResolver: AssetDatabaseOptions<TSchema>['messageResolver'];
    private readonly _now: () => number;
    private readonly _locale: string;
    private readonly _createdAtEpochMs: number;
    private _disposed = false;
    private _batchDepth = 0;
    private _pendingEvents: AssetLeafChangeEvent<TSchema>[] = [];
    private _flushScheduled = false;

    constructor(options: AssetDatabaseOptions<TSchema> = {}) {
        this._locale = normalizeAssetLocale(options.locale) ?? 'en-US';
        this._now = options.now ?? Date.now;
        this._createdAtEpochMs = this._now();
        this._messageResolver = options.messageResolver;
        this._codecs = Object.freeze({ ...(options.codecs ?? {}) }) as AssetCodecMap<TSchema>;
        this._disposers = Object.freeze({
            ...(options.disposers ?? {}),
        }) as AssetDisposerMap<TSchema>;
        this._binary = Object.freeze({
            mode: options.binary?.mode ?? 'auto',
            inlineThresholdBytes: Math.max(
                0,
                Math.trunc(
                    options.binary?.inlineThresholdBytes ?? DEFAULT_BINARY_INLINE_THRESHOLD_BYTES
                )
            ),
            store: options.binary?.store,
        });
        this._ownPipeline = !options.pipeline;
        this._pipeline =
            options.pipeline ??
            new AssetImportPipeline<TSchema>({
                importers: options.importers,
                stages: options.stages,
                locale: this._locale,
                retry: options.retry,
                messageResolver: options.messageResolver,
                now: this._now,
            });

        if (options.pipeline && options.importers?.length) {
            for (const importer of options.importers) {
                this._pipeline.register(importer);
            }
        }

        if (options.pipeline && options.stages?.length) {
            for (const stage of options.stages) {
                this._pipeline.registerStage(stage);
            }
        }
    }

    get size(): number {
        return this._assetsById.size;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get locale(): string {
        return this._locale;
    }

    registerImporter(importer: Parameters<AssetImportPipeline<TSchema>['register']>[0]): this {
        this._assertNotDisposed();
        this._pipeline.register(importer);
        return this;
    }

    unregisterImporter(importerId: string): boolean {
        this._assertNotDisposed();
        return this._pipeline.unregister(importerId);
    }

    listImporters(): readonly AssetImporter<TSchema>[] {
        this._assertNotDisposed();
        return this._pipeline.listImporters();
    }

    registerStage(stage: Parameters<AssetImportPipeline<TSchema>['registerStage']>[0]): this {
        this._assertNotDisposed();
        this._pipeline.registerStage(stage);
        return this;
    }

    unregisterStage(stageId: string): boolean {
        this._assertNotDisposed();
        return this._pipeline.unregisterStage(stageId);
    }

    listStages(): ReturnType<AssetImportPipeline<TSchema>['listStages']> {
        this._assertNotDisposed();
        return this._pipeline.listStages();
    }

    subscribe(listener: AssetListener<TSchema>): AssetSubscription {
        this._assertNotDisposed();
        this._listeners.add(listener);

        let disposed = false;

        return {
            get isDisposed(): boolean {
                return disposed;
            },
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;
                this._listeners.delete(listener);
            },
        };
    }

    has(selector: AssetSelector<TSchema>): boolean {
        return this._resolveStored(selector) !== undefined;
    }

    get<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> | undefined {
        const stored = this._resolveStored(selector);
        if (!stored) {
            return undefined;
        }

        return stored.toRecord() as AssetRecord<TSchema, TKind>;
    }

    require<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> {
        const record = this.get(selector);
        if (!record) {
            throw new AssetReferenceError(
                resolveAssetMessage(
                    {
                        code: 'asset.reference.invalid',
                        value: selector,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return record;
    }

    list(): readonly AssetRecord<TSchema>[];
    list<TKind extends AssetKind<TSchema>>(kind: TKind): readonly AssetRecord<TSchema, TKind>[];
    list<TKind extends AssetKind<TSchema>>(
        kind?: TKind
    ): readonly AssetRecord<TSchema>[] | readonly AssetRecord<TSchema, TKind>[] {
        this._assertNotDisposed();

        const result: AssetRecord<TSchema>[] = [];

        for (const asset of this._assetsById.values()) {
            if (!kind || asset.kind === kind) {
                result.push(asset.toRecord());
            }
        }

        return Object.freeze(result);
    }

    find(query: AssetQuery<TSchema> = {}): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();

        const candidateIds = this._intersectIdBuckets(this._getQueryBuckets(query));
        if (candidateIds && candidateIds.size === 0) {
            return Object.freeze([]);
        }

        const result: AssetRecord<TSchema>[] = [];

        for (const asset of this._assetsById.values()) {
            if (candidateIds && !candidateIds.has(asset.id)) {
                continue;
            }

            if (query.kind && asset.kind !== query.kind) {
                continue;
            }

            result.push(asset.toRecord());
        }

        return Object.freeze(result);
    }

    reference<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetReference<TKind> {
        return this.require(selector).reference;
    }

    versionedReference<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetVersionedReference<TKind> {
        return this.require(selector).versionedReference;
    }

    getDependencies<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): readonly AssetRecord<TSchema>[] {
        const asset = this.require(selector);
        const dependencies: AssetRecord<TSchema>[] = [];

        for (const dependencyId of asset.dependencyIds) {
            const dependency = this._assetsById.get(dependencyId);
            if (dependency) {
                dependencies.push(dependency.toRecord());
            }
        }

        return Object.freeze(dependencies);
    }

    getDependents<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): readonly AssetRecord<TSchema>[] {
        const asset = this.require(selector);
        const dependents = this._dependentsById.get(asset.id);
        if (!dependents?.size) {
            return Object.freeze([]);
        }

        const result: AssetRecord<TSchema>[] = [];
        for (const dependentId of dependents) {
            const dependent = this._assetsById.get(dependentId);
            if (dependent) {
                result.push(dependent.toRecord());
            }
        }

        return Object.freeze(result);
    }

    upsert<TKind extends AssetKind<TSchema>>(
        input: AssetWriteInput<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> {
        this._assertNotDisposed();
        this._beginBatch();

        try {
            const [record] = this._applyWrites([input as unknown as AssetWriteInput<TSchema>]);
            return record as unknown as AssetRecord<TSchema, TKind>;
        } finally {
            this._endBatch();
        }
    }

    upsertMany(inputs: readonly AssetWriteInput<TSchema>[]): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();
        this._beginBatch();

        try {
            return this._applyWrites(inputs);
        } finally {
            this._endBatch();
        }
    }

    async import<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        source: AssetImportSource,
        options: AssetImportManyOptions<TSchema> = {}
    ): Promise<AssetImportReceipt<TSchema, TKind>> {
        this._assertNotDisposed();

        const execution = await this._pipeline.import<TKind>(this, source, options);
        const writes = this._normalizeImportWrites(
            execution.baseKey,
            execution.result as unknown as {
                readonly primary: AssetWriteInput<TSchema>;
                readonly additional?: readonly AssetWriteInput<TSchema>[];
            }
        );

        this._beginBatch();

        try {
            const assets = this._applyWrites(writes);
            const receipt = Object.freeze({
                importerId: execution.importerId,
                sourceKind: source.kind,
                sourceUri: normalizeAssetUri(source.uri),
                baseKey: execution.baseKey,
                importedAtEpochMs: execution.importedAtEpochMs,
                diagnostics: execution.diagnostics,
                primary: assets[0] as unknown as AssetRecord<TSchema, TKind>,
                assets,
            }) as unknown as AssetImportReceipt<TSchema, TKind>;

            this._emitLeaf({
                type: 'import',
                receipt,
            });

            return receipt;
        } finally {
            this._endBatch();
        }
    }

    async importMany(
        sources: readonly AssetImportSource[],
        options: AssetImportManyOptions<TSchema> = {}
    ): Promise<readonly AssetImportReceipt<TSchema>[]> {
        this._assertNotDisposed();

        if (sources.length === 0) {
            return Object.freeze([]);
        }

        const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
        const results = new Array<AssetImportReceipt<TSchema>>(sources.length);
        let cursor = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                const index = cursor;
                cursor += 1;

                if (index >= sources.length) {
                    return;
                }

                results[index] = await this.import(sources[index]!, options);
            }
        };

        const workerCount = Math.min(concurrency, sources.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        return Object.freeze(results);
    }

    delete(selector: AssetSelector<TSchema>, options: AssetDeleteOptions = {}): boolean {
        this._assertNotDisposed();

        const asset = this._resolveStored(selector);
        if (!asset) {
            return false;
        }

        if (!options.cascade) {
            const directDependents = [...(this._dependentsById.get(asset.id) ?? [])].filter((id) =>
                this._assetsById.has(id)
            );
            if (directDependents.length > 0) {
                throw new AssetDependencyError(
                    resolveAssetMessage(
                        {
                            code: 'asset.dependency.missing',
                            dependency: directDependents.join(','),
                        },
                        this._locale,
                        this._messageResolver
                    ),
                    directDependents.join(',')
                );
            }
        }

        this._beginBatch();

        try {
            const order = options.cascade ? this._collectDeleteOrder([asset.id]) : [asset.id];
            this._deleteIds(order);
            return true;
        } finally {
            this._endBatch();
        }
    }

    clear(): void {
        this._assertNotDisposed();
        if (this._assetsById.size === 0) {
            return;
        }

        this._beginBatch();

        try {
            this._deleteIds(this._collectDeleteOrder([...this._assetsById.keys()]));
        } finally {
            this._endBatch();
        }
    }

    snapshot(): AssetDatabaseSnapshot<AssetKind<TSchema>> {
        this._assertNotDisposed();

        const assets = [...this._assetsById.values()]
            .sort((left, right) =>
                left.kind === right.kind
                    ? String(left.key).localeCompare(String(right.key))
                    : left.kind.localeCompare(right.kind)
            )
            .map((asset) => {
                const revisions = this._revisionsById.get(asset.id);
                const history =
                    revisions && revisions.length > 1
                        ? Object.freeze(
                              revisions
                                  .slice(0, Math.max(0, asset.revision - 1))
                                  .filter(
                                      (
                                          revision
                                      ): revision is StoredAsset<TSchema> => revision !== undefined
                                  )
                                  .map((revision) => this._serializeSnapshotRevision(revision))
                          )
                        : undefined;

                return Object.freeze({
                    ...this._serializeSnapshotRevision(asset),
                    ...(history && history.length > 0 ? { history } : {}),
                }) as AssetSnapshotRecord<AssetKind<TSchema>>;
            });

        return Object.freeze({
            version: ASSET_SNAPSHOT_VERSION,
            locale: this._locale,
            capturedAtEpochMs: this._now(),
            assets: Object.freeze(assets),
        });
    }

    hydrate(
        snapshot: AssetDatabaseSnapshot<AssetKind<TSchema>>,
        options: AssetHydrateOptions = {}
    ): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();

        if (!isAssetDatabaseSnapshot(snapshot)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: 'snapshot-shape',
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const replace = options.replace ?? true;

        this._beginBatch();

        try {
            if (replace) {
                this._deleteIds(this._collectDeleteOrder([...this._assetsById.keys()]));
            }

            const staged = new Map<string, StoredAsset<TSchema>>();
            const stagedRevisions = new Map<string, StoredAsset<TSchema>[]>();

            for (const entry of snapshot.assets) {
                const history = entry.history ?? [];
                let previousRevision = 0;

                for (const historicalEntry of history) {
                    const historicalAsset = this._createStoredAssetFromSnapshotRecord(historicalEntry);

                    if (historicalAsset.id !== entry.id || historicalAsset.kind !== entry.kind) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `history mismatch for asset ${entry.id}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }

                    if (historicalAsset.revision <= previousRevision) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `non-monotonic revision history for asset ${entry.id}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }

                    this._stageRevisionAsset(stagedRevisions, historicalAsset);
                    previousRevision = historicalAsset.revision;
                }

                const currentAsset = this._createStoredAssetFromSnapshotRecord(entry);

                if (history.length > 0 && currentAsset.revision <= previousRevision) {
                    throw new AssetSnapshotError(
                        resolveAssetMessage(
                            {
                                code: 'asset.snapshot.invalid',
                                reason: `current revision is not newer than history for asset ${entry.id}`,
                            },
                            this._locale,
                            this._messageResolver
                        )
                    );
                }

                staged.set(currentAsset.id, currentAsset);
            }

            for (const [id, revisions] of stagedRevisions) {
                this._revisionsById.set(id, revisions);
            }

            const availableIds = new Set<string>([...this._assetsById.keys(), ...staged.keys()]);

            for (const asset of staged.values()) {
                for (const dependencyId of asset.dependencyIds) {
                    if (!availableIds.has(dependencyId)) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `missing dependency ${dependencyId}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }
                }
            }

            return this._commitStoredAssets([...staged.values()]);
        } finally {
            this._endBatch();
        }
    }

    private _serializeSnapshotRevision(
        asset: StoredAsset<TSchema>
    ): AssetSnapshotRevisionRecord<AssetKind<TSchema>> {
        return Object.freeze({
            kind: asset.kind,
            id: asset.id,
            key: asset.key,
            aliases: asset.aliases,
            name: asset.name,
            revision: asset.revision,
            fingerprint: asset.fingerprint,
            createdAtEpochMs: asset.createdAtEpochMs,
            updatedAtEpochMs: asset.updatedAtEpochMs,
            metadata: Object.freeze({
                uri: asset.metadata.uri,
                mimeType: asset.metadata.mimeType,
                locale: asset.metadata.locale,
                tags: asset.metadata.tags,
                properties: asset.metadata.properties,
            }),
            dependencyIds: asset.dependencyIds,
            data: this._serializeSnapshotData(asset),
        });
    }

    private _createStoredAssetFromSnapshotRecord(
        entry: AssetSnapshotRevisionRecord<AssetKind<TSchema>>
    ): StoredAsset<TSchema> {
        const kind = this._validateKind(entry.kind);
        const id = this._validateId(entry.id);
        const key = this._validateKey(entry.key);
        const revision = this._validateRevision(entry.revision);
        const metadata = normalizeMetadata({
            uri: entry.metadata.uri,
            mimeType: entry.metadata.mimeType,
            locale: entry.metadata.locale,
            tags: entry.metadata.tags,
            properties: entry.metadata.properties,
        });
        const data = this._deserializeSnapshotData(
            entry,
            kind,
            id,
            key,
            revision,
            entry.fingerprint,
            metadata
        );
        const aliases = this._normalizeAliases(entry.aliases, key);
        const disposer = this._disposers?.[kind]
            ? (value: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      this._disposers?.[kind] as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(value as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;

        return new StoredAsset<TSchema>({
            id,
            kind,
            key,
            aliases,
            name: inferAssetName(kind, key, entry.name),
            data,
            revision,
            fingerprint: entry.fingerprint,
            createdAtEpochMs: entry.createdAtEpochMs,
            updatedAtEpochMs: entry.updatedAtEpochMs,
            metadata,
            dependencyIds: [...entry.dependencyIds],
            disposer,
        });
    }

    private _stageRevisionAsset(
        stagedRevisions: Map<string, StoredAsset<TSchema>[]>,
        asset: StoredAsset<TSchema>
    ): void {
        const revisions = stagedRevisions.get(asset.id) ?? [];
        if (!stagedRevisions.has(asset.id)) {
            stagedRevisions.set(asset.id, revisions);
        }

        revisions[asset.revision - 1] = asset;

        if (revisions.length < asset.revision) {
            revisions.length = asset.revision;
        }
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        let lifecycleError: unknown;

        try {
            this.clear();
        } catch (error) {
            lifecycleError = error;
        } finally {
            this._disposed = true;
            this._listeners.clear();
            this._pendingEvents = [];
            if (this._ownPipeline) {
                this._pipeline.dispose();
            }
        }

        if (lifecycleError) {
            throw lifecycleError;
        }
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new AssetDisposedError(
                resolveAssetMessage(
                    {
                        code: 'asset.disposed',
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }
    }

    private _validateId(value: unknown): string {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-id',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-id',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return value.trim();
    }

    private _validateKind<TKind extends AssetKind<TSchema>>(value: unknown): TKind {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-kind',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-kind',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return value as TKind;
    }

    private _validateKey(value: unknown): AssetKey {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-key',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-key',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return canonicalizeAssetKey(value);
    }

    private _validateRevision(value: unknown): number {
        if (!Number.isSafeInteger(value) || Number(value) < 1) {
            throw new AssetConfigurationError(
                'asset.invalid-revision',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-revision',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return Number(value);
    }

    private _resolveStored(
        selector: AssetSelector<TSchema> | AssetDependencyInput<TSchema>
    ): StoredAsset<TSchema> | undefined {
        if (typeof selector === 'string') {
            if (isAssetVersionedReferenceToken(selector)) {
                const reference = parseAssetVersionedReferenceToken(selector);
                return reference ? this._resolveVersionedReference(reference) : undefined;
            }

            if (isAssetReferenceToken(selector)) {
                const reference = parseAssetReferenceToken(selector);
                return reference ? this._assetsById.get(reference.id) : undefined;
            }

            return this._assetsById.get(selector) ?? this._resolveByKey(selector);
        }

        if (isAssetVersionedReference(selector)) {
            return this._resolveVersionedReference(selector);
        }

        if (isAssetReference(selector)) {
            return this._assetsById.get(selector.id);
        }

        if (isAssetRecordValue(selector)) {
            return this._assetsById.get(selector.id);
        }

        if (isLookupByKey(selector)) {
            const resolved = this._resolveByKey(selector.key);
            if (!resolved) {
                return undefined;
            }

            return selector.kind && resolved.kind !== selector.kind ? undefined : resolved;
        }

        return undefined;
    }

    private _resolveVersionedReference(
        reference: AssetVersionedReference
    ): StoredAsset<TSchema> | undefined {
        const revisions = this._revisionsById.get(reference.id);
        if (!revisions) {
            return undefined;
        }

        return revisions[reference.revision - 1];
    }

    private _resolveByKey(key: string): StoredAsset<TSchema> | undefined {
        const normalized = canonicalizeAssetKey(key);
        const id = this._keyIndex.get(normalized) ?? this._aliasIndex.get(normalized);
        return id ? this._assetsById.get(id) : undefined;
    }

    private _normalizeAliases(
        values: readonly string[] | undefined,
        key: AssetKey
    ): readonly AssetKey[] {
        if (!values?.length) {
            return Object.freeze([]);
        }

        const result: AssetKey[] = [];
        const seen = new Set<string>();

        for (const value of values) {
            const alias = canonicalizeAssetKey(value);
            if (alias === key || seen.has(alias)) {
                continue;
            }

            seen.add(alias);
            result.push(alias);
        }

        return Object.freeze(result);
    }

    private _normalizeImportWrites(
        baseKey: AssetKey,
        result: {
            readonly primary: AssetWriteInput<TSchema>;
            readonly additional?: readonly AssetWriteInput<TSchema>[];
        }
    ): readonly AssetWriteInput<TSchema>[] {
        const normalizeDependency = (
            dependency: AssetDependencyInput<TSchema>
        ): AssetDependencyInput<TSchema> => {
            if (typeof dependency === 'string' && dependency.startsWith('#')) {
                return `${baseKey}${dependency}`;
            }

            if (isLookupByKey(dependency) && dependency.key.startsWith('#')) {
                return {
                    key: `${baseKey}${dependency.key}`,
                    ...(dependency.kind ? { kind: dependency.kind } : {}),
                } as AssetLookupByKey<TSchema>;
            }

            return dependency;
        };

        const normalizeWrite = (
            write: AssetWriteInput<TSchema>,
            index: number,
            isPrimary: boolean
        ): AssetWriteInput<TSchema> => {
            const stableKey = write.stableKey?.trim()
                ? write.stableKey.startsWith('#')
                    ? `${baseKey}${write.stableKey}`
                    : write.stableKey
                : isPrimary
                  ? String(baseKey)
                  : `${baseKey}#${index}`;

            return Object.freeze({
                ...write,
                stableKey,
                dependencies: Object.freeze(
                    [...(write.dependencies ?? [])].map(normalizeDependency)
                ),
            });
        };

        const writes = [
            normalizeWrite(result.primary, 0, true),
            ...(result.additional ?? []).map((write, index) =>
                normalizeWrite(write, index + 1, false)
            ),
        ];

        return Object.freeze(writes);
    }

    private _prepareWrite(input: AssetWriteInput<TSchema>): PreparedWrite<TSchema> {
        const kind = this._validateKind(input.kind);
        const metadata = normalizeMetadata(input.metadata);
        const explicitId = input.id ? this._validateId(input.id) : undefined;
        const explicitKey = input.stableKey?.trim()
            ? canonicalizeAssetKey(input.stableKey)
            : undefined;
        const previousById = explicitId ? this._assetsById.get(explicitId) : undefined;
        const previousByKey = explicitKey ? this._resolveByKey(explicitKey) : undefined;

        if (previousById && previousByKey && previousById.id !== previousByKey.id) {
            throw new AssetConflictError(
                'asset.conflict.key-bound',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.key-bound',
                        key: explicitKey!,
                        currentId: previousByKey.id,
                        requestedId: previousById.id,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const previous = previousById ?? previousByKey;
        const id = previous?.id ?? explicitId ?? RANDOM.uuid();
        const key = explicitKey ?? previous?.key ?? canonicalizeAssetKey(`asset://${kind}/${id}`);

        if (previous && previous.kind !== kind) {
            throw new AssetConflictError(
                'asset.conflict.kind-mismatch',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.kind-mismatch',
                        id: previous.id,
                        expected: previous.kind,
                        received: kind,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const revision = previous ? previous.revision + 1 : 1;
        const nowEpochMs = this._now();
        const aliases = this._normalizeAliases(
            [
                ...(input.aliases ?? EMPTY_STRING_ARRAY),
                ...(previous ? [String(previous.key), ...previous.aliases] : EMPTY_STRING_ARRAY),
                ...(metadata.uri && String(metadata.uri) !== String(key)
                    ? [String(metadata.uri)]
                    : EMPTY_STRING_ARRAY),
            ],
            key
        );
        const specificDisposer = input.disposer
            ? (data: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      input.disposer as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(data as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;
        const mappedDisposer = this._disposers?.[kind]
            ? (data: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      this._disposers?.[kind] as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(data as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;
        const disposer = specificDisposer ?? mappedDisposer ?? previous?.disposer;
        const fingerprint = asAssetFingerprint(
            input.fingerprint?.trim() || computeFingerprint(kind, key, input.data, metadata)
        );

        return Object.freeze({
            id,
            kind,
            key,
            aliases,
            name: inferAssetName(kind, key, input.name),
            data: input.data as AssetData<TSchema>,
            revision,
            fingerprint,
            createdAtEpochMs: previous?.createdAtEpochMs ?? nowEpochMs,
            updatedAtEpochMs: nowEpochMs,
            metadata,
            dependencyInputs: Object.freeze([...(input.dependencies ?? [])]),
            disposer,
        });
    }

    private _applyWrites(
        inputs: readonly AssetWriteInput<TSchema>[]
    ): readonly AssetRecord<TSchema>[] {
        if (inputs.length === 0) {
            return Object.freeze([]);
        }

        const prepared = inputs.map((input) => this._prepareWrite(input));
        const stagedById = new Map<string, PreparedWrite<TSchema>>();
        const stagedByKey = new Map<string, PreparedWrite<TSchema>>();

        for (const write of prepared) {
            stagedById.set(write.id, write);
            stagedByKey.set(write.key, write);
            for (const alias of write.aliases) {
                stagedByKey.set(alias, write);
            }
        }

        const assets = prepared.map((write) => {
            const dependencyIds = this._resolveDependencyIds(
                write.dependencyInputs,
                stagedById,
                stagedByKey
            );

            return new StoredAsset<TSchema>({
                id: write.id,
                kind: write.kind,
                key: write.key,
                aliases: write.aliases,
                name: write.name,
                data: write.data,
                revision: write.revision,
                fingerprint: write.fingerprint,
                createdAtEpochMs: write.createdAtEpochMs,
                updatedAtEpochMs: write.updatedAtEpochMs,
                metadata: write.metadata,
                dependencyIds,
                disposer: write.disposer,
            });
        });

        return this._commitStoredAssets(assets);
    }

    private _resolveDependencyIds(
        inputs: readonly AssetDependencyInput<TSchema>[],
        stagedById: ReadonlyMap<string, PreparedWrite<TSchema>>,
        stagedByKey: ReadonlyMap<string, PreparedWrite<TSchema>>
    ): readonly string[] {
        if (inputs.length === 0) {
            return Object.freeze([]);
        }

        const ids: string[] = [];
        const seen = new Set<string>();

        for (const input of inputs) {
            const resolved =
                this._resolveDependencyInput(input, stagedById, stagedByKey) ??
                this._resolveStored(input)?.id;

            if (!resolved) {
                const descriptor =
                    typeof input === 'string'
                        ? input
                        : isLookupByKey(input)
                          ? input.key
                          : isAssetReference(input) || isAssetVersionedReference(input)
                            ? input.id
                            : isAssetRecordValue(input)
                              ? input.id
                              : stableStringify(input);

                throw new AssetDependencyError(
                    resolveAssetMessage(
                        {
                            code: 'asset.dependency.missing',
                            dependency: descriptor,
                        },
                        this._locale,
                        this._messageResolver
                    ),
                    descriptor
                );
            }

            if (!seen.has(resolved)) {
                seen.add(resolved);
                ids.push(resolved);
            }
        }

        return Object.freeze(ids);
    }

    private _resolveDependencyInput(
        input: AssetDependencyInput<TSchema>,
        stagedById: ReadonlyMap<string, PreparedWrite<TSchema>>,
        stagedByKey: ReadonlyMap<string, PreparedWrite<TSchema>>
    ): string | undefined {
        if (typeof input === 'string') {
            if (isAssetVersionedReferenceToken(input)) {
                return parseAssetVersionedReferenceToken(input)?.id;
            }

            if (isAssetReferenceToken(input)) {
                return parseAssetReferenceToken(input)?.id;
            }

            return (
                stagedById.get(input)?.id ??
                stagedByKey.get(canonicalizeAssetKey(input))?.id ??
                this._resolveStored(input)?.id
            );
        }

        if (
            isAssetVersionedReference(input) ||
            isAssetReference(input) ||
            isAssetRecordValue(input)
        ) {
            return input.id;
        }

        if (isLookupByKey(input)) {
            const resolved = stagedByKey.get(canonicalizeAssetKey(input.key));
            if (resolved && (!input.kind || resolved.kind === input.kind)) {
                return resolved.id;
            }

            const existing = this._resolveStored(input);
            return existing && (!input.kind || existing.kind === input.kind)
                ? existing.id
                : undefined;
        }

        return undefined;
    }

    private _commitStoredAssets(
        assets: readonly StoredAsset<TSchema>[]
    ): readonly AssetRecord<TSchema>[] {
        const disposers: StoredAsset<TSchema>[] = [];
        const records: AssetRecord<TSchema>[] = [];

        for (const asset of assets) {
            this._assertKeyOwnership(asset);

            const previous = this._assetsById.get(asset.id);

            if (previous) {
                this._unlinkDependencies(previous.id, previous.dependencyIds);
                this._unindexAsset(previous);
                this._keyIndex.delete(previous.key);
                for (const alias of previous.aliases) {
                    if (this._aliasIndex.get(alias) === previous.id) {
                        this._aliasIndex.delete(alias);
                    }
                }

                if (previous.disposer && previous.data !== asset.data) {
                    disposers.push(previous);
                }
            }

            this._storeRevision(asset, previous);
            this._assetsById.set(asset.id, asset);
            this._keyIndex.set(asset.key, asset.id);
            this._aliasIndex.delete(asset.key);
            for (const alias of asset.aliases) {
                this._aliasIndex.set(alias, asset.id);
            }
            this._indexAsset(asset);
            this._linkDependencies(asset.id, asset.dependencyIds);
            const record = asset.toRecord();
            records.push(record);
            this._emitLeaf({
                type: 'upsert',
                asset: record,
                previous: previous?.toRecord(),
            });
        }

        this._runDisposers(disposers);
        return Object.freeze(records);
    }

    private _storeRevision(asset: StoredAsset<TSchema>, previous?: StoredAsset<TSchema>): void {
        const revisions = this._revisionsById.get(asset.id) ?? [];

        if (!this._revisionsById.has(asset.id)) {
            this._revisionsById.set(asset.id, revisions);
        }

        if (previous) {
            revisions[previous.revision - 1] = previous;
        }

        revisions[asset.revision - 1] = asset;

        if (revisions.length < asset.revision) {
            revisions.length = asset.revision;
        }
    }

    private _assertKeyOwnership(asset: StoredAsset<TSchema>): void {
        const keyOwner = this._keyIndex.get(asset.key) ?? this._aliasIndex.get(asset.key);
        if (keyOwner && keyOwner !== asset.id) {
            throw new AssetConflictError(
                'asset.conflict.key-bound',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.key-bound',
                        key: asset.key,
                        currentId: keyOwner,
                        requestedId: asset.id,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        for (const alias of asset.aliases) {
            const aliasOwner = this._keyIndex.get(alias) ?? this._aliasIndex.get(alias);
            if (aliasOwner && aliasOwner !== asset.id) {
                throw new AssetConflictError(
                    'asset.conflict.key-bound',
                    resolveAssetMessage(
                        {
                            code: 'asset.conflict.key-bound',
                            key: alias,
                            currentId: aliasOwner,
                            requestedId: asset.id,
                        },
                        this._locale,
                        this._messageResolver
                    )
                );
            }
        }
    }

    private _linkDependencies(assetId: string, dependencyIds: readonly string[]): void {
        for (const dependencyId of dependencyIds) {
            const dependents = this._dependentsById.get(dependencyId) ?? new Set<string>();
            dependents.add(assetId);
            this._dependentsById.set(dependencyId, dependents);
        }
    }

    private _unlinkDependencies(assetId: string, dependencyIds: readonly string[]): void {
        for (const dependencyId of dependencyIds) {
            const dependents = this._dependentsById.get(dependencyId);
            if (!dependents) {
                continue;
            }

            dependents.delete(assetId);
            if (dependents.size === 0) {
                this._dependentsById.delete(dependencyId);
            }
        }
    }

    private _collectDeleteOrder(startIds: readonly string[]): readonly string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (id: string): void => {
            if (visited.has(id)) {
                return;
            }

            visited.add(id);
            for (const dependentId of this._dependentsById.get(id) ?? []) {
                if (this._assetsById.has(dependentId)) {
                    visit(dependentId);
                }
            }
            order.push(id);
        };

        for (const id of startIds) {
            if (this._assetsById.has(id)) {
                visit(id);
            }
        }

        return order;
    }

    private _deleteIds(ids: readonly string[]): void {
        const disposers: StoredAsset<TSchema>[] = [];

        for (const id of ids) {
            const asset = this._assetsById.get(id);
            if (!asset) {
                continue;
            }

            this._assetsById.delete(id);
            this._keyIndex.delete(asset.key);
            for (const alias of asset.aliases) {
                if (this._aliasIndex.get(alias) === id) {
                    this._aliasIndex.delete(alias);
                }
            }

            this._unindexAsset(asset);
            this._unlinkDependencies(id, asset.dependencyIds);
            this._dependentsById.delete(id);
            this._revisionsById.delete(id);
            this._emitLeaf({
                type: 'delete',
                asset: asset.toRecord(),
            });

            if (asset.disposer) {
                disposers.push(asset);
            }
        }

        this._runDisposers(disposers);
    }

    private _getQueryBuckets(query: AssetQuery<TSchema>): readonly ReadonlySet<string>[] {
        const buckets: ReadonlySet<string>[] = [];
        const fingerprint = query.fingerprint?.trim();
        const uri = normalizeAssetUri(query.uri);
        const mimeType = query.mimeType?.trim() || undefined;
        const locale = normalizeAssetLocale(query.locale);

        if (fingerprint) {
            buckets.push(this._fingerprintIndex.get(fingerprint) ?? new Set<string>());
        }

        if (uri) {
            buckets.push(this._metadataUriIndex.get(uri) ?? new Set<string>());
        }

        if (mimeType) {
            buckets.push(this._metadataMimeTypeIndex.get(mimeType) ?? new Set<string>());
        }

        if (locale) {
            buckets.push(this._metadataLocaleIndex.get(locale) ?? new Set<string>());
        }

        for (const tag of uniqueStrings(query.tags ?? EMPTY_STRING_ARRAY)) {
            buckets.push(this._metadataTagIndex.get(tag) ?? new Set<string>());
        }

        for (const [key, value] of Object.entries(query.properties ?? EMPTY_PROPERTIES)) {
            const normalizedKey = key.trim();
            if (!normalizedKey) {
                continue;
            }

            buckets.push(
                this._metadataPropertyIndex
                    .get(normalizedKey)
                    ?.get(stableStringify(value)) ?? new Set<string>()
            );
        }

        return buckets;
    }

    private _intersectIdBuckets(
        buckets: readonly ReadonlySet<string>[]
    ): ReadonlySet<string> | undefined {
        if (buckets.length === 0) {
            return undefined;
        }

        const ordered = [...buckets].sort((left, right) => left.size - right.size);
        const [seed, ...rest] = ordered;
        const result = new Set<string>(seed);

        for (const bucket of rest) {
            for (const id of result) {
                if (!bucket.has(id)) {
                    result.delete(id);
                }
            }

            if (result.size === 0) {
                break;
            }
        }

        return result;
    }

    private _indexAsset(asset: StoredAsset<TSchema>): void {
        this._indexValue(this._fingerprintIndex, asset.fingerprint, asset.id);

        if (asset.metadata.uri) {
            this._indexValue(this._metadataUriIndex, asset.metadata.uri, asset.id);
        }

        if (asset.metadata.mimeType) {
            this._indexValue(this._metadataMimeTypeIndex, asset.metadata.mimeType, asset.id);
        }

        if (asset.metadata.locale) {
            this._indexValue(this._metadataLocaleIndex, asset.metadata.locale, asset.id);
        }

        for (const tag of asset.metadata.tags) {
            this._indexValue(this._metadataTagIndex, tag, asset.id);
        }

        for (const [key, value] of Object.entries(asset.metadata.properties)) {
            const propertyIndex = this._metadataPropertyIndex.get(key) ?? new Map<string, Set<string>>();
            if (!this._metadataPropertyIndex.has(key)) {
                this._metadataPropertyIndex.set(key, propertyIndex);
            }

            this._indexValue(propertyIndex, stableStringify(value), asset.id);
        }
    }

    private _unindexAsset(asset: StoredAsset<TSchema>): void {
        this._unindexValue(this._fingerprintIndex, asset.fingerprint, asset.id);

        if (asset.metadata.uri) {
            this._unindexValue(this._metadataUriIndex, asset.metadata.uri, asset.id);
        }

        if (asset.metadata.mimeType) {
            this._unindexValue(this._metadataMimeTypeIndex, asset.metadata.mimeType, asset.id);
        }

        if (asset.metadata.locale) {
            this._unindexValue(this._metadataLocaleIndex, asset.metadata.locale, asset.id);
        }

        for (const tag of asset.metadata.tags) {
            this._unindexValue(this._metadataTagIndex, tag, asset.id);
        }

        for (const [key, value] of Object.entries(asset.metadata.properties)) {
            const propertyIndex = this._metadataPropertyIndex.get(key);
            if (!propertyIndex) {
                continue;
            }

            this._unindexValue(propertyIndex, stableStringify(value), asset.id);
            if (propertyIndex.size === 0) {
                this._metadataPropertyIndex.delete(key);
            }
        }
    }

    private _indexValue(index: Map<string, Set<string>>, key: string, id: string): void {
        const bucket = index.get(key) ?? new Set<string>();
        bucket.add(id);
        index.set(key, bucket);
    }

    private _unindexValue(index: Map<string, Set<string>>, key: string, id: string): void {
        const bucket = index.get(key);
        if (!bucket) {
            return;
        }

        bucket.delete(id);
        if (bucket.size === 0) {
            index.delete(key);
        }
    }

    private _runDisposers(assets: readonly StoredAsset<TSchema>[]): void {
        let firstError: AssetLifecycleError | undefined;

        for (const asset of assets) {
            try {
                asset.disposer?.(asset.data, asset.toRecord());
            } catch (error) {
                firstError ??= new AssetLifecycleError(
                    resolveAssetMessage(
                        {
                            code: 'asset.lifecycle.dispose-failed',
                            id: asset.id,
                            kind: asset.kind,
                            reason: error,
                        },
                        this._locale,
                        this._messageResolver
                    ),
                    asset.id,
                    asset.kind,
                    {
                        cause: error,
                    }
                );
            }
        }

        if (firstError) {
            throw firstError;
        }
    }

    private _serializeSnapshotData<TKind extends AssetKind<TSchema>>(
        asset: StoredAsset<TSchema, TKind>
    ): AssetSerializedValue {
        const codec = this._codecs?.[asset.kind] as AssetCodec<TSchema[TKind]> | undefined;

        if (codec) {
            if (isBinaryCodec(codec)) {
                return this._serializeBinaryCompatible(codec.serialize(asset.data), asset);
            }

            return this._serializeJsonCompatible(codec.serialize(asset.data), asset.kind);
        }

        if (isAssetJsonValue(asset.data)) {
            return this._serializeJsonCompatible(asset.data, asset.kind);
        }

        return this._serializeBinaryCompatible(asset.data, asset);
    }

    private _deserializeSnapshotData<TKind extends AssetKind<TSchema>>(
        entry: AssetSnapshotRevisionRecord<AssetKind<TSchema>>,
        kind: TKind,
        id: string,
        key: AssetKey,
        revision: number,
        fingerprint: string,
        metadata: AssetMetadata
    ): TSchema[TKind] {
        const codec = this._codecs?.[kind] as AssetCodec<TSchema[TKind]> | undefined;

        if (codec) {
            if (isBinaryCodec(codec)) {
                return codec.deserialize(
                    this._deserializeBinaryCompatible(entry.data, {
                        kind,
                        id,
                        key,
                        revision,
                        fingerprint,
                        metadata,
                    })
                );
            }

            return codec.deserialize(this._requireJsonSerializedValue(entry.data, kind));
        }

        if (isAssetBinaryValue(entry.data)) {
            return this._deserializeBinaryCompatible(entry.data, {
                kind,
                id,
                key,
                revision,
                fingerprint,
                metadata,
            }) as TSchema[TKind];
        }

        return this._deserializeJsonCompatible(entry.data, kind);
    }

    private _serializeBinaryCompatible<TKind extends AssetKind<TSchema>>(
        value: unknown,
        asset: Pick<StoredAsset<TSchema, TKind>, 'kind' | 'id' | 'key' | 'revision' | 'fingerprint' | 'metadata'>
    ): AssetBinaryValue {
        if (!(value instanceof ArrayBuffer) && !isTypedArrayView(value)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `asset kind "${asset.kind}" is not binary serializable`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const bytes = getBytes(value);
        const useExternalStore =
            this._binary.mode === 'external' ||
            (this._binary.mode === 'auto' &&
                !!this._binary.store &&
                bytes.length > this._binary.inlineThresholdBytes);

        if (!useExternalStore) {
            return Object.freeze({
                __asset: 'axrone.binary',
                storage: 'inline',
                encoding: 'base64',
                data: encodeBase64(bytes),
                byteLength: bytes.length,
            });
        }

        const store = this._binary.store;
        if (!store) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `asset kind "${asset.kind}" requires a binary store`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        let storageKey: string;

        try {
            storageKey = store.write({
                kind: asset.kind,
                id: asset.id,
                key: asset.key,
                revision: asset.revision,
                fingerprint: asset.fingerprint,
                metadata: asset.metadata,
                bytes,
            } satisfies AssetBinaryStoreWriteRequest);
        } catch (error) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `binary store write failed for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                ),
                {
                    cause: error,
                }
            );
        }

        if (typeof storageKey !== 'string' || !storageKey.trim()) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `binary store returned an invalid key for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return Object.freeze({
            __asset: 'axrone.binary',
            storage: 'external',
            storageKey: storageKey.trim(),
            byteLength: bytes.length,
        });
    }

    private _deserializeBinaryCompatible<TKind extends AssetKind<TSchema>>(
        value: AssetSerializedValue,
        asset: {
            readonly kind: TKind;
            readonly id: string;
            readonly key: AssetKey;
            readonly revision: number;
            readonly fingerprint: string;
            readonly metadata: AssetMetadata;
        }
    ): Uint8Array {
        if (!isAssetBinaryValue(value)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `asset kind "${asset.kind}" does not contain binary data`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        if (value.storage === 'inline') {
            try {
                const bytes = decodeBase64(value.data);

                if (bytes.length !== value.byteLength) {
                    throw new Error('byte length mismatch');
                }

                return bytes;
            } catch (error) {
                throw new AssetSnapshotError(
                    resolveAssetMessage(
                        {
                            code: 'asset.snapshot.invalid',
                            reason: `invalid inline binary payload for asset ${asset.id}`,
                        },
                        this._locale,
                        this._messageResolver
                    ),
                    {
                        cause: error,
                    }
                );
            }
        }

        const store = this._binary.store;
        if (!store) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `missing binary store for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        let loaded: ArrayBuffer | ArrayBufferView | Uint8Array;

        try {
            loaded = store.read({
                kind: asset.kind,
                id: asset.id,
                key: asset.key,
                revision: asset.revision,
                fingerprint: asset.fingerprint,
                metadata: asset.metadata,
                reference: value,
            } satisfies AssetBinaryStoreReadRequest);
        } catch (error) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `binary store read failed for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                ),
                {
                    cause: error,
                }
            );
        }

        if (!(loaded instanceof ArrayBuffer) && !isTypedArrayView(loaded)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `binary store returned invalid data for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const bytes = getBytes(loaded);
        if (bytes.length !== value.byteLength) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `binary payload length mismatch for asset ${asset.id}`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return bytes;
    }

    private _serializeJsonCompatible<TKind extends AssetKind<TSchema>>(
        data: unknown,
        kind: TKind
    ): AssetJsonValue {
        return this._requireJsonSerializedValue(data, kind);
    }

    private _requireJsonSerializedValue<TKind extends AssetKind<TSchema>>(
        data: unknown,
        kind: TKind
    ): AssetJsonValue {
        if (!isAssetJsonValue(data)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `asset kind "${kind}" is not JSON serializable`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return data;
    }

    private _deserializeJsonCompatible<TKind extends AssetKind<TSchema>>(
        data: unknown,
        kind: TKind
    ): TSchema[TKind] {
        return this._requireJsonSerializedValue(data, kind) as TSchema[TKind];
    }

    private _beginBatch(): void {
        this._batchDepth += 1;
    }

    private _endBatch(): void {
        this._batchDepth -= 1;
        if (this._batchDepth <= 0) {
            this._batchDepth = 0;
            this._scheduleFlush();
        }
    }

    private _emitLeaf(event: AssetLeafChangeEvent<TSchema>): void {
        this._pendingEvents.push(event);
        if (this._batchDepth === 0) {
            this._scheduleFlush();
        }
    }

    private _scheduleFlush(): void {
        if (this._flushScheduled || this._pendingEvents.length === 0) {
            return;
        }

        this._flushScheduled = true;
        queueMicrotask(() => {
            this._flushScheduled = false;
            this._flushEvents();
        });
    }

    private _flushEvents(): void {
        if (this._pendingEvents.length === 0 || this._listeners.size === 0) {
            this._pendingEvents = [];
            return;
        }

        const events = this._pendingEvents;
        this._pendingEvents = [];

        const payload: AssetChangeEvent<TSchema> =
            events.length === 1
                ? events[0]!
                : Object.freeze({
                      type: 'batch',
                      events: Object.freeze([...events]),
                  });

        for (const listener of this._listeners) {
            try {
                listener(payload);
            } catch (error) {
                queueMicrotask(() => {
                    throw error;
                });
            }
        }
    }
}

export const createAssetDatabase = <TSchema extends AssetSchema = AssetSchema>(
    options?: AssetDatabaseOptions<TSchema>
): AssetDatabase<TSchema> => new AssetDatabase<TSchema>(options);
