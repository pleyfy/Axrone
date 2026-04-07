import { DynamicArray } from '../../../memory/containers/queue/dynamic-array';
import {
    createCapacity,
    createQueueSize,
    createHeapIndex,
} from '../../../memory/containers/queue/utils';
import { EmptyQueueError, InvalidCapacityError } from '../../../memory/containers/queue/errors';
import { beforeEach, describe, expect, it } from 'vitest';

describe('DynamicArray', () => {
    describe('Constructor', () => {
        it('should create array with default capacity', () => {
            const array = new DynamicArray<number>();

            expect(array.length).toBe(createQueueSize(0));
            expect(array.capacity).toBe(createCapacity(16));
        });

        it('should create array with custom capacity', () => {
            const customCapacity = createCapacity(32);
            const array = new DynamicArray<number>(customCapacity);

            expect(array.length).toBe(createQueueSize(0));
            expect(array.capacity).toBe(customCapacity);
        });

        it('should throw error for negative capacity', () => {
            expect(() => new DynamicArray<number>(createCapacity(-1))).toThrow(
                InvalidCapacityError
            );
        });
    });

    describe('Basic Operations', () => {
        let array: DynamicArray<number>;

        beforeEach(() => {
            array = new DynamicArray<number>(createCapacity(4));
        });

        it('should get and set elements correctly', () => {
            array.push(42);
            array.push(24);

            expect(array.get(createHeapIndex(0))).toBe(42);
            expect(array.get(createHeapIndex(1))).toBe(24);

            array.set(createHeapIndex(0), 100);
            expect(array.get(createHeapIndex(0))).toBe(100);
        });

        it('should push elements and grow capacity', () => {
            const values = [1, 2, 3, 4, 5];

            for (const value of values) {
                array.push(value);
            }

            expect(array.length).toBe(createQueueSize(5));
            expect(array.capacity).toBeGreaterThan(createCapacity(4));

            for (let i = 0; i < values.length; i++) {
                expect(array.get(createHeapIndex(i))).toBe(values[i]);
            }
        });

        it('should pop elements correctly', () => {
            array.push(1);
            array.push(2);
            array.push(3);

            expect(array.pop()).toBe(3);
            expect(array.length).toBe(createQueueSize(2));

            expect(array.pop()).toBe(2);
            expect(array.pop()).toBe(1);
            expect(array.length).toBe(createQueueSize(0));
        });

        it('should throw error when popping from empty array', () => {
            expect(() => array.pop()).toThrow(EmptyQueueError);
        });

        it('should swap elements correctly', () => {
            array.push(10);
            array.push(20);
            array.push(30);

            array.swap(createHeapIndex(0), createHeapIndex(2));

            expect(array.get(createHeapIndex(0))).toBe(30);
            expect(array.get(createHeapIndex(2))).toBe(10);
            expect(array.get(createHeapIndex(1))).toBe(20);
        });
    });

    describe('Capacity Management', () => {
        let array: DynamicArray<number>;

        beforeEach(() => {
            array = new DynamicArray<number>(createCapacity(2));
        });

        it('should resize correctly', () => {
            array.push(1);
            array.push(2);

            array.resize(createCapacity(10));

            expect(array.capacity).toBe(createCapacity(10));
            expect(array.length).toBe(createQueueSize(2));
            expect(array.get(createHeapIndex(0))).toBe(1);
            expect(array.get(createHeapIndex(1))).toBe(2);
        });

        it('should throw error when resizing below current length', () => {
            array.push(1);
            array.push(2);
            array.push(3);

            expect(() => array.resize(createCapacity(2))).toThrow(InvalidCapacityError);
        });

        it('should ensure capacity grows geometrically', () => {
            const initialCapacity = array.capacity;

            for (let i = 0; i < initialCapacity; i++) {
                array.push(i);
            }

            array.push(999);

            expect(array.capacity).toBeGreaterThanOrEqual(initialCapacity * 2);
        });

        it('should trim to size correctly', () => {
            for (let i = 0; i < 10; i++) {
                array.push(i);
            }

            const largeCapacity = array.capacity;

            array.pop();
            array.pop();
            array.pop();

            array.trimToSize();

            expect(array.capacity).toBeLessThan(largeCapacity);
            expect(array.capacity).toBeGreaterThanOrEqual(array.length);
        });

        it('should maintain minimum capacity of 1 when trimming empty array', () => {
            array.trimToSize();

            expect(array.capacity).toBeGreaterThanOrEqual(createCapacity(1));
        });
    });

    describe('Utility Operations', () => {
        let array: DynamicArray<string>;

        beforeEach(() => {
            array = new DynamicArray<string>();
            array.push('first');
            array.push('second');
            array.push('third');
        });

        it('should clear array correctly', () => {
            array.clear();

            expect(array.length).toBe(createQueueSize(0));
            expect(() => array.pop()).toThrow(EmptyQueueError);
        });

        it('should create correct slice', () => {
            const slice = array.slice();

            expect(slice).toEqual(['first', 'second', 'third']);
            expect(slice.length).toBe(3);

            slice[0] = 'modified';
            expect(array.get(createHeapIndex(0))).toBe('first');
        });

        it('should handle empty array slice', () => {
            array.clear();
            const slice = array.slice();

            expect(slice).toEqual([]);
            expect(slice.length).toBe(0);
        });
    });

    describe('Performance Characteristics', () => {
        it('should handle large number of elements efficiently', () => {
            const array = new DynamicArray<number>();
            const elementCount = 10000;

            const startTime = performance.now();

            for (let i = 0; i < elementCount; i++) {
                array.push(i);
            }

            expect(array.length).toBe(createQueueSize(elementCount));

            for (let i = 0; i < elementCount; i++) {
                expect(array.get(createHeapIndex(i))).toBe(i);
            }

            for (let i = elementCount - 1; i >= 0; i--) {
                expect(array.pop()).toBe(i);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(1000);
        });

        it('should have efficient memory growth pattern', () => {
            const array = new DynamicArray<number>(createCapacity(1));
            const growthHistory: number[] = [];

            let previousCapacity = array.capacity as number;
            growthHistory.push(previousCapacity);

            for (let i = 0; i < 100; i++) {
                array.push(i);

                const currentCapacity = array.capacity as number;
                if (currentCapacity !== previousCapacity) {
                    growthHistory.push(currentCapacity);
                    previousCapacity = currentCapacity;
                }
            }

            for (let i = 1; i < growthHistory.length; i++) {
                const ratio = growthHistory[i] / growthHistory[i - 1];
                expect(ratio).toBeGreaterThanOrEqual(1.5);
                expect(ratio).toBeLessThanOrEqual(2.5);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle zero capacity correctly', () => {
            const array = new DynamicArray<number>(createCapacity(0));

            expect(array.length).toBe(createQueueSize(0));
            expect(array.capacity).toBe(createCapacity(0));

            array.push(42);
            expect(array.capacity).toBeGreaterThan(createCapacity(0));
            expect(array.get(createHeapIndex(0))).toBe(42);
        });

        it('should handle single element operations', () => {
            const array = new DynamicArray<string>(createCapacity(1));

            array.push('only');
            expect(array.length).toBe(createQueueSize(1));
            expect(array.get(createHeapIndex(0))).toBe('only');

            const popped = array.pop();
            expect(popped).toBe('only');
            expect(array.length).toBe(createQueueSize(0));
        });

        it('should handle object references correctly', () => {
            const array = new DynamicArray<object>();
            const obj1 = { id: 1 };
            const obj2 = { id: 2 };

            array.push(obj1);
            array.push(obj2);

            expect(array.get(createHeapIndex(0))).toBe(obj1);
            expect(array.get(createHeapIndex(1))).toBe(obj2);

            obj1.id = 999;
            expect((array.get(createHeapIndex(0)) as any).id).toBe(999);
        });
    });
});
