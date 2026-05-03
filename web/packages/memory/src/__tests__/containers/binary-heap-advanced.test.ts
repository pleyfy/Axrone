import { describe, expect, it } from 'vitest';
import { BinaryHeap, createBinaryHeap, isBinaryHeap } from '../../containers/queue/binary-heap';

describe('BinaryHeap', () => {
    it('should build min and max heaps with the expected ordering', () => {
        const minHeap = BinaryHeap.min<number>([3, 1, 2]);
        const maxHeap = BinaryHeap.max<number>([3, 1, 2]);

        expect(minHeap.peek()).toBe(1);
        expect(maxHeap.peek()).toBe(3);
        expect(minHeap.toSortedArray()).toEqual([1, 2, 3]);
        expect(maxHeap.toSortedArray()).toEqual([3, 2, 1]);
    });

    it('should support push, pop, replaceTop, pushPop, and removeAt', () => {
        const heap = createBinaryHeap<number>({ comparator: (left, right) => left - right });

        heap.pushAll([5, 1, 3]);

        expect(heap.pushPop(2)).toBe(1);
        expect(heap.peek()).toBe(2);
        expect(heap.replaceTop(4)).toBe(2);
        expect(heap.peek()).toBe(3);
        expect(heap.removeAt(1)).toBe(5);
        expect(heap.pop()).toBe(3);
        expect(heap.pop()).toBe(4);
        expect(heap.pop()).toBeUndefined();
    });

    it('should clone and serialize without sharing internal storage', () => {
        const heap = BinaryHeap.from([4, 1, 3]);
        const clone = heap.clone();
        const snapshot = heap.toJSON();
        const restored = BinaryHeap.deserialize<number>(snapshot);

        clone.push(0);

        expect(heap.peek()).toBe(1);
        expect(clone.peek()).toBe(0);
        expect(restored.toSortedArray()).toEqual([1, 3, 4]);
        expect(isBinaryHeap(heap)).toBe(true);
        expect(isBinaryHeap({ peek: () => undefined })).toBe(false);
    });
});