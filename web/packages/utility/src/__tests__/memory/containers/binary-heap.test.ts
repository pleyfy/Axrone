import { BinaryMinHeap } from '../../../memory/containers/queue/binary-heap';
import {
    createCapacity,
    createQueueSize,
    defaultComparator,
    numericComparator,
} from '../../../memory/containers/queue/utils';
import { EmptyQueueError } from '../../../memory/containers/queue/errors';
import { beforeEach, describe, expect, it } from 'vitest';

describe('BinaryMinHeap', () => {
    describe('Constructor', () => {
        it('should create empty heap with default capacity', () => {
            const heap = new BinaryMinHeap<number>(numericComparator);

            expect(heap.size).toBe(createQueueSize(0));
            expect(heap.isEmpty).toBe(true);
            expect(heap.capacity).toBeGreaterThan(createCapacity(0));
        });

        it('should create heap with custom capacity', () => {
            const customCapacity = createCapacity(64);
            const heap = new BinaryMinHeap<number>(numericComparator, customCapacity);

            expect(heap.size).toBe(createQueueSize(0));
            expect(heap.capacity).toBe(customCapacity);
        });

        it('should use custom comparator correctly', () => {
            const maxComparator = (a: number, b: number) => b - a;
            const heap = new BinaryMinHeap<number>(maxComparator);

            heap.insert(1);
            heap.insert(5);
            heap.insert(3);

            expect(heap.peek()).toBe(5);
        });
    });

    describe('Heap Property Maintenance', () => {
        let heap: BinaryMinHeap<number>;

        beforeEach(() => {
            heap = new BinaryMinHeap<number>(numericComparator);
        });

        it('should maintain min-heap property during insertions', () => {
            const values = [50, 30, 70, 20, 40, 60, 80, 10];

            for (const value of values) {
                heap.insert(value);
                expect(heap.peek()).toBe(Math.min(...values.slice(0, values.indexOf(value) + 1)));
            }
        });

        it('should maintain min-heap property during extractions', () => {
            const values = [50, 30, 70, 20, 40, 60, 80, 10, 90, 5];
            const sortedValues = [...values].sort((a, b) => a - b);

            for (const value of values) {
                heap.insert(value);
            }

            for (const expectedValue of sortedValues) {
                expect(heap.extract()).toBe(expectedValue);
            }

            expect(heap.isEmpty).toBe(true);
        });

        it('should handle duplicate values correctly', () => {
            const values = [5, 3, 5, 1, 3, 1, 5];
            const sortedValues = [...values].sort((a, b) => a - b);

            for (const value of values) {
                heap.insert(value);
            }

            for (const expectedValue of sortedValues) {
                expect(heap.extract()).toBe(expectedValue);
            }
        });
    });

    describe('Basic Operations', () => {
        let heap: BinaryMinHeap<string>;

        beforeEach(() => {
            heap = new BinaryMinHeap<string>(defaultComparator);
        });

        it('should insert and peek correctly', () => {
            heap.insert('zebra');
            expect(heap.peek()).toBe('zebra');
            expect(heap.size).toBe(createQueueSize(1));

            heap.insert('apple');
            expect(heap.peek()).toBe('apple');
            expect(heap.size).toBe(createQueueSize(2));

            heap.insert('banana');
            expect(heap.peek()).toBe('apple');
            expect(heap.size).toBe(createQueueSize(3));
        });

        it('should extract minimum element', () => {
            heap.insert('charlie');
            heap.insert('alice');
            heap.insert('bob');

            expect(heap.extract()).toBe('alice');
            expect(heap.size).toBe(createQueueSize(2));

            expect(heap.extract()).toBe('bob');
            expect(heap.size).toBe(createQueueSize(1));

            expect(heap.extract()).toBe('charlie');
            expect(heap.isEmpty).toBe(true);
        });

        it('should throw error when peeking empty heap', () => {
            expect(() => heap.peek()).toThrow(EmptyQueueError);
        });

        it('should throw error when extracting from empty heap', () => {
            expect(() => heap.extract()).toThrow(EmptyQueueError);
        });

        it('should clear heap correctly', () => {
            heap.insert('a');
            heap.insert('b');
            heap.insert('c');

            heap.clear();

            expect(heap.isEmpty).toBe(true);
            expect(heap.size).toBe(createQueueSize(0));
            expect(() => heap.peek()).toThrow(EmptyQueueError);
        });
    });

    describe('Capacity Management', () => {
        let heap: BinaryMinHeap<number>;

        beforeEach(() => {
            heap = new BinaryMinHeap<number>(numericComparator, createCapacity(4));
        });

        it('should ensure capacity grows when needed', () => {
            const initialCapacity = heap.capacity;

            for (let i = 0; i < (initialCapacity as number) + 5; i++) {
                heap.insert(i);
            }

            expect(heap.capacity).toBeGreaterThan(initialCapacity);
            expect(heap.size).toBe(createQueueSize((initialCapacity as number) + 5));
        });

        it('should manually ensure capacity', () => {
            const newCapacity = createCapacity(100);
            heap.ensureCapacity(newCapacity);

            expect(heap.capacity).toBeGreaterThanOrEqual(newCapacity);
        });

        it('should trim excess capacity', () => {
            for (let i = 0; i < 20; i++) {
                heap.insert(i);
            }

            const largeCapacity = heap.capacity;

            for (let i = 0; i < 15; i++) {
                heap.extract();
            }

            heap.trimExcess();

            expect(heap.capacity).toBeLessThan(largeCapacity);
            expect(heap.capacity).toBeGreaterThanOrEqual(heap.size);
        });
    });

    describe('Query Operations', () => {
        let heap: BinaryMinHeap<number>;

        beforeEach(() => {
            heap = new BinaryMinHeap<number>(numericComparator);
            [15, 10, 20, 8, 25, 12, 22].forEach((x) => heap.insert(x));
        });

        it('should check if element exists', () => {
            expect(heap.contains(10)).toBe(true);
            expect(heap.contains(8)).toBe(true);
            expect(heap.contains(25)).toBe(true);
            expect(heap.contains(999)).toBe(false);
            expect(heap.contains(-1)).toBe(false);
        });

        it('should convert to array correctly', () => {
            const array = heap.toArray();

            expect(array.length).toBe(7);
            expect(array).toContain(15);
            expect(array).toContain(10);
            expect(array).toContain(20);
            expect(array).toContain(8);
            expect(array).toContain(25);
            expect(array).toContain(12);
            expect(array).toContain(22);

            array[0] = 999;
            expect(heap.contains(999)).toBe(false);
        });

        it('should handle empty heap queries', () => {
            heap.clear();

            expect(heap.contains(10)).toBe(false);
            expect(heap.toArray()).toEqual([]);
        });
    });

    describe('Performance Characteristics', () => {
        it('should handle large number of elements efficiently', () => {
            const heap = new BinaryMinHeap<number>(numericComparator);
            const elementCount = 10000;
            const values = Array.from({ length: elementCount }, () =>
                Math.floor(Math.random() * 100000)
            );

            const startTime = performance.now();

            for (const value of values) {
                heap.insert(value);
            }

            expect(heap.size).toBe(createQueueSize(elementCount));

            const extracted: number[] = [];
            while (!heap.isEmpty) {
                extracted.push(heap.extract());
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            for (let i = 1; i < extracted.length; i++) {
                expect(extracted[i]).toBeGreaterThanOrEqual(extracted[i - 1]);
            }

            expect(duration).toBeLessThan(1000);
        });

        it('should demonstrate logarithmic complexity characteristics', () => {
            const heap = new BinaryMinHeap<number>(numericComparator);
            const measurements: Array<{ size: number; timePerOp: number }> = [];

            const testSizes = [1000, 2000, 4000, 8000];

            for (const size of testSizes) {
                heap.clear();

                const startTime = performance.now();

                for (let i = 0; i < size; i++) {
                    heap.insert(Math.random() * 1000);
                }

                for (let i = 0; i < size; i++) {
                    heap.extract();
                }

                const endTime = performance.now();
                const timePerOp = (endTime - startTime) / (2 * size);

                measurements.push({ size, timePerOp });
            }

            const firstMeasurement = measurements[0];
            const lastMeasurement = measurements[measurements.length - 1];

            const sizeRatio = lastMeasurement.size / firstMeasurement.size;
            const timeRatio = lastMeasurement.timePerOp / firstMeasurement.timePerOp;

            expect(timeRatio).toBeLessThan(sizeRatio * 0.5);
        });
    });

    describe('Edge Cases', () => {
        let heap: BinaryMinHeap<number>;

        beforeEach(() => {
            heap = new BinaryMinHeap<number>(numericComparator);
        });

        it('should handle single element correctly', () => {
            heap.insert(42);

            expect(heap.size).toBe(createQueueSize(1));
            expect(heap.peek()).toBe(42);
            expect(heap.extract()).toBe(42);
            expect(heap.isEmpty).toBe(true);
        });

        it('should handle alternating insert/extract operations', () => {
            type InsertOperation = {
                op: 'insert';
                value: number;
            };

            type ExtractOperation = {
                op: 'extract';
                expected: number;
            };

            type Operation = InsertOperation | ExtractOperation;

            const operations: Operation[] = [
                { op: 'insert', value: 5 },
                { op: 'insert', value: 3 },
                { op: 'extract', expected: 3 },
                { op: 'insert', value: 7 },
                { op: 'insert', value: 1 },
                { op: 'extract', expected: 1 },
                { op: 'extract', expected: 5 },
                { op: 'extract', expected: 7 },
            ];

            for (const operation of operations) {
                if (operation.op === 'insert') {
                    heap.insert(operation.value);
                } else {
                    expect(heap.extract()).toBe(operation.expected);
                }
            }
        });

        it('should handle special numeric values', () => {
            const specialValues = [Infinity, -Infinity, 0, -0, NaN];

            for (const value of specialValues.filter((v) => !isNaN(v))) {
                heap.insert(value);
            }

            const extracted = [];
            while (!heap.isEmpty) {
                extracted.push(heap.extract());
            }

            expect(extracted[0]).toBe(-Infinity);
            expect(extracted[extracted.length - 1]).toBe(Infinity);
        });

        it('should work with complex objects', () => {
            interface Task {
                id: number;
                priority: number;
                name: string;
            }

            const taskComparator = (a: Task, b: Task) => a.priority - b.priority;
            const taskHeap = new BinaryMinHeap<Task>(taskComparator);

            const tasks: Task[] = [
                { id: 1, priority: 5, name: 'Low priority task' },
                { id: 2, priority: 1, name: 'High priority task' },
                { id: 3, priority: 3, name: 'Medium priority task' },
            ];

            tasks.forEach((task) => taskHeap.insert(task));

            expect(taskHeap.extract().id).toBe(2);
            expect(taskHeap.extract().id).toBe(3);
            expect(taskHeap.extract().id).toBe(1);
        });
    });

    describe('Stress Tests', () => {
        it('should maintain heap property under stress', () => {
            const heap = new BinaryMinHeap<number>(numericComparator);
            const operations = 1000;
            const maxValue = 1000;

            for (let i = 0; i < operations; i++) {
                if (Math.random() < 0.7 || heap.isEmpty) {
                    heap.insert(Math.floor(Math.random() * maxValue));
                } else {
                    const extracted = heap.extract();
                    if (!heap.isEmpty) {
                        expect(extracted).toBeLessThanOrEqual(heap.peek());
                    }
                }
            }

            let lastValue = -Infinity;
            while (!heap.isEmpty) {
                const value = heap.extract();
                expect(value).toBeGreaterThanOrEqual(lastValue);
                lastValue = value;
            }
        });
    });
});
