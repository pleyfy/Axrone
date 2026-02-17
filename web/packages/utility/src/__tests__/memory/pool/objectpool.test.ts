import { ObjectPool, ObjectPoolOptions, PoolableWrapper } from '../../../memory/pool/object-pool';
import { MemoryPoolErrorCode } from '../../../memory/pool/mempool';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ObjectPool', () => {
    class TestUser {
        public id: number = 0;
        public name: string = '';
        public email: string = '';
        public active: boolean = true;
        public metadata: Map<string, unknown> = new Map();

        constructor(id = 0, name = '', email = '') {
            this.id = id;
            this.name = name;
            this.email = email;
        }

        public reset(): void {
            this.id = 0;
            this.name = '';
            this.email = '';
            this.active = true;
            this.metadata.clear();
        }

        public setUserData(id: number, name: string, email: string): void {
            this.id = id;
            this.name = name;
            this.email = email;
        }
    }

    class ComplexObject {
        public data: number[] = [];
        public nested: { value: string } = { value: '' };
        public set: Set<string> = new Set();

        public reset(): void {
            this.data.length = 0;
            this.nested.value = '';
            this.set.clear();
        }
    }

    const createBasicPool = <T extends {}>(
        factory: () => T,
        options: Partial<ObjectPoolOptions<T>> = {}
    ): ObjectPool<T> => {
        return new ObjectPool<T>({
            factory,
            initialCapacity: 4,
            maxCapacity: 16,
            preallocate: true,
            ...options,
        });
    };

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Basic Operations', () => {
        it('should create and acquire objects from pool', () => {
            const pool = createBasicPool(() => new TestUser());

            const user1 = pool.acquire();
            const user2 = pool.acquire();

            expect(user1).toBeInstanceOf(TestUser);
            expect(user2).toBeInstanceOf(TestUser);
            expect(user1).not.toBe(user2);
            expect(pool.getAllocatedCount()).toBe(2);
        });

        it('should efficiently manage object lifecycle', () => {
            let factoryCallCount = 0;
            const pool = createBasicPool(() => {
                factoryCallCount++;
                return new TestUser();
            });

            const user1 = pool.acquire();
            user1.setUserData(123, 'John', 'john@example.com');

            pool.release(user1);
            expect(pool.getAllocatedCount()).toBe(0);
            expect(pool.getAvailableCount()).toBeGreaterThan(0);

            const user2 = pool.acquire();

            expect(user2.id).toBe(0);
            expect(user2.name).toBe('');
            expect(user2.email).toBe('');

            expect(factoryCallCount).toBeLessThanOrEqual(pool.getTotalCount());
        });

        it('should handle tryAcquire correctly when pool is depleted', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 1,
                maxCapacity: 1,
                autoExpand: false,
            });

            const user1 = pool.tryAcquire();
            expect(user1).toBeInstanceOf(TestUser);

            const user2 = pool.tryAcquire();
            expect(user2).toBeNull();

            pool.release(user1!);
            const user3 = pool.tryAcquire();
            expect(user3).toBe(user1);
        });

        it('should provide correct pool statistics', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 3,
            });

            expect(pool.getTotalCount()).toBe(3);
            expect(pool.getAllocatedCount()).toBe(0);
            expect(pool.getAvailableCount()).toBe(3);

            const user1 = pool.acquire();
            const user2 = pool.acquire();

            expect(pool.getAllocatedCount()).toBe(2);
            expect(pool.getAvailableCount()).toBe(1);

            pool.release(user1);
            expect(pool.getAllocatedCount()).toBe(1);
            expect(pool.getAvailableCount()).toBe(2);
        });
    });

    describe('State Management', () => {
        it('should track pool state correctly', () => {
            const pool = createBasicPool(() => new TestUser());

            expect(pool.state).toBe('active');

            pool[Symbol.dispose]();
            expect(pool.state).toBe('disposed');
        });

        it('should prevent operations on disposed pool', () => {
            const pool = createBasicPool(() => new TestUser());
            const user = pool.acquire();

            pool[Symbol.dispose]();

            expect(() => pool.acquire()).toThrow('Pool is disposed');
            expect(() => pool.clear()).toThrow('Pool is disposed');
            expect(() => pool.resize(10)).toThrow('Pool is disposed');

            expect(() => pool.release(user)).not.toThrow();
        });

        it('should handle draining state correctly', () => {
            const pool = createBasicPool(() => new TestUser());
            const user1 = pool.acquire();
            const user2 = pool.acquire();

            pool.release(user2);

            expect(() => pool.drain()).not.toThrow();
            expect(pool.state).toBe('active');

            expect(pool.isFromPool(user1)).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should throw error when releasing non-pool object', () => {
            const pool = createBasicPool(() => new TestUser());
            const externalUser = new TestUser();

            expect(() => pool.release(externalUser)).toThrow('Object not acquired from this pool');
        });

        it('should throw error when releasing object twice', () => {
            const pool = createBasicPool(() => new TestUser());
            const user = pool.acquire();

            pool.release(user);
            expect(() => pool.release(user)).toThrow('Object not acquired from this pool');
        });

        it('should handle factory errors gracefully', () => {
            let shouldFail = true;
            const pool = createBasicPool(
                () => {
                    if (shouldFail) {
                        throw new Error('Factory intentionally failed');
                    }
                    return new TestUser();
                },
                {
                    preallocate: false,
                }
            );

            shouldFail = false;
            expect(() => pool.acquire()).not.toThrow();
        });

        it('should handle validation errors', () => {
            const pool = createBasicPool(() => new TestUser(), {
                validateHandler: (user) => user.id > 0,
            });

            expect(() => pool.acquire()).toThrow();
        });

        it('should handle reset handler errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const pool = createBasicPool(() => new TestUser(), {
                resetHandler: () => {
                    throw new Error('Reset failed');
                },
            });

            const user = pool.acquire();
            expect(() => pool.release(user)).not.toThrow();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });

    describe('Custom Handlers', () => {
        it('should call custom reset handler', () => {
            const resetSpy = vi.fn();
            const pool = createBasicPool(() => new TestUser(), {
                resetHandler: resetSpy,
            });

            const user = pool.acquire();
            user.setUserData(123, 'John', 'john@example.com');

            pool.release(user);

            expect(resetSpy).toHaveBeenCalledWith(user);
        });

        it('should call validation handler', () => {
            const validateSpy = vi.fn().mockReturnValue(true);
            const pool = createBasicPool(() => new TestUser(), {
                validateHandler: validateSpy,
            });

            const user = pool.acquire();

            expect(validateSpy).toHaveBeenCalledWith(user);
        });

        it('should call acquire/release handlers', () => {
            const acquireSpy = vi.fn();
            const releaseSpy = vi.fn();

            const pool = createBasicPool(() => new TestUser(), {
                onAcquireHandler: acquireSpy,
                onReleaseHandler: releaseSpy,
            });

            const user = pool.acquire();
            expect(acquireSpy).toHaveBeenCalledWith(user);

            pool.release(user);
            expect(releaseSpy).toHaveBeenCalledWith(user);
        });

        it('should call evict handler when objects are evicted', () => {
            const evictSpy = vi.fn();

            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 2,
                maxCapacity: 2,
                evictionPolicy: 'lru',
                onEvictHandler: evictSpy,
            });

            const user1 = pool.acquire();
            pool.release(user1);
            const user2 = pool.acquire();
            pool.release(user2);

            pool.acquire();
            pool.acquire();

            const user3 = pool.acquire();

            expect(evictSpy).toHaveBeenCalled();
        });
    });

    describe('Complex Object Types', () => {
        it('should handle complex objects with nested structures', () => {
            const pool = createBasicPool(() => new ComplexObject());

            const obj = pool.acquire();
            obj.data.push(1, 2, 3);
            obj.nested.value = 'test';
            obj.set.add('item1');
            obj.set.add('item2');

            pool.release(obj);

            const obj2 = pool.acquire();

            expect(obj2.data).toHaveLength(0);
            expect(obj2.nested.value).toBe('');
            expect(obj2.set.size).toBe(0);
        });

        it('should work with primitive wrapper objects', () => {
            class NumberWrapper {
                constructor(public value: number = 0) {}
                reset() {
                    this.value = 0;
                }
            }

            const pool = createBasicPool(() => new NumberWrapper(42));

            const wrapper = pool.acquire();
            expect(wrapper.value).toBe(42);

            wrapper.value = 100;
            pool.release(wrapper);

            const wrapper2 = pool.acquire();

            expect(wrapper2.value).toBe(42);
        });
    });

    describe('Async Operations', () => {
        it('should handle async acquire and release', async () => {
            const pool = createBasicPool(() => new TestUser());

            const user = await pool.acquireAsync();
            expect(user).toBeInstanceOf(TestUser);

            await pool.releaseAsync(user);
            expect(pool.getAllocatedCount()).toBe(0);
        });

        it('should handle tryAcquireAsync with timeout', async () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 1,
                maxCapacity: 1,
                autoExpand: false,
            });

            pool.acquire();

            const startTime = Date.now();
            const result = await pool.tryAcquireAsync(100);
            const elapsed = Date.now() - startTime;

            expect(result).toBeNull();
            expect(elapsed).toBeGreaterThanOrEqual(90);
        });

        it('should handle async factory', async () => {
            let asyncCreationCount = 0;

            const pool = new ObjectPool<TestUser>({
                factory: () => new TestUser(),
                asyncFactory: async () => {
                    asyncCreationCount++;
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    return new TestUser();
                },
                initialCapacity: 2,
                preallocate: true,
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(asyncCreationCount).toBeGreaterThan(0);
        });

        it('should handle concurrent async operations', async () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 3,
            });

            const acquirePromises = [pool.acquireAsync(), pool.acquireAsync(), pool.acquireAsync()];

            const users = await Promise.all(acquirePromises);

            expect(users).toHaveLength(3);
            expect(new Set(users).size).toBe(3);

            const releasePromises = users.map((user) => pool.releaseAsync(user));
            await Promise.all(releasePromises);

            expect(pool.getAllocatedCount()).toBe(0);
        });
    });

    describe('Pool Management Operations', () => {
        it('should clear pool when no objects are allocated', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 3,
            });

            const user = pool.acquire();
            pool.release(user);

            expect(() => pool.clear()).not.toThrow();

            expect(pool.getAllocatedCount()).toBe(0);
        });

        it('should throw when clearing pool with allocated objects', () => {
            const pool = createBasicPool(() => new TestUser());

            pool.acquire();

            expect(() => pool.clear()).toThrow();
        });

        it('should resize pool correctly', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 2,
            });

            expect(pool.getTotalCount()).toBe(2);

            pool.resize(5);
            expect(pool.getTotalCount()).toBe(5);

            pool.resize(1);
            expect(pool.getTotalCount()).toBe(1);
        });

        it('should force compact pool', () => {
            const pool = createBasicPool(() => new TestUser());

            expect(() => pool.forceCompact()).not.toThrow();
        });

        it('should handle drain operation preserving allocated objects', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 4,
            });

            const user1 = pool.acquire();
            const user2 = pool.acquire();
            pool.release(user2);

            const initialTotal = pool.getTotalCount();
            pool.drain();

            expect(pool.isFromPool(user1)).toBe(true);
            expect(pool.getAllocatedCount()).toBe(1);
            expect(pool.getTotalCount()).toBeLessThanOrEqual(initialTotal);
        });

        it('should handle async drain operation', async () => {
            const pool = createBasicPool(() => new TestUser());

            const user = pool.acquire();
            await expect(pool.drainAsync()).resolves.not.toThrow();
            expect(pool.isFromPool(user)).toBe(true);
        });
    });

    describe('Metrics and Monitoring', () => {
        it('should provide accurate metrics', () => {
            const pool = createBasicPool(() => new TestUser(), {
                enableMetrics: true,
            });

            const user1 = pool.acquire();
            const user2 = pool.acquire();
            pool.release(user1);
            pool.release(user2);

            const metrics = pool.getMetrics();

            expect(metrics.allocations).toBeGreaterThanOrEqual(2);
            expect(metrics.releases).toBeGreaterThanOrEqual(2);
            expect(metrics.capacity).toBeGreaterThan(0);
        });

        it('should track pool name correctly', () => {
            const poolName = 'TestUserPool';
            const pool = createBasicPool(() => new TestUser(), {
                name: poolName,
            });

            expect(pool.name).toBe(poolName);
        });
    });

    describe('Memory and Performance', () => {
        it('should not leak memory during intensive usage', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 10,
                maxCapacity: 50,
            });

            for (let i = 0; i < 1000; i++) {
                const user = pool.acquire();
                user.setUserData(i, `User${i}`, `user${i}@example.com`);
                pool.release(user);
            }

            expect(pool.getAllocatedCount()).toBe(0);
            expect(pool.getTotalCount()).toBeLessThanOrEqual(50);
        });

        it('should handle rapid acquire/release cycles efficiently', () => {
            const pool = createBasicPool(() => new TestUser());

            const startTime = performance.now();

            for (let i = 0; i < 10000; i++) {
                const user = pool.acquire();
                pool.release(user);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(1000);
            expect(pool.getAllocatedCount()).toBe(0);
        });

        it('should maintain performance with different eviction policies', () => {
            const evictionPolicies = ['lru', 'ttl', 'fifo'] as const;

            evictionPolicies.forEach((policy) => {
                const pool = createBasicPool(() => new TestUser(), {
                    initialCapacity: 5,
                    maxCapacity: 10,
                    evictionPolicy: policy,
                    ttl: policy === 'ttl' ? 100 : 0,
                });

                const users: TestUser[] = [];
                for (let i = 0; i < 15; i++) {
                    try {
                        const user = pool.acquire();
                        users.push(user);
                    } catch {
                        break;
                    }
                }

                users.slice(0, 5).forEach((user) => pool.release(user));

                expect(pool.getAllocatedCount()).toBeLessThanOrEqual(10);
            });
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        it('should handle minimal initial capacity', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 1,
                autoExpand: true,
            });

            expect(pool.getTotalCount()).toBe(1);
            const user = pool.acquire();
            expect(user).toBeInstanceOf(TestUser);

            const user2 = pool.acquire();
            expect(user2).toBeInstanceOf(TestUser);
            expect(pool.getTotalCount()).toBeGreaterThan(1);
        });

        it('should handle single object pool', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 1,
                maxCapacity: 1,
                autoExpand: false,
            });

            const user1 = pool.acquire();
            expect(pool.tryAcquire()).toBeNull();

            pool.release(user1);
            const user2 = pool.acquire();
            expect(user2).toBe(user1);
        });

        it('should handle large pool sizes', () => {
            const pool = createBasicPool(() => new TestUser(), {
                initialCapacity: 1000,
                maxCapacity: 5000,
            });

            expect(pool.getTotalCount()).toBe(1000);

            const users: TestUser[] = [];
            for (let i = 0; i < 500; i++) {
                users.push(pool.acquire());
            }

            expect(pool.getAllocatedCount()).toBe(500);
            expect(pool.getAvailableCount()).toBe(500);

            users.forEach((user) => pool.release(user));
            expect(pool.getAllocatedCount()).toBe(0);
        });

        it('should handle objects with no reset method', () => {
            class NoResetObject {
                public value: number = 42;
            }

            const pool = createBasicPool(() => new NoResetObject());

            const obj = pool.acquire();
            obj.value = 100;

            expect(() => pool.release(obj)).not.toThrow();

            const obj2 = pool.acquire();

            expect(obj2.value).toBe(42);
        });

        it('should handle custom reset logic that modifies object state', () => {
            class StatefulObject {
                public counter: number = 0;
                public history: number[] = [];

                public increment(): void {
                    this.counter++;
                    this.history.push(this.counter);
                }
            }

            const pool = createBasicPool(() => new StatefulObject(), {
                resetHandler: (obj) => {
                    obj.counter = 0;
                    obj.history.length = 0;
                },
            });

            const obj = pool.acquire();
            obj.increment();
            obj.increment();
            expect(obj.counter).toBe(2);
            expect(obj.history).toHaveLength(2);

            pool.release(obj);

            const obj2 = pool.acquire();

            expect(obj2.counter).toBe(0);
            expect(obj2.history).toHaveLength(0);
        });
    });

    describe('Integration with Underlying MemoryPool', () => {
        it('should properly wrap and unwrap objects', () => {
            const pool = createBasicPool(() => new TestUser());

            const user = pool.acquire();
            expect(user).toBeInstanceOf(TestUser);
            expect(user).not.toHaveProperty('isWrapped');

            pool.release(user);
            expect(() => pool.release(user)).toThrow();
        });

        it('should respect all MemoryPool configuration options', () => {
            const options = {
                initialCapacity: 8,
                maxCapacity: 32,
                minFree: 2,
                highWatermarkRatio: 0.9,
                lowWatermarkRatio: 0.1,
                expansionStrategy: 'multiplicative' as const,
                expansionFactor: 2.5,
                allocationStrategy: 'round-robin' as const,
                evictionPolicy: 'lru' as const,
                enableMetrics: true,
                preallocate: true,
            };

            const pool = createBasicPool(() => new TestUser(), options);

            expect(pool.getTotalCount()).toBe(options.initialCapacity);
            const metrics = pool.getMetrics();
            expect(metrics.capacity).toBe(options.initialCapacity);
        });
    });

    describe('Resource Cleanup and Disposal', () => {
        it('should dispose properly with Symbol.dispose', () => {
            const pool = createBasicPool(() => new TestUser());
            const user = pool.acquire();

            using disposablePool = pool;
            expect(disposablePool.state).toBe('active');
        });

        it('should handle disposal with allocated objects gracefully', () => {
            const pool = createBasicPool(() => new TestUser());
            const user1 = pool.acquire();
            const user2 = pool.acquire();

            expect(() => pool[Symbol.dispose]()).not.toThrow();
            expect(pool.state).toBe('disposed');

            expect(() => pool.release(user1)).not.toThrow();
            expect(() => pool.release(user2)).not.toThrow();
        });
    });
});
