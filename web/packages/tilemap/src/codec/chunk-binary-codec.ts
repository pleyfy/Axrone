import { err, ok, type Result } from '@axrone/utility';
import { TilemapErrorCode, tilemapError, type TilemapError } from '../errors';
import type { ChunkKey } from '../types/brands';
import {
    MAX_CHUNK_WORDS,
    isValidChunkShift,
    type ChunkSnapshot,
    type ValidChunkShift,
} from '../types/chunk';
import { crc32Of } from './checksum';

export const CHUNK_CODEC_VERSION = 1;
export const CHUNK_CODEC_HEADER_BYTES = 20;
export const CHUNK_CODEC_PAIR_BYTES = 8;

/** ASCII `AXTC`, read as a little-endian uint32. */
export const CHUNK_CODEC_MAGIC = 0x43545841;

const MAX_SNAPSHOT_LAYERS = 64;
const RESERVED_MASK = 0x80000000;

export interface SnapshotExpectation {
    readonly key?: ChunkKey;
    readonly chunkShift?: ValidChunkShift;
    readonly layerCount?: number;
    /** Defaults to `MAX_CHUNK_WORDS`. */
    readonly maxWords?: number;
}

const fail = (
    code: TilemapErrorCode,
    message: string,
    details?: Record<string, unknown>
): Result<never, TilemapError> => err(tilemapError(code, message, { details }));

const expectedWordCount = (
    chunkShift: ValidChunkShift,
    layerCount: number
): number => layerCount << (chunkShift * 2);

/**
 * Shared geometry + payload validator. Both `importSnapshot` and the async
 * load path call this before mutating engine state.
 */
export const validateChunkSnapshot = (
    snapshot: ChunkSnapshot,
    expected?: SnapshotExpectation
): Result<ChunkSnapshot, TilemapError> => {
    if (snapshot === null || typeof snapshot !== 'object') {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot must be an object'
        );
    }
    if (
        !Number.isInteger(snapshot.key) ||
        snapshot.key < 0 ||
        snapshot.key > 0xffffffff
    ) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot key must be an unsigned 32-bit integer',
            { key: snapshot.key }
        );
    }
    if (!isValidChunkShift(snapshot.chunkShift)) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            `chunk snapshot chunkShift must be one of 3, 4, 5, 6; got ${String(snapshot.chunkShift)}`,
            { chunkShift: snapshot.chunkShift }
        );
    }
    if (
        !Number.isInteger(snapshot.layerCount) ||
        snapshot.layerCount < 1 ||
        snapshot.layerCount > MAX_SNAPSHOT_LAYERS
    ) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            `chunk snapshot layerCount must be in [1, ${MAX_SNAPSHOT_LAYERS}]`,
            { layerCount: snapshot.layerCount }
        );
    }
    if (!(snapshot.words instanceof Uint32Array)) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot words must be a Uint32Array'
        );
    }
    const wordCount = expectedWordCount(
        snapshot.chunkShift,
        snapshot.layerCount
    );
    const maxWords = expected?.maxWords ?? MAX_CHUNK_WORDS;
    if (wordCount > maxWords) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            `chunk snapshot would need ${wordCount} words, above the ${maxWords} word limit`,
            { wordCount, maxWords }
        );
    }
    if (snapshot.words.length !== wordCount) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            `chunk snapshot has ${snapshot.words.length} words, expected ${wordCount}`,
            { actual: snapshot.words.length, expected: wordCount }
        );
    }
    if (expected?.key !== undefined && snapshot.key !== expected.key) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot key does not match the requested chunk',
            { actual: snapshot.key, expected: expected.key }
        );
    }
    if (
        expected?.chunkShift !== undefined &&
        snapshot.chunkShift !== expected.chunkShift
    ) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot chunkShift does not match the store',
            { actual: snapshot.chunkShift, expected: expected.chunkShift }
        );
    }
    if (
        expected?.layerCount !== undefined &&
        snapshot.layerCount !== expected.layerCount
    ) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            'chunk snapshot layerCount does not match the store',
            { actual: snapshot.layerCount, expected: expected.layerCount }
        );
    }
    for (let index = 0; index < snapshot.words.length; index++) {
        if ((snapshot.words[index]! & RESERVED_MASK) !== 0) {
            return fail(
                TilemapErrorCode.INVALID_SNAPSHOT,
                'chunk snapshot contains a word with the reserved bit set',
                { index, word: snapshot.words[index] }
            );
        }
    }
    return ok(snapshot);
};

