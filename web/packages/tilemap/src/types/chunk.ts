import type { ChunkKey, PackedTileWord } from './brands';

export const VALID_CHUNK_SHIFTS = [3, 4, 5, 6] as const;
export type ValidChunkShift = (typeof VALID_CHUNK_SHIFTS)[number];

export const isValidChunkShift = (value: number): value is ValidChunkShift =>
    value === 3 || value === 4 || value === 5 || value === 6;

/** Max words in one snapshot: 4 MiB. */
export const MAX_CHUNK_WORDS = 1 << 20;

/** 0 disables the size cap; only used by tests. */
export const UNBOUNDED_CHUNK_WORDS = 0;

export type Residency = 'resident' | 'default' | 'unloaded';

/** Result of a residency-aware read. */
export interface TileRead {
    readonly word: PackedTileWord;
    readonly residency: Residency;
}

/**
 * Detached copy of one chunk. `words` is laid out as
 * `layer * chunkArea + localY * chunkSize + localX`.
 */
export interface ChunkSnapshot {
    readonly key: ChunkKey;
    readonly chunkShift: ValidChunkShift;
    readonly layerCount: number;
    readonly words: Uint32Array;
}

export const chunkSizeForShift = (chunkShift: ValidChunkShift): number =>
    1 << chunkShift;

export const chunkAreaForShift = (chunkShift: ValidChunkShift): number =>
    1 << (chunkShift * 2);

export const chunkWordCount = (
    chunkShift: ValidChunkShift,
    layerCount: number
): number => chunkAreaForShift(chunkShift) * layerCount;

export const CHUNK_SHIFT_MIN = VALID_CHUNK_SHIFTS[0];
export const CHUNK_SHIFT_MAX = VALID_CHUNK_SHIFTS[VALID_CHUNK_SHIFTS.length - 1];
