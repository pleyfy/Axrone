import type {
    AssetFingerprint,
    AssetId,
    AssetImporterId,
    AssetKey,
    AssetLocale,
    AssetReference,
    AssetReferenceToken,
    AssetRevision,
    AssetSourceIdentity,
    AssetUri,
    AssetVersionedReference,
    AssetVersionedReferenceToken,
} from './types';

const ASSET_REFERENCE_PATTERN = /^asset:([^:]+):([^@]+)$/;
const ASSET_VERSIONED_REFERENCE_PATTERN = /^asset:([^:]+):([^@]+)@(\d+)$/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;

export const asAssetId = (value: string): AssetId => value as AssetId;
export const asAssetKey = (value: string): AssetKey => value as AssetKey;
export const asAssetUri = (value: string): AssetUri => value as AssetUri;
export const asAssetFingerprint = (value: string): AssetFingerprint => value as AssetFingerprint;
export const asAssetRevision = (value: number): AssetRevision => value as AssetRevision;
export const asAssetLocale = (value: string): AssetLocale => value as AssetLocale;
export const asAssetImporterId = (value: string): AssetImporterId => value as AssetImporterId;
export const asAssetSourceIdentity = (value: string): AssetSourceIdentity =>
    value as AssetSourceIdentity;

const normalizePathLike = (value: string): string => value.trim().replace(/\\/g, '/');

export const normalizeAssetUri = (value?: string): AssetUri | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = normalizePathLike(value);

    if (!normalized) {
        return undefined;
    }

    if (URL_SCHEME_PATTERN.test(normalized)) {
        try {
            return asAssetUri(new URL(normalized).toString());
        } catch {
            return asAssetUri(normalized);
        }
    }

    return asAssetUri(normalized);
};

export const canonicalizeAssetKey = (value: string): AssetKey => {
    const normalizedUri = normalizeAssetUri(value);
    if (normalizedUri) {
        return asAssetKey(normalizedUri);
    }

    const normalized = normalizePathLike(value);
    return asAssetKey(normalized);
};

export const normalizeAssetLocale = (value?: string): AssetLocale | undefined => {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const [normalized] = Intl.getCanonicalLocales(trimmed);
        return normalized ? asAssetLocale(normalized) : asAssetLocale(trimmed);
    } catch {
        return asAssetLocale(trimmed);
    }
};

export const normalizeAssetSourceIdentity = (
    value?: string
): AssetSourceIdentity | undefined => {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim();
    return normalized ? asAssetSourceIdentity(normalized) : undefined;
};

export const createAssetReference = <TKind extends string>(
    kind: TKind,
    id: AssetId
): AssetReference<TKind> =>
    Object.freeze({
        kind,
        id,
        token: `asset:${kind}:${id}` as AssetReferenceToken<TKind>,
    });

export const createVersionedAssetReference = <TKind extends string>(
    kind: TKind,
    id: AssetId,
    revision: AssetRevision
): AssetVersionedReference<TKind> => {
    const reference = createAssetReference(kind, id);

    return Object.freeze({
        ...reference,
        revision,
        versionedToken: `${reference.token}@${revision}` as AssetVersionedReferenceToken<TKind>,
    });
};

export const isAssetReferenceToken = (value: unknown): value is AssetReferenceToken =>
    typeof value === 'string' && ASSET_REFERENCE_PATTERN.test(value);

export const isAssetVersionedReferenceToken = (
    value: unknown
): value is AssetVersionedReferenceToken =>
    typeof value === 'string' && ASSET_VERSIONED_REFERENCE_PATTERN.test(value);

export const parseAssetReferenceToken = <TKind extends string = string>(
    value: string
): AssetReference<TKind> | undefined => {
    const match = ASSET_REFERENCE_PATTERN.exec(value);

    if (!match) {
        return undefined;
    }

    return createAssetReference(match[1] as TKind, asAssetId(match[2]));
};

export const parseAssetVersionedReferenceToken = <TKind extends string = string>(
    value: string
): AssetVersionedReference<TKind> | undefined => {
    const match = ASSET_VERSIONED_REFERENCE_PATTERN.exec(value);

    if (!match) {
        return undefined;
    }

    return createVersionedAssetReference(
        match[1] as TKind,
        asAssetId(match[2]),
        asAssetRevision(Number(match[3]))
    );
};

export const isAssetReference = (value: unknown): value is AssetReference =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetReference).kind === 'string' &&
    typeof (value as AssetReference).id === 'string' &&
    typeof (value as AssetReference).token === 'string' &&
    isAssetReferenceToken((value as AssetReference).token);

export const isAssetVersionedReference = (value: unknown): value is AssetVersionedReference =>
    isAssetReference(value) &&
    typeof (value as AssetVersionedReference).revision === 'number' &&
    typeof (value as AssetVersionedReference).versionedToken === 'string' &&
    isAssetVersionedReferenceToken((value as AssetVersionedReference).versionedToken);
