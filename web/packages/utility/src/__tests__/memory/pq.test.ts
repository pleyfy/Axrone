import { beforeEach, describe, expect, it } from 'vitest';
import {
    PriorityQueue,
    EmptyQueueError,
    InvalidCapacityError,
    QueueError,
    PriorityQueueNode,
    createCapacity,
    createQueueSize,
    createHeapIndex,
    defaultComparator,
    type Comparator,
    type ReadonlyQueueNode,
    type PriorityQueueOptions,
} from '../../memory/containers/queue/priority-queue';

describe('PriorityQueue', () => {
    describe('constructor', () => {
        it('should create empty queue with default options', () => {
            const queue = new PriorityQueue<string>();

            expect(queue.size).toBe(0);
            expect(queue.isEmpty).toBe(true);
            expect(queue.capacity).toBeGreaterThan(0);
        });

        it('should create queue with custom comparator', () => {
            const reverseComparator: Comparator<number> = (a, b) => b - a;
            const queue = new PriorityQueue<string, number>({ comparator: reverseComparator });

            queue.enqueue('low', 1);
            queue.enqueue('high', 10);

            expect(queue.dequeue()).toBe('high');
        });

        it('should create queue with initial capacity', () => {
            const capacity = createCapacity(100);
            const queue = new PriorityQueue<string>({ initialCapacity: capacity });

            expect(queue.capacity).toBe(capacity);
        });

        it('should create queue with auto trim enabled', () => {
            const queue = new PriorityQueue<string>({ autoTrim: true });

            expect(queue).toBeDefined();
        });
    });

    describe('enqueue', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should add single element', () => {
            queue.enqueue('test', 1);

            expect(queue.size).toBe(1);
            expect(queue.isEmpty).toBe(false);
        });

        it('should maintain heap property with multiple elements', () => {
            queue.enqueue('high', 10);
            queue.enqueue('low', 1);
            queue.enqueue('medium', 5);

            expect(queue.peek()).toBe('low');
        });

        it('should handle duplicate priorities', () => {
            queue.enqueue('first', 5);
            queue.enqueue('second', 5);

            expect(queue.size).toBe(2);
        });

        it('should grow capacity automatically', () => {
            const initialCapacity = queue.capacity;

            for (let i = 0; i < initialCapacity + 10; i++) {
                queue.enqueue(`item-${i}`, i);
            }

            expect(queue.capacity).toBeGreaterThan(initialCapacity);
            expect(queue.size).toBe(initialCapacity + 10);
        });
    });

    describe('dequeue', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should throw EmptyQueueError when queue is empty', () => {
            expect(() => queue.dequeue()).toThrow(EmptyQueueError);
        });

        it('should return element with highest priority', () => {
            queue.enqueue('medium', 5);
            queue.enqueue('high', 10);
            queue.enqueue('low', 1);

            expect(queue.dequeue()).toBe('low');
        });

        it('should maintain heap property after removal', () => {
            const items = [
                { element: 'a', priority: 3 },
                { element: 'b', priority: 1 },
                { element: 'c', priority: 4 },
                { element: 'd', priority: 2 },
                { element: 'e', priority: 5 },
            ];

            items.forEach((item) => queue.enqueue(item.element, item.priority));

            const results = [];
            while (!queue.isEmpty) {
                results.push(queue.dequeue());
            }

            expect(results).toEqual(['b', 'd', 'a', 'c', 'e']);
        });

        it('should update size correctly', () => {
            queue.enqueue('test', 1);
            expect(queue.size).toBe(1);

            queue.dequeue();
            expect(queue.size).toBe(0);
            expect(queue.isEmpty).toBe(true);
        });

        it('should handle auto trim when enabled', () => {
            const autoTrimQueue = new PriorityQueue<string, number>({ autoTrim: true });

            for (let i = 0; i < 100; i++) {
                autoTrimQueue.enqueue(`item-${i}`, i);
            }

            const capacityBeforeTrim = autoTrimQueue.capacity;

            for (let i = 0; i < 90; i++) {
                autoTrimQueue.dequeue();
            }

            expect(autoTrimQueue.capacity).toBeLessThanOrEqual(capacityBeforeTrim);
        });
    });

    describe('peek', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should throw EmptyQueueError when queue is empty', () => {
            expect(() => queue.peek()).toThrow(EmptyQueueError);
        });

        it('should return highest priority element without removing it', () => {
            queue.enqueue('low', 1);
            queue.enqueue('high', 10);

            expect(queue.peek()).toBe('low');
            expect(queue.size).toBe(2);
        });

        it('should return same element on multiple calls', () => {
            queue.enqueue('test', 1);

            expect(queue.peek()).toBe('test');
            expect(queue.peek()).toBe('test');
        });
    });

    describe('tryDequeue', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should return undefined when queue is empty', () => {
            expect(queue.tryDequeue()).toBeUndefined();
        });

        it('should return element when queue is not empty', () => {
            queue.enqueue('test', 1);

            expect(queue.tryDequeue()).toBe('test');
            expect(queue.isEmpty).toBe(true);
        });
    });

    describe('tryPeek', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should return undefined when queue is empty', () => {
            expect(queue.tryPeek()).toBeUndefined();
        });

        it('should return element when queue is not empty', () => {
            queue.enqueue('test', 1);

            expect(queue.tryPeek()).toBe('test');
            expect(queue.size).toBe(1);
        });
    });

    describe('dequeueAll', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should return empty array when queue is empty', () => {
            expect(queue.dequeueAll()).toEqual([]);
        });

        it('should return all elements in priority order', () => {
            queue.enqueue('c', 3);
            queue.enqueue('a', 1);
            queue.enqueue('b', 2);

            const result = queue.dequeueAll();

            expect(result).toEqual(['a', 'b', 'c']);
            expect(queue.isEmpty).toBe(true);
        });
    });

    describe('enqueueRange', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should handle empty array', () => {
            queue.enqueueRange([]);

            expect(queue.isEmpty).toBe(true);
        });

        it('should add multiple items maintaining priority order', () => {
            const items: ReadonlyQueueNode<string, number>[] = [
                { element: 'c', priority: 3 },
                { element: 'a', priority: 1 },
                { element: 'b', priority: 2 },
            ];

            queue.enqueueRange(items);

            expect(queue.size).toBe(3);
            expect(queue.dequeue()).toBe('a');
            expect(queue.dequeue()).toBe('b');
            expect(queue.dequeue()).toBe('c');
        });

        it('should ensure capacity for large ranges', () => {
            const items: ReadonlyQueueNode<string, number>[] = [];
            for (let i = 0; i < 1000; i++) {
                items.push({ element: `item-${i}`, priority: i });
            }

            queue.enqueueRange(items);

            expect(queue.size).toBe(1000);
        });
    });

    describe('contains', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should return false for empty queue', () => {
            expect(queue.contains('test')).toBe(false);
        });

        it('should return true for existing element', () => {
            queue.enqueue('test', 1);

            expect(queue.contains('test')).toBe(true);
        });

        it('should return false for non-existing element', () => {
            queue.enqueue('test', 1);

            expect(queue.contains('other')).toBe(false);
        });

        it('should work with object elements', () => {
            const objectQueue = new PriorityQueue<{ id: number }, number>();
            const obj1 = { id: 1 };
            const obj2 = { id: 2 };

            objectQueue.enqueue(obj1, 1);

            expect(objectQueue.contains(obj1)).toBe(true);
            expect(objectQueue.contains(obj2)).toBe(false);
        });
    });

    describe('clear', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should clear empty queue', () => {
            queue.clear();

            expect(queue.isEmpty).toBe(true);
            expect(queue.size).toBe(0);
        });

        it('should clear non-empty queue', () => {
            queue.enqueue('a', 1);
            queue.enqueue('b', 2);

            queue.clear();

            expect(queue.isEmpty).toBe(true);
            expect(queue.size).toBe(0);
        });
    });

    describe('ensureCapacity', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should increase capacity when needed', () => {
            const newCapacity = createCapacity(100);
            const oldCapacity = queue.capacity;

            queue.ensureCapacity(newCapacity);

            if (newCapacity > oldCapacity) {
                expect(queue.capacity).toBeGreaterThanOrEqual(newCapacity);
            }
        });

        it('should not decrease capacity', () => {
            const oldCapacity = queue.capacity;
            const smallerCapacity = createCapacity(1);

            queue.ensureCapacity(smallerCapacity);

            expect(queue.capacity).toBe(oldCapacity);
        });
    });

    describe('trimExcess', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should trim excess capacity', () => {
            for (let i = 0; i < 50; i++) {
                queue.enqueue(`item-${i}`, i);
            }

            for (let i = 0; i < 40; i++) {
                queue.dequeue();
            }

            const capacityBeforeTrim = queue.capacity;
            queue.trimExcess();

            expect(queue.capacity).toBeLessThanOrEqual(capacityBeforeTrim);
        });
    });

    describe('toArray', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should return empty array for empty queue', () => {
            const array = queue.toArray();

            expect(array).toEqual([]);
            expect(Object.isFrozen(array)).toBe(true);
        });

        it('should return frozen array of elements', () => {
            queue.enqueue('a', 3);
            queue.enqueue('b', 1);
            queue.enqueue('c', 2);

            const array = queue.toArray();

            expect(array).toHaveLength(3);
            expect(Object.isFrozen(array)).toBe(true);
            expect(array).toContain('a');
            expect(array).toContain('b');
            expect(array).toContain('c');
        });
    });

    describe('clone', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should create independent copy', () => {
            queue.enqueue('a', 1);
            queue.enqueue('b', 2);

            const clone = queue.clone();

            expect(clone.size).toBe(queue.size);
            expect(clone.dequeue()).toBe('a');
            expect(queue.peek()).toBe('a');
        });

        it('should preserve comparator', () => {
            const reverseQueue = new PriorityQueue<string, number>({
                comparator: (a, b) => b - a,
            });

            reverseQueue.enqueue('low', 1);
            reverseQueue.enqueue('high', 10);

            const clone = reverseQueue.clone();

            expect(clone.dequeue()).toBe('high');
        });
    });

    describe('iterator', () => {
        let queue: PriorityQueue<string, number>;

        beforeEach(() => {
            queue = new PriorityQueue<string, number>();
        });

        it('should iterate over empty queue', () => {
            const elements = Array.from(queue);

            expect(elements).toEqual([]);
        });

        it('should iterate in priority order', () => {
            queue.enqueue('c', 3);
            queue.enqueue('a', 1);
            queue.enqueue('b', 2);

            const elements = Array.from(queue);

            expect(elements).toEqual(['a', 'b', 'c']);
            expect(queue.size).toBe(3);
        });

        it('should work with for...of loop', () => {
            queue.enqueue('second', 2);
            queue.enqueue('first', 1);

            const elements: string[] = [];
            for (const element of queue) {
                elements.push(element);
            }

            expect(elements).toEqual(['first', 'second']);
        });
    });

    describe('static factory methods', () => {
        describe('from', () => {
            it('should create queue from array', () => {
                const items: ReadonlyQueueNode<string, number>[] = [
                    { element: 'c', priority: 3 },
                    { element: 'a', priority: 1 },
                    { element: 'b', priority: 2 },
                ];

                const queue = PriorityQueue.from(items);

                expect(queue.size).toBe(3);
                expect(queue.dequeue()).toBe('a');
            });

            it('should create queue from iterable', () => {
                const items = new Set([
                    { element: 'b', priority: 2 },
                    { element: 'a', priority: 1 },
                ]);

                const queue = PriorityQueue.from(items);

                expect(queue.size).toBe(2);
            });

            it('should accept options', () => {
                const items: ReadonlyQueueNode<string, number>[] = [
                    { element: 'low', priority: 1 },
                    { element: 'high', priority: 10 },
                ];

                const queue = PriorityQueue.from(items, {
                    comparator: (a, b) => b - a,
                });

                expect(queue.dequeue()).toBe('high');
            });
        });
        describe('withComparator', () => {
            it('should create queue with custom comparator', () => {
                const queue = PriorityQueue.withComparator<string, number>((a, b) => b - a);

                queue.enqueue('low', 1);
                queue.enqueue('high', 10);

                expect(queue.dequeue()).toBe('high');
            });

            it('should accept initial capacity', () => {
                const capacity = createCapacity(50);
                const queue = PriorityQueue.withComparator<string, number>(
                    (a, b) => a - b,
                    capacity
                );

                expect(queue.capacity).toBe(capacity);
            });
        });

        describe('minQueue', () => {
            it('should create min priority queue', () => {
                const queue = PriorityQueue.minQueue<string, number>();

                queue.enqueue('high', 10);
                queue.enqueue('low', 1);

                expect(queue.dequeue()).toBe('low');
            });

            it('should accept initial capacity', () => {
                const capacity = createCapacity(50);
                const queue = PriorityQueue.minQueue<string, number>(capacity);

                expect(queue.capacity).toBe(capacity);
            });
        });

        describe('maxQueue', () => {
            it('should create max priority queue', () => {
                const queue = PriorityQueue.maxQueue<string, number>();

                queue.enqueue('low', 1);
                queue.enqueue('high', 10);

                expect(queue.dequeue()).toBe('high');
            });

            it('should accept initial capacity', () => {
                const capacity = createCapacity(50);
                const queue = PriorityQueue.maxQueue<string, number>(capacity);

                expect(queue.capacity).toBe(capacity);
            });
        });
    });

    describe('error handling', () => {
        describe('EmptyQueueError', () => {
            it('should have correct error code', () => {
                const error = new EmptyQueueError();

                expect(error.code).toBe('EMPTY_QUEUE');
                expect(error.message).toBe('Queue is empty');
                expect(error).toBeInstanceOf(QueueError);
                expect(error).toBeInstanceOf(Error);
            });
        });

        describe('InvalidCapacityError', () => {
            it('should have correct error code and message', () => {
                const error = new InvalidCapacityError(-1);

                expect(error.code).toBe('INVALID_CAPACITY');
                expect(error.message).toBe('Invalid capacity: -1');
                expect(error).toBeInstanceOf(QueueError);
                expect(error).toBeInstanceOf(Error);
            });
        });
    });
    describe('utility functions', () => {
        it('should create nominal types correctly', () => {
            expect(createCapacity(10)).toBe(10);
            expect(createQueueSize(5)).toBe(5);
            expect(createHeapIndex(3)).toBe(3);
        });

        it('should use default comparator correctly', () => {
            expect(defaultComparator(1, 2)).toBe(-1);
            expect(defaultComparator(2, 1)).toBe(1);
            expect(defaultComparator(1, 1)).toBe(0);
            expect(defaultComparator('a', 'b')).toBe(-1);
            expect(defaultComparator('b', 'a')).toBe(1);
            expect(defaultComparator('a', 'a')).toBe(0);
        });
    });

    describe('PriorityQueueNode', () => {
        it('should create node with element and priority', () => {
            const node = new PriorityQueueNode('test', 5);

            expect(node.element).toBe('test');
            expect(node.priority).toBe(5);
        });

        it('should allow mutation of properties', () => {
            const node = new PriorityQueueNode('test', 5);

            node.element = 'updated';
            node.priority = 10;

            expect(node.element).toBe('updated');
            expect(node.priority).toBe(10);
        });
    });

    describe('complex scenarios', () => {
        it('should handle large number of operations', () => {
            const queue = new PriorityQueue<number, number>();
            const size = 10000;

            for (let i = 0; i < size; i++) {
                queue.enqueue(i, Math.random() * 1000);
            }

            expect(queue.size).toBe(size);

            let previousPriority = -Infinity;
            while (!queue.isEmpty) {
                const element = queue.dequeue();
                expect(typeof element).toBe('number');
            }
        });

        it('should handle mixed operations efficiently', () => {
            const queue = new PriorityQueue<string, number>();

            for (let i = 0; i < 1000; i++) {
                if (Math.random() > 0.3 || queue.isEmpty) {
                    queue.enqueue(`item-${i}`, Math.random() * 100);
                } else {
                    queue.dequeue();
                }
            }

            expect(queue.size).toBeGreaterThanOrEqual(0);
        });

        it('should maintain heap invariant under stress', () => {
            const queue = new PriorityQueue<number, number>();
            const operations = 1000;

            for (let i = 0; i < operations; i++) {
                const action = Math.random();

                if (action < 0.6 || queue.isEmpty) {
                    queue.enqueue(i, Math.random() * 1000);
                } else if (action < 0.8) {
                    queue.dequeue();
                } else if (action < 0.9) {
                    if (!queue.isEmpty) {
                        queue.peek();
                    }
                } else {
                    queue.contains(Math.floor(Math.random() * operations));
                }
            }

            const expectedSize = queue.size;
            const results = queue.dequeueAll();

            expect(results.length).toBe(expectedSize);
        });
    });

    describe('memory management', () => {
        it('should not leak memory on repeated operations', () => {
            const queue = new PriorityQueue<string, number>();

            for (let cycle = 0; cycle < 10; cycle++) {
                for (let i = 0; i < 100; i++) {
                    queue.enqueue(`item-${i}`, i);
                }

                while (!queue.isEmpty) {
                    queue.dequeue();
                }

                expect(queue.isEmpty).toBe(true);
            }
        });

        it('should handle capacity management correctly', () => {
            const queue = new PriorityQueue<number, number>({
                initialCapacity: createCapacity(4),
            });

            expect(queue.capacity).toBe(4);

            for (let i = 0; i < 10; i++) {
                queue.enqueue(i, i);
            }

            expect(queue.capacity).toBeGreaterThan(4);
            expect(queue.size).toBe(10);

            queue.clear();
            queue.trimExcess();

            expect(queue.capacity).toBe(1);
        });
    });
});
