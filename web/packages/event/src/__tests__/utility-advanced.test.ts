import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHooks, EventUtils, type EventMap } from '@axrone/event';

interface TestEvents extends EventMap {
    'test:event': { value: number };
    'test:other': { message: string };
}

describe('utility - Advanced Coverage', () => {
    describe('createHooks().off()', () => {
        it('should remove a specific listener by callback', async () => {
            const hooks = createHooks<TestEvents>();
            let count = 0;
            const cb = () => {
                count++;
            };

            hooks.on('test:event', cb);
            await hooks.emit('test:event', { value: 1 });
            expect(count).toBe(1);

            const removed = hooks.off('test:event', cb);
            expect(removed).toBe(true);

            await hooks.emit('test:event', { value: 2 });
            expect(count).toBe(1);

            hooks.useEmitter().dispose();
        });

        it('should return false when removing non-existent callback', () => {
            const hooks = createHooks<TestEvents>();
            const cb = () => {};

            const removed = hooks.off('test:event', cb);
            expect(removed).toBe(false);

            hooks.useEmitter().dispose();
        });

        it('should remove all listeners for event when no callback provided', async () => {
            const hooks = createHooks<TestEvents>();
            let count = 0;

            hooks.on('test:event', () => {
                count++;
            });
            hooks.on('test:event', () => {
                count++;
            });

            await hooks.emit('test:event', { value: 1 });
            expect(count).toBe(2);

            hooks.off('test:event');

            await hooks.emit('test:event', { value: 2 });
            expect(count).toBe(2);

            hooks.useEmitter().dispose();
        });
    });

    describe('EventUtils.toAsync()', () => {
        it('should convert a sync function to async', async () => {
            const syncFn = (data: { value: number }) => data.value * 2;
            const asyncFn = EventUtils.toAsync(syncFn);

            const result = asyncFn({ value: 5 });
            expect(result).toBeInstanceOf(Promise);
            expect(await result).toBe(10);
        });

        it('should preserve the return value', async () => {
            const syncFn = (data: { value: number }) => ({ doubled: data.value * 2 });
            const asyncFn = EventUtils.toAsync(syncFn);

            const result = await asyncFn({ value: 7 });
            expect(result).toEqual({ doubled: 14 });
        });

        it('should propagate errors as promise rejections', async () => {
            const syncFn = () => {
                throw new Error('sync error');
            };
            const asyncFn = EventUtils.toAsync(syncFn);

            let caught = false;
            try {
                await asyncFn({});
            } catch (err: any) {
                caught = true;
                expect(err).toBeInstanceOf(Error);
                expect(err.message).toBe('sync error');
            }
            expect(caught).toBe(true);
        });
    });

    describe('EventUtils.createKey()', () => {
        it('should return the name as-is', () => {
            const key = EventUtils.createKey('test:event');
            expect(key).toBe('test:event');
        });

        it('should work with any string name', () => {
            const key = EventUtils.createKey<{ value: number }>('custom:event');
            expect(key).toBe('custom:event');
        });
    });

    describe('EventUtils.debounce() edge cases', () => {
        it('should handle wait=0 by executing on next tick', async () => {
            let callCount = 0;
            const debounced = EventUtils.debounce(() => {
                callCount++;
            }, 0);

            debounced({});
            expect(callCount).toBe(0);

            // With wait=0, setTimeout fires on next tick
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(callCount).toBe(1);
        });

        it('should use last data when called multiple times', async () => {
            let received: any = null;
            const debounced = EventUtils.debounce((data: { value: number }) => {
                received = data;
            }, 50);

            debounced({ value: 1 });
            debounced({ value: 2 });
            debounced({ value: 3 });

            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(received).toEqual({ value: 3 });
        });

        it('should handle negative wait as 0', async () => {
            let callCount = 0;
            const debounced = EventUtils.debounce(() => {
                callCount++;
            }, -100);

            debounced({});

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(callCount).toBe(1);
        });
    });

    describe('EventUtils.throttle() edge cases', () => {
        it('should allow all calls when limit=0', () => {
            let callCount = 0;
            const throttled = EventUtils.throttle(() => {
                callCount++;
            }, 0);

            throttled({});
            throttled({});
            throttled({});

            expect(callCount).toBe(3);
        });

        it('should handle negative limit as 0 (no throttling)', () => {
            let callCount = 0;
            const throttled = EventUtils.throttle(() => {
                callCount++;
            }, -100);

            throttled({});
            throttled({});
            throttled({});

            expect(callCount).toBe(3);
        });
    });

    describe('EventUtils.rateLimit() edge cases', () => {
        it('should block all calls when maxCalls=0', () => {
            let callCount = 0;
            const rateLimited = EventUtils.rateLimit(
                () => {
                    callCount++;
                },
                0,
                1000
            );

            rateLimited({});
            rateLimited({});
            rateLimited({});

            expect(callCount).toBe(0);
        });

        it('should allow calls after sliding window expires', async () => {
            let callCount = 0;
            const rateLimited = EventUtils.rateLimit(
                () => {
                    callCount++;
                },
                2,
                50
            );

            rateLimited({});
            rateLimited({});
            expect(callCount).toBe(2);

            // Wait for window to expire
            await new Promise((resolve) => setTimeout(resolve, 70));

            rateLimited({});
            expect(callCount).toBe(3);
        });
    });

    describe('EventUtils.catchErrors() async path', () => {
        it('should catch async errors (Promise rejections)', async () => {
            let caughtError: unknown = null;
            const caught = EventUtils.catchErrors(
                async () => {
                    throw new Error('async error');
                },
                (error) => {
                    caughtError = error;
                }
            );

            await caught({});
            expect(caughtError).toBeInstanceOf(Error);
            expect((caughtError as Error).message).toBe('async error');
        });

        it('should pass data to error handler on sync error', () => {
            let receivedData: any = null;
            const caught = EventUtils.catchErrors(
                () => {
                    throw new Error('sync fail');
                },
                (_error, data) => {
                    receivedData = data;
                }
            );

            caught({ value: 42 });
            expect(receivedData).toEqual({ value: 42 });
        });

        it('should pass data to error handler on async error', async () => {
            let receivedData: any = null;
            const caught = EventUtils.catchErrors(
                async () => {
                    throw new Error('async fail');
                },
                (_error, data) => {
                    receivedData = data;
                }
            );

            await caught({ value: 99 });
            expect(receivedData).toEqual({ value: 99 });
        });

        it('should not interfere with successful async execution', async () => {
            let result: number | undefined;
            const caught = EventUtils.catchErrors(
                async (data: { value: number }) => {
                    result = data.value;
                },
                () => {}
            );

            await caught({ value: 7 });
            expect(result).toBe(7);
        });
    });

    describe('EventUtils.compose() edge cases', () => {
        it('should return a no-op function for empty array', async () => {
            const composed = EventUtils.compose();

            // Should not throw
            await composed({});
        });

        it('should return the identity callback for single callback', async () => {
            let called = false;
            const single = () => {
                called = true;
            };
            const composed = EventUtils.compose(single);

            await composed({});
            expect(called).toBe(true);
        });

        it('should execute callbacks in order for two callbacks', async () => {
            const order: number[] = [];
            const composed = EventUtils.compose(
                () => {
                    order.push(1);
                },
                () => {
                    order.push(2);
                }
            );

            await composed({});
            expect(order).toEqual([1, 2]);
        });
    });
});