const countRuns = (words: Uint32Array): number => {
    let runs = 0;
    let index = 0;
    while (index < words.length) {
        const value = words[index]!;
        index++;
        while (index < words.length && words[index] === value) index++;
        runs++;
    }
    return runs;
};

/** Byte size of an encoded snapshot, without allocating it. */
export const encodedChunkByteLength = (
    snapshot: ChunkSnapshot
): Result<number, TilemapError> => {
    const validated = validateChunkSnapshot(snapshot);
    if (validated.isErr()) return err(validated.expectErr('validated snapshot'));
    return ok(
        CHUNK_CODEC_HEADER_BYTES + countRuns(snapshot.words) * CHUNK_CODEC_PAIR_BYTES
    );
};

const writeChunk = (snapshot: ChunkSnapshot, target: Uint8Array): void => {
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    view.setUint32(0, CHUNK_CODEC_MAGIC, true);
    view.setUint8(4, CHUNK_CODEC_VERSION);
    view.setUint8(5, snapshot.chunkShift);
    view.setUint8(6, snapshot.layerCount);
    view.setUint8(7, 0);
    view.setUint32(8, snapshot.key as unknown as number, true);
    view.setUint32(12, snapshot.words.length, true);

    const words = snapshot.words;
    let offset = CHUNK_CODEC_HEADER_BYTES;
    let index = 0;
    while (index < words.length) {
        const value = words[index]!;
        let next = index + 1;
        while (next < words.length && words[next] === value) next++;
        view.setUint32(offset, value, true);
        view.setUint32(offset + 4, next - index, true);
        offset += CHUNK_CODEC_PAIR_BYTES;
        index = next;
    }

    const payloadBytes = target.byteLength - CHUNK_CODEC_HEADER_BYTES;
    view.setUint32(
        16,
        crc32Of(target, CHUNK_CODEC_HEADER_BYTES, payloadBytes),
        true
    );
};

/** Convenience encoder; allocates the target buffer. */
export const encodeChunkSnapshot = (
    snapshot: ChunkSnapshot
): Result<Uint8Array, TilemapError> => {
    const size = encodedChunkByteLength(snapshot);
    if (size.isErr()) return err(size.expectErr('encoded size'));
    const bytes = new Uint8Array(size.get());
    writeChunk(snapshot, bytes);
    return ok(bytes);
};

/**
 * Encodes into a caller-supplied scratch buffer. Returned number is the number
 * of bytes written; the save path keeps one scratch buffer per engine.
 */
export const encodeChunkSnapshotInto = (
    snapshot: ChunkSnapshot,
    target: Uint8Array
): Result<number, TilemapError> => {
    const size = encodedChunkByteLength(snapshot);
    if (size.isErr()) return err(size.expectErr('encoded size'));
    const required = size.get();
    if (target.length < required) {
        return fail(
            TilemapErrorCode.INVALID_CONFIGURATION,
            `encode target needs ${required} bytes, got ${target.length}`,
            { required, actual: target.length }
        );
    }
    writeChunk(snapshot, target.subarray(0, required));
    return ok(required);
};

interface ChunkHeader {
    readonly key: ChunkKey;
    readonly chunkShift: ValidChunkShift;
    readonly layerCount: number;
    readonly wordCount: number;
    readonly payloadBytes: number;
}

