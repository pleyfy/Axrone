import {
    Subscription,
    SubscriptionOptions,
    EventMetrics,
    QueuedEvent,
} from '../../event/interfaces';
import { EventCallback, EventPriority } from '../../event/definition';
import { describe, expect, it } from 'vitest';

describe('EventEmitter - Subscription Interfaces', () => {
    it('should support proper subscription lifecycle', () => {
        let executionCount = 0;
        const callback: EventCallback<string> = () => {
            executionCount++;
        };

        const subscription: Subscription<string> = {
            id: Symbol('test'),
            event: 'test:event',
            callback,
            once: false,
            priority: 'normal',
            createdAt: Date.now(),
            executionCount: 0,
        };

        subscription.callback('test data');
        subscription.executionCount++;
        subscription.lastExecuted = Date.now();

        expect(executionCount).toBe(1);
        expect(subscription.executionCount).toBe(1);
        expect(subscription.lastExecuted).toBeDefined();
        expect(typeof subscription.lastExecuted).toBe('number');
    });

    it('should handle async callbacks correctly', async () => {
        let resolved = false;
        const asyncCallback: EventCallback<number> = async (data) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            resolved = true;
            return;
        };

        const subscription: Subscription<number> = {
            id: Symbol('async-test'),
            event: 'async:event',
            callback: asyncCallback,
            once: true,
            priority: 'high',
            createdAt: Date.now(),
            executionCount: 0,
        };

        const result = subscription.callback(42);
        expect(result).toBeInstanceOf(Promise);

        await result;
        expect(resolved).toBe(true);
    });

    it('should maintain immutable properties', () => {
        const subscription: Subscription = {
            id: Symbol('immutable'),
            event: 'test',
            callback: () => {},
            once: false,
            priority: 'normal',
            createdAt: Date.now(),
            executionCount: 0,
        };

        // TypeScript should prevent these assignments:
        // subscription.id = Symbol('new'); // ❌
        // subscription.event = 'new'; // ❌
        // subscription.callback = () => {}; // ❌

        // But allow mutable properties:
        subscription.executionCount = 5;
        subscription.lastExecuted = Date.now();

        expect(subscription.executionCount).toBe(5);
        expect(subscription.lastExecuted).toBeDefined();
    });

    describe('SubscriptionOptions', () => {
        it('should support all valid option combinations', () => {
            const validOptions: SubscriptionOptions[] = [
                {},
                { once: true },
                { priority: 'high' },
                { once: false, priority: 'low' },
                { once: true, priority: 'normal' },
            ];

            validOptions.forEach((options) => {
                expect(typeof options).toBe('object');

                if ('once' in options) {
                    expect(typeof options.once).toBe('boolean');
                }

                if ('priority' in options) {
                    expect(['high', 'normal', 'low']).toContain(options.priority);
                }
            });
        });

        it('should work with partial options merging', () => {
            const defaultOptions = { once: false, priority: 'normal' as EventPriority };
            const userOptions: SubscriptionOptions = { priority: 'high' };

            const mergedOptions = { ...defaultOptions, ...userOptions };

            expect(mergedOptions.once).toBe(false); // From default
            expect(mergedOptions.priority).toBe('high'); // From user
        });
    });

    describe('QueuedEvent Interface', () => {
        it('should support priority-based sorting', () => {
            const events: QueuedEvent[] = [
                { id: 1, event: 'low1', data: {}, timestamp: 1000, priority: 'low' },
                { id: 2, event: 'high1', data: {}, timestamp: 2000, priority: 'high' },
                { id: 3, event: 'normal1', data: {}, timestamp: 1500, priority: 'normal' },
                { id: 4, event: 'high2', data: {}, timestamp: 1200, priority: 'high' },
            ];

            const priorityValues = { high: 0, normal: 1, low: 2 };

            const sorted = events.sort((a, b) => {
                const priorityDiff = priorityValues[a.priority] - priorityValues[b.priority];
                if (priorityDiff !== 0) return priorityDiff;
                return a.timestamp - b.timestamp;
            });

            expect(sorted[0].event).toBe('high2');
            expect(sorted[1].event).toBe('high1');
            expect(sorted[2].event).toBe('normal1');
            expect(sorted[3].event).toBe('low1');
        });

        it('should handle large data payloads', () => {
            const largeData = {
                users: new Array(1000).fill(0).map((_, i) => ({ id: i, name: `User${i}` })),
                metadata: { source: 'bulk-import', processed: Date.now() },
            };

            const queuedEvent: QueuedEvent = {
                id: 999,
                event: 'bulk:import',
                data: largeData,
                timestamp: Date.now(),
                priority: 'normal',
            };

            expect(queuedEvent.data.users).toHaveLength(1000);
            expect(queuedEvent.data.metadata.source).toBe('bulk-import');
        });

        it('should maintain event ordering within same priority', () => {
            const events: QueuedEvent[] = [
                { id: 1, event: 'order1', data: {}, timestamp: 1000, priority: 'normal' },
                { id: 2, event: 'order2', data: {}, timestamp: 1001, priority: 'normal' },
                { id: 3, event: 'order3', data: {}, timestamp: 1002, priority: 'normal' },
            ];

            const sorted = events.sort((a, b) => a.timestamp - b.timestamp);

            expect(sorted.map((e) => e.event)).toEqual(['order1', 'order2', 'order3']);
        });
    });

    describe('EventMetrics Interface', () => {
        it('should calculate performance indicators correctly', () => {
            const metrics: EventMetrics = {
                emit: {
                    count: 100,
                    timing: { avg: 2.0, max: 10.0, min: 0.5, total: 200.0 },
                },
                execution: {
                    count: 95,
                    errors: 2,
                    timing: { avg: 8.0, max: 50.0, min: 0.1, total: 760.0 },
                },
            };

            const successRate =
                ((metrics.execution.count - metrics.execution.errors) / metrics.execution.count) *
                100;
            expect(successRate).toBeCloseTo(97.89, 2);

            const totalLatency = metrics.emit.timing.avg + metrics.execution.timing.avg;
            expect(totalLatency).toBe(10.0);

            const coverage = (metrics.execution.count / metrics.emit.count) * 100;
            expect(coverage).toBe(95);
        });

        it('should handle edge cases in metrics data', () => {
            const emptyMetrics: EventMetrics = {
                emit: {
                    count: 0,
                    timing: { avg: 0, max: 0, min: 0, total: 0 },
                },
                execution: {
                    count: 0,
                    errors: 0,
                    timing: { avg: 0, max: 0, min: 0, total: 0 },
                },
            };

            expect(() => {
                const rate =
                    emptyMetrics.execution.count > 0
                        ? (emptyMetrics.execution.errors / emptyMetrics.execution.count) * 100
                        : 0;
                expect(rate).toBe(0);
            }).not.toThrow();
        });

        it('should support metrics aggregation across time windows', () => {
            const window1: EventMetrics = {
                emit: { count: 50, timing: { avg: 2.0, max: 8.0, min: 0.5, total: 100.0 } },
                execution: {
                    count: 48,
                    errors: 1,
                    timing: { avg: 5.0, max: 20.0, min: 0.1, total: 240.0 },
                },
            };

            const window2: EventMetrics = {
                emit: { count: 75, timing: { avg: 3.0, max: 12.0, min: 0.8, total: 225.0 } },
                execution: {
                    count: 72,
                    errors: 2,
                    timing: { avg: 7.0, max: 35.0, min: 0.2, total: 504.0 },
                },
            };

            const aggregated: EventMetrics = {
                emit: {
                    count: window1.emit.count + window2.emit.count,
                    timing: {
                        avg:
                            (window1.emit.timing.total + window2.emit.timing.total) /
                            (window1.emit.count + window2.emit.count),
                        max: Math.max(window1.emit.timing.max, window2.emit.timing.max),
                        min: Math.min(window1.emit.timing.min, window2.emit.timing.min),
                        total: window1.emit.timing.total + window2.emit.timing.total,
                    },
                },
                execution: {
                    count: window1.execution.count + window2.execution.count,
                    errors: window1.execution.errors + window2.execution.errors,
                    timing: {
                        avg:
                            (window1.execution.timing.total + window2.execution.timing.total) /
                            (window1.execution.count + window2.execution.count),
                        max: Math.max(window1.execution.timing.max, window2.execution.timing.max),
                        min: Math.min(window1.execution.timing.min, window2.execution.timing.min),
                        total: window1.execution.timing.total + window2.execution.timing.total,
                    },
                },
            };

            expect(aggregated.emit.count).toBe(125);
            expect(aggregated.execution.errors).toBe(3);
            expect(aggregated.emit.timing.max).toBe(12.0);
            expect(aggregated.execution.timing.min).toBe(0.1);
        });
    });

    describe('Interface Integration', () => {
        it('should support complete subscription workflow', () => {
            const options: SubscriptionOptions = { once: true, priority: 'high' };

            let callbackExecuted = false;
            const subscription: Subscription<string> = {
                id: Symbol('workflow'),
                event: 'test:workflow',
                callback: (data) => {
                    callbackExecuted = true;
                },
                once: options.once ?? false,
                priority: options.priority ?? 'normal',
                createdAt: Date.now(),
                executionCount: 0,
            };

            const queuedEvent: QueuedEvent<string> = {
                id: 1,
                event: subscription.event,
                data: 'test data',
                timestamp: Date.now(),
                priority: subscription.priority,
            };

            const startTime = performance.now();
            subscription.callback(queuedEvent.data);
            const executionTime = performance.now() - startTime;

            subscription.executionCount++;
            subscription.lastExecuted = Date.now();

            expect(callbackExecuted).toBe(true);
            expect(subscription.executionCount).toBe(1);
            expect(subscription.priority).toBe('high');
            expect(subscription.once).toBe(true);
            expect(executionTime).toBeGreaterThanOrEqual(0);
        });

        it('should handle subscription cleanup for once subscriptions', () => {
            const subscriptions = new Map<symbol, Subscription>();

            const onceSubscription: Subscription = {
                id: Symbol('cleanup-test'),
                event: 'test:cleanup',
                callback: () => {},
                once: true,
                priority: 'normal',
                createdAt: Date.now(),
                executionCount: 0,
            };

            subscriptions.set(onceSubscription.id, onceSubscription);
            expect(subscriptions.size).toBe(1);

            onceSubscription.callback('test data');
            onceSubscription.executionCount++;

            if (onceSubscription.once && onceSubscription.executionCount > 0) {
                subscriptions.delete(onceSubscription.id);
            }

            expect(subscriptions.size).toBe(0);
        });

        it('should support metrics collection during subscription execution', () => {
            const metricsCollector = {
                emitCount: 0,
                executionCount: 0,
                errorCount: 0,
                timings: [] as number[],
            };

            const subscriptions: Subscription[] = [
                {
                    id: Symbol('metric1'),
                    event: 'test:metrics',
                    callback: () => {},
                    once: false,
                    priority: 'normal',
                    createdAt: Date.now(),
                    executionCount: 0,
                },
                {
                    id: Symbol('metric2'),
                    event: 'test:metrics',
                    callback: () => {
                        throw new Error('Handler error');
                    },
                    once: false,
                    priority: 'normal',
                    createdAt: Date.now(),
                    executionCount: 0,
                },
            ];

            metricsCollector.emitCount++;

            subscriptions.forEach((subscription) => {
                const startTime = performance.now();

                try {
                    subscription.callback('test data');
                    metricsCollector.executionCount++;
                } catch (error) {
                    metricsCollector.errorCount++;
                }

                const executionTime = performance.now() - startTime;
                metricsCollector.timings.push(executionTime);

                subscription.executionCount++;
                subscription.lastExecuted = Date.now();
            });

            expect(metricsCollector.emitCount).toBe(1);
            expect(metricsCollector.executionCount).toBe(1);
            expect(metricsCollector.errorCount).toBe(1);
            expect(metricsCollector.timings).toHaveLength(2);

            subscriptions.forEach((sub) => {
                expect(sub.executionCount).toBe(1);
                expect(sub.lastExecuted).toBeDefined();
            });
        });
    });
});
