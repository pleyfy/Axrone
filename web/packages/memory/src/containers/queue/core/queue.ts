import { err, ok, type Result } from '@axrone/utility';
import {
    QueueAbortError,
    QueueClosedError,
    QueueEmptyError,
    QueueFullError,
    QueueUnderflowError,
    assertNever,
} from './errors';
import { CHUNK_SIZE, ChunkPool, type IChunkAllocator, type MemoryChunk } from './chunk';
import {
    type Batch,
    type IQueue,
    type IQueueMetrics,
    LifecycleState,
    NULL_METRICS,
    OverflowStrategy,
    type QueueCapacity,
    type QueueSize,
    UNBOUNDED_CAPACITY,
    isBatch,
    Symbol_asyncDispose,
    Symbol_dispose,
    toQueueCapacity,
} from './types';
import {
    ConsumerWaitNode,
    DrainWaitNode,
    IntrusiveQueue,
    ProducerWaitNode,
} from './wait-queue';
import { QueueIterator } from './iterator';

const OK_VOID: Result<void, never> = ok();

/**
 * FIFO queue backed by 512-slot chunks. O(1) append, bounded overflow
 * strategies, abortable async coordination, and an explicit lifecycle FSM.
 */
export class Queue<T> implements IQueue<T> {
    private _chunkHead: MemoryChunk<T>;
    private _chunkTail: MemoryChunk<T>;
    private readonly _allocator: IChunkAllocator<T>;
    private _elementCount: number;
    private readonly _limit: QueueCapacity;
    private readonly _overflowStrategy: OverflowStrategy;
    private readonly _telemetry: IQueueMetrics;

    private _lifecycle: LifecycleState;
    private _terminalFault: Error | undefined;

    private readonly _consumers: IntrusiveQueue<ConsumerWaitNode<T>>;
    private readonly _producers: IntrusiveQueue<ProducerWaitNode<T>>;
    private readonly _drainers: IntrusiveQueue<DrainWaitNode>;

    constructor(
        capacity: QueueCapacity = UNBOUNDED_CAPACITY,
        strategy: OverflowStrategy = OverflowStrategy.Reject,
        metrics: IQueueMetrics = NULL_METRICS,
        allocator?: IChunkAllocator<T>
    ) {
        this._allocator = allocator ?? new ChunkPool<T>();
        const genesisChunk = this._allocator.acquire();
        this._chunkHead = genesisChunk;
        this._chunkTail = genesisChunk;
        this._elementCount = 0;
        this._limit = capacity;
        this._overflowStrategy = strategy;
        this._telemetry = metrics;

        this._lifecycle = LifecycleState.Active;
        this._terminalFault = undefined;

        this._consumers = new IntrusiveQueue<ConsumerWaitNode<T>>();
        this._producers = new IntrusiveQueue<ProducerWaitNode<T>>();
        this._drainers = new IntrusiveQueue<DrainWaitNode>();
    }

    public get size(): QueueSize {
        return (this._elementCount as QueueSize);
    }

    public get capacity(): QueueCapacity {
        return this._limit;
    }

    public get isEmpty(): boolean {
        return this._elementCount === 0;
    }

    public get isFull(): boolean {
        return this._elementCount >= this._limit;
    }

    public get isClosed(): boolean {
        return this._lifecycle !== LifecycleState.Active;
    }

    public get state(): LifecycleState {
        return this._lifecycle;
    }

    public peek(): T | undefined {
        if (this._elementCount === 0) {
            return undefined;
        }
        return this._chunkHead.peek();
    }