const parseHeader = (
    bytes: Uint8Array
): Result<ChunkHeader, TilemapError> => {
    if (!(bytes instanceof Uint8Array)) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            'chunk payload must be a Uint8Array'
        );
    }
    if (bytes.length < CHUNK_CODEC_HEADER_BYTES) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload is ${bytes.length} bytes, shorter than the ${CHUNK_CODEC_HEADER_BYTES} byte header`
        );
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== CHUNK_CODEC_MAGIC) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            'chunk payload magic mismatch'
        );
    }
    const version = view.getUint8(4);
    if (version !== CHUNK_CODEC_VERSION) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `unsupported chunk format version ${version}`,
            { version }
        );
    }
    const chunkShift = view.getUint8(5);
    if (!isValidChunkShift(chunkShift)) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `invalid chunk shift ${chunkShift}`,
            { chunkShift }
        );
    }
    const layerCount = view.getUint8(6);
    if (layerCount < 1 || layerCount > MAX_SNAPSHOT_LAYERS) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `invalid layer count ${layerCount}`,
            { layerCount }
        );
    }
    if (view.getUint8(7) !== 0) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            'chunk payload reserved header byte must be zero'
        );
    }
    const key = view.getUint32(8, true) as ChunkKey;
    const wordCount = view.getUint32(12, true);
    const expected = expectedWordCount(chunkShift, layerCount);
    if (wordCount !== expected) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload declares ${wordCount} words, expected ${expected}`,
            { wordCount, expected }
        );
    }
    if (wordCount > MAX_CHUNK_WORDS) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload declares ${wordCount} words, above the ${MAX_CHUNK_WORDS} word limit`,
            { wordCount }
        );
    }
    const payloadBytes = bytes.length - CHUNK_CODEC_HEADER_BYTES;
    if (payloadBytes % CHUNK_CODEC_PAIR_BYTES !== 0) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload length ${payloadBytes} is not a multiple of ${CHUNK_CODEC_PAIR_BYTES}`,
            { payloadBytes }
        );
    }
    const runCount = payloadBytes / CHUNK_CODEC_PAIR_BYTES;
    if (runCount < 1 || runCount > wordCount) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload has an impossible run count ${runCount}`,
            { runCount, wordCount }
        );
    }
    const storedCrc = view.getUint32(16, true);
    const actualCrc = crc32Of(bytes, CHUNK_CODEC_HEADER_BYTES, payloadBytes);
    if (storedCrc !== actualCrc) {
        return err(
            tilemapError(
                TilemapErrorCode.CODEC_CHECKSUM_MISMATCH,
                'chunk payload CRC mismatch',
                {
                    details: {
                        stored: storedCrc,
                        actual: actualCrc,
                    },
                }
            )
        );
    }
    return ok({
        key,
        chunkShift,
        layerCount,
        wordCount,
        payloadBytes,
    });
};

const readPayload = (
    bytes: Uint8Array,
    header: ChunkHeader,
    out: Uint32Array
): Result<ChunkSnapshot, TilemapError> => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let writeIndex = 0;
    for (
        let offset = CHUNK_CODEC_HEADER_BYTES;
        offset < bytes.length;
        offset += CHUNK_CODEC_PAIR_BYTES
    ) {
        const word = view.getUint32(offset, true);
        const run = view.getUint32(offset + 4, true);
        if (run === 0) {
            return fail(
                TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
                'chunk payload contains a zero-length run',
                { offset }
            );
        }
        if ((word & RESERVED_MASK) !== 0) {
            return fail(
                TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
                'chunk payload contains a word with the reserved bit set',
                { offset, word }
            );
        }
        if (writeIndex + run > header.wordCount) {
            return fail(
                TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
                'chunk payload runs overflow the declared word count',
                { writeIndex, run, wordCount: header.wordCount }
            );
        }
        out.fill(word, writeIndex, writeIndex + run);
        writeIndex += run;
    }
    if (writeIndex !== header.wordCount) {
        return fail(
            TilemapErrorCode.CODEC_CORRUPT_PAYLOAD,
            `chunk payload produced ${writeIndex} of ${header.wordCount} words`,
            { writeIndex, wordCount: header.wordCount }
        );
    }
    return ok({
        key: header.key,
        chunkShift: header.chunkShift,
        layerCount: header.layerCount,
        words: out,
    });
};

/** Allocates a fresh snapshot. Bounded by `MAX_CHUNK_WORDS`. */
export const decodeChunkSnapshot = (
    bytes: Uint8Array
): Result<ChunkSnapshot, TilemapError> => {
    const header = parseHeader(bytes);
    if (header.isErr()) return err(header.expectErr('chunk header'));
    const words = new Uint32Array(header.get().wordCount);
    return readPayload(bytes, header.get(), words);
};

/** Decodes into an existing word buffer; its length must match exactly. */
export const decodeChunkSnapshotInto = (
    bytes: Uint8Array,
    out: Uint32Array
): Result<ChunkSnapshot, TilemapError> => {
    const header = parseHeader(bytes);
    if (header.isErr()) return err(header.expectErr('chunk header'));
    const parsed = header.get();
    if (out.length !== parsed.wordCount) {
        return fail(
            TilemapErrorCode.INVALID_SNAPSHOT,
            `decode target has ${out.length} words, expected ${parsed.wordCount}`,
            { actual: out.length, expected: parsed.wordCount }
        );
    }
    return readPayload(bytes, parsed, out);
};
