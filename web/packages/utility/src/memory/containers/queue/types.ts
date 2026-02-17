declare const __nominal: unique symbol;

export type Nominal<T, K> = T & { readonly [__nominal]: K };

export type Comparator<T> = (a: T, b: T) => number;

export type HeapIndex = Nominal<number, 'HeapIndex'>;
export type QueueSize = Nominal<number, 'QueueSize'>;
export type Capacity = Nominal<number, 'Capacity'>;

export type Priority<T = number> = Nominal<T, 'Priority'>;

export interface ReadonlyQueueNode<TElement, TPriority> {
    readonly element: TElement;
    readonly priority: TPriority;
}

export interface QueueNode<TElement, TPriority> extends ReadonlyQueueNode<TElement, TPriority> {
    element: TElement;
    priority: TPriority;
}

export interface HeapStorage<T> {
    readonly length: QueueSize;
    readonly capacity: Capacity;

    get(index: HeapIndex): T;
    set(index: HeapIndex, value: T): void;

    resize(newCapacity: Capacity): void;
    clear(): void;

    swap?(i: HeapIndex, j: HeapIndex): void;
    ensureCapacity?(minCapacity: Capacity): void;
    trimToSize?(): void;
}

export interface BinaryHeapOperations<T> {
    insert(item: T): void;
    extract(): T;

    peek(): T;
    readonly size: QueueSize;
    readonly isEmpty: boolean;

    clear(): void;
}

export interface PriorityQueueCore<TElement, TPriority> {
    enqueue(element: TElement, priority: TPriority): void;
    dequeue(): TElement;
    peek(): TElement;
    clear(): void;

    readonly size: QueueSize;
    readonly isEmpty: boolean;
}

export interface OptionalOperations<TElement, TPriority> {
    tryDequeue(): TElement | undefined;
    tryPeek(): TElement | undefined;

    dequeueAll(): TElement[];
    enqueueRange(items: ReadonlyArray<ReadonlyQueueNode<TElement, TPriority>>): void;

    dequeueWhere?(predicate: (element: TElement, priority: TPriority) => boolean): TElement[];
    removeWhere?(predicate: (element: TElement, priority: TPriority) => boolean): number;
}

export interface QueryOperations<TElement> {
    contains(element: TElement): boolean;
    toArray(): ReadonlyArray<TElement>;

    find?(predicate: (element: TElement) => boolean): TElement | undefined;
    filter?(predicate: (element: TElement) => boolean): ReadonlyArray<TElement>;
    count?(predicate?: (element: TElement) => boolean): number;
}

export interface CapacityOperations {
    ensureCapacity(capacity: Capacity): void;
    trimExcess(): void;
    readonly capacity: Capacity;

    reserveCapacity?(additionalCapacity: Capacity): void;
    shrinkToFit?(): void;
    getMemoryUsage?(): { used: number; allocated: number; overhead: number };
}

export type PriorityQueueOptions<TPriority> = {
    readonly comparator?: Comparator<TPriority>;
    readonly initialCapacity?: Capacity;
    readonly autoTrim?: boolean;
    readonly growthFactor?: number;
    readonly shrinkThreshold?: number;
};

export type AdvancedQueueOptions<TElement, TPriority> = PriorityQueueOptions<TPriority> & {
    readonly customAllocator?: HeapStorage<QueueNode<TElement, TPriority>>;
    readonly maxSize?: QueueSize;
    readonly strictCapacity?: boolean;
};

export interface QueueIterator<TElement, TPriority> {
    [Symbol.iterator](): Iterator<TElement>;

    entries(): Iterator<[TElement, TPriority]>;
    priorities(): Iterator<TPriority>;
    nodes(): Iterator<ReadonlyQueueNode<TElement, TPriority>>;
}