    public toArray(): T[] {
        const size = this._elementCount;
        if (size === 0) {
            return [];
        }

        const result = new Array<T>(size);
        let writeIndex = 0;
        let chunk: MemoryChunk<T> | null = this._chunkHead;

        while (chunk !== null && writeIndex < size) {
            const start = chunk === this._chunkHead ? chunk.readHead : 0;
            const end = chunk === this._chunkTail ? chunk.writeHead : CHUNK_SIZE;

            for (let i = start; i < end; i = (i + 1) | 0) {
                result[writeIndex] = chunk.slotAt(i);
                writeIndex = (writeIndex + 1) | 0;
            }

            chunk = chunk.next;
        }

        return result;
    }

    public contains(value: T): boolean {
        let chunk: MemoryChunk<T> | null = this._chunkHead;

        while (chunk !== null) {
            const start = chunk === this._chunkHead ? chunk.readHead : 0;
            const end = chunk === this._chunkTail ? chunk.writeHead : CHUNK_SIZE;

            for (let i = start; i < end; i = (i + 1) | 0) {
                if (chunk.slotAt(i) === value) {
                    return true;
                }
            }

            chunk = chunk.next;
        }

        return false;
    }

    public clone(): Queue<T> {
        const copy = new Queue<T>(this._limit, this._overflowStrategy, this._telemetry);
        copy.enqueueBatch(this.toArray());
        return copy;
    }

    public clear(): void {
        this.clearInternal();

        if (this._lifecycle === LifecycleState.Closing) {
            this.evaluateDrainState();
        }
    }

    public [Symbol.iterator](): Iterator<T> {
        return new QueueIterator<T>(this._chunkHead, this._elementCount);
    }

    /**
     * Synchronous enqueue. With {@link OverflowStrategy.Block}, use
     * {@link enqueueAsync} instead — a synchronous caller cannot be suspended.
     */
    public enqueue(item: NoInfer<T>): Result<void, QueueFullError | QueueClosedError> {
        if (this._lifecycle !== LifecycleState.Active) {
            return err(this._closedError());
        }

        if (this._consumers.length > 0) {
            const consumer = this._consumers.shift()!;
            consumer.detach();
            consumer.resolve(ok(item));
            this._telemetry.onDequeue?.(this._elementCount as QueueSize);
            return OK_VOID;
        }

        if (this._elementCount >= this._limit) {
            switch (this._overflowStrategy) {
                case OverflowStrategy.Reject:
                    return err(QueueFullError.INSTANCE);
                case OverflowStrategy.DropTail:
                    this._telemetry.onDrop?.(OverflowStrategy.DropTail);
                    return OK_VOID;
                case OverflowStrategy.DropHead: {
                    this._telemetry.onDrop?.(OverflowStrategy.DropHead);
                    this.executeShift();
                    this.executePush(item);
                    this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
                    return OK_VOID;
                }
                case OverflowStrategy.Block:
                    return err(QueueFullError.INSTANCE);
                default:
                    return assertNever(this._overflowStrategy);
            }
        }

        this.executePush(item);
        this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
        return OK_VOID;
    }

    public tryEnqueue(item: NoInfer<T>): boolean {
        if (this._lifecycle !== LifecycleState.Active) {
            return false;
        }

        if (this._consumers.length > 0) {
            const consumer = this._consumers.shift()!;
            consumer.detach();
            consumer.resolve(ok(item));
            this._telemetry.onDequeue?.(this._elementCount as QueueSize);
            return true;
        }

        if (this._elementCount >= this._limit) {
            switch (this._overflowStrategy) {
                case OverflowStrategy.Reject:
                case OverflowStrategy.Block:
                    return false;
                case OverflowStrategy.DropTail:
                    this._telemetry.onDrop?.(OverflowStrategy.DropTail);
                    return true;
                case OverflowStrategy.DropHead:
                    this._telemetry.onDrop?.(OverflowStrategy.DropHead);
                    this.executeShift();
                    this.executePush(item);
                    this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
                    return true;
                default:
                    return assertNever(this._overflowStrategy);
            }
        }

        this.executePush(item);
        this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
        return true;
    }

