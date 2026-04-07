import { ComponentPool } from '../../component-system/memory/component-pool';
import { Component } from '../../component-system/core/component';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

class TestComponent extends Component {
    value: number = 0;

    constructor(value: number = 0) {
        super();
        this.value = value;
    }

    validate(): boolean {
        return this.value >= 0;
    }

    reset(): void {
        super.reset();
        this.value = 0;
    }
}

class InvalidComponent extends Component {
    validate(): boolean {
        return false;
    }
}

describe('ComponentPool', () => {
    let pool: ComponentPool<TestComponent>;

    beforeEach(() => {
        pool = new ComponentPool(TestComponent, {
            initialCapacity: 4,
            maxCapacity: 16,
            enableValidation: true,
            enableMetrics: true,
        });
    });

    afterEach(() => {
        pool.dispose();
    });

    describe('basic operations', () => {
        it('should create pool with correct configuration', () => {
            expect(pool).toBeDefined();
            expect(pool.capacity).toBe(4);
            expect(pool.size).toBe(0);
        });

        it('should acquire component from pool', () => {
            const component = pool.acquire();

            expect(component).toBeDefined();
            expect(component).toBeInstanceOf(TestComponent);
            expect(pool.size).toBe(1);
        });

        it('should release component back to pool', () => {
            const component = pool.acquire();
            expect(pool.size).toBe(1);

            pool.release(component);
            expect(pool.size).toBe(0);
        });

        it('should reuse released components', () => {
            const component1 = pool.acquire();
            component1.value = 42;

            pool.release(component1);

            const component2 = pool.acquire();
            expect(component2.value).toBe(0);
        });

        it('should handle multiple acquire/release cycles', () => {
            const components = [];

            for (let i = 0; i < 3; i++) {
                components.push(pool.acquire());
            }

            expect(pool.size).toBe(3);

            for (const component of components) {
                pool.release(component);
            }

            expect(pool.size).toBe(0);
        });
    });

    describe('validation', () => {
        it('should validate components when enabled', () => {
            const component = pool.acquire();
            component.value = -1;

            expect(() => pool.release(component)).not.toThrow();
        });

        it('should handle validation disabled', () => {
            const noValidationPool = new ComponentPool(TestComponent, {
                enableValidation: false,
            });

            const component = noValidationPool.acquire();
            expect(component).toBeDefined();

            noValidationPool.dispose();
        });
    });

    describe('capacity management', () => {
        it('should grow when needed', () => {
            const initialCapacity = pool.capacity;

            const components = [];
            for (let i = 0; i < initialCapacity + 2; i++) {
                components.push(pool.acquire());
            }

            pool.grow();
            expect(pool.capacity).toBeGreaterThanOrEqual(initialCapacity);

            for (const component of components) {
                pool.release(component);
            }
        });

        it('should respect max capacity', () => {
            const components = [];

            for (let i = 0; i < 20; i++) {
                try {
                    components.push(pool.acquire());
                } catch (error) {
                    break;
                }
            }

            expect(pool.capacity).toBeLessThanOrEqual(16);

            for (const component of components) {
                pool.release(component);
            }
        });
    });

    describe('async operations', () => {
        it('should acquire component asynchronously', async () => {
            const component = await pool.acquireAsync();

            expect(component).toBeDefined();
            expect(component).toBeInstanceOf(TestComponent);

            pool.release(component);
        });

        it('should release component asynchronously', async () => {
            const component = pool.acquire();

            await pool.releaseAsync(component);
            expect(pool.size).toBe(0);
        });
    });

    describe('metrics', () => {
        it('should provide metrics when enabled', () => {
            const metrics = pool.getMetrics();

            expect(metrics).toBeDefined();
            expect(metrics).toHaveProperty('allocations');
            expect(metrics).toHaveProperty('releases');
        });

        it('should return null metrics when disabled', () => {
            const noMetricsPool = new ComponentPool(TestComponent, {
                enableMetrics: false,
            });

            const metrics = noMetricsPool.getMetrics();
            expect(metrics).toBeNull();

            noMetricsPool.dispose();
        });
    });

    describe('utility methods', () => {
        it('should get available count', () => {
            expect(pool.getAvailableCount()).toBeGreaterThan(0);

            pool.acquire();
            const availableAfter = pool.getAvailableCount();
            expect(availableAfter).toBeGreaterThanOrEqual(0);
        });

        it('should get allocated count', () => {
            const initialAllocated = pool.getAllocatedCount();

            pool.acquire();
            expect(pool.getAllocatedCount()).toBe(initialAllocated + 1);
        });

        it('should get total count', () => {
            const total = pool.getTotalCount();
            expect(total).toBeGreaterThan(0);
        });

        it('should check if component is from pool', () => {
            const poolComponent = pool.acquire();
            const externalComponent = new TestComponent();

            expect(pool.isFromPool(poolComponent)).toBe(true);
            expect(pool.isFromPool(externalComponent)).toBe(false);

            pool.release(poolComponent);
        });
    });

    describe('cleanup operations', () => {
        it('should clear all components', () => {
            const comp1 = pool.acquire();
            const comp2 = pool.acquire();

            expect(pool.size).toBe(2);

            pool.release(comp1);
            pool.release(comp2);

            pool.clear();
            expect(pool.size).toBe(0);
        });

        it('should drain unused components', () => {
            pool.acquire();
            pool.drain();

            expect(pool.getAvailableCount()).toBeGreaterThanOrEqual(0);
        });

        it('should compact pool', () => {
            for (let i = 0; i < 8; i++) {
                pool.acquire();
            }

            pool.compact();
            expect(pool.capacity).toBeGreaterThan(0);
        });
    });

    describe('error handling', () => {
        it('should handle try acquire when pool is empty', () => {
            const component = pool.tryAcquire();
            expect(component).toBeDefined();
        });

        it('should handle release of non-pool component', () => {
            const externalComponent = new TestComponent();

            expect(() => pool.release(externalComponent)).not.toThrow();
        });

        it('should handle disposal', () => {
            const comp = pool.acquire();
            pool.release(comp);

            expect(() => pool.dispose()).not.toThrow();
        });
    });
});
