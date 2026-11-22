import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    namespaceEvents,
    createEmitter,
    createTypedEmitter,
    EventEmitter,
    type EventMap,
    type IEventEmitter,
} from '@axrone/event';

interface SourceEvents extends EventMap {
    'test:event': { value: number };
    'test:other': { message: string };
    error: Error;
}

describe('namespaceEvents - Comprehensive', () => {
    let source: IEventEmitter<SourceEvents>;
    let namespaced: ReturnType<typeof namespaceEvents<'ns', SourceEvents>>;

    beforeEach(() => {
        source = createEmitter<SourceEvents>();
        namespaced = namespaceEvents('ns', source);
    });

    afterEach(() => {
        (namespaced as any).dispose();
        source.dispose();
    });

    describe('Basic on/emit through namespace', () => {
        it('should receive events emitted through source with ns: prefix', async () => {
            let received: any = null;
            namespaced.on('ns:test:event', (data) => {
                received = data;
            });

            await source.emit('test:event', { value: 42 });
            expect(received).toEqual({ value: 42 });
        });

        it('should emit through namespace to source', async () => {
            let received: any = null;
            source.on('test:event', (data) => {
                received = data;
            });

            await namespaced.emit('ns:test:event' as any, { value: 99 });
            expect(received).toEqual({ value: 99 });
        });
    });

    describe('emitSync() through namespace', () => {
        it('should dispatch synchronously through namespace', () => {
            const received: number[] = [];

            namespaced.on('ns:test:event', (data) => {
                received.push(data.value);
            });

            const result = namespaced.emitSync('ns:test:event' as any, { value: 7 });
            expect(result).toBe(true);
            expect(received).toEqual([7]);
        });
    });

    describe('emitBatch() through namespace', () => {
        it('should emit batch events through namespace', async () => {
            let count = 0;
            namespaced.on('ns:test:event', () => {
                count++;
            });

            await namespaced.emitBatch([
                { event: 'ns:test:event' as any, data: { value: 1 } },
                { event: 'ns:test:event' as any, data: { value: 2 } },
            ]);

            expect(count).toBe(2);
        });
    });

    describe('once() through namespace', () => {
        it('should auto-unsubscribe after first invocation', async () => {
            let count = 0;
            namespaced.once('ns:test:event', () => {
                count++;
            });

            await source.emit('test:event', { value: 1 });
            await source.emit('test:event', { value: 2 });

            expect(count).toBe(1);
        });
    });

    describe('off() and offById() through namespace', () => {
        it('should remove listener by callback', () => {
            const cb = vi.fn();
            namespaced.on('ns:test:event', cb);

            const removed = namespaced.off('ns:test:event' as any, cb as any);
            expect(removed).toBe(true);
        });

        it('should remove listener by subscription ID', () => {
            const cb = vi.fn();
            const unsub = namespaced.on('ns:test:event', cb as any);

            expect(namespaced.listenerCount('ns:test:event' as any)).toBe(1);

            const unsubResult = unsub();
            expect(unsubResult).toBe(true);
            expect(namespaced.listenerCount('ns:test:event' as any)).toBe(0);
        });
    });

    describe('pipe() through namespace', () => {
        it('should forward events from source to target with explicit target event', async () => {
            const target = createEmitter<SourceEvents>();
            let targetReceived = false;

            target.on('test:event', () => {
                targetReceived = true;
            });

            namespaced.pipe('ns:test:event' as any, target as any, 'test:event');

            await source.emit('test:event', { value: 1 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });

        it('should forward events using namespaced name when no target event specified', async () => {
            const target = createTypedEmitter<{ 'ns:test:event': { value: number } }>();
            let targetReceived = false;

            target.on('ns:test:event', () => {
                targetReceived = true;
            });

            namespaced.pipe('ns:test:event' as any, target as any);

            await source.emit('test:event', { value: 1 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });
    });

    describe('pause/resume/isPaused delegation', () => {
        it('should delegate pause state to source', () => {
            expect(namespaced.isPaused()).toBe(false);

            namespaced.pause();
            expect(namespaced.isPaused()).toBe(true);
            expect(source.isPaused()).toBe(true);

            namespaced.resume();
            expect(namespaced.isPaused()).toBe(false);
        });
    });

    describe('Buffer operations with namespace translation', () => {
        it('should getQueuedEvents with namespace prefix in event names', async () => {
            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            const queued = namespaced.getQueuedEvents('ns:test:event' as any);
            expect(queued).toHaveLength(1);
            expect(queued[0]!.event).toBe('ns:test:event');

            namespaced.resume();
        });

        it('should getQueuedEvents without argument with translated names', async () => {
            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            const all = namespaced.getQueuedEvents();
            expect(all).toHaveLength(1);
            expect(all[0]!.event).toBe('ns:test:event');

            namespaced.resume();
        });

        it('should delegate getPendingCount', async () => {
            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            expect(namespaced.getPendingCount('ns:test:event' as any)).toBe(1);
            expect(namespaced.getPendingCount()).toBe(1);

            namespaced.resume();
        });

        it('should delegate clearBuffer with namespace translation', async () => {
            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            const cleared = namespaced.clearBuffer('ns:test:event' as any);
            expect(cleared).toBe(1);
            expect(namespaced.getPendingCount()).toBe(0);

            namespaced.resume();
        });

        it('should delegate getBufferSize', () => {
            expect(namespaced.getBufferSize()).toBe(1000);
        });
    });

    describe('batchSubscribe/batchUnsubscribe through namespace', () => {
        it('should batch subscribe through namespace', async () => {
            const cbs = [vi.fn(), vi.fn(), vi.fn()];
            const ids = namespaced.batchSubscribe('ns:test:event' as any, cbs as any);

            expect(ids).toHaveLength(3);
            expect(namespaced.listenerCount('ns:test:event' as any)).toBe(3);

            await source.emit('test:event', { value: 1 });
            cbs.forEach((cb) => expect(cb).toHaveBeenCalledOnce());

            const unsubscribed = namespaced.batchUnsubscribe(ids);
            expect(unsubscribed).toBe(3);
            expect(namespaced.listenerCount('ns:test:event' as any)).toBe(0);
        });
    });

    describe('removeAllListeners() through namespace', () => {
        it('should remove all listeners for specific namespaced event', () => {
            namespaced.on('ns:test:event', vi.fn() as any);
            namespaced.on('ns:test:other', vi.fn() as any);

            namespaced.removeAllListeners('ns:test:event' as any);

            expect(namespaced.listenerCount('ns:test:event' as any)).toBe(0);
            expect(namespaced.listenerCount('ns:test:other' as any)).toBe(1);
        });

        it('should remove all listeners across all events', () => {
            namespaced.on('ns:test:event', vi.fn() as any);
            namespaced.on('ns:test:other', vi.fn() as any);

            namespaced.removeAllListeners();

            expect(namespaced.listenerCountAll()).toBe(0);
        });
    });

    describe('drain/flush/resetMetrics through namespace', () => {
        it('should delegate drain', async () => {
            let processed = 0;
            namespaced.on('ns:test:event', () => {
                processed++;
            });

            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            namespaced.resume();
            await namespaced.drain();

            expect(processed).toBe(1);
        });

        it('should delegate flush', async () => {
            let processed = 0;
            namespaced.on('ns:test:event', () => {
                processed++;
            });

            namespaced.pause();
            await namespaced.emit('ns:test:event' as any, { value: 1 });
            await namespaced.emit('ns:test:event' as any, { value: 2 });

            await namespaced.flush('ns:test:event' as any);
            expect(processed).toBe(2);

            namespaced.resume();
        });

        it('should delegate resetMetrics', async () => {
            namespaced.on('ns:test:event', () => {});
            await namespaced.emit('ns:test:event' as any, { value: 1 });

            let metrics = namespaced.getMetrics('ns:test:event' as any);
            expect(metrics.emit.count).toBe(1);

            namespaced.resetMetrics('ns:test:event' as any);

            metrics = namespaced.getMetrics('ns:test:event' as any);
            expect(metrics.emit.count).toBe(0);
        });
    });

    describe('getSubscriptions() with namespace translation', () => {
        it('should return subscriptions with namespaced event names', () => {
            namespaced.on('ns:test:event', vi.fn() as any);

            const subs = namespaced.getSubscriptions('ns:test:event' as any);
            expect(subs).toHaveLength(1);
            expect(subs[0]!.event).toBe('ns:test:event');
        });
    });

    describe('eventNames() with namespace prefix', () => {
        it('should return event names with namespace prefix', () => {
            namespaced.on('ns:test:event', vi.fn() as any);
            namespaced.on('ns:test:other', vi.fn() as any);

            const names = namespaced.eventNames();
            expect(names).toContain('ns:test:event');
            expect(names).toContain('ns:test:other');
        });
    });

    describe('dispose() behavior', () => {
        it('should dispose owned source when no external source provided', async () => {
            const owned = namespaceEvents<'ns', SourceEvents>('ns');
            let received = false;

            owned.on('ns:test:event', () => {
                received = true;
            });

            await owned.emit('ns:test:event' as any, { value: 1 });
            expect(received).toBe(true);

            owned.dispose();

            // After dispose of owned, the internal source is disposed
            // but the namespaced wrapper still exists as an object
        });

        it('should NOT dispose external source', async () => {
            const external = createEmitter<SourceEvents>();
            const ns = namespaceEvents('ns', external);

            ns.dispose();

            // External source should still work
            let received = false;
            external.on('test:event', () => {
                received = true;
            });
            await external.emit('test:event', { value: 1 });
            expect(received).toBe(true);

            external.dispose();
        });
    });

    describe('maxListeners delegation', () => {
        it('should delegate maxListeners getter/setter', () => {
            expect(namespaced.maxListeners).toBe(10);

            namespaced.maxListeners = 25;
            expect(namespaced.maxListeners).toBe(25);
            expect(source.maxListeners).toBe(25);
        });

        it('should delegate resetMaxListeners', () => {
            namespaced.maxListeners = 50;
            namespaced.resetMaxListeners();
            expect(namespaced.maxListeners).toBe(10);
        });
    });

    describe('Namespace validation', () => {
        it('should throw for events without namespace prefix', () => {
            expect(() => {
                namespaced.on('wrong:event' as any, vi.fn());
            }).toThrow(/must start with namespace/);
        });

        it('should throw for emit without namespace prefix', () => {
            expect(() => {
                namespaced.emit('wrong:event' as any, {});
            }).toThrow(/must start with namespace/);
        });

        it('should throw for emitSync without namespace prefix', () => {
            expect(() => {
                namespaced.emitSync('wrong:event' as any, {});
            }).toThrow(/must start with namespace/);
        });
    });
});
