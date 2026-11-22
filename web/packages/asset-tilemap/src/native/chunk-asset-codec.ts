import type { AssetBinaryCodec } from '@axrone/asset-core';
import {
    decodeChunkSnapshot,
    encodeChunkSnapshot,
    type ChunkSnapshot,
} from '@axrone/tilemap';

/**
 * `AssetBinaryCodec` adapter over the tilemap chunk snapshot codec. The
 * database stores the snapshot object in memory; this codec is used whenever
 * the asset database serializes or hydrates a snapshot (CRC32 is verified on
 * decode).
 */
export const chunkAssetCodec: AssetBinaryCodec<ChunkSnapshot> = {
    format: 'binary',
    serialize(snapshot: ChunkSnapshot): Uint8Array {
        const encoded = encodeChunkSnapshot(snapshot);
        if (encoded.isErr()) {
            throw new Error(encoded.expectErr('encode chunk asset').message);
        }
        return encoded.get();
    },
    deserialize(bytes: Uint8Array): ChunkSnapshot {
        const decoded = decodeChunkSnapshot(bytes);
        if (decoded.isErr()) {
            throw new Error(decoded.expectErr('decode chunk asset').message);
        }
        return decoded.get();
    },
};
