import { performance } from './performance';
import {
    EventCallback,
    EventPriority,
    EventMap,
    EventKey,
    UnsubscribeFn,
    EventOptions,
    DEFAULT_OPTIONS,
    DEFAULT_PRIORITY,
    PRIORITY_VALUES,
    MEMORY_USAGE_SYMBOLS,
    EventDispatchItem,
} from './definition';
import { EventHandlerError, EventQueueFullError } from './errors';
import {
    IEventSubscriber,
    IEventPublisher,
    IEventObserver,
    IEventBuffer,
    SubscriptionOptions,
    Subscription,
    QueuedEvent,
    EventMetrics,
} from './interfaces';
import { EventScheduler, TaskPriority } from './event-scheduler';
import { EVENT_EMITTER_TAP, EventTap, EventTapContext } from './internals';

export interface IEventEmitter<T extends EventMap = EventMap>
    extends IEventSubscriber<T>,
        IEventPublisher<T>,
        IEventObserver<T>,
        IEventBuffer<T> {
    removeAllListeners<K extends EventKey<T>>(event?: K): this;

    batchSubscribe<K extends EventKey<T>>(
        event: K,
        callbacks: ReadonlyArray<EventCallback<T[K]>>,
        options?: SubscriptionOptions
    ): ReadonlyArray<symbol>;

    batchUnsubscribe(subscriptionIds: ReadonlyArray<symbol>): number;

    resetMaxListeners(): void;

    drain(): Promise<void>;

    flush<K extends EventKey<T>>(event: K): Promise<void>;

    resetMetrics<K extends EventKey<T>>(event?: K): void;

    dispose(): void;
}

type InternalCallback<T> = EventCallback<T> | WeakRef<EventCallback<T>>;

interface InternalSubscription<T = unknown> {
    readonly id: symbol;
    readonly event: string;
    readonly once: boolean;
    readonly priority: EventPriority;
    readonly createdAt: number;
    readonly weak: boolean;
    readonly callback: InternalCallback<T>;
    readonly unregisterToken?: object;
    lastExecuted?: number;
    executionCount: number;
}

interface ListenerBucket {
    readonly high: InternalSubscription<any>[];
    readonly normal: InternalSubscription<any>[];
    readonly low: InternalSubscription<any>[];
    size: number;
}

interface BufferedBucket {
    readonly high: QueuedEvent<any>[];
    readonly normal: QueuedEvent<any>[];
    readonly low: QueuedEvent<any>[];
    size: number;
}

interface TimingAccumulator {
    count: number;
    total: number;
    min: number;
    max: number;
}

interface MetricsAccumulator {
    emit: TimingAccumulator;
    execution: TimingAccumulator & { errors: number };
}

const PRIORITY_TO_TASK_PRIORITY = Object.freeze({
    high: TaskPriority.HIGH,
    normal: TaskPriority.NORMAL,
    low: TaskPriority.LOW,
} satisfies Readonly<Record<EventPriority, TaskPriority>>);

function normalizeMaxListeners(value: number | undefined, fallback: number): number {
    if (value === Infinity) {
        return Infinity;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.trunc(value));
}

function normalizeConcurrency(value: number | undefined, fallback: number): number {
    if (value === Infinity || (value === undefined && fallback === Infinity)) {
        return value ?? fallback;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.trunc(value));
}

function normalizeBufferSize(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.trunc(value));
}

function normalizeGcInterval(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.trunc(value));
}

function normalizeOptions(options: EventOptions): Required<EventOptions> {
    return {
        captureRejections:
            typeof options.captureRejections === 'boolean'
                ? options.captureRejections
                : DEFAULT_OPTIONS.captureRejections,
        maxListeners: normalizeMaxListeners(options.maxListeners, DEFAULT_OPTIONS.maxListeners),
        weakReferences:
            typeof options.weakReferences === 'boolean'
                ? options.weakReferences
                : DEFAULT_OPTIONS.weakReferences,
        immediateDispatch:
            typeof options.immediateDispatch === 'boolean'
                ? options.immediateDispatch
                : DEFAULT_OPTIONS.immediateDispatch,
        concurrencyLimit: normalizeConcurrency(
            options.concurrencyLimit,
            DEFAULT_OPTIONS.concurrencyLimit
        ),
        bufferSize: normalizeBufferSize(options.bufferSize, DEFAULT_OPTIONS.bufferSize),
        gcIntervalMs: normalizeGcInterval(options.gcIntervalMs, DEFAULT_OPTIONS.gcIntervalMs),
    };
}

