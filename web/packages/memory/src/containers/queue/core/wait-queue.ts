import type { Result } from '@axrone/utility';
import type {
    QueueAbortError,
    QueueClosedError,
    QueueFullError,
} from './errors';

export interface ILinkedListNode<N> {
    prev: N | null;
    next: N | null;
}

export class IntrusiveQueue<N extends ILinkedListNode<N>> {
    public head: N | null = null;
    public tail: N | null = null;
    public length: number = 0;

    public append(node: N): void {
        if (this.tail === null) {
            this.head = node;
            this.tail = node;
            node.prev = null;
            node.next = null;
        } else {
            node.prev = this.tail;
            node.next = null;
            this.tail.next = node;
            this.tail = node;
        }
        this.length++;
    }

    public remove(node: N): void {
        if (node.prev !== null) {
            node.prev.next = node.next;
        } else if (this.head === node) {
            this.head = node.next;
        }

        if (node.next !== null) {
            node.next.prev = node.prev;
        } else if (this.tail === node) {
            this.tail = node.prev;
        }

        node.prev = null;
        node.next = null;
        this.length--;
    }

    public shift(): N | null {
        const first = this.head;
        if (first === null) {
            return null;
        }
        this.remove(first);
        return first;
    }
}

export class ConsumerWaitNode<T> implements ILinkedListNode<ConsumerWaitNode<T>> {
    public prev: ConsumerWaitNode<T> | null = null;
    public next: ConsumerWaitNode<T> | null = null;
    public readonly signal: AbortSignal | undefined;
    public listener: (() => void) | null = null;
    public readonly resolve: (result: Result<T, QueueClosedError | QueueAbortError>) => void;

    constructor(
        resolve: (result: Result<T, QueueClosedError | QueueAbortError>) => void,
        signal: AbortSignal | undefined
    ) {
        this.resolve = resolve;
        this.signal = signal;
    }

    public detach(): void {
        this.prev = null;
        this.next = null;
        if (this.signal !== undefined && this.listener !== null) {
            this.signal.removeEventListener('abort', this.listener);
            this.listener = null;
        }
    }
}

export class ProducerWaitNode<T> implements ILinkedListNode<ProducerWaitNode<T>> {
    public prev: ProducerWaitNode<T> | null = null;
    public next: ProducerWaitNode<T> | null = null;
    public readonly element: T;
    public readonly signal: AbortSignal | undefined;
    public listener: (() => void) | null = null;
    public readonly resolve: (
        result: Result<void, QueueFullError | QueueClosedError | QueueAbortError>
    ) => void;

    constructor(
        element: T,
        resolve: (result: Result<void, QueueFullError | QueueClosedError | QueueAbortError>) => void,
        signal: AbortSignal | undefined
    ) {
        this.element = element;
        this.resolve = resolve;
        this.signal = signal;
    }

    public detach(): void {
        this.prev = null;
        this.next = null;
        if (this.signal !== undefined && this.listener !== null) {
            this.signal.removeEventListener('abort', this.listener);
            this.listener = null;
        }
    }
}

export class DrainWaitNode implements ILinkedListNode<DrainWaitNode> {
    public prev: DrainWaitNode | null = null;
    public next: DrainWaitNode | null = null;
    public readonly signal: AbortSignal | undefined;
    public listener: (() => void) | null = null;
    public readonly resolve: () => void;
    public readonly reject: (reason: QueueAbortError) => void;

    constructor(
        resolve: () => void,
        reject: (reason: QueueAbortError) => void,
        signal: AbortSignal | undefined
    ) {
        this.resolve = resolve;
        this.reject = reject;
        this.signal = signal;
    }

    public detach(): void {
        this.prev = null;
        this.next = null;
        if (this.signal !== undefined && this.listener !== null) {
            this.signal.removeEventListener('abort', this.listener);
            this.listener = null;
        }
    }
}

export function abortMessage(signal: AbortSignal): string {
    return signal.reason !== undefined ? String(signal.reason) : 'Queue operation aborted.';
}
