import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHooks, EventUtils } from '../../event/utility';
import { EventGroup } from '../../event/event-group';
import {
    createEmitter,
    createEventProxy,
    createTypedEmitter,
    excludeEvents,
    filterEvents,
    isEventEmitter,
    mergeEmitters,
    namespaceEvents,
    TypedEventRegistry,
} from '../../event/extras';
import { EventMap } from '../../event/definition';

interface TestEvents extends EventMap {
    'test:event': { id: string; data: any };
    'test:filtered': { value: number };
    'test:excluded': { message: string };
}

interface TargetEvents extends EventMap {
    'target:mapped': { transformed: boolean };
    'target:direct': { forwarded: boolean };
}

describe('EventEmitter - Features', () => {
    describe('Factory Functions', () => {
        it('should create emitters with correct configurations', () => {
            const emitter1 = createEmitter({ maxListeners: 15 });
            const emitter2 = createTypedEmitter<TestEvents>();

            expect(emitter1.maxListeners).toBe(15);
            expect(emitter2.maxListeners).toBe(10); // default

            emitter1.dispose();
            emitter2.dispose();
        });

        it('should correctly identify EventEmitter instances', () => {
            const emitter = createEmitter();
            const notEmitter = { on: 'not a function', emit: null };
            const partialEmitter = { on: () => {}, emit: () => {} };

            expect(isEventEmitter(emitter)).toBe(true);
            expect(isEventEmitter(notEmitter)).toBe(false);
            expect(isEventEmitter(partialEmitter)).toBe(false);
            expect(isEventEmitter(null)).toBe(false);
            expect(isEventEmitter(undefined)).toBe(false);

            emitter.dispose();
        });

        it('should handle edge cases in type guard', () => {
            const edgeCases = [
                {},
                { on: null, emit: () => {}, off: () => {} },
                { on: () => {}, emit: undefined, off: () => {} },
                { on: () => {}, emit: () => {} }, // missing off
                'string',
                123,
                [],
            ];

            edgeCases.forEach((testCase) => {
                expect(isEventEmitter(testCase)).toBe(false);
            });
        });
    });

    describe('Event Filtering', () => {
        let sourceEmitter: ReturnType<typeof createTypedEmitter<TestEvents>>;

        beforeEach(() => {
            sourceEmitter = createTypedEmitter<TestEvents>();
        });

        afterEach(() => {
            sourceEmitter.dispose();
        });

        it('should filter events correctly', async () => {
            const filtered = filterEvents(sourceEmitter, ['test:event']);
            let filteredCount = 0;
            let sourceCount = 0;

            filtered.on('test:event', () => {
                filteredCount++;
            });
            sourceEmitter.on('test:filtered', () => {
                sourceCount++;
            });

            await sourceEmitter.emit('test:event', { id: 'test', data: {} });
            await sourceEmitter.emit('test:filtered', { value: 42 });

            expect(filteredCount).toBe(1);
            expect(sourceCount).toBe(1);

            (filtered as any).dispose();
        });

        it('should reject non-allowed events in filtered emitter', async () => {
            const filtered = filterEvents(sourceEmitter, ['test:event']);

            const result = await filtered.emit('test:filtered' as any, { value: 42 });
            expect(result).toBe(false);

            (filtered as any).dispose();
        });

        it('should passthrough errors when configured', async () => {
            const filtered = filterEvents(sourceEmitter, ['test:event'], {
                passthroughErrors: true,
            });
            let errorPassed = false;

            filtered.on('error' as any, () => {
                errorPassed = true;
            });
            await sourceEmitter.emit('error' as any, new Error('test'));

            expect(errorPassed).toBe(true);

            (filtered as any).dispose();
        });

        it('should exclude specified events', async () => {
            const excluded = excludeEvents(sourceEmitter, ['test:excluded']);
            let includedCount = 0;
            let excludedCount = 0;

            excluded.on('test:event', () => {
                includedCount++;
            });
            sourceEmitter.on('test:excluded', () => {
                excludedCount++;
            });

            await sourceEmitter.emit('test:event', { id: 'test', data: {} });
            await sourceEmitter.emit('test:excluded', { message: 'excluded' });

            expect(includedCount).toBe(1);
            expect(excludedCount).toBe(1);

            (excluded as any).dispose();
        });
    });

    describe('Event Proxy', () => {
        let sourceEmitter: ReturnType<typeof createTypedEmitter<TestEvents>>;
        let targetEmitter: ReturnType<typeof createTypedEmitter<TargetEvents>>;

        beforeEach(() => {
            sourceEmitter = createTypedEmitter<TestEvents>();
            targetEmitter = createTypedEmitter<TargetEvents>();
        });

        afterEach(() => {
            sourceEmitter.dispose();
            targetEmitter.dispose();
        });

        it('should proxy events with mapping', async () => {
            let targetReceived = false;

            targetEmitter.on('target:mapped', () => {
                targetReceived = true;
            });

            const unsubscribe = createEventProxy(sourceEmitter, targetEmitter, {
                'test:event': 'target:mapped',
            });

            await sourceEmitter.emit('test:event', { id: 'test', data: {} });
            expect(targetReceived).toBe(true);

            unsubscribe();
        });

        it('should transform data with transformers', async () => {
            let transformedData: any = null;

            targetEmitter.on('target:mapped', (data) => {
                transformedData = data;
            });

            const unsubscribe = createEventProxy(
                sourceEmitter,
                targetEmitter,
                { 'test:event': 'target:mapped' },
                {
                    'test:event': (data) => ({ transformed: true, original: data }),
                }
            );

            await sourceEmitter.emit('test:event', { id: 'test', data: { value: 42 } });

            expect(transformedData).toEqual({
                transformed: true,
                original: { id: 'test', data: { value: 42 } },
            });

            unsubscribe();
        });

        it('should handle bidirectional proxying', async () => {
            let sourceReceived = false;
            let targetReceived = false;

            sourceEmitter.on('test:event', () => {
                sourceReceived = true;
            });
            targetEmitter.on('target:mapped', () => {
                targetReceived = true;
            });

            const unsubscribe = createEventProxy(
                sourceEmitter,
                targetEmitter,
                { 'test:event': 'target:mapped' },
                undefined,
                { bidirectional: true }
            );

            await sourceEmitter.emit('test:event', { id: 'test', data: {} });
            expect(targetReceived).toBe(true);

            await targetEmitter.emit('target:mapped', { transformed: true });
            expect(sourceReceived).toBe(true);

            unsubscribe();
        });

        it('should preserve priority when configured', async () => {
            const targetEmitter = createTypedEmitter<TargetEvents>();
            let receivedPriority: any = null;

            const originalEmit = targetEmitter.emit.bind(targetEmitter);
            targetEmitter.emit = async function (event, data, options) {
                receivedPriority = options?.priority;
                return originalEmit(event, data, options);
            };

            const unsubscribe = createEventProxy(
                sourceEmitter,
                targetEmitter,
                { 'test:event': 'target:mapped' },
                undefined,
                { preservePriority: true }
            );

            await sourceEmitter.emit('test:event', { id: 'test', data: {} }, { priority: 'high' });
            expect(receivedPriority).toBe('high');

            unsubscribe();
            targetEmitter.dispose();
        });
    });

    describe('Emitter Merging', () => {
        it('should merge multiple emitters correctly', async () => {
            const emitter1 = createTypedEmitter<TestEvents>();
            const emitter2 = createTypedEmitter<TargetEvents>();
            const merged = mergeEmitters(emitter1, emitter2);

            let event1Count = 0;
            let event2Count = 0;

            merged.on('test:event' as any, () => {
                event1Count++;
            });
            merged.on('target:mapped' as any, () => {
                event2Count++;
            });

            await emitter1.emit('test:event', { id: 'test', data: {} });
            await emitter2.emit('target:mapped', { transformed: true });

            expect(event1Count).toBe(1);
            expect(event2Count).toBe(1);

            emitter1.dispose();
            emitter2.dispose();
            (merged as any).dispose();
        });

        it('should forward error events from source emitters', async () => {
            const emitter1 = createTypedEmitter<TestEvents>();
            const emitter2 = createTypedEmitter<TargetEvents>();
            const merged = mergeEmitters(emitter1, emitter2);

            let errorForwarded = false;

            merged.on('error' as any, () => {
                errorForwarded = true;
            });

            emitter1.on('error' as any, () => {});
            await emitter1.emit('error' as any, new Error('test'));

            expect(errorForwarded).toBe(true);

            emitter1.dispose();
            emitter2.dispose();
            (merged as any).dispose();
        });
    });

    describe('Namespaced Events', () => {
        it('should create namespaced events correctly', async () => {
            const source = createTypedEmitter<TestEvents>();
            const namespaced = namespaceEvents('ns', source);

            let namespacedReceived = false;

            namespaced.on('ns:test:event', () => {
                namespacedReceived = true;
            });

            await source.emit('test:event', { id: 'test', data: {} });
            expect(namespacedReceived).toBe(true);

            source.dispose();
            (namespaced as any).dispose();
        });

        it('should validate namespace prefix', async () => {
            const source = createTypedEmitter<TestEvents>();
            const namespaced = namespaceEvents('auth', source);

            expect(() => {
                namespaced.on('invalid:event' as any, () => {});
            }).toThrow(/must start with namespace/);

            source.dispose();
            (namespaced as any).dispose();
        });
    });

    describe('TypedEventRegistry', () => {
        let registry: TypedEventRegistry<TestEvents>;

        beforeEach(() => {
            registry = new TypedEventRegistry<TestEvents>();
        });

        it('should register and retrieve events correctly', () => {
            const symbol1 = registry.register('test:event');
            const symbol2 = registry.register('test:filtered');

            expect(registry.getSymbol('test:event')).toBe(symbol1);
            expect(registry.getEvent(symbol1)).toBe('test:event');
            expect(registry.has('test:event')).toBe(true);
            expect(registry.hasSymbol(symbol1)).toBe(true);
        });

        it('should return same symbol for duplicate registrations', () => {
            const symbol1 = registry.register('test:event');
            const symbol2 = registry.register('test:event');

            expect(symbol1).toBe(symbol2);
        });

        it('should provide correct collections', () => {
            registry.register('test:event');
            registry.register('test:filtered');

            const events = registry.events();
            const symbols = registry.symbols();
            const entries = registry.entries();

            expect(events).toContain('test:event');
            expect(events).toContain('test:filtered');
            expect(symbols).toHaveLength(2);
            expect(entries).toHaveLength(2);
        });

        it('should clear registry correctly', () => {
            registry.register('test:event');
            expect(registry.events()).toHaveLength(1);

            registry.clear();
            expect(registry.events()).toHaveLength(0);
            expect(registry.symbols()).toHaveLength(0);
        });
    });

    describe('EventGroup', () => {
        let baseEmitter: ReturnType<typeof createTypedEmitter<TestEvents>>;
        let group: EventGroup<TestEvents>;

        beforeEach(() => {
            baseEmitter = createTypedEmitter<TestEvents>();
            group = new EventGroup(baseEmitter);
        });

        afterEach(() => {
            baseEmitter.dispose();
            group.dispose();
        });

        it('should manage scoped subscriptions', async () => {
            let groupReceived = false;
            let baseReceived = false;

            group.on('test:event', () => {
                groupReceived = true;
            });
            baseEmitter.on('test:event', () => {
                baseReceived = true;
            });

            await group.emit('test:event', { id: 'test', data: {} });

            expect(groupReceived).toBe(true);
            expect(baseReceived).toBe(true);
        });

        it('should clean up subscriptions on dispose', async () => {
            let received = false;

            group.on('test:event', () => {
                received = true;
            });
            expect(group.listenerCount('test:event')).toBe(1);

            group.dispose();

            await baseEmitter.emit('test:event', { id: 'test', data: {} });
            expect(received).toBe(false);
        });

        it('should filter subscriptions in getSubscriptions', () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();

            group.on('test:event', callback1);
            baseEmitter.on('test:event', callback2);

            const groupSubscriptions = group.getSubscriptions('test:event');
            const baseSubscriptions = baseEmitter.getSubscriptions('test:event');

            expect(groupSubscriptions).toHaveLength(1);
            expect(baseSubscriptions).toHaveLength(2);
        });

        it('should handle batch operations correctly', () => {
            const callbacks = [vi.fn(), vi.fn(), vi.fn()];
            const ids = group.batchSubscribe('test:event', callbacks);

            expect(ids).toHaveLength(3);
            expect(group.listenerCount('test:event')).toBe(3);

            const unsubscribed = group.batchUnsubscribe(ids);
            expect(unsubscribed).toBe(3);
            expect(group.listenerCount('test:event')).toBe(0);
        });
    });

    describe('Hooks API', () => {
        it('should provide functional event API', async () => {
            const { on, once, emit, emitSync, useEmitter } = createHooks<TestEvents>();

            let onCount = 0;
            let onceCount = 0;

            const unsubscribe = on('test:event', () => {
                onCount++;
            });
            const unsubscribeOnce = once('test:filtered', () => {
                onceCount++;
            });

            await emit('test:event', { id: 'test', data: {} });
            await emit('test:filtered', { value: 42 });
            await emit('test:filtered', { value: 43 });

            expect(onCount).toBe(1);
            expect(onceCount).toBe(1);

            emitSync('test:event', { id: 'sync', data: {} });
            expect(onCount).toBe(2);

            const emitter = useEmitter();
            expect(emitter.listenerCountAll()).toBeGreaterThan(0);

            unsubscribe();
            unsubscribeOnce();
            emitter.dispose();
        });
    });

    describe('Event Utilities', () => {
        describe('debounce', () => {
            it('should debounce rapid calls', async () => {
                let callCount = 0;
                const debounced = EventUtils.debounce(() => {
                    callCount++;
                }, 50);

                debounced({});
                debounced({});
                debounced({});

                expect(callCount).toBe(0);

                await new Promise((resolve) => setTimeout(resolve, 60));
                expect(callCount).toBe(1);
            });
        });

        describe('throttle', () => {
            it('should throttle rapid calls', async () => {
                let callCount = 0;
                const throttled = EventUtils.throttle(() => {
                    callCount++;
                }, 50);

                throttled({});
                expect(callCount).toBe(1);

                throttled({});
                throttled({});
                expect(callCount).toBe(1);

                await new Promise((resolve) => setTimeout(resolve, 60));
                throttled({});
                expect(callCount).toBe(2);
            });
        });

        describe('rateLimit', () => {
            it('should limit calls within time window', () => {
                let callCount = 0;
                const rateLimited = EventUtils.rateLimit(
                    () => {
                        callCount++;
                    },
                    2,
                    1000
                );

                rateLimited({});
                rateLimited({});
                expect(callCount).toBe(2);

                rateLimited({});
                expect(callCount).toBe(2);
            });
        });

        describe('filter', () => {
            it('should filter based on predicate', () => {
                let callCount = 0;
                const filtered = EventUtils.filter(
                    (data: { value: number }) => data.value > 5,
                    () => {
                        callCount++;
                    }
                );

                filtered({ value: 3 });
                expect(callCount).toBe(0);

                filtered({ value: 7 });
                expect(callCount).toBe(1);
            });
        });

        describe('compose', () => {
            it('should compose multiple callbacks', async () => {
                const results: string[] = [];
                const composed = EventUtils.compose(
                    () => {
                        results.push('first');
                    },
                    () => {
                        results.push('second');
                    },
                    () => {
                        results.push('third');
                    }
                );

                await composed({});
                expect(results).toEqual(['first', 'second', 'third']);
            });
        });

        describe('map', () => {
            it('should transform data before callback', () => {
                let receivedData: any = null;
                const mapped = EventUtils.map(
                    (data: { value: number }) => ({ doubled: data.value * 2 }),
                    (transformed) => {
                        receivedData = transformed;
                    }
                );

                mapped({ value: 5 });
                expect(receivedData).toEqual({ doubled: 10 });
            });
        });

        describe('once', () => {
            it('should execute callback only once', () => {
                let callCount = 0;
                const onceCallback = EventUtils.once(() => {
                    callCount++;
                });

                onceCallback({});
                onceCallback({});
                onceCallback({});

                expect(callCount).toBe(1);
            });
        });

        describe('catchErrors', () => {
            it('should catch and handle errors', async () => {
                let errorCaught: any = null;
                const errorCatcher = EventUtils.catchErrors(
                    () => {
                        throw new Error('Test error');
                    },
                    (error) => {
                        errorCaught = error;
                    }
                );

                await errorCatcher({});
                expect(errorCaught).toBeInstanceOf(Error);
                expect(errorCaught.message).toBe('Test error');
            });
        });
    });

    describe('Integration Tests', () => {
        it('should work together in complex scenarios', async () => {
            const source = createTypedEmitter<TestEvents>();
            const registry = new TypedEventRegistry<TestEvents>();
            const group = new EventGroup(source);

            const eventSymbol = registry.register('test:event');

            const filtered = filterEvents(source, ['test:event']);

            const {
                on: hookOn,
                emit: hookEmit,
                useEmitter: useHookEmitter,
            } = createHooks<TestEvents>();

            let counts = {
                source: 0,
                group: 0,
                filtered: 0,
                hook: 0,
            };

            source.on('test:event', () => {
                counts.source++;
            });
            group.on('test:event', () => {
                counts.group++;
            });
            filtered.on('test:event', () => {
                counts.filtered++;
            });
            hookOn('test:event', () => {
                counts.hook++;
            });

            await source.emit('test:event', { id: 'integration', data: {} });

            await hookEmit('test:event', { id: 'integration', data: {} });

            expect(counts.source).toBe(1);
            expect(counts.group).toBe(1);
            expect(counts.filtered).toBe(1);
            expect(counts.hook).toBe(1);

            expect(registry.getEvent(eventSymbol)).toBe('test:event');

            source.dispose();
            group.dispose();
            (filtered as any).dispose();
            useHookEmitter().dispose();
        });

        it('should handle complex event transformations', async () => {
            const source = createTypedEmitter<TestEvents>();
            const target = createTypedEmitter<TargetEvents>();

            const debouncedHandler = EventUtils.debounce((data: TestEvents['test:event']) => {
                target.emit('target:mapped', { transformed: true });
            }, 50);

            const filteredHandler = EventUtils.filter(
                (data: TestEvents['test:event']) => data.id.startsWith('valid'),
                debouncedHandler
            );

            source.on('test:event', filteredHandler);

            let targetCount = 0;
            target.on('target:mapped', () => {
                targetCount++;
            });

            await source.emit('test:event', { id: 'invalid1', data: {} });
            await source.emit('test:event', { id: 'valid1', data: {} });
            await source.emit('test:event', { id: 'valid2', data: {} });

            expect(targetCount).toBe(0);
            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(targetCount).toBe(1);

            source.dispose();
            target.dispose();
        });
    });
});
