import { describe, expect, it } from 'vitest';
import { MemoryPool, MemoryPoolError, PoolableObject } from './../../../memory/pool/mempool';

describe('MemoryPool', () => {
    class TestObject implements PoolableObject {
        __poolId?: number;
        __poolStatus?: 'free' | 'allocated' | 'reserved';
        __lastAccessed?: number;
        __allocCount?: number;
        value: number;
        constructor(value = 0) {
            this.value = value;
        }
        reset() {
            this.value = 0;
        }
    }

    const createPool = (options = {}) =>
        new MemoryPool<TestObject>({
            factory: () => new TestObject(),
            ...options,
        });

    it('should allocate and release objects', () => {
        const pool = createPool({ initialCapacity: 2 });
        const obj1 = pool.acquire();
        const obj2 = pool.acquire();
        expect(obj1).not.toBe(obj2);
        expect(pool.getAllocatedCount()).toBe(2);
        pool.release(obj1);
        expect(pool.getAllocatedCount()).toBe(1);
        pool.release(obj2);
        expect(pool.getAllocatedCount()).toBe(0);
    });

    it('should reuse released objects', () => {
        const pool = createPool({ initialCapacity: 1 });
        const obj1 = pool.acquire();
        pool.release(obj1);
        const obj2 = pool.acquire();
        expect(obj1).toBe(obj2);
    });

    it('should throw when acquiring from disposed pool', () => {
        const pool = createPool();
        pool[Symbol.dispose]();
        expect(() => pool.acquire()).toThrow(MemoryPoolError);
    });

    it('should throw when releasing foreign object', () => {
        const pool = createPool();
        const foreign = new TestObject();
        expect(() => pool.release(foreign)).toThrow(MemoryPoolError);
    });

    it('should throw when releasing already released object', () => {
        const pool = createPool();
        const obj = pool.acquire();
        pool.release(obj);
        expect(() => pool.release(obj)).toThrow(MemoryPoolError);
    });

    it('should support tryAcquire and return null if depleted', () => {
        const pool = createPool({ initialCapacity: 1, maxCapacity: 1, autoExpand: false });
        const obj1 = pool.acquire();
        expect(pool.tryAcquire()).toBeNull();
        pool.release(obj1);
        expect(pool.tryAcquire()).not.toBeNull();
    });

    it('should clear only if all objects are released', () => {
        const pool = createPool({ initialCapacity: 2 });
        const obj1 = pool.acquire();
        pool.release(obj1);
        pool.clear();
        expect(pool.getAllocatedCount()).toBe(0);
        const obj2 = pool.acquire();
        expect(obj2).toBeDefined();
    });

    it('should throw if clear is called with allocated objects', () => {
        const pool = createPool({ initialCapacity: 1 });
        pool.acquire();
        expect(() => pool.clear()).toThrow(MemoryPoolError);
    });

    it('should resize pool and preserve allocated objects', () => {
        const pool = createPool({ initialCapacity: 2 });
        const obj1 = pool.acquire();
        pool.resize(4);
        expect(pool.getTotalCount()).toBe(4);
        expect(pool.isFromPool(obj1)).toBe(true);
        pool.resize(1);
        expect(pool.getTotalCount()).toBe(1);
        expect(pool.isFromPool(obj1)).toBe(true);
    });

    it('should provide metrics', () => {
        const pool = createPool({ initialCapacity: 1, enableMetrics: true });
        pool.acquire();
        pool.releaseAll();
        const metrics = pool.getMetrics();
        expect(metrics.capacity).toBe(1);
        expect(metrics.allocations).toBeGreaterThanOrEqual(1);
        expect(metrics.releases).toBeGreaterThanOrEqual(1);
    });

    it('should support async acquire/release', async () => {
        const pool = createPool({ initialCapacity: 1 });
        const obj = await pool.acquireAsync();
        await pool.releaseAsync(obj);
        expect(pool.getAllocatedCount()).toBe(0);
    });

    it('should support tryAcquireAsync with timeout', async () => {
        const pool = createPool({ initialCapacity: 1, maxCapacity: 1, autoExpand: false });
        pool.acquire();
        const result = await pool.tryAcquireAsync(50);
        expect(result).toBeNull();
    });

    it('should force compact and not throw', () => {
        const pool = createPool({ initialCapacity: 2 });
        expect(() => pool.forceCompact()).not.toThrow();
    });

    it('should drain and preserve allocated objects', () => {
        const pool = createPool({ initialCapacity: 3 });
        const obj1 = pool.acquire();
        const obj2 = pool.acquire();
        pool.release(obj2);
        pool.drain();
        expect(pool.isFromPool(obj1)).toBe(true);
        expect(pool.getAllocatedCount()).toBe(1);
    });
    it('should call validator and reject invalid objects', () => {
        let called = false;
        const pool = createPool({
            initialCapacity: 1,
            validator: (obj: TestObject) => {
                called = true;
                return false;
            },
        });
        expect(() => pool.acquire()).toThrow(MemoryPoolError);
        expect(called).toBe(true);
    });

    it('should call onAcquire and onRelease callbacks', () => {
        let acquired = false;
        let released = false;
        const pool = createPool({
            initialCapacity: 1,
            onAcquire: () => {
                acquired = true;
            },
            onRelease: () => {
                released = true;
            },
        });
        const obj = pool.acquire();
        expect(acquired).toBe(true);
        pool.release(obj);
        expect(released).toBe(true);
    });

    it('should handle factory errors gracefully', () => {
        const pool = createPool({
            initialCapacity: 1,
            factory: () => {
                throw new Error('factory fail');
            },
        });
        expect(() => pool.acquire()).toThrow();
    });

    it('should evict objects with LRU policy', () => {
        const pool = createPool({
            initialCapacity: 2,
            maxCapacity: 2,
            evictionPolicy: 'lru',
        });
        const obj1 = pool.acquire();
        pool.release(obj1);
        const obj2 = pool.acquire();
        pool.release(obj2);
        // Both slots are now free, fill up pool
        pool.acquire();
        pool.acquire();
        // Next acquire should evict LRU
        expect(() => pool.acquire()).not.toThrow();
    });

    it('should not leak memory on rapid acquire/release cycles', () => {
        const pool = createPool({ initialCapacity: 10, maxCapacity: 100 });
        for (let i = 0; i < 1000; ++i) {
            const obj = pool.acquire();
            pool.release(obj);
        }
        expect(pool.getAllocatedCount()).toBe(0);
        expect(pool.getTotalCount()).toBeLessThanOrEqual(100);
    });

    it('should support asyncFactory and preallocate', async () => {
        let created = 0;
        const pool = new MemoryPool<TestObject>({
            initialCapacity: 2,
            preallocate: true,
            asyncFactory: async () => {
                created++;
                return new TestObject();
            },
            factory: () => new TestObject(),
        });
        // Wait for preallocation
        await new Promise((r) => setTimeout(r, 50));
        expect(created).toBeGreaterThanOrEqual(2);
    });

    it('should respect TTL eviction policy', async () => {
        const pool = createPool({
            initialCapacity: 1,
            evictionPolicy: 'ttl',
            ttl: 10,
        });
        const obj = pool.acquire();
        pool.release(obj);
        await new Promise((r) => setTimeout(r, 20));
        expect(() => pool.acquire()).not.toThrow();
    });

    it('should not allow operations after dispose', () => {
        const pool = createPool({ initialCapacity: 1 });
        pool[Symbol.dispose]();
        expect(() => pool.acquire()).toThrow();
        expect(() => pool.releaseAll()).not.toThrow();
        expect(() => pool.drain()).not.toThrow();
    });

    it('should update metrics correctly after many operations', () => {
        const pool = createPool({ initialCapacity: 2, enableMetrics: true });
        for (let i = 0; i < 100; ++i) {
            const obj = pool.acquire();
            pool.release(obj);
        }
        const metrics = pool.getMetrics();
        expect(metrics.allocations).toBeGreaterThan(50);
        expect(metrics.releases).toBeGreaterThan(50);
        expect(metrics.highWaterMark).toBeLessThanOrEqual(2);
    });

    it('should handle concurrent async acquires and releases', async () => {
        const pool = createPool({ initialCapacity: 2 });
        const results: TestObject[] = [];
        const acquires = [pool.acquireAsync(), pool.acquireAsync()];
        results.push(await acquires[0]);
        results.push(await acquires[1]);
        expect(pool.getAllocatedCount()).toBe(2);
        await Promise.all(results.map((obj) => pool.releaseAsync(obj)));
        expect(pool.getAllocatedCount()).toBe(0);
    });

    it('should not call reset if resetOnRecycle is false', () => {
        let resetCalled = false;
        class NoResetObject extends TestObject {
            reset() {
                resetCalled = true;
            }
        }
        const pool = new MemoryPool<NoResetObject>({
            factory: () => new NoResetObject(),
            initialCapacity: 1,
            resetOnRecycle: false,
        });
        const obj = pool.acquire();
        pool.release(obj);
        expect(resetCalled).toBe(false);
    });
});
