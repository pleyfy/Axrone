declare const __nominal: unique symbol;

export type Nominal<T, K> = T & { readonly [__nominal]: K };

export type Comparator<T> = (a: T, b: T) => number;

export type HeapIndex = Nominal<number, 'HeapIndex'>;
export type QueueSize = Nominal<number, 'QueueSize'>;
export type Capacity = Nominal<number, 'Capacity'>;

export interface BinaryHeapOperations<T> {
    insert(item: T): void;
    extract(): T;

    peek(): T;
    readonly size: QueueSize;
    readonly isEmpty: boolean;

    clear(): void;
}
