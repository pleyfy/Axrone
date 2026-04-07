import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../event/event-emitter';
import { EventHandlerError, EventQueueFullError } from '../../event/errors';
import { EventMap } from '../../event/definition';

interface TestEvents extends EventMap {
    'test:event': { id: string; data: any };
    'test:async': { delay: number };
    'test:error': { shouldFail: boolean; message?: string };
    'test:async-error': { delay?: number; shouldFail: boolean };
    'test:priority': { level: string };
    'test:batch': { index: number };
    'test:success': { data: string };
    error: Error | EventHandlerError; // Error event'ini düzgün tanımlayalım
}

describe('EventEmitter - Main Implementation', () => {
    describe('Core Event Operations', () => {
        let emitter: EventEmitter<TestEvents>;

        beforeEach(() => {
            emitter = new EventEmitter<TestEvents>();
        });

        afterEach(() => {
            emitter.dispose();
        });

        it('should handle basic subscription and emission workflow', async () => {
            let callbackExecuted = false;
            let receivedData: any = null;

            const unsubscribe = emitter.on('test:event', (data) => {
                callbackExecuted = true;
                receivedData = data;
            });

            const testData = { id: 'test1', data: { value: 42 } };
            const result = await emitter.emit('test:event', testData);

            expect(result).toBe(true);
            expect(callbackExecuted).toBe(true);
            expect(receivedData).toEqual(testData);

            unsubscribe();
        });

        it('should handle once subscriptions correctly', async () => {
            let executionCount = 0;

            emitter.once('test:event', () => {
                executionCount++;
            });

            await emitter.emit('test:event', { id: 'test1', data: {} });
            expect(executionCount).toBe(1);

            await emitter.emit('test:event', { id: 'test2', data: {} });
            expect(executionCount).toBe(1);

            expect(emitter.listenerCount('test:event')).toBe(0);
        });

        it('should handle async and sync callbacks correctly', async () => {
            const executionOrder: string[] = [];

            emitter.on('test:async', async (data) => {
                await new Promise((resolve) => setTimeout(resolve, data.delay));
                executionOrder.push('async');
            });

            emitter.on('test:async', (data) => {
                executionOrder.push('sync');
            });

            await emitter.emit('test:async', { delay: 50 });

            expect(executionOrder).toContain('async');
            expect(executionOrder).toContain('sync');
        });

        it('should return false when no listeners exist', async () => {
            const result = await emitter.emit('test:event', { id: 'test', data: {} });
            expect(result).toBe(false);
        });

        it('should handle subscription removal correctly', () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();

            emitter.on('test:event', callback1);
            emitter.on('test:event', callback2);

            expect(emitter.listenerCount('test:event')).toBe(2);

            const removed = emitter.off('test:event', callback1);
            expect(removed).toBe(true);
            expect(emitter.listenerCount('test:event')).toBe(1);

            const removedAll = emitter.off('test:event');
            expect(removedAll).toBe(true);
            expect(emitter.listenerCount('test:event')).toBe(0);
        });
    });

    // PRIORITY SYSTEM TESTS
    describe('Priority System', () => {
        let emitter: EventEmitter<TestEvents>;

        beforeEach(() => {
            emitter = new EventEmitter<TestEvents>({ concurrencyLimit: 1 });
        });

        afterEach(() => {
            emitter.dispose();
        });

        it('should execute handlers in priority order', async () => {
            const executionOrder: string[] = [];

            emitter.on(
                'test:priority',
                () => {
                    executionOrder.push('low');
                },
                { priority: 'low' }
            );

            emitter.on(
                'test:priority',
                () => {
                    executionOrder.push('high');
                },
                { priority: 'high' }
            );

            emitter.on(
                'test:priority',
                () => {
                    executionOrder.push('normal');
                },
                { priority: 'normal' }
            );

            await emitter.emit('test:priority', { level: 'test' });

            expect(executionOrder).toEqual(['high', 'normal', 'low']);
        });

        it('should handle priority-based emission options', async () => {
            emitter.pause();

            const events = [
                emitter.emit('test:priority', { level: 'low' }, { priority: 'low' }),
                emitter.emit('test:priority', { level: 'high' }, { priority: 'high' }),
                emitter.emit('test:priority', { level: 'normal' }, { priority: 'normal' }),
            ];

            const queuedEvents = emitter.getQueuedEvents();
            expect(queuedEvents).toHaveLength(3);

            expect(queuedEvents[0].priority).toBe('high');
            expect(queuedEvents[1].priority).toBe('normal');
            expect(queuedEvents[2].priority).toBe('low');

            emitter.resume();
            await Promise.all(events);
        });
    });

    // // ERROR HANDLING TESTS
    // describe('EventEmitter - Error Handling Tests', () => {
    //     let emitter: EventEmitter<TestEvents>;

    //     afterEach(() => {
    //         if (emitter) {
    //             emitter.dispose();
    //         }
    //     });

    //     describe('Synchronous Error Handling', () => {
    //         it('should handle synchronous handler errors with captureRejections enabled', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorCaught = false;
    //             let caughtError: EventHandlerError | null = null;

    //             emitter.on('error', (error) => {
    //                 errorCaught = true;
    //                 if (error instanceof EventHandlerError) {
    //                     caughtError = error;
    //                 }
    //             });

    //             emitter.on('test:error', (data) => {
    //                 if (data.shouldFail) {
    //                     throw new Error(data.message || 'Handler intentionally failed');
    //                 }
    //             });

    //             await emitter.emit('test:error', { shouldFail: true, message: 'Test error' });

    //             await new Promise((resolve) => setTimeout(resolve, 10));

    //             expect(errorCaught).toBe(true);
    //             expect(caughtError).toBeInstanceOf(EventHandlerError);
    //             expect(caughtError!.eventName).toBe('test:error');
    //             expect(caughtError!.originalError).toBeInstanceOf(Error);
    //         });

    //         it('should propagate errors when captureRejections is disabled', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: false });

    //             emitter.on('test:error', (data) => {
    //                 if (data.shouldFail) {
    //                     throw new Error('Handler error');
    //                 }
    //             });

    //             await expect(emitter.emit('test:error', { shouldFail: true })).rejects.toThrow(
    //                 EventHandlerError
    //             );
    //         });

    //         it('should handle errors in emitSync with captureRejections enabled', () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorCaught = false;

    //             emitter.on('error', () => {
    //                 errorCaught = true;
    //             });

    //             emitter.on('test:error', (data) => {
    //                 if (data.shouldFail) {
    //                     throw new Error('Sync handler error');
    //                 }
    //             });

    //             expect(() => {
    //                 emitter.emitSync('test:error', { shouldFail: true });
    //             }).not.toThrow();

    //             expect(errorCaught).toBe(true);
    //         });

    //         it('should propagate errors in emitSync when captureRejections is disabled', () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: false });

    //             emitter.on('test:error', (data) => {
    //                 if (data.shouldFail) {
    //                     throw new Error('Sync handler error');
    //                 }
    //             });

    //             expect(() => {
    //                 emitter.emitSync('test:error', { shouldFail: true });
    //             }).toThrow(EventHandlerError);
    //         });
    //     });

    //     describe('Asynchronous Error Handling', () => {
    //         it('should handle async handler errors with captureRejections enabled', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorHandled = false;
    //             let caughtError: EventHandlerError | null = null;

    //             emitter.on('error', (error) => {
    //                 errorHandled = true;
    //                 if (error instanceof EventHandlerError) {
    //                     caughtError = error;
    //                 }
    //             });

    //             emitter.on('test:async-error', async (data) => {
    //                 await new Promise((resolve) => setTimeout(resolve, data.delay || 10));
    //                 if (data.shouldFail) {
    //                     throw new Error('Async handler error');
    //                 }
    //             });

    //             await emitter.emit('test:async-error', { shouldFail: true, delay: 20 });

    //             expect(errorHandled).toBe(true);
    //             expect(caughtError).toBeInstanceOf(EventHandlerError);
    //             expect(caughtError!.eventName).toBe('test:async-error');
    //         });

    //         it('should propagate async errors when captureRejections is disabled', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: false });

    //             emitter.on('test:async-error', async (data) => {
    //                 await new Promise((resolve) => setTimeout(resolve, 10));
    //                 if (data.shouldFail) {
    //                     throw new Error('Async handler error');
    //                 }
    //             });

    //             await expect(
    //                 emitter.emit('test:async-error', { shouldFail: true })
    //             ).rejects.toThrow(EventHandlerError);
    //         });

    //         it('should handle Promise rejection in async handlers', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorHandled = false;

    //             emitter.on('error', () => {
    //                 errorHandled = true;
    //             });

    //             emitter.on('test:async-error', () => {
    //                 return Promise.reject(new Error('Promise rejection'));
    //             });

    //             await emitter.emit('test:async-error', { shouldFail: true });

    //             expect(errorHandled).toBe(true);
    //         });

    //         it('should handle async callbacks in emitSync with warning', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             const consoleSpy = vi.(console, 'warn').mockImplementation();
    //             let errorHandled = false;

    //             emitter.on('error', () => {
    //                 errorHandled = true;
    //             });

    //             emitter.on('test:async-error', async (data) => {
    //                 await new Promise((resolve) => setTimeout(resolve, 10));
    //                 if (data.shouldFail) {
    //                     throw new Error('Async error in emitSync');
    //                 }
    //             });

    //             emitter.emitSync('test:async-error', { shouldFail: true });

    //             expect(consoleSpy).toHaveBeenCalledWith(
    //                 expect.stringContaining('emitted synchronously but had async listeners')
    //             );

    //             await new Promise((resolve) => setTimeout(resolve, 50));
    //             expect(errorHandled).toBe(true);

    //             consoleSpy.mockRestore();
    //         });
    //     });

    //     describe('Multiple Handlers Error Scenarios', () => {
    //         it('should handle errors from multiple handlers independently', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorCount = 0;
    //             const errors: EventHandlerError[] = [];

    //             emitter.on('error', (error) => {
    //                 errorCount++;
    //                 if (error instanceof EventHandlerError) {
    //                     errors.push(error);
    //                 }
    //             });

    //             emitter.on('test:error', () => {
    //                 throw new Error('Handler 1 error');
    //             });

    //             emitter.on('test:error', (data) => {
    //                 expect(data.shouldFail).toBe(true);
    //             });

    //             emitter.on('test:error', () => {
    //                 throw new Error('Handler 3 error');
    //             });

    //             await emitter.emit('test:error', { shouldFail: true });

    //             await new Promise((resolve) => setTimeout(resolve, 50));

    //             expect(errorCount).toBe(2);
    //             expect(errors).toHaveLength(2);
    //             expect(errors.every((e) => e instanceof EventHandlerError)).toBe(true);
    //         });

    //         it('should handle mixed sync and async handler errors', async () => {
    //             emitter = new EventEmitter<TestEvents>({ captureRejections: true });
    //             let errorCount = 0;

    //             emitter.on('error', () => {
    //                 errorCount++;
    //             });

    //             emitter.on('test:error', () => {
    //                 throw new Error('Sync error');
    //             });

    //             emitter.on('test:error', async () => {
    //                 await new Promise((resolve) => setTimeout(resolve, 10));
    //                 throw new Error('Async error');
    //             });

    //             await emitter.emit('test:error', { shouldFail: true });

    //             await new Promise((resolve) => setTimeout(resolve, 50));

    //             expect(errorCount).toBe(2);
    //         });
    //     });
    // });

    // PAUSE/RESUME AND BUFFERING TESTS
    describe('Pause/Resume and Buffering', () => {
        let emitter: EventEmitter<TestEvents>;

        beforeEach(() => {
            emitter = new EventEmitter<TestEvents>({ bufferSize: 10 });
        });

        afterEach(() => {
            emitter.dispose();
        });

        it('should queue events when paused', async () => {
            let processedEvents = 0;

            emitter.on('test:event', () => {
                processedEvents++;
            });

            emitter.pause();
            expect(emitter.isPaused()).toBe(true);

            await emitter.emit('test:event', { id: 'queued1', data: {} });
            await emitter.emit('test:event', { id: 'queued2', data: {} });

            expect(processedEvents).toBe(0);
            expect(emitter.getPendingCount()).toBe(2);

            emitter.resume();
            await emitter.drain();

            expect(processedEvents).toBe(2);
            expect(emitter.getPendingCount()).toBe(0);
        });

        it('should handle buffer overflow correctly', async () => {
            const smallBufferEmitter = new EventEmitter<TestEvents>({ bufferSize: 2 });

            smallBufferEmitter.pause();

            await smallBufferEmitter.emit('test:event', { id: '1', data: {} });
            await smallBufferEmitter.emit('test:event', { id: '2', data: {} });

            await expect(
                smallBufferEmitter.emit('test:event', { id: '3', data: {} })
            ).rejects.toThrow(EventQueueFullError);

            smallBufferEmitter.dispose();
        });

        it('should clear buffers correctly', async () => {
            emitter.pause();

            await emitter.emit('test:event', { id: '1', data: {} });
            await emitter.emit('test:batch', { index: 1 });

            expect(emitter.getPendingCount()).toBe(2);
            expect(emitter.getPendingCount('test:event')).toBe(1);

            const cleared = emitter.clearBuffer('test:event');
            expect(cleared).toBe(1);
            expect(emitter.getPendingCount()).toBe(1);

            const clearedAll = emitter.clearBuffer();
            expect(clearedAll).toBe(1);
            expect(emitter.getPendingCount()).toBe(0);
        });

        it('should flush specific event queues', async () => {
            let processedEvents = 0;

            emitter.on('test:event', () => {
                processedEvents++;
            });

            emitter.pause();

            await emitter.emit('test:event', { id: '1', data: {} });
            await emitter.emit('test:event', { id: '2', data: {} });

            expect(processedEvents).toBe(0);

            await emitter.flush('test:event');

            expect(processedEvents).toBe(2);
            expect(emitter.getPendingCount('test:event')).toBe(0);
        });
    });

    // BATCH OPERATIONS TESTS
    describe('Batch Operations', () => {
        let emitter: EventEmitter<TestEvents>;

        beforeEach(() => {
            emitter = new EventEmitter<TestEvents>();
        });

        afterEach(() => {
            emitter.dispose();
        });

        it('should handle batch subscription correctly', () => {
            const callbacks = [vi.fn(), vi.fn(), vi.fn()];

            const subscriptionIds = emitter.batchSubscribe('test:batch', callbacks);

            expect(subscriptionIds).toHaveLength(3);
            expect(emitter.listenerCount('test:batch')).toBe(3);

            const uniqueIds = new Set(subscriptionIds);
            expect(uniqueIds.size).toBe(3);
        });

        it('should handle batch unsubscription correctly', () => {
            const callbacks = [vi.fn(), vi.fn(), vi.fn()];
            const subscriptionIds = emitter.batchSubscribe('test:batch', callbacks);

            expect(emitter.listenerCount('test:batch')).toBe(3);

            const unsubscribed = emitter.batchUnsubscribe(subscriptionIds);
            expect(unsubscribed).toBe(3);
            expect(emitter.listenerCount('test:batch')).toBe(0);
        });

        it('should handle batch emission correctly', async () => {
            let emissionCount = 0;

            emitter.on('test:batch', () => {
                emissionCount++;
            });

            const events = [
                { event: 'test:batch' as const, data: { index: 1 } },
                { event: 'test:batch' as const, data: { index: 2 } },
                { event: 'test:batch' as const, data: { index: 3 } },
            ];

            const results = await emitter.emitBatch(events);

            expect(results).toEqual([true, true, true]);
            expect(emissionCount).toBe(3);
        });

        it('should handle empty batch operations', async () => {
            const results = await emitter.emitBatch([]);
            expect(results).toEqual([]);

            const subscriptionIds = emitter.batchSubscribe('test:batch', []);
            expect(subscriptionIds).toEqual([]);

            const unsubscribed = emitter.batchUnsubscribe([]);
            expect(unsubscribed).toBe(0);
        });
    });

    describe('Concurrency and Performance', () => {
        it('should respect concurrency limits', async () => {
            const emitter = new EventEmitter<TestEvents>({ concurrencyLimit: 2 });
            let maxConcurrent = 0;
            let currentConcurrent = 0;

            emitter.on('test:async', async (data) => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

                await new Promise((resolve) => setTimeout(resolve, data.delay));

                currentConcurrent--;
            });

            const promises = Array.from({ length: 5 }, () =>
                emitter.emit('test:async', { delay: 100 })
            );

            await Promise.all(promises);

            expect(maxConcurrent).toBe(2);

            emitter.dispose();
        });

        it('should handle unlimited concurrency correctly', async () => {
            const emitter = new EventEmitter<TestEvents>({ concurrencyLimit: Infinity });
            let maxConcurrent = 0;
            let currentConcurrent = 0;

            emitter.on('test:async', async (data) => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

                await new Promise((resolve) => setTimeout(resolve, data.delay));

                currentConcurrent--;
            });

            const promises = Array.from({ length: 10 }, () =>
                emitter.emit('test:async', { delay: 50 })
            );

            await Promise.all(promises);

            expect(maxConcurrent).toBe(10);
            emitter.dispose();
        });

        it('should drain all pending operations', async () => {
            const emitter = new EventEmitter<TestEvents>({ concurrencyLimit: 1 });
            let completedTasks = 0;

            emitter.on('test:async', async (data) => {
                await new Promise((resolve) => setTimeout(resolve, data.delay));
                completedTasks++;
            });

            const tasks = Array.from({ length: 5 }, () =>
                emitter.emit('test:async', { delay: 50 })
            );

            await emitter.drain();
            expect(completedTasks).toBe(5);
            emitter.dispose();
        });
    });

    // METRICS AND MONITORING TESTS
    describe('Metrics and Monitoring', () => {
        let emitter: EventEmitter<TestEvents>;

        beforeEach(() => {
            emitter = new EventEmitter<TestEvents>();
        });

        afterEach(() => {
            emitter.dispose();
        });

        it('should collect emission and execution metrics', async () => {
            emitter.on('test:event', async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
            });

            emitter.on('test:event', () => {
                // Sync handler
            });

            await emitter.emit('test:event', { id: 'test', data: {} });
            await emitter.emit('test:event', { id: 'test2', data: {} });

            const metrics = emitter.getMetrics('test:event');

            expect(metrics.emit.count).toBe(2);
            expect(metrics.execution.count).toBe(4); // 2 emissions × 2 handlers
            expect(metrics.execution.errors).toBe(0);
            expect(metrics.emit.timing.avg).toBeGreaterThan(0);
            expect(metrics.execution.timing.avg).toBeGreaterThan(0);
        });

        it('should track error metrics correctly', async () => {
            const emitter = new EventEmitter<TestEvents>({ captureRejections: true });

            emitter.on('error' as any, () => {});

            emitter.on('test:error', () => {
                throw new Error('Test error');
            });

            emitter.on('test:error', () => {
                // Successful handler
            });

            await emitter.emit('test:error', { shouldFail: true });

            const metrics = emitter.getMetrics('test:error');

            expect(metrics.execution.count).toBe(2);
            expect(metrics.execution.errors).toBe(1);

            emitter.dispose();
        });

        it('should provide memory usage information', () => {
            for (let i = 0; i < 10; i++) {
                emitter.on('test:event', () => {});
            }

            const memoryUsage = emitter.getMemoryUsage();

            expect(memoryUsage).toHaveProperty('total');
            expect(typeof memoryUsage.total).toBe('number');
            expect(memoryUsage.total).toBeGreaterThan(0);

            const allKeys = [
                ...Object.keys(memoryUsage),
                ...Object.getOwnPropertySymbols(memoryUsage),
            ];
            expect(allKeys.length).toBeGreaterThan(1);

            expect(Object.getOwnPropertySymbols(memoryUsage).length).toBe(4);
        });

        it('should reset metrics correctly', async () => {
            emitter.on('test:event', () => {});

            await emitter.emit('test:event', { id: 'test', data: {} });

            let metrics = emitter.getMetrics('test:event');
            expect(metrics.emit.count).toBe(1);

            emitter.resetMetrics('test:event');

            metrics = emitter.getMetrics('test:event');
            expect(metrics.emit.count).toBe(0);
        });
    });

    // CONFIGURATION AND OPTIONS TESTS
    describe('Configuration and Options', () => {
        it('should respect maxListeners configuration', () => {
            const emitter = new EventEmitter<TestEvents>({ maxListeners: 2 });

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            emitter.on('test:event', () => {});
            emitter.on('test:event', () => {});

            expect(emitter.listenerCount('test:event')).toBe(2);
            expect(consoleSpy).not.toHaveBeenCalled();

            emitter.on('test:event', () => {});

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('MaxListenersExceededWarning')
            );

            consoleSpy.mockRestore();
            emitter.dispose();
        });

        it('should handle maxListeners property changes', () => {
            const emitter = new EventEmitter<TestEvents>({ maxListeners: 5 });

            expect(emitter.maxListeners).toBe(5);

            emitter.maxListeners = 10;
            expect(emitter.maxListeners).toBe(10);

            expect(() => {
                emitter.maxListeners = -1;
            }).toThrow(TypeError);

            emitter.resetMaxListeners();
            expect(emitter.maxListeners).toBe(10);

            emitter.dispose();
        });

        it('should handle GC configuration correctly', async () => {
            const emitter = new EventEmitter<TestEvents>({ gcIntervalMs: 100 });

            const unsubscribe = emitter.on('test:event', () => {});
            unsubscribe();

            await new Promise((r) => setTimeout(r, 150));
            emitter.dispose();
        });
    });
});
