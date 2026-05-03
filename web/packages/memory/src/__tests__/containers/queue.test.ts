import { beforeEach, describe, expect, it } from 'vitest';
import {
    Queue,
    EmptyQueueError,
    InvalidCapacityError,
    createCapacity,
    createQueueSize,
} from '../../containers/queue';

describe('Queue', () => {
    describe('Constructor', () => {
        it('should create an empty queue with default options', () => {
            const queue = new Queue<number>();

            expect(queue.size).toBe(createQueueSize(0));
            expect(queue.isEmpty).toBe(true);
            expect(queue.capacity).toBe(createCapacity(16));
        });

        it('should honor a custom initial capacity', () => {
            const queue = new Queue<number>({ initialCapacity: createCapacity(32) });

            expect(queue.capacity).toBe(createCapacity(32));
            expect(queue.size).toBe(createQueueSize(0));
        });

        it('should reject invalid initial capacities', () => {
            expect(() => new Queue<number>({ initialCapacity: createCapacity(0) })).toThrow(
                InvalidCapacityError
            );
        });
    });

    describe('FIFO Operations', () => {
        let queue: Queue<string>;

        beforeEach(() => {
            queue = new Queue<string>({ initialCapacity: createCapacity(4) });
        });

        it('should preserve insertion order across enqueue and dequeue', () => {
            queue.enqueue('first');
            queue.enqueue('second');
            queue.enqueue('third');

            expect(queue.dequeue()).toBe('first');
            expect(queue.dequeue()).toBe('second');
            expect(queue.dequeue()).toBe('third');
            expect(queue.isEmpty).toBe(true);
        });

        it('should support wrap-around without losing order', () => {
            queue.enqueue('a');
            queue.enqueue('b');
            queue.enqueue('c');

            expect(queue.dequeue()).toBe('a');
            expect(queue.dequeue()).toBe('b');

            queue.enqueue('d');
            queue.enqueue('e');
            queue.enqueue('f');

            expect(queue.toArray()).toEqual(['c', 'd', 'e', 'f']);
            expect(queue.dequeue()).toBe('c');
            expect(queue.dequeue()).toBe('d');
            expect(queue.dequeue()).toBe('e');
            expect(queue.dequeue()).toBe('f');
        });

        it('should grow capacity when the ring buffer fills up', () => {
            const initialCapacity = queue.capacity;

            queue.enqueue('a');
            queue.enqueue('b');
            queue.enqueue('c');
            queue.enqueue('d');
            queue.enqueue('e');

            expect(queue.capacity).toBeGreaterThan(initialCapacity);
            expect(queue.toArray()).toEqual(['a', 'b', 'c', 'd', 'e']);
        });
    });

    describe('Safe Accessors', () => {
        let queue: Queue<number>;

        beforeEach(() => {
            queue = new Queue<number>();
        });

        it('should throw when dequeuing from an empty queue', () => {
            expect(() => queue.dequeue()).toThrow(EmptyQueueError);
        });

        it('should throw when peeking into an empty queue', () => {
            expect(() => queue.peek()).toThrow(EmptyQueueError);
        });

        it('should expose undefined-safe accessors for empty queues', () => {
            expect(queue.tryDequeue()).toBeUndefined();
            expect(queue.tryPeek()).toBeUndefined();
        });

        it('should peek without consuming the head item', () => {
            queue.enqueue(10);
            queue.enqueue(20);

            expect(queue.peek()).toBe(10);
            expect(queue.tryPeek()).toBe(10);
            expect(queue.size).toBe(createQueueSize(2));
        });
    });

    describe('Bulk and Utility Operations', () => {
        it('should enqueue ranges from arrays and iterables', () => {
            const queue = new Queue<number>();

            queue.enqueueRange([1, 2, 3]);
            queue.enqueueRange(new Set([4, 5]));

            expect(queue.toArray()).toEqual([1, 2, 3, 4, 5]);
        });

        it('should report membership using reference equality', () => {
            const queue = new Queue<object>();
            const first = { id: 1 };
            const second = { id: 2 };

            queue.enqueue(first);

            expect(queue.contains(first)).toBe(true);
            expect(queue.contains(second)).toBe(false);
        });

        it('should expose a frozen snapshot with toArray', () => {
            const queue = new Queue<string>();
            queue.enqueueRange(['alpha', 'beta', 'gamma']);

            const snapshot = queue.toArray();

            expect(snapshot).toEqual(['alpha', 'beta', 'gamma']);
            expect(Object.isFrozen(snapshot)).toBe(true);
        });

        it('should iterate in FIFO order', () => {
            const queue = new Queue<number>();
            queue.enqueueRange([1, 2, 3, 4]);

            expect([...queue]).toEqual([1, 2, 3, 4]);
        });

        it('should clone queue state without sharing storage', () => {
            const queue = new Queue<string>({ initialCapacity: createCapacity(8) });
            queue.enqueueRange(['north', 'south', 'west']);

            const clone = queue.clone();
            clone.enqueue('east');

            expect(queue.toArray()).toEqual(['north', 'south', 'west']);
            expect(clone.toArray()).toEqual(['north', 'south', 'west', 'east']);
        });
    });

    describe('Capacity Management', () => {
        it('should reserve additional capacity when requested', () => {
            const queue = new Queue<number>({ initialCapacity: createCapacity(4) });

            queue.ensureCapacity(createCapacity(64));

            expect(queue.capacity).toBeGreaterThanOrEqual(createCapacity(64));
        });

        it('should reject invalid ensureCapacity calls', () => {
            const queue = new Queue<number>();

            expect(() => queue.ensureCapacity(createCapacity(0))).toThrow(InvalidCapacityError);
        });

        it('should trim excess capacity to active size', () => {
            const queue = new Queue<number>({ initialCapacity: createCapacity(2) });

            for (let index = 0; index < 24; index++) {
                queue.enqueue(index);
            }

            for (let index = 0; index < 20; index++) {
                queue.dequeue();
            }

            const capacityBeforeTrim = queue.capacity;
            queue.trimExcess();

            expect(queue.capacity).toBeLessThanOrEqual(capacityBeforeTrim);
            expect(queue.capacity).toBeGreaterThanOrEqual(createCapacity(4));
            expect(queue.toArray()).toEqual([20, 21, 22, 23]);
        });

        it('should auto-trim back toward minimum capacity when enabled', () => {
            const queue = new Queue<number>({
                initialCapacity: createCapacity(4),
                autoTrim: true,
            });

            for (let index = 0; index < 40; index++) {
                queue.enqueue(index);
            }

            const expandedCapacity = queue.capacity;

            for (let index = 0; index < 39; index++) {
                queue.dequeue();
            }

            expect(queue.capacity).toBeLessThanOrEqual(expandedCapacity);
            expect(queue.capacity).toBeGreaterThanOrEqual(createCapacity(4));
            expect(queue.toArray()).toEqual([39]);
        });

        it('should reset to minimum capacity on clear when auto-trim is enabled', () => {
            const queue = new Queue<number>({
                initialCapacity: createCapacity(4),
                autoTrim: true,
            });

            queue.ensureCapacity(createCapacity(64));
            queue.enqueueRange([1, 2, 3, 4]);
            queue.clear();

            expect(queue.size).toBe(createQueueSize(0));
            expect(queue.capacity).toBe(createCapacity(4));
            expect(queue.isEmpty).toBe(true);
        });
    });
});