    public tryDequeue(): T | undefined {
        if (this._elementCount === 0) {
            return undefined;
        }

        const item = this.executeShift();
        this.dispatchPendingProducer();
        this._telemetry.onDequeue?.(this._elementCount as QueueSize);

        if (this._elementCount === 0) {
            this.evaluateDrainState();
        }

        return item;
    }

    public enqueueBatch(
        items: readonly NoInfer<T>[]
    ): Result<QueueSize, QueueFullError | QueueClosedError> {
        if (this._lifecycle !== LifecycleState.Active) {
            return err(this._closedError());
        }

        const count = items.length;
        if (count === 0) {
            return ok(this._elementCount as QueueSize);
        }

        let start = 0;
        if (this._consumers.length > 0) {
            while (start < count && this._consumers.length > 0) {
                const consumer = this._consumers.shift()!;
                consumer.detach();
                consumer.resolve(ok(items[start]));
                start = (start + 1) | 0;
            }
            this._telemetry.onDequeue?.(this._elementCount as QueueSize);
        }

        const remaining = count - start;
        if (remaining === 0) {
            return ok(this._elementCount as QueueSize);
        }

        const free = this._limit - this._elementCount;
        if (remaining <= free) {
            this.executePushBulk(items, start, remaining);
            this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
            return ok(this._elementCount as QueueSize);
        }

        switch (this._overflowStrategy) {
            case OverflowStrategy.Reject:
            case OverflowStrategy.Block:
                return err(QueueFullError.INSTANCE);
            case OverflowStrategy.DropTail: {
                if (free > 0) {
                    this.executePushBulk(items, start, free);
                }
                this._telemetry.onDrop?.(OverflowStrategy.DropTail);
                this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
                return ok(this._elementCount as QueueSize);
            }
            case OverflowStrategy.DropHead: {
                this._telemetry.onDrop?.(OverflowStrategy.DropHead);
                if (remaining >= this._limit) {
                    this.clearInternal();
                    this.executePushBulk(items, start + remaining - this._limit, this._limit);
                } else {
                    this.dropFromHead(this._elementCount + remaining - this._limit);
                    this.executePushBulk(items, start, remaining);
                }
                this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
                return ok(this._elementCount as QueueSize);
            }
            default:
                return assertNever(this._overflowStrategy);
        }
    }

    public dequeue(): Result<T, QueueEmptyError | QueueClosedError> {
        if (this._elementCount === 0) {
            if (this._lifecycle !== LifecycleState.Active) {
                return err(this._closedError());
            }
            return err(QueueEmptyError.INSTANCE);
        }

        const item = this.executeShift();
        this.dispatchPendingProducer();
        this._telemetry.onDequeue?.(this._elementCount as QueueSize);

        if (this._elementCount === 0) {
            this.evaluateDrainState();
        }

        return ok(item);
    }

    public dequeueBatch<const N extends number>(
        count: N
    ): Result<Batch<T, N>, QueueUnderflowError | QueueClosedError> {
        if (count <= 0) {
            const empty: readonly T[] = [];
            if (isBatch(empty, count)) {
                return ok(empty);
            }
            return err(new QueueUnderflowError(count, this._elementCount));
        }

        if (this._elementCount < count) {
            if (this._lifecycle !== LifecycleState.Active) {
                return err(this._closedError());
            }
            return err(new QueueUnderflowError(count, this._elementCount));
        }

        const batch = new Array<T>(count);
        for (let i = 0; i < count; i++) {
            batch[i] = this.executeShift();
            this.dispatchPendingProducer();
        }

        this._telemetry.onDequeue?.(this._elementCount as QueueSize);

        if (this._elementCount === 0) {
            this.evaluateDrainState();
        }

        if (isBatch(batch, count)) {
            return ok(batch);
        }

        return err(new QueueUnderflowError(count, batch.length));
    }

