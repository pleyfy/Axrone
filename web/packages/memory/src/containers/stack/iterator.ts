export class ChunkedStackIterator<T> implements Iterator<T> {
    private readonly _chunks: readonly (readonly (T | undefined)[])[];
    private _cursor: number;

    constructor(
        chunks: readonly (readonly (T | undefined)[])[],
        size: number
    ) {
        this._chunks = chunks;
        this._cursor = (size - 1) | 0;
    }

    next(): IteratorResult<T> {
        const cursor = this._cursor;
        if (cursor < 0) {
            return ITERATOR_DONE;
        }
        this._cursor = (cursor - 1) | 0;
        const chunkIdx = cursor >>> 6;
        const slotIdx = cursor & 63;
        const chunk = this._chunks[chunkIdx];
        if (chunk === undefined) {
            return ITERATOR_DONE;
        }
        const value = chunk[slotIdx] as T;
        return { done: false, value };
    }
}

const ITERATOR_DONE: IteratorReturnResult<undefined> = Object.freeze({
    done: true,
    value: undefined,
});
