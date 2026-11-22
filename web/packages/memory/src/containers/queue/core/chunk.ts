import { assertNever, throwCorruptedSlot } from './errors';

export const CHUNK_SIZE = 512;
export const CHUNK_POOL_LIMIT = 1024;
export const EMPTY_SLOT: unique symbol = Symbol('EMPTY_SLOT');
export type EmptySlot = typeof EMPTY_SLOT;

export function assertItemSlot<V>(value: V | EmptySlot): asserts value is V {
    if (value === EMPTY_SLOT) {
        throwCorruptedSlot();
    }
}

export class MemoryChunk<T> {
    public next: MemoryChunk<T> | null = null;
    public readHead: number = 0;
    public writeHead: number = 0;
    private readonly _slots: (T | EmptySlot)[];

    constructor() {
        this._slots = new Array<T | EmptySlot>(CHUNK_SIZE).fill(EMPTY_SLOT);
    }

    public write(item: T): void {
        this._slots[this.writeHead] = item;
        this.writeHead++;
    }

    public read(): T {
        const index = this.readHead;
        const value = this._slots[index];
        this._slots[index] = EMPTY_SLOT;
        this.readHead = index + 1;
        assertItemSlot(value);
        return value;
    }

    public peek(): T | undefined {
        const value = this._slots[this.readHead];
        return value === EMPTY_SLOT ? undefined : (value as T);
    }

    public slotAt(index: number): T {
        return this._slots[index] as T;
    }

    public reset(): void {
        const slots = this._slots;
        const start = this.readHead;
        const end = this.writeHead;
        for (let i = start; i < end; i = (i + 1) | 0) {
            slots[i] = EMPTY_SLOT;
        }
        this.next = null;
        this.readHead = 0;
        this.writeHead = 0;
    }
}

export interface IChunkAllocator<T> {
    acquire(): MemoryChunk<T>;
    release(chunk: MemoryChunk<T>): void;
    clear(): void;
}

export class ChunkPool<T> implements IChunkAllocator<T> {
    private _head: MemoryChunk<T> | null = null;
    private _size: number = 0;

    public acquire(): MemoryChunk<T> {
        const chunk = this._head;
        if (chunk !== null) {
            this._head = chunk.next;
            chunk.next = null;
            this._size--;
            return chunk;
        }
        return new MemoryChunk<T>();
    }

    public release(chunk: MemoryChunk<T>): void {
        if (this._size < CHUNK_POOL_LIMIT) {
            chunk.reset();
            chunk.next = this._head;
            this._head = chunk;
            this._size++;
        } else {
            chunk.reset();
        }
    }

    public clear(): void {
        let cursor = this._head;
        while (cursor !== null) {
            const next = cursor.next;
            cursor.reset();
            cursor = next;
        }
        this._head = null;
        this._size = 0;
    }
}

export { assertNever };
