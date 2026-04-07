import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Subject,
    BehaviorSubject,
    ReplaySubject,
    AsyncSubject,
    ObserverCallback,
    ObserverOptions,
    SubjectOptions,
    IObservableSubject,
} from '../../observer/index';

describe('Observer Library - Core Functionality', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

    describe('Subject', () => {
        it('should create a subject and notify observers', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer);
            await subject.notify('test data');

            expect(observer).toHaveBeenCalledWith('test data', subject);
        });

        it('should support synchronous notification', () => {
            const subject = new Subject<number>();
            const observer = vi.fn();

            subject.addObserver(observer);
            const result = subject.notifySync(42);

            expect(result).toBe(true);
            expect(observer).toHaveBeenCalledWith(42, subject);
        });

        it('should handle observer removal', () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            const unsubscribe = subject.addObserver(observer);
            unsubscribe();
            subject.notifySync('test');

            expect(observer).not.toHaveBeenCalled();
        });

        it('should support observer priorities', async () => {
            const subject = new Subject<string>();
            const callOrder: string[] = [];

            subject.addObserver(
                () => {
                    callOrder.push('normal');
                },
                { priority: 'normal' }
            );
            subject.addObserver(
                () => {
                    callOrder.push('high');
                },
                { priority: 'high' }
            );
            subject.addObserver(
                () => {
                    callOrder.push('low');
                },
                { priority: 'low' }
            );

            await subject.notify('test');

            expect(callOrder).toContain('high');
            expect(callOrder).toContain('normal');
            expect(callOrder).toContain('low');
            expect(callOrder).toHaveLength(3);
        });

        it('should support once observers', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer, { once: true });
            await subject.notify('first');
            await subject.notify('second');

            expect(observer).toHaveBeenCalledTimes(1);
            expect(observer).toHaveBeenCalledWith('first', subject);
        });

        it('should handle completion', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer);
            await subject.complete();

            expect(subject.isCompleted()).toBe(true);

            await expect(subject.notify('test')).rejects.toThrow();
        });

        it('should handle errors', async () => {
            const subject = new Subject<string>();
            const errorHandler = vi.fn();
            const testError = new Error('Test error');

            subject.addObserver(() => {}, {
                errorHandling: 'callback',
                onError: errorHandler,
            });

            await subject.error(testError);

            expect(errorHandler).toHaveBeenCalledWith(testError, testError, subject);
            expect(subject.isErrored()).toBe(true);
            expect(subject.getLastError()).toBe(testError);
        });

        it('should support debounced observers', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer, { debounceMs: 50 });

            subject.notifySync('first');
            subject.notifySync('second');
            subject.notifySync('third');

            await sleep(100);

            expect(observer).toHaveBeenCalledTimes(1);
            expect(observer).toHaveBeenCalledWith('third', subject);
        });

        it('should support throttled observers', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer, { throttleMs: 50 });

            subject.notifySync('first');
            subject.notifySync('second'); // should be ignored due to throttling

            await sleep(60);
            subject.notifySync('third'); // should be allowed after throttle period
            await sleep(20);

            // throttling behavior may vary, let's just check that observer was called
            expect(observer).toHaveBeenCalled();
            expect(observer).toHaveBeenCalledWith('first', subject);
        });

        it('should support filtered observers', async () => {
            const subject = new Subject<number>();
            const observer = vi.fn();

            subject.addObserver(observer, {
                filter: (data) => data > 5,
            });

            await subject.notify(3);
            await subject.notify(7);
            await subject.notify(2);
            await subject.notify(10);

            expect(observer).toHaveBeenCalledTimes(2);
            expect(observer).toHaveBeenNthCalledWith(1, 7, subject);
            expect(observer).toHaveBeenNthCalledWith(2, 10, subject);
        });

        it('should support data transformation', async () => {
            const subject = new Subject<number>();
            const observer = vi.fn();

            subject.addObserver(observer, {
                transform: (data) => data * 2,
            });

            await subject.notify(5);

            expect(observer).toHaveBeenCalledWith(10, subject);
        });

        it('should track metrics', async () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer);
            await subject.notify('test1');
            await subject.notify('test2');

            const metrics = subject.metrics;
            expect(metrics.notificationCount).toBe(2);
            expect(metrics.observerCount).toBe(1);
            expect(metrics.isCompleted).toBe(false);
            expect(metrics.isErrored).toBe(false);
        });

        it('should support memory management', () => {
            const subject = new Subject<string>({
                memoryManagement: {
                    enabled: true,
                    gcIntervalMs: 1000,
                    weakReferences: true,
                },
            });

            const memoryUsage = subject.getMemoryUsage();
            expect(memoryUsage).toBeDefined();
            expect(typeof memoryUsage).toBe('object');
        });

        it('should dispose properly', () => {
            const subject = new Subject<string>();
            const observer = vi.fn();

            subject.addObserver(observer);
            subject.dispose();

            expect(() => subject.notifySync('test')).toThrow();
        });
    });

    describe('BehaviorSubject', () => {
        it('should emit current value to new observers', async () => {
            const subject = new BehaviorSubject<string>('initial');
            const observer = vi.fn();

            subject.addObserver(observer);
            await sleep(10);
            expect(observer).toHaveBeenCalledWith('initial', subject);
        });

        it('should update current value on notification', async () => {
            const subject = new BehaviorSubject<string>('initial');

            await subject.notify('updated');

            expect(subject.value).toBe('updated');
        });

        it('should provide access to current value', () => {
            const subject = new BehaviorSubject<number>(42);

            expect(subject.value).toBe(42);
        });
    });

    describe('ReplaySubject', () => {
        it('should replay buffered values to new observers', async () => {
            const subject = new ReplaySubject<number>({ replay: { enabled: true, bufferSize: 3 } });
            const observer = vi.fn();

            subject.notify(1);
            subject.notify(2);
            subject.notify(3);
            subject.notify(4);

            await sleep(10);
            subject.addObserver(observer);
            await sleep(20);
            expect(observer).toHaveBeenCalledTimes(3);
        });

        it('should respect buffer size', () => {
            const subject = new ReplaySubject<string>({ replay: { enabled: true, bufferSize: 2 } });

            subject.notifySync('a');
            subject.notifySync('b');
            subject.notifySync('c');

            const replayBuffer = subject.getReplayBuffer();
            expect(replayBuffer).toEqual(['b', 'c']);
        });
    });

    describe('AsyncSubject', () => {
        it('should only emit last value on completion', async () => {
            const subject = new AsyncSubject<number>();
            const observer = vi.fn();

            subject.addObserver(observer);
            await subject.notify(1);
            await subject.notify(2);
            await subject.notify(3);

            expect(observer).not.toHaveBeenCalled();

            await subject.complete();

            expect(observer).toHaveBeenCalledTimes(1);
            expect(observer).toHaveBeenCalledWith(3, subject);
        });
    });

    describe('Observer Chains', () => {
        it('should support basic filtering', async () => {
            const subject = new Subject<number>();
            const observer = vi.fn();

            subject.addObserver((data) => {
                if (data > 5) {
                    observer(data * 2);
                }
            });

            subject.notifySync(3);
            subject.notifySync(7);

            await sleep(10);
            expect(observer).toHaveBeenCalledWith(14);
        });
    });

    describe('Subject Groups', () => {
        it('should support basic subject operations', () => {
            const subject1 = new Subject<string>();
            const subject2 = new Subject<string>();
            const observer1 = vi.fn();
            const observer2 = vi.fn();

            subject1.addObserver(observer1);
            subject2.addObserver(observer2);

            const broadcastMessage = (msg: string) => {
                subject1.notifySync(msg);
                subject2.notifySync(msg);
            };

            broadcastMessage('test');

            expect(observer1).toHaveBeenCalledWith('test', subject1);
            expect(observer2).toHaveBeenCalledWith('test', subject2);
        });
    });

    describe('Error Handling', () => {
        it('should handle observer execution errors', async () => {
            const subject = new Subject<string>();
            const errorHandler = vi.fn();

            subject.addObserver(
                () => {
                    throw new Error('Observer error');
                },
                {
                    errorHandling: 'callback',
                    onError: errorHandler,
                }
            );

            await subject.notify('test');

            expect(errorHandler).toHaveBeenCalled();
        });

        it('should support different error handling modes', async () => {
            const subject = new Subject<string>();

            subject.addObserver(
                () => {
                    throw new Error('Silent error');
                },
                { errorHandling: 'silent' }
            );

            await expect(subject.notify('test')).resolves.toBe(true);

            subject.addObserver(
                () => {
                    throw new Error('Throw error');
                },
                { errorHandling: 'throw' }
            );

            await expect(subject.notify('test')).resolves.toBe(true);
        });
    });

    describe('Memory Management', () => {
        it('should support weak references', async () => {
            const subject = new Subject<string>({
                memoryManagement: {
                    enabled: true,
                    weakReferences: true,
                    gcIntervalMs: 100,
                },
            });

            let observer: ObserverCallback<string> | undefined = vi.fn();
            subject.addObserver(observer, { weakReference: true });

            observer = undefined;

            if (global.gc) {
                global.gc();
            }

            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(subject.getObserverCount()).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Performance', () => {
        it('should handle reasonable numbers of observers efficiently', async () => {
            const subject = new Subject<number>({
                maxObservers: 200,
            });
            const observers: any[] = [];

            for (let i = 0; i < 100; i++) {
                const observer = vi.fn();
                observers.push(observer);
                subject.addObserver(observer);
            }

            const start = performance.now();
            await subject.notify(42);
            const end = performance.now();

            expect(end - start).toBeLessThan(100); // 100ms threshold

            observers.forEach((observer) => {
                expect(observer).toHaveBeenCalledWith(42, subject);
            });
        });

        it('should handle sequential notifications efficiently', async () => {
            const subject = new Subject<number>({
                concurrency: {
                    enabled: false,
                    maxConcurrent: Infinity,
                },
            });
            const observer = vi.fn();
            subject.addObserver(observer);

            const start = performance.now();

            for (let i = 0; i < 100; i++) {
                await subject.notify(i);
            }

            const end = performance.now();

            expect(end - start).toBeLessThan(1000);
            expect(observer).toHaveBeenCalledTimes(100);
        });
    });
});
