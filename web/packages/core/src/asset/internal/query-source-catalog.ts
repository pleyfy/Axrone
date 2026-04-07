import {
    asAssetId,
    asAssetSourceIdentity,
    normalizeAssetLocale,
    normalizeAssetUri,
} from '../reference';
import type {
    AssetJsonValue,
    AssetMetadata,
    AssetQuery,
    AssetSchema,
    AssetSourceBinding,
    AssetSourceIdentity,
} from '../types';

const EMPTY_STRING_ARRAY = Object.freeze([]) as readonly string[];
const EMPTY_PROPERTIES = Object.freeze({}) as Readonly<Record<string, AssetJsonValue>>;

interface SourceBindingEntry {
    readonly assetId: string;
    readonly updatedAtEpochMs: number;
}

interface AssetCatalogRecord {
    readonly id: string;
    readonly fingerprint: string;
    readonly metadata: Pick<
        AssetMetadata,
        'uri' | 'mimeType' | 'locale' | 'tags' | 'properties'
    >;
}

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

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(
            value instanceof ArrayBuffer ? value : value.buffer,
            value instanceof ArrayBuffer ? 0 : value.byteOffset,
            value instanceof ArrayBuffer ? value.byteLength : value.byteLength
        );
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

    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) {
            return '"[Circular]"';
        }

        seen.add(value);

        if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
            return stableStringify((value as { toJSON: () => unknown }).toJSON(), seen);
        }

        const keys = Object.keys(value).sort();
        const body = keys
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key], seen)}`)
            .join(',');

        seen.delete(value);
        return `{${body}}`;
    }

    return JSON.stringify(String(value));
};

export class AssetQuerySourceCatalog<TSchema extends AssetSchema = AssetSchema> {
    private readonly _sourceBindings = new Map<string, SourceBindingEntry>();
    private readonly _sourceIdentitiesByAssetId = new Map<string, Set<string>>();
    private readonly _fingerprintIndex = new Map<string, Set<string>>();
    private readonly _metadataUriIndex = new Map<string, Set<string>>();
    private readonly _metadataMimeTypeIndex = new Map<string, Set<string>>();
    private readonly _metadataLocaleIndex = new Map<string, Set<string>>();
    private readonly _metadataTagIndex = new Map<string, Set<string>>();
    private readonly _metadataPropertyIndex = new Map<string, Map<string, Set<string>>>();

    getSourceBinding(sourceIdentity: AssetSourceIdentity): Readonly<SourceBindingEntry> | undefined {
        return this._sourceBindings.get(String(sourceIdentity));
    }

    resolveSourceIdentityId(sourceIdentity: AssetSourceIdentity): string | undefined {
        return this._sourceBindings.get(String(sourceIdentity))?.assetId;
    }

    listSourceBindings(): readonly AssetSourceBinding[] {
        return Object.freeze(
            [...this._sourceBindings.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([sourceIdentity, binding]) =>
                    Object.freeze({
                        sourceIdentity: asAssetSourceIdentity(sourceIdentity),
                        assetId: asAssetId(binding.assetId),
                        updatedAtEpochMs: binding.updatedAtEpochMs,
                    })
                )
        );
    }

    snapshotSourceBindings(): readonly {
        readonly sourceIdentity: string;
        readonly assetId: string;
        readonly updatedAtEpochMs: number;
    }[] {
        return Object.freeze(
            [...this._sourceBindings.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([sourceIdentity, binding]) =>
                    Object.freeze({
                        sourceIdentity,
                        assetId: binding.assetId,
                        updatedAtEpochMs: binding.updatedAtEpochMs,
                    })
                )
        );
    }

    bindSourceIdentity(
        sourceIdentity: AssetSourceIdentity,
        assetId: string,
        updatedAtEpochMs: number
    ): void {
        const normalizedIdentity = String(sourceIdentity);
        const previous = this._sourceBindings.get(normalizedIdentity);

        if (previous && previous.assetId !== assetId) {
            this._sourceIdentitiesByAssetId.get(previous.assetId)?.delete(normalizedIdentity);

            if (this._sourceIdentitiesByAssetId.get(previous.assetId)?.size === 0) {
                this._sourceIdentitiesByAssetId.delete(previous.assetId);
            }
        }

        this._sourceBindings.set(normalizedIdentity, {
            assetId,
            updatedAtEpochMs,
        });

        const identities = this._sourceIdentitiesByAssetId.get(assetId) ?? new Set<string>();
        identities.add(normalizedIdentity);
        this._sourceIdentitiesByAssetId.set(assetId, identities);
    }

    unbindSourceIdentity(sourceIdentity: AssetSourceIdentity): boolean {
        const normalizedIdentity = String(sourceIdentity);
        const binding = this._sourceBindings.get(normalizedIdentity);

        if (!binding) {
            return false;
        }

        this._sourceBindings.delete(normalizedIdentity);

        const identities = this._sourceIdentitiesByAssetId.get(binding.assetId);
        identities?.delete(normalizedIdentity);
        if (identities?.size === 0) {
            this._sourceIdentitiesByAssetId.delete(binding.assetId);
        }

        return true;
    }

    unbindSourceIdentitiesForAsset(assetId: string): void {
        const identities = this._sourceIdentitiesByAssetId.get(assetId);
        if (!identities?.size) {
            return;
        }

        for (const sourceIdentity of identities) {
            this._sourceBindings.delete(sourceIdentity);
        }

        this._sourceIdentitiesByAssetId.delete(assetId);
    }

    findCandidateIds(query: AssetQuery<TSchema>): ReadonlySet<string> | undefined {
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
                this._metadataPropertyIndex.get(normalizedKey)?.get(stableStringify(value)) ??
                    new Set<string>()
            );
        }

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

    indexAsset(asset: AssetCatalogRecord): void {
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

    unindexAsset(asset: AssetCatalogRecord): void {
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
}
