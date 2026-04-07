import {
    AssetSnapshotError,
    resolveAssetMessage,
} from '../errors';
import type {
    AssetBinaryCodec,
    AssetBinaryPersistenceOptions,
    AssetBinaryStoreReadRequest,
    AssetBinaryStoreWriteRequest,
    AssetBinaryValue,
    AssetCodec,
    AssetCodecMap,
    AssetDatabaseSnapshot,
    AssetJsonValue,
    AssetKey,
    AssetKind,
    AssetMessageResolver,
    AssetMetadata,
    AssetSchema,
    AssetSerializedValue,
    AssetSnapshotRevisionRecord,
} from '../types';

export const ASSET_SNAPSHOT_VERSION = 4 as const;
const LEGACY_ASSET_SNAPSHOT_VERSIONS = Object.freeze([1, 2, 3] as const);

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

export const isAssetJsonValue = (value: unknown): value is AssetJsonValue => {
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

export const isTypedArrayView = (value: unknown): value is ArrayBufferView =>
    typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value as ArrayBufferView);

export const getBytes = (value: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array =>
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

export const isAssetBinaryValue = (value: unknown): value is AssetBinaryValue =>
    isPlainObject(value) &&
    value.__asset === 'axrone.binary' &&
    Number.isSafeInteger(value.byteLength) &&
    Number(value.byteLength) >= 0 &&
    ((value.storage === 'inline' &&
        value.encoding === 'base64' &&
        typeof value.data === 'string') ||
        (value.storage === 'external' && typeof value.storageKey === 'string'));

export const isAssetDatabaseSnapshot = <TKind extends string = string>(
    value: unknown
): value is AssetDatabaseSnapshot<TKind> =>
    value !== null &&
    typeof value === 'object' &&
    (((value as AssetDatabaseSnapshot<TKind>).version as number) === ASSET_SNAPSHOT_VERSION ||
        LEGACY_ASSET_SNAPSHOT_VERSIONS.includes(
            (value as AssetDatabaseSnapshot<TKind>).version as 1 | 2 | 3
        )) &&
    Array.isArray((value as AssetDatabaseSnapshot<TKind>).assets);

type AssetBinaryModeOptions = Required<
    Pick<AssetBinaryPersistenceOptions, 'mode' | 'inlineThresholdBytes'>
> & Pick<AssetBinaryPersistenceOptions, 'store'>;

export interface AssetSnapshotSerializationContext<TSchema extends AssetSchema> {
    readonly locale: string;
    readonly messageResolver?: AssetMessageResolver;
    readonly codecs: AssetCodecMap<TSchema>;
    readonly binary: AssetBinaryModeOptions;
}

export interface AssetSnapshotAssetDescriptor<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly kind: TKind;
    readonly id: string;
    readonly key: AssetKey;
    readonly data: TSchema[TKind];
    readonly revision: number;
    readonly fingerprint: string;
    readonly metadata: AssetMetadata;
}

export interface AssetSnapshotBinaryDescriptor<TKind extends string = string> {
    readonly kind: TKind;
    readonly id: string;
    readonly key: AssetKey;
    readonly revision: number;
    readonly fingerprint: string;
    readonly metadata: AssetMetadata;
}

const requireJsonSerializedValue = <TKind extends string>(
    data: unknown,
    kind: TKind,
    context: Pick<AssetSnapshotSerializationContext<AssetSchema>, 'locale' | 'messageResolver'>
): AssetJsonValue => {
    if (!isAssetJsonValue(data)) {
        throw new AssetSnapshotError(
            resolveAssetMessage(
                {
                    code: 'asset.snapshot.invalid',
                    reason: `asset kind "${kind}" is not JSON serializable`,
                },
                context.locale,
                context.messageResolver
            )
        );
    }

    return data;
};

