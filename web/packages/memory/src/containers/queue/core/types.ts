import type { Brand, Result } from '@axrone/utility';
import {
    QueueInvalidCapacityError,
    type QueueAbortError,
    type QueueClosedError,
    type QueueEmptyError,
    type QueueFullError,
    type QueueUnderflowError,
} from './errors';

const Symbol_dispose: typeof Symbol.dispose =
    (Symbol as { dispose?: typeof Symbol.dispose }).dispose ??
    (Symbol.for('Symbol.dispose') as never);

const Symbol_asyncDispose: typeof Symbol.asyncDispose =
    (Symbol as { asyncDispose?: typeof Symbol.asyncDispose }).asyncDispose ??
    (Symbol.for('Symbol.asyncDispose') as never);

export type QueueCapacity = Brand<number, 'QueueCapacity'>;
export type QueueSize = Brand<number, 'QueueSize'>;

export const UNBOUNDED_CAPACITY: QueueCapacity = Number.MAX_SAFE_INTEGER as QueueCapacity;

export type Batch<T, N extends number, Acc extends readonly T[] = []> = number extends N
    ? readonly T[]
    : Acc['length'] extends N
      ? Acc
      : Batch<T, N, readonly [...Acc, T]>;

export function isBatch<T, N extends number>(items: readonly T[], count: N): items is Batch<T, N> {
    return items.length === count;
}

export function isValidQueueCapacity(value: number): value is QueueCapacity {
    return Number.isSafeInteger(value) && value > 0;
}

export function isValidQueueSize(value: number): value is QueueSize {
    return Number.isSafeInteger(value) && value >= 0;
}

export function toQueueCapacity(value: number): QueueCapacity {
    if (!isValidQueueCapacity(value)) {
        throw new QueueInvalidCapacityError(value);
    }
    return value;
}

export function toQueueSize(value: number): QueueSize {
    if (!isValidQueueSize(value)) {
        throw new RangeError(`Specified size ${value} is invalid. Expected non-negative safe integer.`);
    }
    return value;
}

export const OverflowStrategy = {
    /** Reject the write and return QueueFullError. */
    Reject: 'REJECT',
    /** Drop the oldest buffered item to make room. */
    DropHead: 'DROP_HEAD',
    /** Discard the incoming item when full. */
    DropTail: 'DROP_TAIL',
    /** Suspend the producer until capacity frees (async only). */
    Block: 'BLOCK',
} as const;

export type OverflowStrategy = (typeof OverflowStrategy)[keyof typeof OverflowStrategy];

export const LifecycleState = {
    /** Accepts reads and writes. */
    Active: 'ACTIVE',
    /** Close called with buffered items; reads drain, writes rejected. */
    Closing: 'CLOSING',
    /** Buffer empty after close; readers released. */
    Drained: 'DRAINED',
    /** Resources released by dispose. */
    Terminated: 'TERMINATED',
} as const;

export type LifecycleState = (typeof LifecycleState)[keyof typeof LifecycleState];

export interface IQueueMetrics {
    readonly onEnqueue?: ((size: QueueSize) => void) | undefined;
    readonly onDequeue?: ((size: QueueSize) => void) | undefined;
    readonly onDrop?: ((strategy: OverflowStrategy) => void) | undefined;
    readonly onSuspendConsumer?: (() => void) | undefined;
    readonly onSuspendProducer?: (() => void) | undefined;
}

export const NULL_METRICS: IQueueMetrics = Object.freeze({
    onEnqueue(): void {},
    onDequeue(): void {},
    onDrop(): void {},
    onSuspendConsumer(): void {},
    onSuspendProducer(): void {},
});

export interface IQueueSource<out T> extends Iterable<T> {
    readonly size: QueueSize;
    readonly capacity: QueueCapacity;
    readonly isEmpty: boolean;
    readonly isClosed: boolean;
    peek(): T | undefined;
    toArray(): T[];
    contains(value: T): boolean;
    clone(): IQueueSource<T>;
    tryDequeue(): T | undefined;
    dequeue(): Result<T, QueueEmptyError | QueueClosedError>;
    dequeueBatch<const N extends number>(
        count: N
    ): Result<Batch<T, N>, QueueUnderflowError | QueueClosedError>;
}

export interface IQueueSink<in T> {
    readonly size: QueueSize;
    readonly capacity: QueueCapacity;
    readonly isFull: boolean;
    readonly isClosed: boolean;
    tryEnqueue(item: NoInfer<T>): boolean;
    enqueue(item: NoInfer<T>): Result<void, QueueFullError | QueueClosedError>;
    enqueueBatch(items: readonly NoInfer<T>[]): Result<QueueSize, QueueFullError | QueueClosedError>;
    clear(): void;
}

export interface IAsyncQueueSource<out T> {
    dequeueAsync(
        signal?: AbortSignal | undefined
    ): Promise<Result<T, QueueClosedError | QueueAbortError>>;
    [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface IAsyncQueueSink<in T> {
    enqueueAsync(
        item: NoInfer<T>,
        signal?: AbortSignal | undefined
    ): Promise<Result<void, QueueFullError | QueueClosedError | QueueAbortError>>;
}

export interface IQueueLifecycle {
    readonly state: LifecycleState;
    close(error?: Error | undefined): void;
    drain(signal?: AbortSignal | undefined): Promise<void>;
    [Symbol_dispose](): void;
    [Symbol_asyncDispose](): Promise<void>;
}

export interface IQueue<T>
    extends IQueueSource<T>,
        IQueueSink<T>,
        IAsyncQueueSource<T>,
        IAsyncQueueSink<T>,
        IQueueLifecycle {}

export { Symbol_dispose, Symbol_asyncDispose };
