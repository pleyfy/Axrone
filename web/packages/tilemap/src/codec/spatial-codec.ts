import { TilemapErrorCode, TilemapFault } from '../errors';
import { KEY_BITS, KEY_MASK, KEY_MAX, KEY_MIN } from '../types/brands';

const assertKeyCoordinate = (name: string, value: number): void => {
    if (!Number.isInteger(value) || value < KEY_MIN || value > KEY_MAX) {
        throw new TilemapFault(
            `${name} must be an integer in [${KEY_MIN}, ${KEY_MAX}], got ${value}`,
            TilemapErrorCode.INVALID_COORDINATE,
            { name, value }
        );
    }
};

/**
 * Packs a signed 16-bit coordinate pair into one unsigned 32-bit key.
 * `x` occupies the high half, `y` the low half.
 */
export const packSpatialKey = (
    x: number,
    y: number,
    label: 'grid' | 'chunk' = 'grid'
): number => {
    assertKeyCoordinate(`${label} x`, x);
    assertKeyCoordinate(`${label} y`, y);
    return (((x & KEY_MASK) << KEY_BITS) | (y & KEY_MASK)) >>> 0;
};

export const unpackSpatialKeyX = (key: number): number => (key | 0) >> KEY_BITS;

export const unpackSpatialKeyY = (key: number): number =>
    ((key | 0) << KEY_BITS) >> KEY_BITS;

export const packGridKey = (gridX: number, gridY: number): number =>
    packSpatialKey(gridX, gridY, 'grid');

export const packChunkKey = (chunkX: number, chunkY: number): number =>
    packSpatialKey(chunkX, chunkY, 'chunk');

export const unpackGridX = unpackSpatialKeyX;
export const unpackGridY = unpackSpatialKeyY;
export const unpackChunkX = unpackSpatialKeyX;
export const unpackChunkY = unpackSpatialKeyY;

export const isSpatialKey = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff;

export interface ChunkCoordinate {
    readonly chunkX: number;
    readonly chunkY: number;
    readonly localX: number;
    readonly localY: number;
}

/** Splits a grid coordinate into its chunk and local parts. */
export const gridToChunkCoordinate = (
    gridX: number,
    gridY: number,
    chunkShift: number
): ChunkCoordinate => {
    const mask = (1 << chunkShift) - 1;
    return {
        chunkX: gridX >> chunkShift,
        chunkY: gridY >> chunkShift,
        localX: gridX & mask,
        localY: gridY & mask,
    };
};

export const chunkKeyFromGrid = (
    gridX: number,
    gridY: number,
    chunkShift: number
): number =>
    packChunkKey(gridX >> chunkShift, gridY >> chunkShift);

/** Row-major index inside a chunk's layer plane. */
export const localTileIndex = (
    localX: number,
    localY: number,
    chunkShift: number
): number => (localY << chunkShift) | localX;

export const gridKeyFromChunkLocal = (
    chunkX: number,
    chunkY: number,
    localX: number,
    localY: number,
    chunkShift: number
): number =>
    packGridKey(
        (chunkX << chunkShift) | localX,
        (chunkY << chunkShift) | localY
    );

/** Wraps a 32-bit mix result into an unsigned table index. */
export const tableIndexForHash = (hash: number, capacity: number): number =>
    hash & (capacity - 1);
