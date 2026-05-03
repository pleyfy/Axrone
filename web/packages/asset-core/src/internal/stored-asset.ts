import {
    getBytes,
    isTypedArrayView,
} from './snapshot-serialization';
import { isRecord } from '@axrone/utility';
import {
    asAssetFingerprint,
    asAssetId,
    asAssetRevision,
    createAssetReference,
    createVersionedAssetReference,
    normalizeAssetLocale,
    normalizeAssetUri,
} from '../reference';
import type {
    AssetKey,
    AssetJsonValue,
    AssetKind,
    AssetMetadata,
    AssetMetadataInput,
    AssetRecord,
    AssetReference,
    AssetSchema,
    AssetVersionedReference,
} from '../types';

const EMPTY_STRING_ARRAY = Object.freeze([]) as readonly string[];
const EMPTY_PROPERTIES = Object.freeze({}) as Readonly<Record<string, AssetJsonValue>>;

export const uniqueStrings = (values: readonly string[]): readonly string[] => {
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

export const normalizeMetadata = (input?: AssetMetadataInput): AssetMetadata =>
    Object.freeze({
        uri: normalizeAssetUri(input?.uri),
        mimeType: input?.mimeType?.trim() || undefined,
        locale: normalizeAssetLocale(input?.locale),
        tags: uniqueStrings([...(input?.tags ?? EMPTY_STRING_ARRAY)]),
        properties: sortPropertyRecord(input?.properties ?? EMPTY_PROPERTIES),
    });

export const stableStringify = (value: unknown, seen = new WeakSet<object>()): string => {
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

export const computeFingerprint = (
    kind: string,
    key: AssetKey,
    data: unknown,
    metadata: AssetMetadata
): string =>
    `fp:${hashString(`${kind}|${key}|${stableStringify(data)}|${stableStringify(metadata)}`)}`;

export type InternalAssetDisposer<TSchema extends AssetSchema> = (
    data: unknown,
    record: Readonly<AssetRecord<TSchema>>
) => void;

export const inferAssetName = (kind: string, key: AssetKey, explicitName?: string): string => {
    const trimmed = explicitName?.trim();
    if (trimmed) {
        return trimmed;
    }

    const normalized = String(key);
    const withoutFragment = normalized.split('#', 1)[0] ?? normalized;
    const segment = withoutFragment.split('/').filter(Boolean).pop();
    return segment ?? kind;
};

export interface StoredAssetConfig<
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

export class StoredAsset<
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