    public enqueueAsync(
        item: NoInfer<T>,
        signal?: AbortSignal | undefined
    ): Promise<Result<void, QueueFullError | QueueClosedError | QueueAbortError>> {
        if (signal?.aborted) {
            return Promise.resolve(err(new QueueAbortError(signal.reason)));
        }

        if (this._lifecycle !== LifecycleState.Active) {
            return Promise.resolve(err(this._closedError()));
        }

        const consumer = this._consumers.shift();
        if (consumer !== null) {
            consumer.detach();
            consumer.resolve(ok(item));
            this._telemetry.onDequeue?.(this._elementCount as QueueSize);
            return Promise.resolve(OK_VOID);
        }

        if (this._elementCount >= this._limit) {
            if (this._overflowStrategy === OverflowStrategy.Block) {
                this._telemetry.onSuspendProducer?.();
                return new Promise<Result<void, QueueFullError | QueueClosedError | QueueAbortError>>(
                    (resolve) => {
                        const waitNode = new ProducerWaitNode<T>(item, resolve, signal);

                        if (signal !== undefined) {
                            const onAbort = (): void => {
                                this._producers.remove(waitNode);
                                waitNode.detach();
                                waitNode.resolve(err(new QueueAbortError(signal.reason)));
                            };
                            waitNode.listener = onAbort;
                            signal.addEventListener('abort', onAbort, { once: true });
                        }

                        this._producers.append(waitNode);
                    }
                );
            }

            return Promise.resolve(this.enqueue(item));
        }

        this.executePush(item);
        this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
        return Promise.resolve(OK_VOID);
    }

    public dequeueAsync(
        signal?: AbortSignal | undefined
    ): Promise<Result<T, QueueClosedError | QueueAbortError>> {
        if (signal?.aborted) {
            return Promise.resolve(err(new QueueAbortError(signal.reason)));
        }

        if (this._elementCount > 0) {
            const item = this.executeShift();
            this.dispatchPendingProducer();
            this._telemetry.onDequeue?.(this._elementCount as QueueSize);

            if (this._elementCount === 0) {
                this.evaluateDrainState();
            }
            return Promise.resolve(ok(item));
        }

        if (this._lifecycle !== LifecycleState.Active) {
            return Promise.resolve(err(this._closedError()));
        }

        this._telemetry.onSuspendConsumer?.();
        return new Promise<Result<T, QueueClosedError | QueueAbortError>>((resolve) => {
            const waitNode = new ConsumerWaitNode<T>(resolve, signal);

            if (signal !== undefined) {
                const onAbort = (): void => {
                    this._consumers.remove(waitNode);
                    waitNode.detach();
                    waitNode.resolve(err(new QueueAbortError(signal.reason)));
                };
                waitNode.listener = onAbort;
                signal.addEventListener('abort', onAbort, { once: true });
            }

            this._consumers.append(waitNode);
        });
    }

