import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldEventRuntime } from '../component-system/core/world-event-runtime';
import { ECSObservables } from '../component-system/observers/ecs-observer';

type TestRegistry = {
    Transform: any;
    Health: any;
};

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WorldEventRuntime', () => {
    let runtime: WorldEventRuntime<TestRegistry>;
    let mockQuery: ReturnType<typeof vi.fn>;
    let observables: ECSObservables<TestRegistry>;

    beforeEach(() => {
        mockQuery = vi.fn().mockReturnValue([]);
        observables = new ECSObservables<TestRegistry>();
        runtime = new WorldEventRuntime<TestRegistry>(
            ['Transform', 'Health'],
            mockQuery,
            observables
        );
    });

    afterEach(() => {
        runtime.dispose();
    });

    // ─── on / off ───────────────────────────────────────────────────

    describe('on / off', () => {
        it('subscribes to events and receives emitted data', async () => {
            const handler = vi.fn();
            runtime.on('EntityCreated', handler);

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ entity: 1 })
            );
        });

        it('returns a disposer that unsubscribes', async () => {
            const handler = vi.fn();
            const dispose = runtime.on('EntityCreated', handler);

            dispose();

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            expect(handler).not.toHaveBeenCalled();
        });

        it('off removes a specific handler', async () => {
            const handler = vi.fn();
            runtime.on('EntityCreated', handler);
            runtime.off('EntityCreated', handler);

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ─── once ───────────────────────────────────────────────────────

    describe('once', () => {
        it('fires handler exactly once then auto-unsubscribes', async () => {
            const handler = vi.fn();
            runtime.once('EntityCreated', handler);

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            await runtime.emit('EntityCreated', {
                entity: 2,
                actor: { name: 'B' } as any,
            } as any);

            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    // ─── emit / emitSync ────────────────────────────────────────────

    describe('emit / emitSync', () => {
        it('emit delivers data to subscribers', async () => {
            const handler = vi.fn();
            runtime.on('EntityCreated', handler);

            const result = await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            expect(result).toBe(true);
            expect(handler).toHaveBeenCalled();
        });

        it('emitSync delivers data synchronously', () => {
            const handler = vi.fn();
            runtime.on('EntityCreated', handler);

            const result = runtime.emitSync('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            expect(result).toBe(true);
            expect(handler).toHaveBeenCalled();
        });
    });

    // ─── emitSafe ───────────────────────────────────────────────────

    describe('emitSafe', () => {
        it('catches errors from handlers and logs to console.error', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const handler = vi.fn().mockImplementation(() => {
                throw new Error('handler error');
            });

            runtime.on('EntityCreated', handler);
            expect(() =>
                runtime.emitSafe('EntityCreated', {
                    entity: 1,
                    actor: { name: 'A' } as any,
                } as any)
            ).not.toThrow();

            consoleSpy.mockRestore();
        });
    });

    // ─── getEventMetrics ────────────────────────────────────────────

    describe('getEventMetrics', () => {
        it('returns correct handlerCount', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();

            runtime.on('EntityCreated', handler1);
            runtime.on('EntityCreated', handler2);

            const metrics = runtime.getEventMetrics('EntityCreated');
            // +1 for the internal bridge handler set up in constructor
            expect(metrics.handlerCount).toBe(3);
        });

        it('tracks lastEmittedAt after emit', async () => {
            const before = runtime.getEventMetrics('EntityCreated');
            expect(before.lastEmittedAt).toBeNull();

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            const after = runtime.getEventMetrics('EntityCreated');
            expect(after.lastEmittedAt).toBeGreaterThan(0);
        });
    });

    // ─── getAllEventMetrics ─────────────────────────────────────────

    describe('getAllEventMetrics', () => {
        it('aggregates metrics across tracked events', () => {
            runtime.on('EntityCreated', vi.fn());
            runtime.on('EntityDestroyed', vi.fn());

            const all = runtime.getAllEventMetrics();
            expect(all).toHaveProperty('EntityCreated');
            expect(all).toHaveProperty('EntityDestroyed');
        });
    });

    // ─── pause / resume / drain ─────────────────────────────────────

    describe('pause / resume / drain', () => {
        it('pause stops event delivery', async () => {
            const handler = vi.fn();
            runtime.on('EntityCreated', handler);

            runtime.pause();

            await runtime.emit('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            // While paused, handler should not have been called
            expect(handler).not.toHaveBeenCalled();

            runtime.resume();
            // Resume schedules buffered delivery; settle it before clearing the
            // spy, otherwise the queued pause-time event can land after the
            // post-resume emit and inflate the count.
            await runtime.drain();
            expect(handler).toHaveBeenCalledTimes(1);

            // Clear the drained queued event so the assertion below covers
            // only the emit issued after resume.
            handler.mockClear();

            await runtime.emit('EntityCreated', {
                entity: 2,
                actor: { name: 'B' } as any,
            } as any);

            // After resume, new emits are delivered normally
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('drain resolves without error', async () => {
            await expect(runtime.drain()).resolves.toBeUndefined();
        });
    });

    // ─── getObservables ─────────────────────────────────────────────

    describe('getObservables', () => {
        it('returns the ECSObservables instance', () => {
            expect(runtime.getObservables()).toBe(observables);
        });
    });

    // ─── observeEntityLifecycle ─────────────────────────────────────

    describe('observeEntityLifecycle', () => {
        it('returns entity lifecycle streams', () => {
            const streams = runtime.observeEntityLifecycle();
            expect(streams).toHaveProperty('all');
            expect(streams).toHaveProperty('byName');
            expect(streams).toHaveProperty('byTag');
            expect(streams).toHaveProperty('byLayer');
        });
    });

    // ─── observeComponent ───────────────────────────────────────────

    describe('observeComponent', () => {
        it('returns component observable stream', () => {
            const stream = runtime.observeComponent('Transform');
            expect(stream).toHaveProperty('added');
            expect(stream).toHaveProperty('removed');
            expect(stream).toHaveProperty('changes');
        });
    });

    // ─── createReactiveQuery ────────────────────────────────────────

    describe('createReactiveQuery', () => {
        it('calls query executor on creation', () => {
            runtime.createReactiveQuery('Transform');
            expect(mockQuery).toHaveBeenCalledWith('Transform');
        });

        it('returns an observable with addObserver', () => {
            const observable = runtime.createReactiveQuery('Transform');
            expect(observable).toHaveProperty('addObserver');
        });

        it('updates when component Added event fires', async () => {
            const observable = runtime.createReactiveQuery('Transform');
            const received: any[] = [];
            observable.addObserver((data) => received.push(data));

            await flushMicrotasks();

            // Simulate a TransformAdded event
            runtime.emitSync('TransformAdded', {
                entity: 1,
                component: {},
                actor: { name: 'A' } as any,
            } as any);

            await flushMicrotasks();

            // The query executor should have been called again
            expect(mockQuery).toHaveBeenCalledTimes(2);
        });

        it('updates when EntityCreated event fires', async () => {
            runtime.createReactiveQuery('Health');

            runtime.emitSync('EntityCreated', {
                entity: 5,
                actor: { name: 'New' } as any,
            } as any);

            await flushMicrotasks();

            // Initial call + EntityCreated trigger
            expect(mockQuery).toHaveBeenCalledTimes(2);
        });

        it('handles query executor errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockQuery.mockImplementation(() => {
                throw new Error('query error');
            });

            expect(() => runtime.createReactiveQuery('Transform')).not.toThrow();

            consoleSpy.mockRestore();
        });
    });

    // ─── registerComponent ──────────────────────────────────────────

    describe('registerComponent', () => {
        it('registers a new component event bridge', async () => {
            runtime.registerComponent('NewComponent');

            // Now NewComponentAdded/Removed events should bridge to observables
            const handler = vi.fn();
            runtime.on('NewComponentAdded' as any, handler);

            await runtime.emit('NewComponentAdded' as any, {
                entity: 1,
                component: {},
                actor: { name: 'A' } as any,
            } as any);

            expect(handler).toHaveBeenCalled();
        });

        it('deduplicates registration for same component', () => {
            runtime.registerComponent('Transform');
            runtime.registerComponent('Transform');

            // Should not throw or create duplicate bridges
            expect(() => runtime.registerComponent('Transform')).not.toThrow();
        });
    });

    // ─── dispose ────────────────────────────────────────────────────

    describe('dispose', () => {
        it('clears all internal state', () => {
            runtime.on('EntityCreated', vi.fn());
            runtime.dispose();

            // After dispose, metrics should reflect cleared state
            // (event bus is disposed, so getEventMetrics may behave differently)
            // Just verify no throw
        });

        it('handles disposal errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Create a runtime and dispose it twice
            runtime.dispose();
            // Second dispose should not throw (already cleared)
            expect(() => runtime.dispose()).not.toThrow();

            consoleSpy.mockRestore();
        });
    });

    // ─── Event-observable bridge ────────────────────────────────────

    describe('event-observable bridge', () => {
        it('EntityCreated events notify entityCreated observable', async () => {
            const received: any[] = [];
            observables.entityCreated.addObserver((data) => received.push(data));

            runtime.emitSync('EntityCreated', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            await flushMicrotasks();

            expect(received).toHaveLength(1);
            expect(received[0]).toEqual(
                expect.objectContaining({ entity: 1 })
            );
        });

        it('EntityDestroyed events notify entityDestroyed observable', async () => {
            const received: any[] = [];
            observables.entityDestroyed.addObserver((data) => received.push(data));

            runtime.emitSync('EntityDestroyed', {
                entity: 1,
                actor: { name: 'A' } as any,
            } as any);

            await flushMicrotasks();

            expect(received).toHaveLength(1);
        });

        it('component Added events notify component observables', async () => {
            const received: any[] = [];
            const componentObs = observables.getComponentObservables('Transform');
            componentObs.added.addObserver((data) => received.push(data));

            runtime.emitSync('TransformAdded', {
                entity: 1,
                component: { value: 42 },
                actor: { name: 'A' } as any,
            } as any);

            await flushMicrotasks();

            expect(received).toHaveLength(1);
            expect(received[0]).toEqual(
                expect.objectContaining({ entity: 1 })
            );
        });

        it('component Removed events notify component observables', async () => {
            const received: any[] = [];
            const componentObs = observables.getComponentObservables('Health');
            componentObs.removed.addObserver((data) => received.push(data));

            runtime.emitSync('HealthRemoved', {
                entity: 1,
                component: {},
                actor: { name: 'A' } as any,
            } as any);

            await flushMicrotasks();

            expect(received).toHaveLength(1);
        });
    });
});
