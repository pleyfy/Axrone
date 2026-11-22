import { describe, expect, it } from 'vitest';
import type { TimelineRecordEvent } from '@axrone/profiler';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import { createProfilerTilemapMetricsSink } from '../profiler/tilemap-metrics-sink';
import { asChunkKey } from '../types/brands';

interface FakeRecorder {
    readonly events: TimelineRecordEvent[];
    recordEvent(event: TimelineRecordEvent): void;
}

const createRecorder = (): FakeRecorder => {
    const events: TimelineRecordEvent[] = [];
    return {
        events,
        recordEvent(event) {
            events.push(event);
        },
    };
};

const chunk = asChunkKey(0x00010002);

describe('createProfilerTilemapMetricsSink', () => {
    it('adapts every metric callback into one timeline event', () => {
        const recorder = createRecorder();
        let now = 1000;
        const sink = createProfilerTilemapMetricsSink(recorder, {
            now: () => now++,
        });

        sink.onChunkAllocated?.(chunk);
        sink.onChunkLoaded?.(chunk);
        sink.onChunkDirtied?.(chunk);
        sink.onChunkPinned?.(chunk);
        sink.onChunkUnpinned?.(chunk);
        sink.onChunkFlushed?.(chunk, 512);
        sink.onChunkEvicted?.(chunk, true);
        sink.onTableRehash?.(128);
        sink.onPoolExhausted?.({
            dirtyPressure: true,
            residentChunks: 4,
            pinnedChunks: 1,
        });

        expect(recorder.events).toHaveLength(9);
        expect(recorder.events.map((event) => event.payload.event)).toEqual([
            'chunk-allocated',
            'chunk-loaded',
            'chunk-dirtied',
            'chunk-pinned',
            'chunk-unpinned',
            'chunk-flushed',
            'chunk-evicted',
            'table-rehash',
            'pool-exhausted',
        ]);
        for (const event of recorder.events) {
            expect(event.category).toBe('cpu');
            expect(event.payload.domain).toBe('tilemap');
        }
        expect(recorder.events[0]!.timestampMs).toBe(1000);
        expect(recorder.events[1]!.timestampMs).toBe(1001);
        expect(recorder.events[5]!.payload).toMatchObject({ bytes: 512 });
        expect(recorder.events[6]!.payload).toMatchObject({ dirty: true });
        expect(recorder.events[7]!.payload).toMatchObject({ capacity: 128 });
        expect(recorder.events[8]!.payload).toMatchObject({
            dirtyPressure: true,
            residentChunks: 4,
            pinnedChunks: 1,
        });

        expect(sink.counters).toMatchObject({
            chunkAllocated: 1,
            chunkLoaded: 1,
            chunkDirtied: 1,
            pins: 1,
            unpins: 1,
            chunkFlushed: 1,
            chunkFlushedBytes: 512,
            chunkEvicted: 1,
            chunkEvictedDirty: 1,
            tableRehashes: 1,
            poolExhaustions: 1,
        });
    });

    it('tracks gauges without emitting events', () => {
        const recorder = createRecorder();
        const sink = createProfilerTilemapMetricsSink(recorder);

        sink.onGauge?.('residentChunks', 3);
        sink.onGauge?.('dirtyChunks', 1);
        sink.onGauge?.('pinnedChunks', 2);
        sink.onGauge?.('activeLeases', 2);

        expect(recorder.events).toHaveLength(0);
        expect(sink.gauges).toEqual({
            residentChunks: 3,
            dirtyChunks: 1,
            pinnedChunks: 2,
            activeLeases: 2,
        });
    });

    it('resets counters and gauges', () => {
        const recorder = createRecorder();
        const sink = createProfilerTilemapMetricsSink(recorder);
        sink.onChunkAllocated?.(chunk);
        sink.onChunkEvicted?.(chunk, false);
        sink.onGauge?.('residentChunks', 1);

        sink.reset();

        expect(sink.counters.chunkAllocated).toBe(0);
        expect(sink.counters.chunkEvicted).toBe(0);
        expect(sink.counters.chunkEvictedDirty).toBe(0);
        expect(sink.gauges.residentChunks).toBe(0);
        expect(recorder.events).toHaveLength(2);
    });

    it('drives counters from a real TilemapEngine', () => {
        const recorder = createRecorder();
        const sink = createProfilerTilemapMetricsSink(recorder);
        const engine = TilemapBuilder.create()
            .withChunkShift(3)
            .withCapacity(4)
            .withMetrics(sink)
            .withLayers([{ name: 'ground' }])
            .build()
            .get();

        engine.write('ground', 0, 0, TileCodec.pack(1));
        engine.write('ground', 0, 1, TileCodec.pack(2));

        expect(sink.counters.chunkAllocated).toBe(1);
        expect(sink.counters.chunkDirtied).toBe(1);
        expect(sink.gauges.residentChunks).toBe(1);
        expect(sink.gauges.dirtyChunks).toBe(1);
        engine.dispose();
    });
});
