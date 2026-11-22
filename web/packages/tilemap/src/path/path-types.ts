import type { PackedTileWord } from '../types/brands';

/** Options shared by every `findPath` call. */
export interface PathOptions {
    /** Expansion cap; `limit` is returned instead of a partial path. */
    readonly maxExpandedNodes?: number;
    /** Include the four diagonals; default `true`. */
    readonly allowDiagonal?: boolean;
    /** Refuse a diagonal when either orthogonal neighbour blocks it; default `true`. */
    readonly preventCornerCutting?: boolean;
    /** Blocking predicate; defaults to a non-zero collision mask. */
    readonly isBlocked?: (word: PackedTileWord) => boolean;
    /** Base step cost; defaults to `1 + material`. */
    readonly stepCost?: (word: PackedTileWord) => number;
    /**
     * Interleaved `(gridX, gridY)` waypoint buffer filled from start to goal.
     * When it is too small the result is `buffer-too-small`; no partial path
     * is written.
     */
    readonly out?: Int32Array;
}

export interface PathFound {
    readonly status: 'found';
    readonly count: number;
    readonly expanded: number;
    readonly cost: number;
    /** `count * 2` interleaved coordinates, start first, goal last. */
    readonly waypoints: Int32Array;
}

export interface PathNoPath {
    readonly status: 'no-path';
    readonly expanded: number;
}

export interface PathLimit {
    readonly status: 'limit';
    readonly expanded: number;
}

export interface PathBufferTooSmall {
    readonly status: 'buffer-too-small';
    readonly required: number;
    readonly expanded: number;
}

export type PathResult =
    | PathFound
    | PathNoPath
    | PathLimit
    | PathBufferTooSmall;

export const DEFAULT_MAX_EXPANDED_NODES = 100_000;