    public async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
            const result = await this.dequeueAsync();
            if (result.isOk()) {
                yield result.get();
            } else {
                const error = result.errToOptional()!;
                if (error instanceof QueueClosedError) {
                    if (this._terminalFault !== undefined) {
                        throw this._terminalFault;
                    }
                    return;
                }
                throw error;
            }
        }
    }

    public close(error?: Error | undefined): void {
        if (this._lifecycle !== LifecycleState.Active) {
            return;
        }

        this._terminalFault = error;
        const isDrained = this._elementCount === 0;
        this._lifecycle = isDrained ? LifecycleState.Drained : LifecycleState.Closing;

        const closedError = this._closedError();
        while (this._producers.length > 0) {
            const producer = this._producers.shift()!;
            producer.detach();
            producer.resolve(err(closedError));
        }

        if (isDrained) {
            this.flushConsumerNodes();
            this.flushDrainWaiters();
        }
    }

    public drain(signal?: AbortSignal | undefined): Promise<void> {
        if (this._elementCount === 0) {
            return Promise.resolve();
        }

        if (signal?.aborted) {
            return Promise.reject(new QueueAbortError(signal.reason));
        }

        return new Promise<void>((resolve, reject) => {
            const drainNode = new DrainWaitNode(resolve, reject, signal);

            if (signal !== undefined) {
                const onAbort = (): void => {
                    this._drainers.remove(drainNode);
                    drainNode.detach();
                    drainNode.reject(new QueueAbortError(signal.reason));
                };
                drainNode.listener = onAbort;
                signal.addEventListener('abort', onAbort, { once: true });
            }

            this._drainers.append(drainNode);
        });
    }

    public [Symbol_dispose](): void {
        this.close();
        this.disposeMemoryTopology();
        this._lifecycle = LifecycleState.Terminated;
        this.flushConsumerNodes();
        this.flushDrainWaiters();
    }

    public async [Symbol_asyncDispose](): Promise<void> {
        this.close();
        try {
            await this.drain();
        } catch {
            // Aborted or faulted drains are intentionally swallowed on disposal.
        } finally {
            this.disposeMemoryTopology();
            this._lifecycle = LifecycleState.Terminated;
            this.flushConsumerNodes();
            this.flushDrainWaiters();
        }
    }

    private _closedError(): QueueClosedError {
        return this._terminalFault !== undefined
            ? new QueueClosedError(this._terminalFault.message)
            : QueueClosedError.INSTANCE;
    }

    private executePush(item: T): void {
        let tail = this._chunkTail;
        if (tail.writeHead === CHUNK_SIZE) {
            const nextChunk = this._allocator.acquire();
            tail.next = nextChunk;
            this._chunkTail = nextChunk;
            tail = nextChunk;
        }
        tail.write(item);
        this._elementCount++;
    }

    private executeShift(): T {
        const head = this._chunkHead;
        const value = head.read();
        this._elementCount--;

        if (this._elementCount === 0) {
            head.readHead = 0;
            head.writeHead = 0;
        } else if (head.readHead === CHUNK_SIZE) {
            const forward = head.next;
            if (forward !== null) {
                this._chunkHead = forward;
                this._allocator.release(head);
            }
        }

        return value;
    }

    private executePushBulk(items: readonly T[], start: number, count: number): void {
        let index = start;
        let remaining = count;
        let tail = this._chunkTail;

        while (remaining > 0) {
            if (tail.writeHead === CHUNK_SIZE) {
                const nextChunk = this._allocator.acquire();
                tail.next = nextChunk;
                this._chunkTail = nextChunk;
                tail = nextChunk;
            }

            const free = CHUNK_SIZE - tail.writeHead;
            const take = remaining < free ? remaining : free;

            for (let k = 0; k < take; k = (k + 1) | 0) {
                tail.write(items[index + k] as T);
            }

            index += take;
            remaining -= take;
            this._elementCount += take;
        }
    }

    private dropFromHead(count: number): void {
        let remaining = count;
        while (remaining > 0 && this._elementCount > 0) {
            this.executeShift();
            remaining = (remaining - 1) | 0;
        }
    }

    private clearInternal(): void {
        const head = this._chunkHead;
        let cursor = head.next;

        while (cursor !== null) {
            const next: MemoryChunk<T> | null = cursor.next;
            this._allocator.release(cursor);
            cursor = next;
        }

        head.next = null;
        head.reset();
        this._chunkTail = head;
        this._elementCount = 0;
    }

    private dispatchPendingProducer(): void {
        if (this._producers.length === 0) {
            return;
        }

        const producer = this._producers.shift()!;
        producer.detach();
        this.executePush(producer.element);
        this._telemetry.onEnqueue?.(this._elementCount as QueueSize);
        producer.resolve(OK_VOID);
    }

    private evaluateDrainState(): void {
        if (this._lifecycle === LifecycleState.Closing) {
            this._lifecycle = LifecycleState.Drained;
            this.flushConsumerNodes();
        }
        this.flushDrainWaiters();
    }

    private flushConsumerNodes(): void {
        const closedError = this._closedError();
        while (this._consumers.length > 0) {
            const consumer = this._consumers.shift()!;
            consumer.detach();
            consumer.resolve(err(closedError));
        }
    }

    private flushDrainWaiters(): void {
        while (this._drainers.length > 0) {
            const drainer = this._drainers.shift()!;
            drainer.detach();
            drainer.resolve();
        }
    }

    private disposeMemoryTopology(): void {
        let cursor: MemoryChunk<T> | null = this._chunkHead;
        while (cursor !== null) {
            const next: MemoryChunk<T> | null = cursor.next;
            cursor.reset();
            cursor = next;
        }
        this._chunkTail = this._chunkHead;
        this._elementCount = 0;
        this._allocator.clear();
    }
}

