import {
    Comparator,
    HeapIndex,
    QueueSize,
    Capacity,
    ReadonlyQueueNode,
    QueueNode,
    PriorityQueueOptions,
    PriorityQueueCore,
    OptionalOperations,
    QueryOperations,
    CapacityOperations,
} from './types';

import { EmptyQueueError, InvalidCapacityError, QueueError } from './errors';

import {
    createHeapIndex,
    createQueueSize,
    createCapacity,
    defaultComparator,
    getParentIndex,
    getLeftChildIndex,
    getRightChildIndex,
    hasParent,
    hasLeftChild,
    hasRightChild,
} from './utils';

import { DynamicArray } from './dynamic-array';
import { BinaryMinHeap } from './binary-heap';
import { PriorityQueueNode } from './node';

export class PriorityQueue<TElement, TPriority = number>
    implements
        PriorityQueueCore<TElement, TPriority>,
        OptionalOperations<TElement, TPriority>,
        QueryOperations<TElement>,
        CapacityOperations,
        Iterable<TElement>
{
    private heap: BinaryMinHeap<PriorityQueueNode<TElement, TPriority>>;
    private comparator: Comparator<TPriority>;
    private autoTrimEnabled: boolean;

    constructor(options?: PriorityQueueOptions<TPriority>) {
        this.comparator = options?.comparator ?? (defaultComparator as Comparator<TPriority>);
        this.autoTrimEnabled = options?.autoTrim ?? false;

        const nodeComparator: Comparator<PriorityQueueNode<TElement, TPriority>> = (a, b) =>
            this.comparator(a.priority, b.priority);

        this.heap = new BinaryMinHeap(nodeComparator, options?.initialCapacity);
    }

    get size(): QueueSize {
        return this.heap.size;
    }

    get isEmpty(): boolean {
        return this.heap.isEmpty;
    }

    get capacity(): Capacity {
        return this.heap.capacity;
    }

    enqueue(element: TElement, priority: TPriority): void {
        const node = new PriorityQueueNode(element, priority);
        this.heap.insert(node);
    }

    dequeue(): TElement {
        const node = this.heap.extract();

        if (this.autoTrimEnabled && this.shouldAutoTrim()) {
            this.trimExcess();
        }

        return node.element;
    }

    peek(): TElement {
        const node = this.heap.peek();
        return node.element;
    }

    tryDequeue(): TElement | undefined {
        if (this.isEmpty) {
            return undefined;
        }
        return this.dequeue();
    }

    tryPeek(): TElement | undefined {
        if (this.isEmpty) {
            return undefined;
        }
        return this.peek();
    }

    dequeueAll(): TElement[] {
        const result: TElement[] = [];
        while (!this.isEmpty) {
            result.push(this.dequeue());
        }
        return result;
    }

    enqueueRange(items: ReadonlyArray<ReadonlyQueueNode<TElement, TPriority>>): void {
        if (items.length === 0) return;

        this.ensureCapacity(createCapacity((this.size as unknown as number) + items.length));

        for (const item of items) {
            this.enqueue(item.element, item.priority);
        }
    }

    contains(element: TElement): boolean {
        return this.heap.toArray().some((node) => node.element === element);
    }

    clear(): void {
        this.heap.clear();
    }

    ensureCapacity(capacity: Capacity): void {
        this.heap.ensureCapacity(capacity);
    }

    trimExcess(): void {
        this.heap.trimExcess();
    }

    toArray(): ReadonlyArray<TElement> {
        return Object.freeze(this.heap.toArray().map((node) => node.element));
    }

    clone(): PriorityQueue<TElement, TPriority> {
        const cloned = new PriorityQueue<TElement, TPriority>({
            comparator: this.comparator,
            initialCapacity: this.capacity,
            autoTrim: this.autoTrimEnabled,
        });

        const nodes = this.heap.toArray();
        const nodeItems = nodes.map((node) => ({
            element: node.element,
            priority: node.priority,
        }));

        cloned.enqueueRange(nodeItems);
        return cloned;
    }

    *[Symbol.iterator](): Iterator<TElement> {
        const clone = this.clone();

        while (!clone.isEmpty) {
            yield clone.dequeue();
        }
    }

    static from<T, P = number>(
        items: Iterable<ReadonlyQueueNode<T, P>>,
        options?: PriorityQueueOptions<P>
    ): PriorityQueue<T, P> {
        const queue = new PriorityQueue<T, P>(options);
        const itemArray = Array.isArray(items) ? items : Array.from(items);
        queue.enqueueRange(itemArray);
        return queue;
    }

    static withComparator<T, P>(
        comparator: Comparator<P>,
        initialCapacity?: Capacity
    ): PriorityQueue<T, P> {
        return new PriorityQueue<T, P>({
            comparator,
            initialCapacity,
        });
    }

    static minQueue<T, P = number>(initialCapacity?: Capacity): PriorityQueue<T, P> {
        return new PriorityQueue<T, P>({
            comparator: defaultComparator as Comparator<P>,
            initialCapacity,
        });
    }

    static maxQueue<T, P = number>(initialCapacity?: Capacity): PriorityQueue<T, P> {
        const maxComparator: Comparator<P> = (a, b) => (defaultComparator as Comparator<P>)(b, a);

        return new PriorityQueue<T, P>({
            comparator: maxComparator,
            initialCapacity,
        });
    }

    private shouldAutoTrim(): boolean {
        return (
            (this.capacity as unknown as number) > 32 &&
            (this.size as unknown as number) < (this.capacity as unknown as number) / 4
        );
    }
}

export type {
    Comparator,
    HeapIndex,
    QueueSize,
    Capacity,
    ReadonlyQueueNode,
    QueueNode,
    PriorityQueueOptions,
    PriorityQueueCore,
    OptionalOperations,
    QueryOperations,
    CapacityOperations,
};

export {
    QueueError,
    EmptyQueueError,
    InvalidCapacityError,
    PriorityQueueNode,
    createHeapIndex,
    createQueueSize,
    createCapacity,
    defaultComparator,
};
