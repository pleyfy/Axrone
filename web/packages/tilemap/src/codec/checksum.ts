import { Crc32 } from '@axrone/hash';
import { fmix32 } from '@axrone/hash';

/**
 * CRC32 (IEEE 802.3) over a byte range. The hasher is reused between calls:
 * JavaScript runs one call at a time, so there is no reentrancy hazard.
 */
const crcHasher = new Crc32();

export const crc32Of = (
    bytes: Uint8Array,
    offset = 0,
    length?: number
): number => {
    crcHasher.reset();
    crcHasher.updateBytes(bytes, offset, length);
    return crcHasher.digest() as unknown as number;
};

/** Deterministic 32-bit mix for hash-table bucket selection. */
export const mix32 = (value: number): number => fmix32(value) >>> 0;

export const mixKeys = (a: number, b: number): number =>
    fmix32((a ^ Math.imul(b, 0x9e3779b1)) >>> 0) >>> 0;
