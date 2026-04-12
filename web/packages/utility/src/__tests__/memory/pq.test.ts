import { describe, expect, it } from 'vitest';
import {
    PriorityQueue,
    PriorityQueueComparatorError,
    PriorityQueueHandleError,
    PriorityQueuePriorityError,
    PriorityQueueSerializationError,
    createPriorityQueue,
    isPriorityQueue,
} from '../../memory/containers/queue/priority-queue';

describe('PriorityQueue', () => {
    it('dequeues highest priority items first in default max order', () => {
        const queue = new PriorityQueue<string, number>();

        queue.enqueue('low', 1);
        queue.enqueue('high', 10);
        queue.enqueue('medium', 5);

        expect(queue.dequeue()).toBe('high');
        expect(queue.dequeue()).toBe('medium');
        expect(queue.dequeue()).toBe('low');
    });

    it('supports min order helpers', () => {
        const queue = PriorityQueue.min<string, number>();

        queue.enqueue('low', 1);
        queue.enqueue('high', 10);

        expect(queue.peek()).toBe('low');
        expect(queue.dequeue()).toBe('low');
        expect(queue.dequeue()).toBe('high');
    });

    it('keeps insertion order stable for equal priorities', () => {
        const queue = new PriorityQueue<string, number>();

        queue.enqueue('first', 7);
        queue.enqueue('second', 7);
        queue.enqueue('third', 7);

        expect(queue.drain()).toEqual(['first', 'second', 'third']);
    });

    it('returns handles and snapshots for queued items', () => {
        const queue = new PriorityQueue<string, number>();
        const handle = queue.enqueue('alpha', 3);

        expect(queue.has(handle)).toBe(true);
        expect(queue.peekHandle()).toBe(handle);
        expect(queue.peekPriority()).toBe(3);
        expect(queue.get(handle)).toEqual({ value: 'alpha', priority: 3, handle });
        expect(queue.peekEntry()).toEqual({ value: 'alpha', priority: 3, handle });
    });

    it('updates and removes entries by handle', () => {
        const queue = new PriorityQueue<string, number>();
        const first = queue.enqueue('first', 1);
        const second = queue.enqueue('second', 2);

        expect(queue.updateValue(first, 'first-updated')).toBe(true);
        expect(queue.updatePriority(first, 10)).toBe(true);
        expect(queue.peek()).toBe('first-updated');

        const removed = queue.remove(second);

        expect(removed).toEqual({ value: 'second', priority: 2, handle: second });
        expect(queue.has(second)).toBe(false);
        expect(queue.contains('second')).toBe(false);
    });

    it('supports replaceHead', () => {
        const queue = new PriorityQueue<string, number>();

        queue.enqueue('first', 1);
        queue.enqueue('second', 2);

        const head = queue.peekEntry();
        const removed = queue.replaceHead('replacement', 3);

        expect(removed).toEqual(head);
        expect(queue.peek()).toBe('replacement');
    });

    it('builds from entries and values', () => {
        const fromEntries = PriorityQueue.fromEntries<string, number>([
            { value: 'c', priority: 3 },
            { value: 'a', priority: 1 },
            { value: 'b', priority: 2 },
        ]);

        const fromValues = PriorityQueue.fromValues(['gamma', 'alpha', 'beta'], {
            priority: (value) => value.length,
        });

        expect(fromEntries.drain()).toEqual(['c', 'b', 'a']);
        expect(fromValues.drain()).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('serializes and restores queue state', () => {
        const queue = PriorityQueue.min<string, number>();

        queue.enqueue('b', 2);
        queue.enqueue('a', 1);

        const json = queue.toJSON();
        const restored = PriorityQueue.deserialize<string, number, 'min'>(json);

        expect(json).toEqual({
            kind: 'PriorityQueue',
            version: 1,
            order: 'min',
            items: [
                { value: 'a', priority: 1 },
                { value: 'b', priority: 2 },
            ],
        });
        expect(restored.drain()).toEqual(['a', 'b']);
    });

    it('clones without sharing mutable state', () => {
        const queue = new PriorityQueue<string, number>();
        const handle = queue.enqueue('alpha', 1);
        const clone = queue.clone();

        expect(clone.peek()).toBe('alpha');
        expect(clone.updateValue(handle, 'beta')).toBe(true);
        expect(queue.peek()).toBe('alpha');
        expect(clone.peek()).toBe('beta');
    });

    it('supports iteration and sorted views', () => {
        const queue = new PriorityQueue<string, number>();

        queue.enqueue('first', 1);
        queue.enqueue('second', 2);

        expect([...queue]).toEqual(['second', 'first']);
        expect(queue.toSortedArray()).toEqual(['second', 'first']);
        expect(queue.toSortedEntries().map((entry) => entry.value)).toEqual(['second', 'first']);
    });

    it('uses priority selectors when values are enqueued without explicit priority', () => {
        const queue = new PriorityQueue<{ id: string; score: number }, number>({
            priority: (value) => value.score,
        });

        queue.enqueue({ id: 'low', score: 1 });
        queue.enqueue({ id: 'high', score: 10 });

        expect(queue.dequeue()?.id).toBe('high');
    });

    it('reports type helpers and errors', () => {
        const queue = new PriorityQueue<string, number>();
        const handle = queue.enqueue('alpha', 1);

        expect(isPriorityQueue(queue)).toBe(true);
        expect(isPriorityQueue(null)).toBe(false);
        expect(queue.assertHas(handle)).toEqual({ value: 'alpha', priority: 1, handle });
        expect(() => queue.assertHas(123 as never)).toThrow(PriorityQueueHandleError);
        expect(() => new PriorityQueue<string, number>({ comparator: {} as never })).toThrow(
            PriorityQueueComparatorError
        );
        expect(() => new PriorityQueue<string, number>().enqueue('a')).toThrow(
            PriorityQueuePriorityError
        );
        expect(() =>
            PriorityQueue.deserialize<string, number>({ kind: 'Bad', version: 1, items: [] })
        ).toThrow(PriorityQueueSerializationError);
    });
});

describe('PriorityQueue factories', () => {
    it('createPriorityQueue returns a usable queue', () => {
        const queue = createPriorityQueue<string, number>({
            priority: (value) => value.length,
        });

        queue.enqueue('alpha');

        expect(queue.peek()).toBe('alpha');
    });

    it('PriorityQueue.max and PriorityQueue.min use the expected order', () => {
        const maxQueue = PriorityQueue.max<string, number>();
        const minQueue = PriorityQueue.min<string, number>();

        maxQueue.enqueue('low', 1);
        maxQueue.enqueue('high', 10);
        minQueue.enqueue('low', 1);
        minQueue.enqueue('high', 10);

        expect(maxQueue.peek()).toBe('high');
        expect(minQueue.peek()).toBe('low');
    });
});