const serializeBinaryCompatible = <TKind extends string>(
    value: unknown,
    asset: AssetSnapshotBinaryDescriptor<TKind>,
    context: Pick<AssetSnapshotSerializationContext<AssetSchema>, 'binary' | 'locale' | 'messageResolver'>
): AssetBinaryValue => {
    if (!(value instanceof ArrayBuffer) && !isTypedArrayView(value)) {
        throw new AssetSnapshotError(
            resolveAssetMessage(
                {
                    code: 'asset.snapshot.invalid',
                    reason: `asset kind "${asset.kind}" is not binary serializable`,
                },
                context.locale,
                context.messageResolver
            )
        );
    }

    const bytes = getBytes(value);
    const useExternalStore =
        context.binary.mode === 'external' ||
        (context.binary.mode === 'auto' &&
            !!context.binary.store &&
            bytes.length > context.binary.inlineThresholdBytes);

    if (!useExternalStore) {
        return Object.freeze({
            __asset: 'axrone.binary',
            storage: 'inline',
            encoding: 'base64',
            data: encodeBase64(bytes),
            byteLength: bytes.length,
        });
    }

    const store = context.binary.store;
    if (!store) {
        throw new AssetSnapshotError(
            resolveAssetMessage(
                {
                    code: 'asset.snapshot.invalid',
                    reason: `asset kind "${asset.kind}" requires a binary store`,
                },
                context.locale,
                context.messageResolver
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
                context.locale,
                context.messageResolver
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
                context.locale,
                context.messageResolver
            )
        );
    }

    return Object.freeze({
        __asset: 'axrone.binary',
        storage: 'external',
        storageKey: storageKey.trim(),
        byteLength: bytes.length,
    });
};

const deserializeBinaryCompatible = <TKind extends string>(
    value: AssetSerializedValue,
    asset: AssetSnapshotBinaryDescriptor<TKind>,
    context: Pick<AssetSnapshotSerializationContext<AssetSchema>, 'binary' | 'locale' | 'messageResolver'>
): Uint8Array => {
    if (!isAssetBinaryValue(value)) {
        throw new AssetSnapshotError(
            resolveAssetMessage(
                {
                    code: 'asset.snapshot.invalid',
                    reason: `asset kind "${asset.kind}" does not contain binary data`,
                },
                context.locale,
                context.messageResolver
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
                    context.locale,
                    context.messageResolver
                ),
                {
                    cause: error,
                }
            );
        }
    }

    const store = context.binary.store;
    if (!store) {
        throw new AssetSnapshotError(
            resolveAssetMessage(
                {
                    code: 'asset.snapshot.invalid',
                    reason: `missing binary store for asset ${asset.id}`,
                },
                context.locale,
                context.messageResolver
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
                context.locale,
                context.messageResolver
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
                context.locale,
                context.messageResolver
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
                context.locale,
                context.messageResolver
            )
        );
    }

    return bytes;
};

export const serializeAssetSnapshotData = <
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema>,
>(
    asset: AssetSnapshotAssetDescriptor<TSchema, TKind>,
    context: AssetSnapshotSerializationContext<TSchema>
): AssetSerializedValue => {
    const codec = context.codecs[asset.kind] as AssetCodec<TSchema[TKind]> | undefined;

    if (codec) {
        if (isBinaryCodec(codec)) {
            return serializeBinaryCompatible(codec.serialize(asset.data), asset, context);
        }

        return requireJsonSerializedValue(codec.serialize(asset.data), asset.kind, context);
    }

    if (isAssetJsonValue(asset.data)) {
        return requireJsonSerializedValue(asset.data, asset.kind, context);
    }

    return serializeBinaryCompatible(asset.data, asset, context);
};

export const deserializeAssetSnapshotData = <
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema>,
>(
    entry: AssetSnapshotRevisionRecord<AssetKind<TSchema>>,
    kind: TKind,
    asset: AssetSnapshotBinaryDescriptor<TKind>,
    context: AssetSnapshotSerializationContext<TSchema>
): TSchema[TKind] => {
    const codec = context.codecs[kind] as AssetCodec<TSchema[TKind]> | undefined;

    if (codec) {
        if (isBinaryCodec(codec)) {
            return codec.deserialize(deserializeBinaryCompatible(entry.data, asset, context));
        }

        return codec.deserialize(requireJsonSerializedValue(entry.data, kind, context));
    }

    if (isAssetBinaryValue(entry.data)) {
        return deserializeBinaryCompatible(entry.data, asset, context) as TSchema[TKind];
    }

    return requireJsonSerializedValue(entry.data, kind, context) as TSchema[TKind];
};