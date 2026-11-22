import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@axrone/utility';
import {
    CHUNK_CODEC_HEADER_BYTES,
    CHUNK_CODEC_MAGIC,
    CHUNK_CODEC_VERSION,
    decodeChunkSnapshot,
    decodeChunkSnapshotInto,
    encodeChunkSnapshot,
    encodeChunkSnapshotInto,
    encodedChunkByteLength,
    validateChunkSnapshot,
} from '../codec/chunk-binary-codec';
import { crc32Of } from '../codec/checksum';
import { packChunkKey } from '../codec/spatial-codec';
import type { ChunkSnapshot } from '../types/chunk';
import type { TilemapError } from '../errors';

type SnapshotResult = Result<ChunkSnapshot, TilemapError>;

const makeSnapshot = (
    chunkX = 0,
    chunkY = 0,
    chunkShift: 3 | 4 | 5 | 6 = 3,
    layerCount = 2,
    word: (index: number) => number = (index) => index % 7
): ChunkSnapshot => {
    const words = new Uint32Array((1 << (chunkShift * 2)) * layerCount);
    for (let index = 0; index < words.length; index++) {
        words[index] = word(index);
    }
    return {
        key: packChunkKey(chunkX, chunkY) as ChunkSnapshot['key'],
        chunkShift,
        layerCount,
        words,
    };
};

const expectErrCode = (
    result: SnapshotResult,
    code: string
): void => {
    expect(result.isErr()).toBe(true);
    expect(result.expectErr('expected error').code).toBe(code);
};

const rewriteCrc = (bytes: Uint8Array): void => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(
        16,
        crc32Of(bytes, CHUNK_CODEC_HEADER_BYTES, bytes.length - CHUNK_CODEC_HEADER_BYTES),
        true
    );
};

