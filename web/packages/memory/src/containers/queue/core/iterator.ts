import type { MemoryChunk } from './chunk';

const ITERATOR_DONE: IteratorReturnResult<undefined> = Object.freeze({
    done: true,
    value: undefined,
});

export class QueueIterator<T> implements Iterator<T> {
    private _chunk: MemoryChunk<T> | null;
    private _index: number;
    private _remaining: number;

    constructor(head: MemoryChunk<T>, size: number) {
        this._chunk = head;
        this._index = head.readHead;
        this._remaining = size;
    }

    public next(): IteratorResult<T> {
        if (this._remaining === 0) {
            return ITERATOR_DONE;
        }

        let chunk = this._chunk!;
        while (chunk.next !== null && this._index >= chunk.writeHead) {
            chunk = chunk.next;
            this._index = 0;
        }

        const value = chunk.slotAt(this._index);
        this._index = (this._index + 1) | 0;
        this._remaining = (this._remaining - 1) | 0;
        this._chunk = chunk;

        return { done: false, value };
    }
}
