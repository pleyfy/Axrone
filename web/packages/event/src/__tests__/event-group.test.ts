import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    EventGroup,
    EventEmitter,
    createEmitter,
    type EventMap,
    type IEventEmitter,
} from '@axrone/event';

interface TestEvents extends EventMap {
    'test:event': { value: number };
    'test:other': { message: string };
    'test:third': { flag: boolean };
    error: Error;
}

describe('EventGroup - Comprehensive', () => {
    let baseEmitter: IEventEmitter<TestEvents>;
    let group: EventGroup<TestEvents>;

    beforeEach(() => {
        baseEmitter = createEmitter<TestEvents>();
        group = new EventGroup<TestEvents>(baseEmitter);
    });

    afterEach(() => {
        group.dispose();
        baseEmitter.dispose();
    });

    describe('Constructor', () => {
        it('should create with an external base emitter', async () => {
            let groupReceived = false;
            group.on('test:event', () => {
                groupReceived = true;
            });

            await baseEmitter.emit('test:event', { value: 1 });
            expect(groupReceived).toBe(true);
        });

        it('should create its own emitter when no base is provided', async () => {
            const standalone = new EventGroup<TestEvents>();
            let received = false;

            standalone.on('test:event', () => {
                received = true;
            });

            await standalone.emit('test:event', { value: 42 });
            expect(received).toBe(true);

            standalone.dispose();
        });
    });

    describe('once()', () => {
        it('should execute callback only once then auto-unsubscribe', async () => {
            let count = 0;
            group.once('test:event', () => {
                count++;
            });

            await group.emit('test:event', { value: 1 });
            await group.emit('test:event', { value: 2 });

            expect(count).toBe(1);
            expect(group.listenerCount('test:event')).toBe(0);
        });

        it('should support priority option on once', async () => {
            const order: string[] = [];

            group.once('test:event', () => {
                order.push('low');
            }, { priority: 'low' });
            group.once('test:event', () => {
                order.push('high');
            }, { priority: 'high' });

            await group.emit('test:event', { value: 1 });

            expect(order).toEqual(['high', 'low']);
        });
    });

    describe('off()', () => {
        it('should remove a specific callback', async () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();

            group.on('test:event', cb1);
            group.on('test:event', cb2);

            const removed = group.off('test:event', cb1);
            expect(removed).toBe(true);
            expect(group.listenerCount('test:event')).toBe(1);

            await group.emit('test:event', { value: 1 });
            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).toHaveBeenCalledOnce();
        });

        it('should remove all callbacks for event when no callback given', () => {
            group.on('test:event', vi.fn());
            group.on('test:event', vi.fn());
            group.on('test:event', vi.fn());

            expect(group.listenerCount('test:event')).toBe(3);

            const removed = group.off('test:event');
            expect(removed).toBe(true);
            expect(group.listenerCount('test:event')).toBe(0);
        });

        it('should return false when event has no listeners', () => {
            const removed = group.off('test:event', vi.fn());
            expect(removed).toBe(false);
        });
    });

    describe('offById()', () => {
        it('should remove subscription by tracked ID', () => {
            const cb = vi.fn();
            const [id] = group.batchSubscribe('test:event', [cb]);

            expect(group.hasSubscription(id)).toBe(true);

            const removed = group.offById(id);
            expect(removed).toBe(true);
            expect(group.hasSubscription(id)).toBe(false);
            expect(group.listenerCount('test:event')).toBe(0);
        });

        it('should return false for unknown subscription ID', () => {
            const removed = group.offById(Symbol('unknown'));
            expect(removed).toBe(false);
        });
    });

    describe('pipe()', () => {
        it('should forward events to another publisher', async () => {
            const target = createEmitter<TestEvents>();
            let targetReceived = false;

            target.on('test:event', () => {
                targetReceived = true;
            });

            group.pipe('test:event', target);

            await group.emit('test:event', { value: 1 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });

        it('should forward to a different target event name', async () => {
            const target = createEmitter<TestEvents>();
            let targetReceived = false;

            target.on('test:other', () => {
                targetReceived = true;
            });

            group.pipe('test:event', target, 'test:other');

            await group.emit('test:event', { value: 1 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });
    });

    describe('emitSync()', () => {
        it('should dispatch synchronously through base emitter', () => {
            const received: number[] = [];

            group.on('test:event', (data) => {
                received.push(data.value);
            });

            const result = group.emitSync('test:event', { value: 42 });
            expect(result).toBe(true);
            expect(received).toEqual([42]);
        });

        it('should return false when no listeners exist', () => {
            const result = group.emitSync('test:event', { value: 1 });
            expect(result).toBe(false);
        });
    });

    describe('emitBatch()', () => {
        it('should emit multiple events in batch', async () => {
            let count = 0;
            group.on('test:event', () => {
                count++;
            });

            const results = await group.emitBatch([
                { event: 'test:event' as const, data: { value: 1 } },
                { event: 'test:event' as const, data: { value: 2 } },
                { event: 'test:event' as const, data: { value: 3 } },
            ]);

            expect(results).toEqual([{ success: true }, { success: true }, { success: true }]);
            expect(count).toBe(3);
        });
    });

    describe('has()', () => {
        it('should return true when event has listeners', () => {
            group.on('test:event', vi.fn());
            expect(group.has('test:event')).toBe(true);
        });

        it('should return false when event has no listeners', () => {
            expect(group.has('test:event')).toBe(false);
        });

        it('should return false after all listeners removed', () => {
            const unsub = group.on('test:event', vi.fn());
            unsub();
            expect(group.has('test:event')).toBe(false);
        });
    });

    describe('listenerCountAll()', () => {
        it('should count all listeners across all events', () => {
            group.on('test:event', vi.fn());
            group.on('test:other', vi.fn());
            group.on('test:other', vi.fn());

            expect(group.listenerCountAll()).toBe(3);
        });

        it('should prune stale subscriptions before counting', () => {
            group.on('test:event', vi.fn());
            const [id] = group.batchSubscribe('test:other', [vi.fn()]);

            expect(group.listenerCountAll()).toBe(2);

            baseEmitter.offById(id);

            expect(group.listenerCountAll()).toBe(1);
        });
    });

    describe('eventNames()', () => {
        it('should return all registered event names', () => {
            group.on('test:event', vi.fn());
            group.on('test:other', vi.fn());

            const names = group.eventNames();
            expect(names).toContain('test:event');
            expect(names).toContain('test:other');
        });

        it('should prune stale subscriptions', () => {
            group.on('test:event', vi.fn());
            const [id] = group.batchSubscribe('test:other', [vi.fn()]);

            baseEmitter.offById(id);

            const names = group.eventNames();
            expect(names).toContain('test:event');
            expect(names).not.toContain('test:other');
        });
    });

    describe('hasSubscription()', () => {
        it('should return true for tracked subscription', () => {
            const [id] = group.batchSubscribe('test:event', [vi.fn()]);
            expect(group.hasSubscription(id)).toBe(true);
        });

        it('should return false for untracked subscription', () => {
            const id = baseEmitter.batchSubscribe('test:event', [vi.fn()])[0]!;
            expect(group.hasSubscription(id)).toBe(false);
        });

        it('should return false after unsubscription', () => {
            const [id] = group.batchSubscribe('test:event', [vi.fn()]);
            group.offById(id);
            expect(group.hasSubscription(id)).toBe(false);
        });
    });

    describe('getMetrics()', () => {
        it('should delegate getMetrics to base emitter', async () => {
            group.on('test:event', () => {});
            await group.emit('test:event', { value: 1 });

            const metrics = group.getMetrics('test:event');
            expect(metrics.emit.count).toBe(1);
        });
    });

    describe('Buffer Operations', () => {
        it('should delegate pause/resume/isPaused to base emitter', () => {
            expect(group.isPaused()).toBe(false);

            group.pause();
            expect(group.isPaused()).toBe(true);

            group.resume();
            expect(group.isPaused()).toBe(false);
        });

        it('should delegate getQueuedEvents to base emitter', async () => {
            group.pause();
            await group.emit('test:event', { value: 1 });

            const queued = group.getQueuedEvents('test:event');
            expect(queued.length).toBe(1);

            group.resume();
        });

        it('should delegate getPendingCount to base emitter', async () => {
            group.pause();
            await group.emit('test:event', { value: 1 });
            await group.emit('test:other', { message: 'hello' });

            expect(group.getPendingCount()).toBe(2);
            expect(group.getPendingCount('test:event')).toBe(1);

            group.resume();
        });

        it('should delegate getBufferSize to base emitter', () => {
            expect(group.getBufferSize()).toBe(1000);
        });

        it('should delegate clearBuffer to base emitter', async () => {
            group.pause();
            await group.emit('test:event', { value: 1 });

            const cleared = group.clearBuffer('test:event');
            expect(cleared).toBe(1);
            expect(group.getPendingCount()).toBe(0);

            group.resume();
        });
    });

    describe('removeAllListeners()', () => {
        it('should remove all listeners for a specific event', () => {
            group.on('test:event', vi.fn());
            group.on('test:event', vi.fn());
            group.on('test:other', vi.fn());

            group.removeAllListeners('test:event');

            expect(group.listenerCount('test:event')).toBe(0);
            expect(group.listenerCount('test:other')).toBe(1);
        });

        it('should remove all listeners across all events', () => {
            group.on('test:event', vi.fn());
            group.on('test:other', vi.fn());

            group.removeAllListeners();

            expect(group.listenerCountAll()).toBe(0);
        });
    });

    describe('maxListeners', () => {
        it('should delegate getter to base emitter', () => {
            expect(group.maxListeners).toBe(10);
        });

        it('should delegate setter to base emitter', () => {
            group.maxListeners = 20;
            expect(group.maxListeners).toBe(20);
            expect(baseEmitter.maxListeners).toBe(20);
        });

        it('should delegate resetMaxListeners', () => {
            group.maxListeners = 50;
            group.resetMaxListeners();
            expect(group.maxListeners).toBe(10);
        });
    });

    describe('drain() and flush()', () => {
        it('should drain all pending operations', async () => {
            let processed = 0;
            group.on('test:event', () => {
                processed++;
            });

            group.pause();
            await group.emit('test:event', { value: 1 });
            await group.emit('test:event', { value: 2 });

            expect(processed).toBe(0);

            group.resume();
            await group.drain();

            expect(processed).toBe(2);
        });

        it('should flush specific event queue', async () => {
            let eventProcessed = 0;
            group.on('test:event', () => {
                eventProcessed++;
            });

            group.pause();
            await group.emit('test:event', { value: 1 });
            await group.emit('test:event', { value: 2 });

            await group.flush('test:event');
            expect(eventProcessed).toBe(2);

            group.resume();
        });
    });

    describe('resetMetrics()', () => {
        it('should delegate resetMetrics to base emitter', async () => {
            group.on('test:event', () => {});
            await group.emit('test:event', { value: 1 });

            let metrics = group.getMetrics('test:event');
            expect(metrics.emit.count).toBe(1);

            group.resetMetrics('test:event');

            metrics = group.getMetrics('test:event');
            expect(metrics.emit.count).toBe(0);
        });

        it('should reset all metrics when no event specified', async () => {
            group.on('test:event', () => {});
            group.on('test:other', () => {});
            await group.emit('test:event', { value: 1 });
            await group.emit('test:other', { message: 'hi' });

            group.resetMetrics();

            expect(group.getMetrics('test:event').emit.count).toBe(0);
            expect(group.getMetrics('test:other').emit.count).toBe(0);
        });
    });

    describe('Stale Subscription Pruning', () => {
        it('should detect stale subscriptions from base emitter removal', () => {
            const [id] = baseEmitter.batchSubscribe('test:event', [vi.fn()]);

            baseEmitter.offById(id);

            expect(group.hasSubscription(id)).toBe(false);
        });

        it('should handle unsubscribe of externally removed subscriptions gracefully', () => {
            const cb = vi.fn();
            const [id] = group.batchSubscribe('test:event', [cb]);

            baseEmitter.offById(id);

            const removed = group.offById(id);
            expect(removed).toBe(false);
            expect(group.hasSubscription(id)).toBe(false);
        });
    });

    describe('dispose()', () => {
        it('should remove only group-tracked subscriptions from base emitter', async () => {
            const baseCb = vi.fn();
            baseEmitter.on('test:event', baseCb);

            group.on('test:event', vi.fn());

            group.dispose();

            await baseEmitter.emit('test:event', { value: 1 });
            expect(baseCb).toHaveBeenCalledOnce();
        });

        it('should be safe to call dispose multiple times', () => {
            expect(() => {
                group.dispose();
                group.dispose();
            }).not.toThrow();
        });
    });
});
