import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    EventScheduler,
    TaskPriority,
    TaskState,
    ISchedulerOptions,
} from '../../event/event-scheduler';

describe('EventScheduler', () => {
    let scheduler: EventScheduler;

    beforeEach(() => {
        const options: ISchedulerOptions = {
            concurrencyLimit: 2,
            maxQueueSize: 100,
            enableMetrics: true,
            enableRetries: true,
            maxRetries: 2,
            retryDelay: 10,
            taskTimeout: 1000,
            gcIntervalMs: 5000,
            name: 'TestScheduler',
        };
        scheduler = new EventScheduler(options);
    });

    afterEach(() => {
        // Skip disposal - each test handles its own cleanup
    });

    describe('Basic Scheduling', () => {
        it('should schedule and execute tasks', async () => {
            let executed = false;
            const task = () => Promise.resolve((executed = true));

            await scheduler.schedule(task);
            expect(executed).toBe(true);
        });

        it('should handle task results correctly', async () => {
            const expectedResult = 'test-result';
            const task = () => Promise.resolve(expectedResult);

            const result = await scheduler.schedule(task);
            expect(result).toBe(expectedResult);
        });

        it('should handle task errors correctly', async () => {
            const expectedError = new Error('test-error');
            const task = () => Promise.reject(expectedError);

            await expect(scheduler.schedule(task)).rejects.toThrow('test-error');
        });

        it('should respect concurrency limits', async () => {
            let activeCount = 0;
            let maxActiveCount = 0;

            const task = () => {
                activeCount++;
                maxActiveCount = Math.max(maxActiveCount, activeCount);
                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        activeCount--;
                        resolve();
                    }, 50);
                });
            };

            const promises = Array.from({ length: 5 }, () => scheduler.schedule(task));
            await Promise.all(promises);

            expect(maxActiveCount).toBeLessThanOrEqual(2);
        });
    });

    describe('Priority Scheduling', () => {
        it('should execute high priority tasks first', async () => {
            const executionOrder: string[] = [];

            const delayedTask = (id: string) => () =>
                new Promise<void>((resolve) => {
                    setTimeout(() => {
                        executionOrder.push(id);
                        resolve();
                    }, 10);
                });

            const blockingTasks = [
                scheduler.schedule(() => new Promise((resolve) => setTimeout(resolve, 100))),
                scheduler.schedule(() => new Promise((resolve) => setTimeout(resolve, 100))),
            ];

            const lowTask = scheduler.schedule(delayedTask('low'), TaskPriority.LOW);
            const highTask = scheduler.schedule(delayedTask('high'), TaskPriority.HIGH);
            const normalTask = scheduler.schedule(delayedTask('normal'), TaskPriority.NORMAL);

            await Promise.all(blockingTasks);
            await Promise.all([lowTask, highTask, normalTask]);

            expect(executionOrder).toEqual(['high', 'normal', 'low']);
        });
    });

    describe('Task Timeout', () => {
        it('should timeout long-running tasks', async () => {
            const longTask = () =>
                new Promise<void>((resolve) => {
                    setTimeout(resolve, 2000);
                });

            await expect(scheduler.schedule(longTask, TaskPriority.NORMAL, 100)).rejects.toThrow(
                /timed out/
            );
        });

        it('should not timeout tasks that complete in time', async () => {
            const quickTask = () =>
                new Promise<string>((resolve) => {
                    setTimeout(() => resolve('completed'), 50);
                });

            const result = await scheduler.schedule(quickTask, TaskPriority.NORMAL, 200);
            expect(result).toBe('completed');
        });
    });

    describe('Retry Logic', () => {
        it('should retry failed tasks', async () => {
            let attempts = 0;
            const flakyTask = () => {
                attempts++;
                if (attempts < 3) {
                    return Promise.reject(new Error('Temporary failure'));
                }
                return Promise.resolve('success');
            };

            const result = await scheduler.schedule(flakyTask);
            expect(result).toBe('success');
            expect(attempts).toBe(3);
        });

        it('should fail after max retries', async () => {
            let attempts = 0;
            const alwaysFailTask = () => {
                attempts++;
                return Promise.reject(new Error('Permanent failure'));
            };

            await expect(scheduler.schedule(alwaysFailTask)).rejects.toThrow('Permanent failure');
            expect(attempts).toBe(3);
        });
    });

    describe('Queue Management', () => {
        it('should reject tasks when queue is full', async () => {
            const smallScheduler = new EventScheduler({
                concurrencyLimit: 1,
                maxQueueSize: 2,
            });

            try {
                const blockingTask = smallScheduler.schedule(
                    () => new Promise((resolve) => setTimeout(resolve, 100))
                );

                const queuedTask1 = smallScheduler.schedule(() => Promise.resolve());
                const queuedTask2 = smallScheduler.schedule(() => Promise.resolve());

                await expect(smallScheduler.schedule(() => Promise.resolve())).rejects.toThrow(
                    'Task queue is full'
                );

                await blockingTask;
                await queuedTask1;
                await queuedTask2;
            } finally {
                smallScheduler.dispose();
            }
        });

        it('should handle trySchedule correctly', async () => {
            const task = () => Promise.resolve('success');

            const result = await scheduler.trySchedule(task);
            expect(result).not.toBeNull();
            expect(await result!).toBe('success');
        });

        it('should return null from trySchedule when at capacity', async () => {
            const smallScheduler = new EventScheduler({
                concurrencyLimit: 1,
                maxQueueSize: 1,
            });

            try {
                smallScheduler.schedule(() => new Promise((resolve) => setTimeout(resolve, 100)));
                smallScheduler.schedule(() => Promise.resolve());

                const result = smallScheduler.trySchedule(() => Promise.resolve());
                expect(result).toBeNull();
            } finally {
                smallScheduler.dispose();
            }
        });
    });

    describe('Statistics and Metrics', () => {
        it('should provide accurate statistics', async () => {
            const testScheduler = new EventScheduler({
                concurrencyLimit: 2,
                enableMetrics: true,
                name: 'StatsTestScheduler',
            });

            try {
                const task1 = () => Promise.resolve('result1');
                const task2 = () => Promise.reject(new Error('error'));

                await testScheduler.schedule(task1);
                try {
                    await testScheduler.schedule(task2);
                } catch (error) {
                    // Expected error
                }

                const stats = testScheduler.getStats();
                expect(stats.name).toBe('StatsTestScheduler');
                expect(stats.completedCount).toBe(1);
                expect(stats.failedCount).toBe(1);
                expect(stats.totalProcessed).toBe(2);
                expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
            } finally {
                testScheduler.dispose();
            }
        });

        it('should track task metrics', async () => {
            const metricsScheduler = new EventScheduler({
                concurrencyLimit: 2,
                enableMetrics: true,
                name: 'MetricsTestScheduler',
            });

            try {
                const task = () => Promise.resolve('result');
                await metricsScheduler.schedule(task);

                const allMetrics = metricsScheduler.getAllTaskMetrics();
                expect(allMetrics.length).toBeGreaterThan(0);

                const completedMetrics = allMetrics.find((m) => m.state === TaskState.COMPLETED);
                expect(completedMetrics).toBeDefined();
                expect(completedMetrics?.priority).toBe(TaskPriority.NORMAL);
                expect(completedMetrics?.executionTime).toBeGreaterThanOrEqual(0);
            } finally {
                metricsScheduler.dispose();
            }
        });

        it('should clear metrics correctly', async () => {
            await scheduler.schedule(() => Promise.resolve());

            let stats = scheduler.getStats();
            expect(stats.completedCount).toBe(1);

            scheduler.clearMetrics();

            stats = scheduler.getStats();
            expect(stats.completedCount).toBe(0);
            expect(scheduler.getAllTaskMetrics()).toHaveLength(0);
        });
    });

    describe('Drain and Disposal', () => {
        it('should dispose correctly', async () => {
            const task = () => Promise.resolve();

            scheduler.dispose();

            await expect(scheduler.schedule(task)).rejects.toThrow('Scheduler has been disposed');
        });

        it('should cancel pending tasks on disposal', async () => {
            const promises: Promise<any>[] = [];

            promises.push(
                scheduler.schedule(() => new Promise((resolve) => setTimeout(resolve, 100)))
            );
            promises.push(
                scheduler.schedule(() => new Promise((resolve) => setTimeout(resolve, 100)))
            );

            promises.push(scheduler.schedule(() => Promise.resolve()));
            promises.push(scheduler.schedule(() => Promise.resolve()));

            scheduler.dispose();

            const results = await Promise.allSettled(promises);
            const rejectedCount = results.filter((r) => r.status === 'rejected').length;
            expect(rejectedCount).toBeGreaterThan(0);
        });
    });

    describe('Performance', () => {
        it('should handle high throughput', async () => {
            const taskCount = 100;
            let completed = 0;

            const highThroughputScheduler = new EventScheduler({
                concurrencyLimit: Infinity,
                maxQueueSize: 1000,
                enableMetrics: true,
            });

            try {
                const startTime = performance.now();

                const promises = Array.from({ length: taskCount }, () =>
                    highThroughputScheduler.schedule(() => Promise.resolve(++completed))
                );

                await Promise.all(promises);

                const endTime = performance.now();
                const duration = endTime - startTime;

                expect(completed).toBe(taskCount);
                expect(duration).toBeLessThan(5000);

                const stats = highThroughputScheduler.getStats();
                expect(stats.completedCount).toBe(taskCount);
            } finally {
                highThroughputScheduler.dispose();
            }
        });

        it('should have minimal memory overhead', async () => {
            const taskCount = 100;
            const promises: Promise<any>[] = [];

            for (let i = 0; i < taskCount; i++) {
                promises.push(scheduler.schedule(() => Promise.resolve(i)));
            }

            await Promise.all(promises);

            const stats = scheduler.getStats();
            expect(stats.memoryUsage).toBeLessThan(100000);
        });
    });
});
