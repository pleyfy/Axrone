import type { TimelineRecorder } from '@axrone/profiler';
import type { TilemapMetricsSink, TilemapGaugeName } from '../metrics';
import type { ChunkKey } from '../types/brands';

export interface TilemapMetricsCounters {
    readonly chunkAllocated: number;
    readonly chunkLoaded: number;
    readonly chunkEvicted: number;
    readonly chunkEvictedDirty: number;
    readonly chunkDirtied: number;
    readonly chunkFlushed: number;
    readonly chunkFlushedBytes: number;
    readonly tableRehashes: number;
    readonly poolExhaustions: number;
    readonly pins: number;
    readonly unpins: number;
}

export interface TilemapMetricsGauges {
    readonly residentChunks: number;
    readonly dirtyChunks: number;
    readonly pinnedChunks: number;
    readonly activeLeases: number;
}

export interface ProfilerTilemapMetricsSink extends TilemapMetricsSink {
    readonly counters: TilemapMetricsCounters;
    readonly gauges: TilemapMetricsGauges;
    reset(): void;
}

export interface TilemapProfilerSinkOptions {
    readonly now?: () => number;
}

type RecorderLike = Pick<TimelineRecorder, 'recordEvent'>;

const EMPTY_COUNTERS: TilemapMetricsCounters = Object.freeze({
    chunkAllocated: 0,
    chunkLoaded: 0,
    chunkEvicted: 0,
    chunkEvictedDirty: 0,
    chunkDirtied: 0,
    chunkFlushed: 0,
    chunkFlushedBytes: 0,
    tableRehashes: 0,
    poolExhaustions: 0,
    pins: 0,
    unpins: 0,
});

/**
 * Adapts the narrow tilemap metrics contract to `TimelineRecorder` events and
 * keeps a counter snapshot for tests and overlays.
 */
export const createProfilerTilemapMetricsSink = (
    recorder: RecorderLike,
    options: TilemapProfilerSinkOptions = {}
): ProfilerTilemapMetricsSink => {
    const now = options.now ?? (() => Date.now());
    let counters = { ...EMPTY_COUNTERS };
    let gauges: TilemapMetricsGauges = {
        residentChunks: 0,
        dirtyChunks: 0,
        pinnedChunks: 0,
        activeLeases: 0,
    };

    const emit = (
        event: string,
        payload: Record<string, unknown>
    ): void => {
        recorder.recordEvent({
            timestampMs: now(),
            category: 'cpu',
            payload: { domain: 'tilemap', event, ...payload },
        });
    };

    const bump = (
        key: keyof TilemapMetricsCounters,
        amount = 1
    ): void => {
        counters = { ...counters, [key]: counters[key] + amount };
    };

    return {
        get counters(): TilemapMetricsCounters {
            return counters;
        },
        get gauges(): TilemapMetricsGauges {
            return gauges;
        },

        onChunkAllocated(key: ChunkKey): void {
            bump('chunkAllocated');
            emit('chunk-allocated', { key });
        },
        onChunkLoaded(key: ChunkKey): void {
            bump('chunkLoaded');
            emit('chunk-loaded', { key });
        },
        onChunkEvicted(key: ChunkKey, dirty: boolean): void {
            bump('chunkEvicted');
            if (dirty) bump('chunkEvictedDirty');
            emit('chunk-evicted', { key, dirty });
        },
        onChunkDirtied(key: ChunkKey): void {
            bump('chunkDirtied');
            emit('chunk-dirtied', { key });
        },
        onChunkFlushed(key: ChunkKey, bytes: number): void {
            bump('chunkFlushed');
            bump('chunkFlushedBytes', bytes);
            emit('chunk-flushed', { key, bytes });
        },
        onChunkPinned(key: ChunkKey): void {
            bump('pins');
            emit('chunk-pinned', { key });
        },
        onChunkUnpinned(key: ChunkKey): void {
            bump('unpins');
            emit('chunk-unpinned', { key });
        },
        onTableRehash(capacity: number): void {
            bump('tableRehashes');
            emit('table-rehash', { capacity });
        },
        onPoolExhausted(details): void {
            bump('poolExhaustions');
            emit('pool-exhausted', { ...details });
        },
        onGauge(name: TilemapGaugeName, value: number): void {
            gauges = { ...gauges, [name]: value };
        },

        reset(): void {
            counters = { ...EMPTY_COUNTERS };
            gauges = {
                residentChunks: 0,
                dirtyChunks: 0,
                pinnedChunks: 0,
                activeLeases: 0,
            };
        },
    };
};
