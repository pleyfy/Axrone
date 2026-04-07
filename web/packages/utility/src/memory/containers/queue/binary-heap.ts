import { BinaryHeapOperations, HeapIndex, QueueSize, Capacity, Comparator } from './types';
import { DynamicArray } from './dynamic-array';
import { EmptyQueueError } from './errors';

export class BinaryMinHeap<T> implements BinaryHeapOperations<T> {
    private storage: DynamicArray<T>;
    private compare: Comparator<T>;
    private _size: number;

    constructor(comparator: Comparator<T>, initialCapacity?: Capacity) {
        this.compare = comparator;
        this.storage = new DynamicArray<T>(initialCapacity);
        this._size = 0;
    }

    get size(): QueueSize {
        return this._size as QueueSize;
    }

    get isEmpty(): boolean {
        return this._size === 0;
    }

    get capacity(): Capacity {
        return this.storage.capacity;
    }

    insert(item: T): void {
        this.storage.push(item);
        this._size++;

        let currentIndex = this._size - 1;

        if (currentIndex > 0) {
            let parentIndex = (currentIndex - 1) >>> 1;

            while (
                currentIndex > 0 &&
                this.compare(item, this.storage.get(parentIndex as HeapIndex)) < 0
            ) {
                this.storage.set(
                    currentIndex as HeapIndex,
                    this.storage.get(parentIndex as HeapIndex)
                );
                currentIndex = parentIndex;
                parentIndex = (currentIndex - 1) >>> 1;
            }

            this.storage.set(currentIndex as HeapIndex, item);
        }
    }

    extract(): T {
        if (this._size === 0) {
            throw new EmptyQueueError();
        }

        const root = this.storage.get(0 as HeapIndex);

        if (this._size === 1) {
            this._size = 0;
            this.storage.clear();
            return root;
        }

        const lastItem = this.storage.pop();
        this._size--;
        this.storage.set(0 as HeapIndex, lastItem);

        this.siftDown(0, lastItem);

        return root;
    }

    peek(): T {
        if (this._size === 0) {
            throw new EmptyQueueError();
        }
        return this.storage.get(0 as HeapIndex);
    }

    clear(): void {
        this.storage.clear();
        this._size = 0;
    }

    ensureCapacity(capacity: Capacity): void {
        this.storage.ensureCapacity(capacity);
    }

    trimExcess(): void {
        this.storage.trimToSize();
    }

    contains(item: T): boolean {
        for (let i = 0; i < this._size; i++) {
            if (this.storage.get(i as HeapIndex) === item) {
                return true;
            }
        }
        return false;
    }

    toArray(): T[] {
        return this.storage.slice();
    }

    private siftDown(startIndex: number, item: T): void {
        let holeIndex = startIndex;
        const halfSize = this._size >>> 1;

        while (holeIndex < halfSize) {
            let childIndex = (holeIndex << 1) + 1;
            const rightChildIndex = childIndex + 1;

            if (rightChildIndex < this._size) {
                const leftChild = this.storage.get(childIndex as HeapIndex);
                const rightChild = this.storage.get(rightChildIndex as HeapIndex);

                if (this.compare(rightChild, leftChild) < 0) {
                    childIndex = rightChildIndex;
                }
            }

            const child = this.storage.get(childIndex as HeapIndex);

            if (this.compare(item, child) <= 0) {
                break;
            }

            this.storage.set(holeIndex as HeapIndex, child);
            holeIndex = childIndex;
        }

        this.storage.set(holeIndex as HeapIndex, item);
    }
}