describe('chunk binary codec v1', () => {
    it('encodes the documented header', () => {
        const snapshot = makeSnapshot(2, -3, 3, 2, () => 0);
        const encoded = encodeChunkSnapshot(snapshot);
        expect(encoded.isOk()).toBe(true);
        const bytes = encoded.get();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        expect(view.getUint32(0, true)).toBe(CHUNK_CODEC_MAGIC);
        expect(view.getUint8(4)).toBe(CHUNK_CODEC_VERSION);
        expect(view.getUint8(5)).toBe(3);
        expect(view.getUint8(6)).toBe(2);
        expect(view.getUint8(7)).toBe(0);
        expect(view.getUint32(8, true)).toBe(packChunkKey(2, -3));
        expect(view.getUint32(12, true)).toBe(128);
        expect(view.getUint32(16, true)).toBe(
            crc32Of(bytes, CHUNK_CODEC_HEADER_BYTES, bytes.length - CHUNK_CODEC_HEADER_BYTES)
        );
        // One run of 128 zeros -> one RLE pair.
        expect(bytes.length).toBe(CHUNK_CODEC_HEADER_BYTES + 8);
        expect(view.getUint32(20, true)).toBe(0);
        expect(view.getUint32(24, true)).toBe(128);
    });

    it('round-trips a mixed snapshot', () => {
        const snapshot = makeSnapshot(11, -7, 4, 3, (index) =>
            index % 13 === 0 ? 0 : ((index * 2654435761) >>> 0) & 0x7fffffff
        );
        const encoded = encodeChunkSnapshot(snapshot);
        expect(encoded.isOk()).toBe(true);
        const decoded = decodeChunkSnapshot(encoded.get());
        expect(decoded.isOk()).toBe(true);
        const value = decoded.get();
        expect(value.key).toBe(snapshot.key);
        expect(value.chunkShift).toBe(4);
        expect(value.layerCount).toBe(3);
        expect(Array.from(value.words)).toEqual(Array.from(snapshot.words));
    });

    it('decodes into a caller buffer', () => {
        const snapshot = makeSnapshot(0, 0, 3, 1, (index) => index & 3);
        const encoded = encodeChunkSnapshot(snapshot).get();
        const out = new Uint32Array(snapshot.words.length);
        const decoded = decodeChunkSnapshotInto(encoded, out);
        expect(decoded.isOk()).toBe(true);
        expect(decoded.get().words).toBe(out);
        expect(Array.from(out)).toEqual(Array.from(snapshot.words));
    });

    it('encodes into a caller scratch buffer', () => {
        const snapshot = makeSnapshot();
        const size = encodedChunkByteLength(snapshot).get();
        const scratch = new Uint8Array(size + 32);
        const written = encodeChunkSnapshotInto(snapshot, scratch);
        expect(written.isOk()).toBe(true);
        expect(written.get()).toBe(size);
        const decoded = decodeChunkSnapshot(scratch.subarray(0, size));
        expect(decoded.isOk()).toBe(true);
    });

    it('rejects a scratch buffer that is too small', () => {
        const snapshot = makeSnapshot();
        const written = encodeChunkSnapshotInto(snapshot, new Uint8Array(4));
        expect(written.isErr()).toBe(true);
        expect(written.expectErr('small').code).toBe('INVALID_CONFIGURATION');
    });

    it('validates snapshot geometry before touching data', () => {
        const snapshot = makeSnapshot(1, 1, 4, 2);
        expect(validateChunkSnapshot(snapshot).isOk()).toBe(true);

        const wrongKey = validateChunkSnapshot(snapshot, {
            key: packChunkKey(9, 9) as ChunkSnapshot['key'],
        });
        expectErrCode(wrongKey, 'INVALID_SNAPSHOT');

        const wrongShift = validateChunkSnapshot(snapshot, { chunkShift: 3 });
        expectErrCode(wrongShift, 'INVALID_SNAPSHOT');

        const wrongLayers = validateChunkSnapshot(snapshot, { layerCount: 3 });
        expectErrCode(wrongLayers, 'INVALID_SNAPSHOT');

        const wrongWords = validateChunkSnapshot({
            ...snapshot,
            words: new Uint32Array(4),
        });
        expectErrCode(wrongWords, 'INVALID_SNAPSHOT');
    });

    it('rejects a reserved-bit word when validating', () => {
        const snapshot = makeSnapshot();
        snapshot.words[10] = 0x80000000;
        const validated = validateChunkSnapshot(snapshot);
        expectErrCode(validated, 'INVALID_SNAPSHOT');
    });

    it('rejects truncated payloads', () => {
        const bytes = encodeChunkSnapshot(makeSnapshot()).get();
        for (const length of [0, 8, 19, 24]) {
            const result = decodeChunkSnapshot(bytes.subarray(0, length));
            expectErrCode(result, 'CODEC_CORRUPT_PAYLOAD');
        }
    });

    it('rejects trailing bytes', () => {
        const bytes = encodeChunkSnapshot(makeSnapshot()).get();
        const padded = new Uint8Array(bytes.length + 1);
        padded.set(bytes);
        expectErrCode(decodeChunkSnapshot(padded), 'CODEC_CORRUPT_PAYLOAD');
    });

    it('rejects a CRC mismatch', () => {
        const bytes = encodeChunkSnapshot(
            makeSnapshot(0, 0, 3, 1, (index) => index)
        ).get();
        const copy = bytes.slice();
        copy[CHUNK_CODEC_HEADER_BYTES + 1] ^= 0x01;
        expectErrCode(
            decodeChunkSnapshot(copy),
            'CODEC_CHECKSUM_MISMATCH'
        );
    });

    it('rejects a zero-length run even with a valid CRC', () => {
        const bytes = encodeChunkSnapshot(
            makeSnapshot(0, 0, 3, 1, () => 0)
        ).get();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        view.setUint32(24, 0, true);
        rewriteCrc(bytes);
        expectErrCode(decodeChunkSnapshot(bytes), 'CODEC_CORRUPT_PAYLOAD');
    });

    it('rejects a word with the reserved bit even with a valid CRC', () => {
        const bytes = encodeChunkSnapshot(
            makeSnapshot(0, 0, 3, 1, () => 0)
        ).get();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        view.setUint32(20, 0x80000000, true);
        rewriteCrc(bytes);
        expectErrCode(decodeChunkSnapshot(bytes), 'CODEC_CORRUPT_PAYLOAD');
    });

    it('rejects runs that overflow the declared word count', () => {
        const bytes = encodeChunkSnapshot(
            makeSnapshot(0, 0, 3, 1, () => 0)
        ).get();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        view.setUint32(24, 0xffff, true);
        rewriteCrc(bytes);
        expectErrCode(decodeChunkSnapshot(bytes), 'CODEC_CORRUPT_PAYLOAD');
    });

    it('rejects an impossible declared word count', () => {
        const bytes = encodeChunkSnapshot(makeSnapshot()).get();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        view.setUint32(12, 3, true);
        expectErrCode(decodeChunkSnapshot(bytes), 'CODEC_CORRUPT_PAYLOAD');
    });

    it('rejects unsupported versions, shifts and layer counts', () => {
        for (const [offset, value] of [
            [4, 2],
            [5, 7],
            [6, 0],
        ] as const) {
            const bytes = encodeChunkSnapshot(makeSnapshot()).get();
            bytes[offset] = value;
            expectErrCode(
                decodeChunkSnapshot(bytes),
                'CODEC_CORRUPT_PAYLOAD'
            );
        }
    });

    it('never throws on mutated payloads', () => {
        const source = encodeChunkSnapshot(
            makeSnapshot(3, 4, 4, 2, (index) => index % 5)
        ).get();
        let state = 0x12345678;
        for (let iteration = 0; iteration < 2_000; iteration++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const bytes = source.slice();
            const index = state % bytes.length;
            bytes[index] = (bytes[index]! ^ (1 + (state & 0xff))) & 0xff;
            expect(() => decodeChunkSnapshot(bytes)).not.toThrow();
        }
    });

    it('returns errors, not throws, through the Result surface', () => {
        const decoded = decodeChunkSnapshot(new Uint8Array(0));
        expect(decoded.isErr()).toBe(true);
        expect(ok(true).isOk()).toBe(true);
    });
});