function createListenerBucket(): ListenerBucket {
    return {
        high: [],
        normal: [],
        low: [],
        size: 0,
    };
}

function createBufferedBucket(): BufferedBucket {
    return {
        high: [],
        normal: [],
        low: [],
        size: 0,
    };
}

function createTimingAccumulator(): TimingAccumulator {
    return {
        count: 0,
        total: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
    };
}

function createMetricsAccumulator(): MetricsAccumulator {
    return {
        emit: createTimingAccumulator(),
        execution: {
            ...createTimingAccumulator(),
            errors: 0,
        },
    };
}

function snapshotTiming(timing: TimingAccumulator): EventMetrics['emit']['timing'] {
    if (timing.count === 0) {
        return {
            avg: 0,
            max: 0,
            min: 0,
            total: 0,
        };
    }

    return {
        avg: timing.total / timing.count,
        max: timing.max,
        min: Number.isFinite(timing.min) ? timing.min : 0,
        total: timing.total,
    };
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof (value as PromiseLike<T>).then === 'function'
    );
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export class EventEmitter<T extends EventMap = EventMap> implements IEventEmitter<T> {
    #events = new Map<string, ListenerBucket>();
    #subscriptionIndex = new Map<symbol, InternalSubscription<any>>();
    #options: Required<EventOptions>;
    #metrics = new Map<string, MetricsAccumulator>();
    #scheduler: EventScheduler;
    #buffer = new Map<string, BufferedBucket>();
    #bufferedEventId = 0;
    #bufferedEventCount = 0;
    #isPaused = false;
    #isDisposed = false;
    #gcIntervalId?: ReturnType<typeof setInterval>;
    #weakRegistry?: FinalizationRegistry<symbol>;
    #tapListeners = new Set<EventTap>();
    #bufferProcessing: Promise<void> | null = null;

    constructor(options: EventOptions = {}) {
        this.#options = normalizeOptions(options);

        if (
            this.#options.weakReferences &&
            typeof WeakRef === 'function' &&
            typeof FinalizationRegistry === 'function'
        ) {
            this.#weakRegistry = new FinalizationRegistry((subscriptionId) => {
                this.offById(subscriptionId);
            });
        }

        this.#scheduler = this.#createScheduler();

        if (this.#options.gcIntervalMs > 0) {
            this.#startGc();
        }
    }

    get maxListeners(): number {
        return this.#options.maxListeners;
    }

    set maxListeners(value: number) {
        if (value !== Infinity && (value < 0 || !Number.isInteger(value))) {
            throw new TypeError('maxListeners must be a non-negative integer');
        }
        this.#options = { ...this.#options, maxListeners: value };
    }

    resetMaxListeners(): void {
        this.#options = {
            ...this.#options,
            maxListeners: DEFAULT_OPTIONS.maxListeners,
        };
    }

    public on<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: SubscriptionOptions = {}
    ): UnsubscribeFn {
        this.#ensureRuntime();

        const id = this.#registerListener(event, callback, {
            once: false,
            priority: options.priority ?? DEFAULT_PRIORITY,
        });

        return () => this.offById(id);
    }

    public once<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: Omit<SubscriptionOptions, 'once'> = {}
    ): UnsubscribeFn {
        this.#ensureRuntime();

        const id = this.#registerListener(event, callback, {
            once: true,
            priority: options.priority ?? DEFAULT_PRIORITY,
        });

        return () => this.offById(id);
    }

    public pipe<K extends EventKey<T>>(
        event: K,
        emitter: IEventPublisher<any>,
        targetEvent?: string
    ): UnsubscribeFn {
        const actualTargetEvent = targetEvent ?? (event as string);
        return this.on(event, (data) => emitter.emit(actualTargetEvent as any, data).then(() => undefined));
    }

    public off<K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>): boolean {
        const eventName = String(event);
        const bucket = this.#events.get(eventName);

        if (!bucket || bucket.size === 0) {
            return false;
        }

        if (!callback) {
            this.#clearBucket(eventName, bucket);
            return true;
        }

        let removed = false;

        for (const priority of ['high', 'normal', 'low'] as const) {
            const records = bucket[priority];

            for (let index = records.length - 1; index >= 0; index--) {
                const record = records[index]!;
                const currentCallback = this.#resolveCallback(record);

                if (currentCallback === callback) {
                    this.#deleteSubscription(record);
                    removed = true;
                }
            }
        }

        return removed;
    }

    public offById(subscriptionId: symbol): boolean {
        const subscription = this.#subscriptionIndex.get(subscriptionId);
        if (!subscription) {
            return false;
        }

        return this.#deleteSubscription(subscription);
    }

    public async emit<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): Promise<boolean> {
        this.#ensureRuntime();

        const eventName = String(event);
        const priority = options.priority ?? DEFAULT_PRIORITY;
        const startTime = performance.now();

        if (this.#isPaused) {
            try {
                this.#enqueueBufferedEvent(eventName, data, priority);
                this.#recordEmitMetric(eventName, 0);
                return true;
            } catch (error) {
                this.#recordEmitMetric(eventName, performance.now() - startTime);
                throw error;
            }
        }

        const tapContext: Omit<EventTapContext, 'phase'> = {
            event: eventName,
            data,
            priority,
            sync: false,
        };

        this.#emitTaps({ ...tapContext, phase: 'start' });

        try {
            const snapshot = this.#snapshotListeners(eventName);

            if (snapshot.length === 0) {
                return false;
            }

            this.#removeOnceSubscriptions(snapshot);
            await this.#dispatchAsync(eventName, data, snapshot);
            return true;
        } catch (error) {
            throw error;
        } finally {
            this.#recordEmitMetric(eventName, performance.now() - startTime);
            this.#emitTaps({ ...tapContext, phase: 'end' });
        }
    }

    public emitSync<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): boolean {
        this.#ensureRuntime();

        const eventName = String(event);
        const priority = options.priority ?? DEFAULT_PRIORITY;
        const startTime = performance.now();

        if (this.#isPaused) {
            try {
                this.#enqueueBufferedEvent(eventName, data, priority);
                this.#recordEmitMetric(eventName, 0);
                return true;
            } catch (error) {
                this.#recordEmitMetric(eventName, performance.now() - startTime);
                throw error;
            }
        }

        const tapContext: Omit<EventTapContext, 'phase'> = {
            event: eventName,
            data,
            priority,
            sync: true,
        };

        this.#emitTaps({ ...tapContext, phase: 'start' });

        try {
            const snapshot = this.#snapshotListeners(eventName);

            if (snapshot.length === 0) {
                return false;
            }

            this.#removeOnceSubscriptions(snapshot);

            let hadAsyncCallbacks = false;

            for (const subscription of snapshot) {
                const callback = this.#resolveCallback(subscription);

                if (!callback) {
                    continue;
                }

                const execStartTime = performance.now();
                subscription.executionCount++;
                subscription.lastExecuted = Date.now();

                try {
                    const result = callback(data);

                    if (isPromiseLike<void>(result)) {
                        hadAsyncCallbacks = true;
                        void Promise.resolve(result).then(
                            () => {
                                this.#recordExecutionMetric(
                                    eventName,
                                    performance.now() - execStartTime,
                                    false
                                );
                            },
                            (error) => {
                                this.#recordExecutionMetric(
                                    eventName,
                                    performance.now() - execStartTime,
                                    true
                                );

                                const wrapped = new EventHandlerError(eventName, error);

                                if (this.#options.captureRejections) {
                                    try {
                                        this.#handleCapturedErrorSync(eventName, wrapped);
                                    } catch (handlerError) {
                                        this.#reportAsyncError(handlerError);
                                    }
                                } else {
                                    this.#reportAsyncError(wrapped);
                                }
                            }
                        );
                    } else {
                        this.#recordExecutionMetric(
                            eventName,
                            performance.now() - execStartTime,
                            false
                        );
                    }
                } catch (error) {
                    this.#recordExecutionMetric(
                        eventName,
                        performance.now() - execStartTime,
                        true
                    );

                    const wrapped = new EventHandlerError(eventName, error);

                    if (this.#options.captureRejections) {
                        this.#handleCapturedErrorSync(eventName, wrapped);
                    } else {
                        throw wrapped;
                    }
                }
            }

            if (hadAsyncCallbacks) {
                console.warn(
                    `EventEmitter: Event "${eventName}" was emitted synchronously but had async listeners. Consider using emit() instead.`
                );
            }

            return true;
        } catch (error) {
            throw error;
        } finally {
            this.#recordEmitMetric(eventName, performance.now() - startTime);
            this.#emitTaps({ ...tapContext, phase: 'end' });
        }
    }

    public async emitBatch(events: ReadonlyArray<EventDispatchItem<T>>): Promise<boolean[]> {
        if (events.length === 0) return [];

        this.#ensureRuntime();

        const results = new Array<Promise<boolean>>(events.length);

        for (let index = 0; index < events.length; index++) {
            const { event, data, priority } = events[index]!;
            results[index] = this.emit(
                event as EventKey<T>,
                data as T[EventKey<T>],
                priority ? { priority } : undefined
            );
        }

        return Promise.all(results);
    }

    public has<K extends EventKey<T>>(event: K): boolean {
        const bucket = this.#events.get(String(event));
        return bucket !== undefined && bucket.size > 0;
    }

    public hasSubscription(subscriptionId: symbol): boolean {
        return this.#subscriptionIndex.has(subscriptionId);
    }

    public listenerCount<K extends EventKey<T>>(event: K): number {
        return this.#events.get(String(event))?.size ?? 0;
    }

    public listenerCountAll(): number {
        return this.#subscriptionIndex.size;
    }

    public eventNames(): EventKey<T>[] {
        return Array.from(this.#events.keys()) as EventKey<T>[];
    }

    public getSubscriptions<K extends EventKey<T>>(event: K): ReadonlyArray<Subscription<T[K]>> {
        const bucket = this.#events.get(String(event));
        if (!bucket || bucket.size === 0) {
            return [];
        }

        const subscriptions: Subscription<T[K]>[] = [];
        this.#appendPublicSubscriptions(bucket.high, subscriptions);
        this.#appendPublicSubscriptions(bucket.normal, subscriptions);
        this.#appendPublicSubscriptions(bucket.low, subscriptions);
        return subscriptions;
    }

    public removeAllListeners<K extends EventKey<T>>(event?: K): this {
        if (event) {
            const eventName = String(event);
            const bucket = this.#events.get(eventName);
            if (bucket) {
                this.#clearBucket(eventName, bucket);
            }
        } else {
            for (const [eventName, bucket] of this.#events.entries()) {
                this.#clearBucket(eventName, bucket);
            }
        }
        return this;
    }

    public batchSubscribe<K extends EventKey<T>>(
        event: K,
        callbacks: ReadonlyArray<EventCallback<T[K]>>,
        options: SubscriptionOptions = {}
    ): ReadonlyArray<symbol> {
        if (callbacks.length === 0) {
            return [];
        }

        this.#ensureRuntime();

        const subscriptionIds = new Array<symbol>(callbacks.length);

        for (let index = 0; index < callbacks.length; index++) {
            const callback = callbacks[index]!;
            subscriptionIds[index] = this.#registerListener(event, callback, {
                once: options.once ?? false,
                priority: options.priority ?? DEFAULT_PRIORITY,
            });
        }

        return subscriptionIds;
    }

    public batchUnsubscribe(subscriptionIds: ReadonlyArray<symbol>): number {
        let count = 0;
        for (const id of subscriptionIds) {
            if (this.offById(id)) {
                count++;
            }
        }
        return count;
    }

    public getQueuedEvents<K extends EventKey<T>>(event: K): ReadonlyArray<QueuedEvent<T[K]>>;
    public getQueuedEvents(): ReadonlyArray<QueuedEvent<T[EventKey<T>]>>;
    public getQueuedEvents<K extends EventKey<T>>(event?: K): ReadonlyArray<QueuedEvent<any>> {
        if (event) {
            const bucket = this.#buffer.get(String(event));
            return bucket ? this.#snapshotBufferedBucket(bucket) : [];
        }

        if (this.#bufferedEventCount === 0) {
            return [];
        }

        const allEvents = new Array<QueuedEvent>(this.#bufferedEventCount);
        let offset = 0;

        for (const bucket of this.#buffer.values()) {
            offset = this.#copyBufferedEntries(bucket.high, allEvents, offset);
            offset = this.#copyBufferedEntries(bucket.normal, allEvents, offset);
            offset = this.#copyBufferedEntries(bucket.low, allEvents, offset);
        }

        return allEvents.sort((a, b) => {
            const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return a.id - b.id;
        });
    }

    public getPendingCount<K extends EventKey<T>>(event?: K): number {
        if (event) {
            return this.#buffer.get(String(event))?.size ?? 0;
        }

        return this.#bufferedEventCount;
    }

    public getBufferSize(): number {
        return this.#options.bufferSize;
    }

    public clearBuffer<K extends EventKey<T>>(event?: K): number {
        if (event) {
            const eventName = String(event);
            const bucket = this.#buffer.get(eventName);
            if (!bucket) return 0;
            const size = bucket.size;
            this.#buffer.delete(eventName);
            this.#bufferedEventCount -= size;
            return size;
        }

        const total = this.#bufferedEventCount;
        this.#buffer.clear();
        this.#bufferedEventCount = 0;
        return total;
    }

    public pause(): void {
        this.#ensureRuntime();
        this.#isPaused = true;
    }

    public resume(): void {
        if (!this.#isPaused) return;

        this.#ensureRuntime();
        this.#isPaused = false;

        if (this.#bufferedEventCount === 0 || this.#bufferProcessing) {
            return;
        }

        const processing = this.#processBufferedEvents().finally(() => {
            if (this.#bufferProcessing === processing) {
                this.#bufferProcessing = null;
            }
        });

        this.#bufferProcessing = processing;
    }

    public isPaused(): boolean {
        return this.#isPaused;
    }

    public async drain(): Promise<void> {
        for (;;) {
            const currentBufferProcessing = this.#bufferProcessing;
            if (currentBufferProcessing) {
                await currentBufferProcessing;
                continue;
            }

            await this.#scheduler.drain();

            if (
                this.#bufferProcessing === null &&
                this.#scheduler.activeCount === 0 &&
                this.#scheduler.queuedCount === 0
            ) {
                break;
            }
        }
    }

    public async flush<K extends EventKey<T>>(event: K): Promise<void> {
        if (this.#bufferProcessing) {
            await this.#bufferProcessing;
        }

        const eventName = String(event);
        const bucket = this.#buffer.get(eventName);
        if (!bucket || bucket.size === 0) return;

        const queuedEvents = this.#snapshotBufferedBucket(bucket);
        this.#buffer.delete(eventName);
        this.#bufferedEventCount -= queuedEvents.length;

        const wasPaused = this.#isPaused;
        this.#isPaused = false;

        try {
            for (const queuedEvent of queuedEvents) {
                await this.emit(event, queuedEvent.data as T[K], {
                    priority: queuedEvent.priority,
                });
            }
        } finally {
            this.#isPaused = wasPaused;
        }
    }

    public getMetrics<K extends EventKey<T>>(event: K): EventMetrics {
        const metrics = this.#metrics.get(String(event));

        if (!metrics) {
            return {
                emit: {
                    count: 0,
                    timing: snapshotTiming(createTimingAccumulator()),
                },
                execution: {
                    count: 0,
                    errors: 0,
                    timing: snapshotTiming(createTimingAccumulator()),
                },
            };
        }

        return {
            emit: {
                count: metrics.emit.count,
                timing: snapshotTiming(metrics.emit),
            },
            execution: {
                count: metrics.execution.count,
                errors: metrics.execution.errors,
                timing: snapshotTiming(metrics.execution),
            },
        };
    }

    public resetMetrics<K extends EventKey<T>>(event?: K): void {
        if (event) {
            this.#metrics.delete(String(event));
        } else {
            this.#metrics.clear();
        }
    }

    public getMemoryUsage(): Record<string, number> {
        const staticSubscriptions = this.#subscriptionIndex.size * 112;
        const subscriptionMaps = this.#events.size * 80 + this.#subscriptionIndex.size * 24;
        const priorityQueues = this.#buffer.size * 72;
        const eventBuffer = this.#bufferedEventCount * 64;
        const total =
            staticSubscriptions +
            subscriptionMaps +
            priorityQueues +
            eventBuffer +
            this.#metrics.size * 64 +
            this.#tapListeners.size * 16;

        return {
            [MEMORY_USAGE_SYMBOLS.staticSubscriptions]: staticSubscriptions,
            [MEMORY_USAGE_SYMBOLS.subscriptionMaps]: subscriptionMaps,
            [MEMORY_USAGE_SYMBOLS.priorityQueues]: priorityQueues,
            [MEMORY_USAGE_SYMBOLS.eventBuffer]: eventBuffer,
            total,
        };
    }

    public [EVENT_EMITTER_TAP](tap: EventTap): UnsubscribeFn {
        this.#ensureRuntime();
        this.#tapListeners.add(tap);
        return () => this.#tapListeners.delete(tap);
    }

    #registerListener<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: Required<SubscriptionOptions>
    ): symbol {
        const eventName = String(event);
        let bucket = this.#events.get(eventName);

        if (!bucket) {
            bucket = createListenerBucket();
            this.#events.set(eventName, bucket);
        }

        if (
            this.#options.maxListeners !== Infinity &&
            bucket.size >= this.#options.maxListeners
        ) {
            console.warn(
                `MaxListenersExceededWarning: Possible memory leak detected. ${
                    bucket.size
                } listeners added to event "${eventName}".`
            );
        }

        const id = Symbol(eventName);
        let internalCallback: InternalCallback<T[K]> = callback;
        let unregisterToken: object | undefined;
        let weak = false;

        if (this.#options.weakReferences && this.#weakRegistry) {
            unregisterToken = Object.create(null) as object;
            this.#weakRegistry.register(callback as EventCallback<T[K]> & object, id, unregisterToken);
            internalCallback = new WeakRef(callback as EventCallback<T[K]> & object);
            weak = true;
        }

        const subscription: InternalSubscription<T[K]> = {
            id,
            event: eventName,
            callback: internalCallback,
            once: options.once,
            priority: options.priority,
            executionCount: 0,
            createdAt: Date.now(),
            unregisterToken,
            weak,
        };

        bucket[options.priority].push(subscription);
        bucket.size += 1;
        this.#subscriptionIndex.set(id, subscription);

        return id;
    }

    #enqueueBufferedEvent<K extends EventKey<T>>(
        event: K | string,
        data: T[K] | T[EventKey<T>],
        priority: EventPriority
    ): void {
        const eventName = String(event);
        let bucket = this.#buffer.get(eventName);

        if (!bucket) {
            bucket = createBufferedBucket();
            this.#buffer.set(eventName, bucket);
        }

        if (bucket.size >= this.#options.bufferSize) {
            throw new EventQueueFullError(eventName, this.#options.bufferSize);
        }

        const eventId = ++this.#bufferedEventId;
        const queuedEvent: QueuedEvent = {
            id: eventId,
            event: eventName,
            data,
            timestamp: Date.now(),
            priority,
        };

        bucket[priority].push(queuedEvent);
        bucket.size += 1;
        this.#bufferedEventCount += 1;
    }

    async #processBufferedEvents(): Promise<void> {
        if (this.#isPaused || this.#bufferedEventCount === 0) {
            return;
        }

        const queuedEvents = this.getQueuedEvents();
        this.clearBuffer();

        for (const queuedEvent of queuedEvents) {
            await this.emit(queuedEvent.event as EventKey<T>, queuedEvent.data as T[EventKey<T>], {
                priority: queuedEvent.priority,
            });
        }
    }

    async #dispatchAsync<K extends EventKey<T>>(
        event: K | string,
        data: T[K] | T[EventKey<T>],
        snapshot: ReadonlyArray<InternalSubscription>
    ): Promise<void> {
        const eventName = String(event);

        if (snapshot.length === 1) {
            let scheduled = this.#scheduleDispatch(eventName, snapshot[0]!, data);

            if (this.#options.captureRejections) {
                scheduled = scheduled.catch((error) => this.#handleCapturedErrorAsync(eventName, error));
            }

            await scheduled;
            return;
        }

        const scheduled = new Array<Promise<void>>(snapshot.length);

        for (let index = 0; index < snapshot.length; index++) {
            let task = this.#scheduleDispatch(eventName, snapshot[index]!, data);

            if (this.#options.captureRejections) {
                task = task.catch((error) => this.#handleCapturedErrorAsync(eventName, error));
            }

            scheduled[index] = task;
        }

        await Promise.all(scheduled);
    }

    #startGc(): void {
        if (this.#gcIntervalId) {
            clearInterval(this.#gcIntervalId);
        }

        this.#gcIntervalId = setInterval(() => {
            this.#runGc();
        }, this.#options.gcIntervalMs);

        if (
            typeof this.#gcIntervalId === 'object' &&
            this.#gcIntervalId !== null &&
            'unref' in this.#gcIntervalId
        ) {
            (this.#gcIntervalId as any).unref();
        }
    }

    #runGc(): void {
        if (this.#options.weakReferences) {
            for (const subscription of this.#subscriptionIndex.values()) {
                this.#resolveCallback(subscription);
            }
        }

        for (const [eventName, metrics] of this.#metrics.entries()) {
            if (!this.#events.has(eventName) && !this.#buffer.has(eventName)) {
                this.#metrics.delete(eventName);
            }
        }

        for (const [eventName, bucket] of this.#buffer.entries()) {
            if (bucket.size === 0) {
                this.#buffer.delete(eventName);
            }
        }
    }

    dispose(): void {
        if (this.#gcIntervalId) {
            clearInterval(this.#gcIntervalId);
            this.#gcIntervalId = undefined;
        }

        this.#scheduler.dispose();
        this.removeAllListeners();
        this.clearBuffer();
        this.#metrics.clear();
        this.#tapListeners.clear();
        this.#bufferProcessing = null;
        this.#isPaused = false;
        this.#isDisposed = true;
    }

    #createScheduler(): EventScheduler {
        return new EventScheduler({
            concurrencyLimit: this.#options.concurrencyLimit,
        });
    }

    #ensureRuntime(): void {
        if (!this.#isDisposed) {
            return;
        }

        this.#isDisposed = false;
        this.#scheduler = this.#createScheduler();

        if (this.#options.gcIntervalMs > 0) {
            this.#startGc();
        }
    }

    #scheduleDispatch<K extends EventKey<T>>(
        event: K | string,
        subscription: InternalSubscription,
        data: T[K] | T[EventKey<T>]
    ): Promise<void> {
        const eventName = String(event);

        return this.#scheduler.schedule(
            async () => {
                const callback = this.#resolveCallback(subscription);

                if (!callback) {
                    return;
                }

                const startTime = performance.now();
                subscription.executionCount += 1;
                subscription.lastExecuted = Date.now();

                try {
                    await callback(data as never);
                    this.#recordExecutionMetric(eventName, performance.now() - startTime, false);
                } catch (error) {
                    this.#recordExecutionMetric(eventName, performance.now() - startTime, true);
                    throw new EventHandlerError(eventName, error);
                }
            },
            PRIORITY_TO_TASK_PRIORITY[subscription.priority]
        );
    }

    async #handleCapturedErrorAsync(eventName: string, error: unknown): Promise<void> {
        const wrapped = error instanceof EventHandlerError ? error : new EventHandlerError(eventName, error);

        if (eventName === 'error') {
            throw wrapped;
        }

        const errorEvent = 'error' as EventKey<T>;

        if (!this.has(errorEvent)) {
            throw wrapped;
        }

        await this.emit(errorEvent, wrapped as T[typeof errorEvent]);
    }

    #handleCapturedErrorSync(eventName: string, error: EventHandlerError): void {
        if (eventName === 'error') {
            throw error;
        }

        const errorEvent = 'error' as EventKey<T>;

        if (!this.has(errorEvent)) {
            throw error;
        }

        this.emitSync(errorEvent, error as T[typeof errorEvent]);
    }

    #reportAsyncError(error: unknown): void {
        const failure = toError(error);

        if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => {
                throw failure;
            });
            return;
        }

        void Promise.resolve().then(() => {
            throw failure;
        });
    }

    #emitTaps(context: EventTapContext): void {
        if (this.#tapListeners.size === 0) {
            return;
        }

        for (const tap of this.#tapListeners) {
            try {
                tap(context);
            } catch (error) {
                this.#reportAsyncError(error);
            }
        }
    }

    #resolveCallback<TData>(subscription: InternalSubscription<TData>): EventCallback<TData> | undefined {
        if (!subscription.weak) {
            return subscription.callback as EventCallback<TData>;
        }

        const callback = (subscription.callback as WeakRef<EventCallback<TData>>).deref();

        if (callback) {
            return callback;
        }

        this.#deleteSubscription(subscription);
        return undefined;
    }

    #deleteSubscription(subscription: InternalSubscription<any>): boolean {
        const bucket = this.#events.get(subscription.event);
        this.#subscriptionIndex.delete(subscription.id);

        if (subscription.unregisterToken && this.#weakRegistry) {
            this.#weakRegistry.unregister(subscription.unregisterToken);
        }

        if (!bucket) {
            return false;
        }

        const records = bucket[subscription.priority];

        for (let index = 0; index < records.length; index++) {
            if (records[index] === subscription) {
                records.splice(index, 1);
                bucket.size -= 1;

                if (bucket.size === 0) {
                    this.#events.delete(subscription.event);
                }

                return true;
            }
        }

        if (bucket.size === 0) {
            this.#events.delete(subscription.event);
        }

        return false;
    }

    #clearBucket(eventName: string, bucket: ListenerBucket): void {
        for (const priority of ['high', 'normal', 'low'] as const) {
            const records = bucket[priority];

            for (let index = 0; index < records.length; index++) {
                const subscription = records[index]!;
                this.#subscriptionIndex.delete(subscription.id);

                if (subscription.unregisterToken && this.#weakRegistry) {
                    this.#weakRegistry.unregister(subscription.unregisterToken);
                }
            }

            records.length = 0;
        }

        bucket.size = 0;
        this.#events.delete(eventName);
    }

    #snapshotListeners(eventName: string): InternalSubscription<any>[] {
        const bucket = this.#events.get(eventName);
        if (!bucket || bucket.size === 0) {
            return [];
        }

        const snapshot = new Array<InternalSubscription<any>>(bucket.size);
        let offset = 0;
        offset = this.#copyLiveSubscriptions(bucket.high, snapshot, offset);
        offset = this.#copyLiveSubscriptions(bucket.normal, snapshot, offset);
        offset = this.#copyLiveSubscriptions(bucket.low, snapshot, offset);

        snapshot.length = offset;
        return snapshot;
    }

    #copyLiveSubscriptions(
        source: InternalSubscription<any>[],
        target: InternalSubscription<any>[],
        offset: number
    ): number {
        for (let index = 0; index < source.length; ) {
            const subscription = source[index]!;

            if (!this.#resolveCallback(subscription)) {
                continue;
            }

            target[offset] = subscription;
            offset += 1;
            index += 1;
        }

        return offset;
    }

    #removeOnceSubscriptions(snapshot: ReadonlyArray<InternalSubscription<any>>): void {
        for (let index = 0; index < snapshot.length; index++) {
            const subscription = snapshot[index]!;
            if (subscription.once) {
                this.#deleteSubscription(subscription);
            }
        }
    }

    #appendPublicSubscriptions<TData>(
        source: InternalSubscription<any>[],
        target: Subscription<TData>[]
    ): void {
        for (let index = 0; index < source.length; ) {
            const subscription = source[index]!;
            const callback = this.#resolveCallback(subscription);

            if (!callback) {
                continue;
            }

            target.push({
                id: subscription.id,
                event: subscription.event,
                callback,
                once: subscription.once,
                priority: subscription.priority,
                createdAt: subscription.createdAt,
                lastExecuted: subscription.lastExecuted,
                executionCount: subscription.executionCount,
            });
            index += 1;
        }
    }

    #copyBufferedEntries(source: ReadonlyArray<QueuedEvent>, target: QueuedEvent[], offset: number): number {
        for (let index = 0; index < source.length; index++) {
            target[offset] = source[index]!;
            offset += 1;
        }

        return offset;
    }

    #snapshotBufferedBucket(bucket: BufferedBucket): QueuedEvent[] {
        const snapshot = new Array<QueuedEvent>(bucket.size);
        let offset = 0;
        offset = this.#copyBufferedEntries(bucket.high, snapshot, offset);
        offset = this.#copyBufferedEntries(bucket.normal, snapshot, offset);
        this.#copyBufferedEntries(bucket.low, snapshot, offset);
        return snapshot;
    }

    #recordEmitMetric(eventName: string, duration: number): void {
        const metrics = this.#metrics.get(eventName) ?? createMetricsAccumulator();
        this.#metrics.set(eventName, metrics);
        this.#updateTiming(metrics.emit, duration);
    }

    #recordExecutionMetric(eventName: string, duration: number, isError: boolean): void {
        const metrics = this.#metrics.get(eventName) ?? createMetricsAccumulator();
        this.#metrics.set(eventName, metrics);
        this.#updateTiming(metrics.execution, duration);

        if (isError) {
            metrics.execution.errors += 1;
        }
    }

    #updateTiming(timing: TimingAccumulator, duration: number): void {
        timing.count += 1;
        timing.total += duration;
        timing.max = Math.max(timing.max, duration);
        timing.min = Math.min(timing.min, duration);
    }
}