export type TypestateUnconfigured = { readonly __tag: 'UNCONFIGURED' };
export type TypestateBounded = { readonly __tag: 'BOUNDED' };
export type TypestateConfigured = { readonly __tag: 'CONFIGURED' };

export class QueueBuilder<T, S extends { readonly __tag: string } = TypestateUnconfigured> {
    private readonly _capacity: QueueCapacity;
    private readonly _strategy: OverflowStrategy;
    private readonly _metrics: IQueueMetrics;
    private readonly _allocator: IChunkAllocator<T> | undefined;

    private constructor(
        capacity: QueueCapacity,
        strategy: OverflowStrategy,
        metrics: IQueueMetrics,
        allocator: IChunkAllocator<T> | undefined
    ) {
        this._capacity = capacity;
        this._strategy = strategy;
        this._metrics = metrics;
        this._allocator = allocator;
    }

    public static create<T>(): QueueBuilder<T, TypestateUnconfigured> {
        return new QueueBuilder<T, TypestateUnconfigured>(
            UNBOUNDED_CAPACITY,
            OverflowStrategy.Reject,
            NULL_METRICS,
            undefined
        );
    }

    public unbounded(
        this: QueueBuilder<T, TypestateUnconfigured>
    ): QueueBuilder<T, TypestateConfigured> {
        return new QueueBuilder<T, TypestateConfigured>(
            UNBOUNDED_CAPACITY,
            OverflowStrategy.Reject,
            this._metrics,
            this._allocator
        );
    }

    public bounded(
        this: QueueBuilder<T, TypestateUnconfigured>,
        capacity: number
    ): QueueBuilder<T, TypestateBounded> {
        return new QueueBuilder<T, TypestateBounded>(
            toQueueCapacity(capacity),
            this._strategy,
            this._metrics,
            this._allocator
        );
    }

    public withOverflowStrategy(
        this: QueueBuilder<T, TypestateBounded>,
        strategy: OverflowStrategy
    ): QueueBuilder<T, TypestateConfigured> {
        return new QueueBuilder<T, TypestateConfigured>(
            this._capacity,
            strategy,
            this._metrics,
            this._allocator
        );
    }

    public withMetrics<const M extends IQueueMetrics>(
        this: QueueBuilder<T, S>,
        sink: M
    ): QueueBuilder<T, S> {
        return new QueueBuilder<T, S>(this._capacity, this._strategy, sink, this._allocator);
    }

    public withAllocator(
        this: QueueBuilder<T, S>,
        allocator: IChunkAllocator<T>
    ): QueueBuilder<T, S> {
        return new QueueBuilder<T, S>(this._capacity, this._strategy, this._metrics, allocator);
    }

    public build(this: QueueBuilder<T, TypestateConfigured>): Queue<T>;
    public build(this: QueueBuilder<T, TypestateBounded>): Queue<T>;
    public build(this: QueueBuilder<T, TypestateConfigured | TypestateBounded>): Queue<T> {
        return new Queue<T>(this._capacity, this._strategy, this._metrics, this._allocator);
    }
}
