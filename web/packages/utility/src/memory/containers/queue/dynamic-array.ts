import { HeapIndex, QueueSize, Capacity, HeapStorage } from './types';
import { EmptyQueueError, InvalidCapacityError } from './errors';

export class DynamicArray<T> implements HeapStorage<T> {
    private buffer: T[];
    private _length: number;
    private _capacity: number;

    constructor(initialCapacity?: Capacity) {
        const capacity = initialCapacity != null ? (initialCapacity as number) : 16;

        if (capacity < 0) {
            throw new InvalidCapacityError(capacity);
        }

        this._capacity = capacity;
        this._length = 0;

        this.buffer = new Array<T>(capacity);
    }

    get length(): QueueSize {
        return this._length as QueueSize;
    }

    get capacity(): Capacity {
        return this._capacity as Capacity;
    }

    get(index: HeapIndex): T {
        return this.buffer[index as number];
    }

    set(index: HeapIndex, value: T): void {
        this.buffer[index as number] = value;
    }

    push(value: T): void {
        if (this._length >= this._capacity) {
            this.grow();
        }

        this.buffer[this._length] = value;
        this._length++;
    }

    pop(): T {
        if (this._length === 0) {
            throw new EmptyQueueError();
        }

        this._length--;
        return this.buffer[this._length];
    }

    swap(i: HeapIndex, j: HeapIndex): void {
        const buffer = this.buffer;
        const iIndex = i as number;
        const jIndex = j as number;

        const temp = buffer[iIndex];
        buffer[iIndex] = buffer[jIndex];
        buffer[jIndex] = temp;
    }

    resize(newCapacity: Capacity): void {
        const newCap = newCapacity as number;

        if (newCap < this._length) {
            throw new InvalidCapacityError(newCap);
        }

        const newBuffer = new Array<T>(newCap);

        for (let i = 0; i < this._length; i++) {
            newBuffer[i] = this.buffer[i];
        }

        this.buffer = newBuffer;
        this._capacity = newCap;
    }

    ensureCapacity(minCapacity: Capacity): void {
        const minCap = minCapacity as number;

        if (minCap > this._capacity) {
            const newCapacity = Math.max(minCap, this._capacity << 1);
            this.resize(newCapacity as Capacity);
        }
    }

    trimToSize(): void {
        if (this._length < this._capacity) {
            const newCapacity = Math.max(1, this._length);
            this.resize(newCapacity as Capacity);
        }
    }

    clear(): void {
        this._length = 0;
    }

    slice(): T[] {
        return this.buffer.slice(0, this._length);
    }

    private grow(): void {
        const newCapacity = Math.max(this._capacity << 1, this._capacity + 1);
        this.resize(newCapacity as Capacity);
    }
}
