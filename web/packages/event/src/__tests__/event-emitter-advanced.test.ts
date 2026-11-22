import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter, type EventMap, type IEventPublisher, type Subscription } from '@axrone/event';

interface TestEvents extends EventMap {
    'test:event': { value: number };
    'test:other': { message: string };
    'test:async': { delay: number };
    error: Error;
}

describe('EventEmitter - Advanced Methods', () => {
    let emitter: EventEmitter<TestEvents>;

    beforeEach(() => {
        emitter = new EventEmitter<TestEvents>();
    });

    afterEach(() => {
        emitter.dispose();
    });

    describe('pipe()', () => {
        it('should forward events to another publisher with same event name', async () => {
            const target = new EventEmitter<TestEvents>();
            let targetReceived = false;

            target.on('test:event', (data) => {
                targetReceived = true;
                expect(data.value).toBe(42);
            });

            emitter.pipe('test:event', target as IEventPublisher<any>);

            await emitter.emit('test:event', { value: 42 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });

        it('should forward events to a different target event name', async () => {
            const target = new EventEmitter<TestEvents>();
            let targetReceived = false;

            target.on('test:other', () => {
                targetReceived = true;
            });

            emitter.pipe('test:event', target as IEventPublisher<any>, 'test:other');

            await emitter.emit('test:event', { value: 1 });
            expect(targetReceived).toBe(true);

            target.dispose();
        });

        it('should return an unsubscribe function that stops forwarding', async () => {
            const target = new EventEmitter<TestEvents>();
            let count = 0;

            target.on('test:event', () => {
                count++;
            });

            const unsub = emitter.pipe('test:event', target as IEventPublisher<any>);

            await emitter.emit('test:event', { value: 1 });
            expect(count).toBe(1);

            unsub();

            await emitter.emit('test:event', { value: 2 });
            expect(count).toBe(1);

            target.dispose();
        });
    });

    describe('emitSync()', () => {
        it('should dispatch to all sync listeners synchronously', () => {
            const received: number[] = [];

            emitter.on('test:event', (data) => {
                received.push(data.value);
            });
            emitter.on('test:event', (data) => {
                received.push(data.value * 10);
            });

            const result = emitter.emitSync('test:event', { value: 5 });

            expect(result).toBe(true);
            expect(received).toEqual([5, 50]);
        });

        it('should return false when no listeners exist', () => {
            const result = emitter.emitSync('test:event', { value: 1 });
            expect(result).toBe(false);
        });

        it('should respect priority ordering', () => {
            const order: string[] = [];

            emitter.on('test:event', () => {
                order.push('low');
            }, { priority: 'low' });
            emitter.on('test:event', () => {
                order.push('high');
            }, { priority: 'high' });
            emitter.on('test:event', () => {
                order.push('normal');
            }, { priority: 'normal' });

            emitter.emitSync('test:event', { value: 1 });

            expect(order).toEqual(['high', 'normal', 'low']);
        });

        it('should handle once listeners correctly', () => {
            let count = 0;

            emitter.once('test:event', () => {
                count++;
            });

            emitter.emitSync('test:event', { value: 1 });
            emitter.emitSync('test:event', { value: 2 });

            expect(count).toBe(1);
        });

        it('should buffer events when paused', () => {
            emitter.pause();

            const result = emitter.emitSync('test:event', { value: 1 });
            expect(result).toBe(true);
            expect(emitter.getPendingCount()).toBe(1);

            emitter.resume();
        });
    });

    describe('offById()', () => {
        it('should remove subscription by its symbol ID', () => {
            const cb = vi.fn();
            const [id] = emitter.batchSubscribe('test:event', [cb]);

            expect(emitter.listenerCount('test:event')).toBe(1);

            const removed = emitter.offById(id);
            expect(removed).toBe(true);
            expect(emitter.listenerCount('test:event')).toBe(0);
        });

        it('should return false for unknown symbol', () => {
            const removed = emitter.offById(Symbol('nonexistent'));
            expect(removed).toBe(false);
        });

        it('should return false for already removed subscription', () => {
            const [id] = emitter.batchSubscribe('test:event', [vi.fn()]);
            emitter.offById(id);

            const second = emitter.offById(id);
            expect(second).toBe(false);
        });
    });

    describe('hasSubscription()', () => {
        it('should return true for active subscription', () => {
            const [id] = emitter.batchSubscribe('test:event', [vi.fn()]);
            expect(emitter.hasSubscription(id)).toBe(true);
        });

        it('should return false after removal', () => {
            const [id] = emitter.batchSubscribe('test:event', [vi.fn()]);
            emitter.offById(id);
            expect(emitter.hasSubscription(id)).toBe(false);
        });

        it('should return false for unknown symbol', () => {
            expect(emitter.hasSubscription(Symbol('unknown'))).toBe(false);
        });
    });

    describe('eventNames()', () => {
        it('should return empty array when no events registered', () => {
            expect(emitter.eventNames()).toEqual([]);
        });

        it('should return all registered event names', () => {
            emitter.on('test:event', vi.fn());
            emitter.on('test:other', vi.fn());

            const names = emitter.eventNames();
            expect(names).toContain('test:event');
            expect(names).toContain('test:other');
            expect(names).toHaveLength(2);
        });

        it('should remove event name after all listeners removed', () => {
            const unsub = emitter.on('test:event', vi.fn());
            unsub();

            expect(emitter.eventNames()).not.toContain('test:event');
        });
    });

    describe('getSubscriptions()', () => {
        it('should return empty array for unknown event', () => {
            expect(emitter.getSubscriptions('test:event')).toEqual([]);
        });

        it('should return subscription details with correct shape', () => {
            const cb = vi.fn();
            emitter.on('test:event', cb, { priority: 'high' });

            const subs = emitter.getSubscriptions('test:event');
            expect(subs).toHaveLength(1);

            const sub = subs[0]!;
            expect(typeof sub.id).toBe('symbol');
            expect(sub.event).toBe('test:event');
            expect(sub.callback).toBe(cb);
            expect(sub.once).toBe(false);
            expect(sub.priority).toBe('high');
            expect(typeof sub.createdAt).toBe('number');
            expect(sub.executionCount).toBe(0);
        });

        it('should return subscriptions ordered by priority: high, normal, low', () => {
            emitter.on('test:event', vi.fn(), { priority: 'low' });
            emitter.on('test:event', vi.fn(), { priority: 'high' });
            emitter.on('test:event', vi.fn(), { priority: 'normal' });

            const subs = emitter.getSubscriptions('test:event');
            expect(subs).toHaveLength(3);
            expect(subs[0]!.priority).toBe('high');
            expect(subs[1]!.priority).toBe('normal');
            expect(subs[2]!.priority).toBe('low');
        });

        it('should update executionCount after emission', async () => {
            emitter.on('test:event', vi.fn());

            await emitter.emit('test:event', { value: 1 });
            await emitter.emit('test:event', { value: 2 });

            const subs = emitter.getSubscriptions('test:event');
            expect(subs[0]!.executionCount).toBe(2);
            expect(subs[0]!.lastExecuted).toBeDefined();
        });
    });

    describe('removeAllListeners()', () => {
        it('should remove all listeners for a specific event', () => {
            emitter.on('test:event', vi.fn());
            emitter.on('test:event', vi.fn());
            emitter.on('test:other', vi.fn());

            const result = emitter.removeAllListeners('test:event');

            expect(result).toBe(emitter);
            expect(emitter.listenerCount('test:event')).toBe(0);
            expect(emitter.listenerCount('test:other')).toBe(1);
        });

        it('should remove all listeners across all events', () => {
            emitter.on('test:event', vi.fn());
            emitter.on('test:other', vi.fn());

            emitter.removeAllListeners();

            expect(emitter.listenerCountAll()).toBe(0);
            expect(emitter.eventNames()).toEqual([]);
        });

        it('should be safe to call on non-existent event', () => {
            expect(() => emitter.removeAllListeners('test:event')).not.toThrow();
        });
    });

    describe('flush()', () => {
        it('should flush buffered events for a specific event while paused', async () => {
            let processed = 0;
            emitter.on('test:event', () => {
                processed++;
            });

            emitter.pause();
            await emitter.emit('test:event', { value: 1 });
            await emitter.emit('test:event', { value: 2 });

            expect(processed).toBe(0);

            await emitter.flush('test:event');
            expect(processed).toBe(2);
            expect(emitter.getPendingCount('test:event')).toBe(0);

            emitter.resume();
        });

        it('should preserve paused state after flush', async () => {
            emitter.pause();
            await emitter.emit('test:event', { value: 1 });

            await emitter.flush('test:event');
            expect(emitter.isPaused()).toBe(true);

            emitter.resume();
        });

        it('should be no-op when no events are buffered for the event', async () => {
            emitter.pause();
            await expect(emitter.flush('test:event')).resolves.toBeUndefined();
            emitter.resume();
        });
    });

    describe('dispose() and self-healing', () => {
        it('should throw on re-use after dispose (dispose is terminal)', () => {
            emitter.dispose();

            expect(() => emitter.on('test:event', () => {})).toThrow(
                'EventEmitter has been disposed and cannot be reused'
            );
            expect(() => emitter.emit('test:event', { value: 1 })).toThrow(
                'EventEmitter has been disposed and cannot be reused'
            );
        });

        it('should clear all state on dispose', () => {
            emitter.on('test:event', vi.fn());
            emitter.on('test:other', vi.fn());

            emitter.dispose();

            expect(emitter.listenerCountAll()).toBe(0);
            expect(emitter.eventNames()).toEqual([]);

            emitter = new EventEmitter<TestEvents>();
        });
    });

    describe('getQueuedEvents() - merged overload', () => {
        it('should return sorted merged buffer across all events', async () => {
            emitter.pause();

            await emitter.emit('test:event', { value: 1 }, { priority: 'low' });
            await emitter.emit('test:other', { message: 'hi' }, { priority: 'high' });
            await emitter.emit('test:event', { value: 2 }, { priority: 'normal' });

            const all = emitter.getQueuedEvents();
            expect(all).toHaveLength(3);
            expect(all[0]!.priority).toBe('high');
            expect(all[1]!.priority).toBe('normal');
            expect(all[2]!.priority).toBe('low');

            emitter.resume();
        });

        it('should return empty array when nothing is buffered', () => {
            expect(emitter.getQueuedEvents()).toEqual([]);
        });
    });

    describe('drain()', () => {
        it('should wait for buffer processing and scheduler completion', async () => {
            let processed = 0;

            emitter.on('test:event', () => {
                processed++;
            });

            emitter.pause();
            await emitter.emit('test:event', { value: 1 });
            await emitter.emit('test:event', { value: 2 });
            await emitter.emit('test:event', { value: 3 });

            emitter.resume();
            await emitter.drain();

            expect(processed).toBe(3);
        });

        it('should resolve immediately when nothing is pending', async () => {
            await expect(emitter.drain()).resolves.toBeUndefined();
        });
    });
});
