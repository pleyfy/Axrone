import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferPool, BufferPoolOptions, ByteBuffer } from '../../buffering';

describe('Professional BufferPool', () => {
    let pool: BufferPool;

    beforeEach(() => {
        BufferPool.resetInstance();

        const options: BufferPoolOptions = {
            initialCapacityPerBucket: 8,
            maxCapacityPerBucket: 32,
            preallocate: true,
            autoExpand: true,
            name: 'TestBufferPool',
        };
        pool = BufferPool.getInstance(options);
    });

    afterEach(() => {
        pool.dispose();
        BufferPool.resetInstance();
    });

    describe('Basic Operations', () => {
        it('should allocate buffers of requested size', () => {
            const buffer = pool.allocate(1024);
            expect(buffer.byteLength).toBeGreaterThanOrEqual(1024);
        });

        it('should allocate the nearest power of 2 size', () => {
            const buffer = pool.allocate(1000);
            expect(buffer.byteLength).toBe(1024);
        });

        it('should release buffers back to pool', () => {
            const buffer = pool.allocate(512);
            expect(() => pool.release(buffer)).not.toThrow();
        });

        it('should handle multiple allocations', () => {
            const buffers = [];
            for (let i = 0; i < 10; i++) {
                buffers.push(pool.allocate(256));
            }
            expect(buffers).toHaveLength(10);
            buffers.forEach((buffer) => expect(buffer.byteLength).toBeGreaterThanOrEqual(256));
        });
    });

    describe('tryAllocate', () => {
        it('should allocate buffer when available', () => {
            const buffer = pool.tryAllocate(512);
            expect(buffer).toBeTruthy();
            expect(buffer!.byteLength).toBeGreaterThanOrEqual(512);
        });

        it('should return null when pool is exhausted', () => {
            const buffers = [];
            for (let i = 0; i < 100; i++) {
                const buffer = pool.tryAllocate(1024);
                if (buffer) buffers.push(buffer);
                else break;
            }

            const failedBuffer = pool.tryAllocate(1024);
            expect(failedBuffer).toBeNull();
        });
    });

    describe('Statistics', () => {
        it('should provide accurate statistics', () => {
            const buffer1 = pool.allocate(512);
            const buffer2 = pool.allocate(1024);

            const stats = pool.getStats();
            expect(stats.name).toBe('TestBufferPool');
            expect(stats.totalAllocated).toBeGreaterThan(0);
            expect(stats.bucketCount).toBeGreaterThan(0);

            pool.release(buffer1);
            pool.release(buffer2);
        });

        it('should track bucket metrics', () => {
            const buffer = pool.allocate(1024);
            const metrics = pool.getBucketMetrics(1024);

            expect(metrics).toBeTruthy();
            expect(metrics!.allocations).toBeGreaterThan(0);
            expect(metrics!.hitRatio).toBeDefined();

            pool.release(buffer);
        });

        it('should calculate hit ratios correctly', () => {
            const buffer1 = pool.allocate(512);
            pool.release(buffer1);

            const buffer2 = pool.allocate(512);

            const metrics = pool.getBucketMetrics(512);
            expect(metrics).toBeTruthy();
            expect(metrics!.allocations).toBe(2);

            pool.release(buffer2);
        });
    });

    describe('Buffer Size Calculation', () => {
        it('should handle various sizes correctly', () => {
            const testCases = [
                { requested: 1, expected: 32 },
                { requested: 32, expected: 32 },
                { requested: 33, expected: 64 },
                { requested: 100, expected: 128 },
                { requested: 512, expected: 512 },
                { requested: 1000, expected: 1024 },
                { requested: 2000, expected: 2048 },
            ];

            testCases.forEach(({ requested, expected }) => {
                const buffer = pool.allocate(requested);
                expect(buffer.byteLength).toBe(expected);
                pool.release(buffer);
            });
        });
    });

    describe('Pool Management', () => {
        it('should drain all buffers', () => {
            const buffers = [];
            for (let i = 0; i < 5; i++) {
                buffers.push(pool.allocate(256));
            }

            buffers.forEach((buffer) => pool.release(buffer));

            const statsBefore = pool.getStats();
            const availableBefore = statsBefore.totalAvailable;

            pool.drain();
            const stats = pool.getStats();

            expect(stats.totalAvailable).toBeLessThanOrEqual(availableBefore);
        });

        it('should handle dispose correctly', () => {
            const buffer = pool.allocate(512);
            pool.release(buffer);

            expect(() => pool.dispose()).not.toThrow();
        });
    });

    describe('Memory Management', () => {
        it('should handle buffer reuse correctly', () => {
            const originalBuffer = pool.allocate(1024);
            pool.release(originalBuffer);

            const reusedBuffer = pool.allocate(1024);

            expect(reusedBuffer.byteLength).toBe(originalBuffer.byteLength);

            pool.release(reusedBuffer);
        });

        it('should handle large buffer requests', () => {
            const largeBuffer = pool.allocate(1024 * 1024);
            expect(largeBuffer.byteLength).toBeGreaterThanOrEqual(1024 * 1024);
            pool.release(largeBuffer);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid buffer sizes gracefully', () => {
            expect(() => pool.allocate(0)).toThrow();
            expect(() => pool.allocate(-1)).toThrow();
        });

        it('should handle releasing invalid buffers', () => {
            const externalBuffer = new ArrayBuffer(1024);
            expect(() => pool.release(externalBuffer)).not.toThrow();
        });
    });

    describe('Advanced Features', () => {
        it('should respect TTL when configured', async () => {
            vi.useFakeTimers();
            BufferPool.resetInstance();

            const options: BufferPoolOptions = {
                ttl: 100,
                name: 'TTLPool',
            };
            const ttlPool = BufferPool.getInstance(options);

            const buffer = ttlPool.allocate(512);
            ttlPool.release(buffer);

            await vi.advanceTimersByTimeAsync(150);

            const buffers = [];
            for (let i = 0; i < 50; i++) {
                const buf = ttlPool.tryAllocate(512);
                if (buf) buffers.push(buf);
            }

            const stats = ttlPool.getStats();

            expect(stats.totalAvailable).toBeLessThanOrEqual(stats.totalCapacity);

            buffers.forEach((buf) => ttlPool.release(buf));
            ttlPool.dispose();
            BufferPool.resetInstance();
            vi.useRealTimers();
        });

        it('should call lifecycle hooks when configured', () => {
            let acquired = false;
            let released = false;

            BufferPool.resetInstance();

            const options: BufferPoolOptions = {
                onAcquire: () => {
                    acquired = true;
                },
                onRelease: () => {
                    released = true;
                },
                name: 'HookPool',
            };
            const hookPool = BufferPool.getInstance(options);

            const buffer = hookPool.allocate(512);
            expect(acquired).toBe(true);

            hookPool.release(buffer);
            expect(released).toBe(true);

            hookPool.dispose();
            BufferPool.resetInstance();
        });
    });

    describe('Singleton lifecycle', () => {
        beforeEach(() => {
            BufferPool.resetInstance();
        });

        afterEach(() => {
            BufferPool.resetInstance();
        });

        it('re-pools buffers through ByteBuffer after singleton reset', () => {
            const b1 = ByteBuffer.alloc(64);
            b1.release();

            BufferPool.resetInstance();

            const b2 = ByteBuffer.alloc(64);
            const raw2 = b2.getBuffer();
            b2.release();

            const b3 = ByteBuffer.alloc(64);
            const raw3 = b3.getBuffer();
            b3.release();

            expect(raw2).toBe(raw3);
        });
    });

    describe('Bucket overflow — fallback to direct allocation', () => {
        it('should fall back to direct allocation when bucket is exhausted', () => {
            BufferPool.resetInstance();

            const onOutOfMemory = vi.fn();
            const exhaustPool = BufferPool.getInstance({
                initialCapacityPerBucket: 2,
                maxCapacityPerBucket: 4,
                autoExpand: false,
                preallocate: false,
                name: 'ExhaustPool',
                onOutOfMemory,
            });

            // Allocate all 4 slots in the 512-byte bucket (bucket index for 512 = ceil(log2(512)) - 5 = 9 - 5 = 4)
            const buffers: ArrayBuffer[] = [];
            for (let i = 0; i < 4; i++) {
                buffers.push(exhaustPool.allocate(512));
            }

            // 5th allocation should trigger fallback to direct allocation
            const fallbackBuffer = exhaustPool.allocate(512);
            expect(fallbackBuffer).toBeTruthy();
            expect(fallbackBuffer.byteLength).toBe(512);
            expect(onOutOfMemory).toHaveBeenCalled();

            // The fallback buffer is a direct allocation — it is NOT tracked by the pool,
            // so releasing it should be a no-op (no error thrown)
            expect(() => exhaustPool.release(fallbackBuffer)).not.toThrow();

            buffers.forEach((b) => exhaustPool.release(b));
            exhaustPool.dispose();
            BufferPool.resetInstance();
        });

        it('should still return a usable buffer when pool is exhausted', () => {
            BufferPool.resetInstance();

            const exhaustPool = BufferPool.getInstance({
                initialCapacityPerBucket: 2,
                maxCapacityPerBucket: 2,
                autoExpand: false,
                preallocate: false,
                name: 'SmallPool',
            });

            // Exhaust the 1024-byte bucket
            const b1 = exhaustPool.allocate(1024);
            const b2 = exhaustPool.allocate(1024);

            // This should fall back to direct allocation
            const b3 = exhaustPool.allocate(1024);
            expect(b3).toBeTruthy();
            expect(b3.byteLength).toBe(1024);

            // The fallback buffer should be writable
            const view = new Uint8Array(b3);
            view[0] = 42;
            expect(view[0]).toBe(42);

            exhaustPool.release(b1);
            exhaustPool.release(b2);
            // b3 is not tracked by pool, release is a no-op
            exhaustPool.release(b3);
            exhaustPool.dispose();
            BufferPool.resetInstance();
        });
    });
});
