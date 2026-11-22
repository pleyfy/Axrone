import type { ChunkKey } from './types/brands';

/**
 * Narrow metrics contract for the core package. It intentionally has no
 * per-tile counters: cardinality would be unbounded and the adapter to
 * `@axrone/profiler` only receives chunk-level events.
 */
export interface TilemapMetricsSink {
    onChunkAllocated?(key: ChunkKey): void;
    onChunkLoaded?(key: ChunkKey): void;
    onChunkEvicted?(key: ChunkKey, dirty: boolean): void;
    onChunkFlushed?(key: ChunkKey, bytes: number): void;
    onChunkDirtied?(key: ChunkKey): void;
    onChunkPinned?(key: ChunkKey): void;
    onChunkUnpinned?(key: ChunkKey): void;
    onTableRehash?(capacity: number): void;
    onPoolExhausted?(details: {
        readonly dirtyPressure: boolean;
        readonly residentChunks: number;
        readonly pinnedChunks: number;
    }): void;
    onGauge?(name: TilemapGaugeName, value: number): void;
}

export type TilemapGaugeName =
    | 'residentChunks'
    | 'dirtyChunks'
    | 'pinnedChunks'
    | 'activeLeases';

export interface TilemapStoreStats {
    readonly residentChunks: number;
    readonly dirtyChunks: number;
    readonly pinnedChunks: number;
    readonly maxLoadedChunks: number;
    readonly maxDirtyChunks: number;
    readonly chunkShift: number;
    readonly layerCount: number;
}

export const NOOP_TILEMAP_METRICS: TilemapMetricsSink = Object.freeze({});
