import { StackNode } from './types';

export class StackIterator<T> implements IterableIterator<T> {
    private current: StackNode<T> | null;
    private readonly checksum: number;
    private position = 0;

    constructor(head: StackNode<T> | null, checksum: number) {
        this.current = head;
        this.checksum = checksum;
    }

    [Symbol.iterator](): IterableIterator<T> {
        return new StackIterator(this.current, this.checksum);
    }

    next(): IteratorResult<T> {
        if (this.current === null) {
            return { done: true, value: undefined };
        }

        const { value } = this.current;
        this.current = this.current.next;
        this.position++;

        return { done: false, value };
    }
}
