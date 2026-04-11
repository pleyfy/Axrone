import { PriorityQueue } from '@axrone/utility';
import { performance } from './performance';
import {
    EventCallback,
    EventPriority,
    EventMap,
    EventKey,
    UnsubscribeFn,
    EventOptions,
    DEFAULT_OPTIONS,
    PRIORITY_VALUES,
    MEMORY_USAGE_SYMBOLS,
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
import { EventScheduler } from './event-scheduler';

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

export class EventEmitter<T extends EventMap = EventMap> implements IEventEmitter<T> {
    #subscriptions = new Map<string, Map<symbol, Subscription<any>>>();
    #options: Required<EventOptions>;
    #staticSubscriptionStorage = new Map<symbol, Subscription>();
    #weakSubscriptionStorage?: WeakMap<object, symbol[]>;
    #metrics = new Map<
        string,
        {
            emit: {
                count: number;
                timing: number[];
            };
            execution: {
                count: number;
                errors: number;
                timing: number[];
            };
        }
    >();
    #scheduler: EventScheduler;
    #eventQueues = new Map<string, PriorityQueue<QueuedEvent, number>>();
    #eventIdCounter = 0;
    #isPaused = false;
    #gcIntervalId?: ReturnType<typeof setInterval>;
    #lastGcTime = Date.now();

    constructor(options: EventOptions = {}) {
        this.#options = { ...DEFAULT_OPTIONS, ...options };

        if (this.#options.weakReferences) {
            this.#weakSubscriptionStorage = new WeakMap();
        }

        this.#scheduler = new EventScheduler({ concurrencyLimit: this.#options.concurrencyLimit });

        if (this.#options.gcIntervalMs > 0) {
            this.#startGc();
        }
    }

    get maxListeners(): number {
        return this.#options.maxListeners;
    }

    set maxListeners(value: number) {
        if (value < 0 || !Number.isInteger(value)) {
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
        return this.#addListener(event, callback, {
            once: false,
            priority: 'normal',
            ...options,
        });
    }

    public once<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: Omit<SubscriptionOptions, 'once'> = {}
    ): UnsubscribeFn {
        return this.#addListener(event, callback, {
            once: true,
            priority: 'normal',
            ...options,
        });
    }

    public pipe<K extends EventKey<T>>(
        event: K,
        emitter: IEventPublisher<any>,
        targetEvent?: string
    ): UnsubscribeFn {
        const actualTargetEvent = targetEvent || event;
        return this.on(event, (data) => {
            void emitter.emit(actualTargetEvent as any, data);
        });
    }

    public off<K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>): boolean {
        if (!this.#subscriptions.has(event)) {
            return false;
        }

        const subscriptionMap = this.#subscriptions.get(event)!;

        if (!callback) {
            for (const id of subscriptionMap.keys()) {
                this.#staticSubscriptionStorage.delete(id);
            }
            this.#subscriptions.delete(event);
            return subscriptionMap.size > 0;
        }

        let found = false;
        for (const [id, subscription] of subscriptionMap.entries()) {
            if (subscription.callback === callback) {
                subscriptionMap.delete(id);
                this.#staticSubscriptionStorage.delete(id);
                found = true;
            }
        }

        if (subscriptionMap.size === 0) {
            this.#subscriptions.delete(event);
        }

        return found;
    }

    public offById(subscriptionId: symbol): boolean {
        const subscription = this.#staticSubscriptionStorage.get(subscriptionId);
        if (!subscription) {
            return false;
        }

        const { event } = subscription;
        const subscriptionMap = this.#subscriptions.get(event);

        if (!subscriptionMap) {
            this.#staticSubscriptionStorage.delete(subscriptionId);
            return false;
        }

        const result = subscriptionMap.delete(subscriptionId);
        this.#staticSubscriptionStorage.delete(subscriptionId);

        if (subscriptionMap.size === 0) {
            this.#subscriptions.delete(event);
        }

        return result;
    }

    async #handleError(error: Error): Promise<void> {
        const errorEvent = 'error' as EventKey<T>;

        if (this.has(errorEvent)) {
            try {
                await this.emit(errorEvent, error as T[typeof errorEvent]);
            } catch (innerError) {
                console.error('Error in error handler:', innerError);
            }
        } else {
            throw error;
        }
    }

    #handleErrorSync(error: Error): void {
        const errorEvent = 'error' as EventKey<T>;

        if (this.has(errorEvent)) {
            try {
                this.emitSync(errorEvent, error as T[typeof errorEvent]);
            } catch (innerError) {
                console.error('Error in error handler:', innerError);
            }
        } else {
            throw error;
        }
    }

    public async emit<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): Promise<boolean> {
        const priority = options.priority || 'normal';
        const startTime = performance.now();

        try {
            if (this.#isPaused) {
                this.#addToQueue(event, data, priority);
                this.#updateMetrics(event, 'emit', 0);
                return true;
            }

            const subscriptionMap = this.#subscriptions.get(event);
            if (!subscriptionMap || subscriptionMap.size === 0) {
                this.#updateMetrics(event, 'emit', performance.now() - startTime);
                return false;
            }

            const subscriptions = [...subscriptionMap.values()].sort(
                (a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]
            );

            const onceSubscriptions = subscriptions.filter((s) => s.once);
            for (const subscription of onceSubscriptions) {
                this.offById(subscription.id);
            }

            const executionPromises = subscriptions.map((subscription) =>
                this.#scheduler.schedule(async () => {
                    const execStartTime = performance.now();
                    subscription.executionCount++;
                    subscription.lastExecuted = Date.now();
                    const { callback } = subscription;

                    try {
                        await callback(data);
                        this.#updateMetrics(event, 'execution', performance.now() - execStartTime);
                    } catch (error) {
                        this.#updateMetrics(
                            event,
                            'execution',
                            performance.now() - execStartTime,
                            true
                        );

                        const shouldCaptureRejections = this.#options.captureRejections === true;

                        if (shouldCaptureRejections) {
                            try {
                                await this.#handleError(new EventHandlerError(event, error));
                                return;
                            } catch (handlerError) {
                                console.error('Failed to handle error:', handlerError);
                                return;
                            }
                        } else {
                            throw new EventHandlerError(event, error);
                        }
                    }
                })
            );

            if (this.#options.captureRejections === true) {
                await Promise.allSettled(executionPromises);
            } else {
                await Promise.all(executionPromises);
            }

            this.#updateMetrics(event, 'emit', performance.now() - startTime);
            return true;
        } catch (error) {
            this.#updateMetrics(event, 'emit', performance.now() - startTime);
            throw error;
        }
    }

    public emitSync<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): boolean {
        const startTime = performance.now();

        try {
            if (this.#isPaused) {
                this.#addToQueue(event, data, options.priority || 'normal');
                this.#updateMetrics(event, 'emit', 0);
                return true;
            }

            const subscriptionMap = this.#subscriptions.get(event);
            if (!subscriptionMap || subscriptionMap.size === 0) {
                this.#updateMetrics(event, 'emit', performance.now() - startTime);
                return false;
            }

            const subscriptions = [...subscriptionMap.values()].sort(
                (a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]
            );

            const onceSubscriptions = subscriptions.filter((s) => s.once);
            for (const subscription of onceSubscriptions) {
                this.offById(subscription.id);
            }

            let hadAsyncCallbacks = false;

            for (const subscription of subscriptions) {
                const execStartTime = performance.now();
                subscription.executionCount++;
                subscription.lastExecuted = Date.now();
                const { callback } = subscription;

                try {
                    const result = callback(data);
                    if (result instanceof Promise) {
                        hadAsyncCallbacks = true;
                        result
                            .catch((error) => {
                                this.#updateMetrics(
                                    event,
                                    'execution',
                                    performance.now() - execStartTime,
                                    true
                                );

                                const shouldCaptureRejections =
                                    this.#options.captureRejections === true;

                                if (shouldCaptureRejections) {
                                    this.#handleErrorSync(new EventHandlerError(event, error));
                                } else {
                                    queueMicrotask(() => {
                                        throw new EventHandlerError(event, error);
                                    });
                                }
                            })
                            .then(() => {
                                this.#updateMetrics(
                                    event,
                                    'execution',
                                    performance.now() - execStartTime
                                );
                            });
                    } else {
                        this.#updateMetrics(event, 'execution', performance.now() - execStartTime);
                    }
                } catch (error) {
                    this.#updateMetrics(
                        event,
                        'execution',
                        performance.now() - execStartTime,
                        true
                    );

                    const shouldCaptureRejections = this.#options.captureRejections === true;

                    if (shouldCaptureRejections) {
                        this.#handleErrorSync(new EventHandlerError(event, error));
                    } else {
                        throw new EventHandlerError(event, error);
                    }
                }
            }

            if (hadAsyncCallbacks) {
                console.warn(
                    `EventEmitter: Event "${String(
                        event
                    )}" was emitted synchronously but had async listeners. Consider using emit() instead.`
                );
            }

            this.#updateMetrics(event, 'emit', performance.now() - startTime);
            return true;
        } catch (error) {
            this.#updateMetrics(event, 'emit', performance.now() - startTime);
            throw error;
        }
    }

    public async emitBatch<K extends EventKey<T>>(
        events: Array<{ event: K; data: T[K]; priority?: EventPriority }>
    ): Promise<boolean[]> {
        if (events.length === 0) return [];

        const results: Promise<boolean>[] = [];

        for (const { event, data, priority } of events) {
            results.push(this.emit(event, data, { priority }));
        }

        return Promise.all(results);
    }

    public has<K extends EventKey<T>>(event: K): boolean {
        const subscriptionMap = this.#subscriptions.get(event);
        return !!subscriptionMap && subscriptionMap.size > 0;
    }

    public hasSubscription(subscriptionId: symbol): boolean {
        return this.#staticSubscriptionStorage.has(subscriptionId);
    }

    public listenerCount<K extends EventKey<T>>(event: K): number {
        const subscriptionMap = this.#subscriptions.get(event);
        return subscriptionMap ? subscriptionMap.size : 0;
    }

    public listenerCountAll(): number {
        let count = 0;
        for (const subscriptionMap of this.#subscriptions.values()) {
            count += subscriptionMap.size;
        }
        return count;
    }

    public eventNames(): EventKey<T>[] {
        return Array.from(this.#subscriptions.keys()) as EventKey<T>[];
    }

    public getSubscriptions<K extends EventKey<T>>(event: K): ReadonlyArray<Subscription<T[K]>> {
        const subscriptionMap = this.#subscriptions.get(event);
        if (!subscriptionMap) {
            return [];
        }
        return Array.from(subscriptionMap.values()) as Subscription<T[K]>[];
    }

    public removeAllListeners<K extends EventKey<T>>(event?: K): this {
        if (event) {
            const subscriptionMap = this.#subscriptions.get(event);
            if (subscriptionMap) {
                for (const id of subscriptionMap.keys()) {
                    this.#staticSubscriptionStorage.delete(id);
                }
                this.#subscriptions.delete(event);
            }
        } else {
            this.#staticSubscriptionStorage.clear();
            this.#subscriptions.clear();
            if (this.#weakSubscriptionStorage) {
                this.#weakSubscriptionStorage = new WeakMap();
            }
        }
        return this;
    }

    public batchSubscribe<K extends EventKey<T>>(
        event: K,
        callbacks: ReadonlyArray<EventCallback<T[K]>>,
        options: SubscriptionOptions = {}
    ): ReadonlyArray<symbol> {
        const subscriptionIds: symbol[] = [];

        for (const callback of callbacks) {
            const unsubscribe = this.on(event, callback, options);
            const subscription = this.getSubscriptions(event).find((s) => s.callback === callback);
            if (subscription) {
                subscriptionIds.push(subscription.id);
            }
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

    public getQueuedEvents<K extends EventKey<T>>(event?: K): ReadonlyArray<QueuedEvent> {
        if (event) {
            const queue = this.#eventQueues.get(event);
            return queue ? queue.toArray() : [];
        }

        const allEvents: QueuedEvent[] = [];
        for (const queue of this.#eventQueues.values()) {
            allEvents.push(...queue.toArray());
        }

        return allEvents.sort((a, b) => {
            const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return a.timestamp - b.timestamp;
        });
    }

    public getPendingCount<K extends EventKey<T>>(event?: K): number {
        if (event) {
            const queue = this.#eventQueues.get(event);
            return queue ? queue.size : 0;
        }

        let total = 0;
        for (const queue of this.#eventQueues.values()) {
            total += queue.size;
        }
        return total;
    }

    public getBufferSize(): number {
        return this.#options.bufferSize;
    }

    public clearBuffer<K extends EventKey<T>>(event?: K): number {
        if (event) {
            const queue = this.#eventQueues.get(event);
            if (!queue) return 0;
            const size = queue.size;
            queue.clear();
            return size;
        }

        let total = 0;
        for (const [eventName, queue] of this.#eventQueues.entries()) {
            total += queue.size;
            queue.clear();
        }
        this.#eventQueues.clear();
        return total;
    }

    public pause(): void {
        this.#isPaused = true;
    }

    public resume(): void {
        if (!this.#isPaused) return;
        this.#isPaused = false;
        this.#processQueues();
    }

    public isPaused(): boolean {
        return this.#isPaused;
    }

    public async drain(): Promise<void> {
        await this.#scheduler.drain();

        if (!this.#isPaused) {
            await this.#processQueues();
        }
    }

    public async flush<K extends EventKey<T>>(event: K): Promise<void> {
        if (!this.#eventQueues.has(event)) return;

        const queue = this.#eventQueues.get(event)!;
        const queuedEvents = queue.toArray();
        queue.clear();

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
        const metrics = this.#metrics.get(event) || {
            emit: { count: 0, timing: [] },
            execution: { count: 0, errors: 0, timing: [] },
        };

        const emitTimings = metrics.emit.timing;
        const executionTimings = metrics.execution.timing;

        return {
            emit: {
                count: metrics.emit.count,
                timing: {
                    avg: emitTimings.length
                        ? emitTimings.reduce((a, b) => a + b, 0) / emitTimings.length
                        : 0,
                    max: emitTimings.length ? Math.max(...emitTimings) : 0,
                    min: emitTimings.length ? Math.min(...emitTimings) : 0,
                    total: emitTimings.reduce((a, b) => a + b, 0),
                },
            },
            execution: {
                count: metrics.execution.count,
                errors: metrics.execution.errors,
                timing: {
                    avg: executionTimings.length
                        ? executionTimings.reduce((a, b) => a + b, 0) / executionTimings.length
                        : 0,
                    max: executionTimings.length ? Math.max(...executionTimings) : 0,
                    min: executionTimings.length ? Math.min(...executionTimings) : 0,
                    total: executionTimings.reduce((a, b) => a + b, 0),
                },
            },
        };
    }

    public resetMetrics<K extends EventKey<T>>(event?: K): void {
        if (event) {
            this.#metrics.delete(event);
        } else {
            this.#metrics.clear();
        }
    }

    public getMemoryUsage(): Record<string, number> {
        const calcSize = (obj: any): number => {
            if (obj === null || obj === undefined) return 0;

            let bytes = 0;

            if (typeof obj === 'object') {
                if (obj instanceof Map) {
                    bytes = 64;
                    for (const [key, value] of obj.entries()) {
                        bytes += calcSize(key) + calcSize(value);
                    }
                } else if (obj instanceof Set) {
                    bytes = 40;
                    for (const item of obj) {
                        bytes += calcSize(item);
                    }
                } else if (obj instanceof Array) {
                    bytes = 40 + 8 * obj.length;
                    for (const item of obj) {
                        bytes += calcSize(item);
                    }
                } else if (obj instanceof PriorityQueue) {
                    bytes = 48;
                    bytes += calcSize(obj.toArray());
                } else {
                    bytes = 40;
                    for (const key in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) {
                            bytes += calcSize(key) + calcSize(obj[key]);
                        }
                    }
                }
            } else if (typeof obj === 'string') {
                bytes = 2 * obj.length + 24;
            } else if (typeof obj === 'number') {
                bytes = 8;
            } else if (typeof obj === 'boolean') {
                bytes = 4;
            } else if (typeof obj === 'symbol') {
                bytes = 16;
            }

            return bytes;
        };

        return {
            [MEMORY_USAGE_SYMBOLS.staticSubscriptions]: calcSize(this.#staticSubscriptionStorage),
            [MEMORY_USAGE_SYMBOLS.subscriptionMaps]: calcSize(this.#subscriptions),
            [MEMORY_USAGE_SYMBOLS.priorityQueues]: calcSize(this.#eventQueues),
            [MEMORY_USAGE_SYMBOLS.eventBuffer]: Array.from(this.#eventQueues.values()).reduce(
                (total, queue) => total + queue.size,
                0
            ),
            total:
                calcSize(this.#staticSubscriptionStorage) +
                calcSize(this.#subscriptions) +
                calcSize(this.#eventQueues) +
                calcSize(this.#metrics),
        };
    }

    #addListener<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: Required<SubscriptionOptions>
    ): UnsubscribeFn {
        if (!this.#subscriptions.has(event)) {
            this.#subscriptions.set(event, new Map());
        }

        const subscriptionMap = this.#subscriptions.get(event)!;

        if (
            this.#options.maxListeners !== Infinity &&
            subscriptionMap.size >= this.#options.maxListeners
        ) {
            console.warn(
                `MaxListenersExceededWarning: Possible memory leak detected. ${
                    subscriptionMap.size
                } listeners added to event "${String(event)}".`
            );
        }

        const id = Symbol();
        const subscription: Subscription<T[K]> = {
            id,
            event,
            callback,
            once: options.once,
            priority: options.priority,
            executionCount: 0,
            createdAt: Date.now(),
        };

        subscriptionMap.set(id, subscription as Subscription);
        this.#staticSubscriptionStorage.set(id, subscription as Subscription);

        if (this.#weakSubscriptionStorage && typeof callback === 'object') {
            const existingIds = this.#weakSubscriptionStorage.get(callback) || [];
            this.#weakSubscriptionStorage.set(callback, [...existingIds, id]);
        }

        return () => this.offById(id);
    }

    #addToQueue<K extends EventKey<T>>(event: K, data: T[K], priority: EventPriority): void {
        if (!this.#eventQueues.has(event)) {
            this.#eventQueues.set(
                event,
                PriorityQueue.withComparator<QueuedEvent, number>((a, b) => a - b)
            );
        }

        const queue = this.#eventQueues.get(event)!;

        if (queue.size >= this.#options.bufferSize) {
            throw new EventQueueFullError(event, this.#options.bufferSize);
        }

        const eventId = this.#eventIdCounter++;
        const queuedEvent: QueuedEvent = {
            id: eventId,
            event,
            data,
            timestamp: Date.now(),
            priority,
        };

        const priorityValue = PRIORITY_VALUES[priority] * 1000000000 + Date.now();
        queue.enqueue(queuedEvent, priorityValue);
    }

    async #processQueues(): Promise<void> {
        if (this.#isPaused) return;

        const allEvents = this.getQueuedEvents();

        this.clearBuffer();

        for (const queuedEvent of allEvents) {
            await this.emit(queuedEvent.event as EventKey<T>, queuedEvent.data as T[EventKey<T>], {
                priority: queuedEvent.priority,
            });
        }
    }

    #updateMetrics<K extends EventKey<T>>(
        event: K,
        type: 'emit' | 'execution',
        duration: number,
        isError = false
    ): void {
        if (!this.#metrics.has(event)) {
            this.#metrics.set(event, {
                emit: { count: 0, timing: [] },
                execution: { count: 0, errors: 0, timing: [] },
            });
        }

        const metrics = this.#metrics.get(event)!;

        if (type === 'emit') {
            metrics.emit.count++;
            metrics.emit.timing.push(duration);

            if (metrics.emit.timing.length > 100) {
                metrics.emit.timing = metrics.emit.timing.slice(-100);
            }
        } else {
            metrics.execution.count++;
            if (isError) {
                metrics.execution.errors++;
            }
            metrics.execution.timing.push(duration);

            if (metrics.execution.timing.length > 100) {
                metrics.execution.timing = metrics.execution.timing.slice(-100);
            }
        }
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
        this.#lastGcTime = Date.now();

        if (this.#options.weakReferences) {
            return;
        }

        const existingEvents = new Set(this.eventNames());
        for (const event of this.#metrics.keys()) {
            if (!existingEvents.has(event as any)) {
                this.#metrics.delete(event);
            }
        }

        for (const [event, queue] of this.#eventQueues.entries()) {
            if (queue.size === 0) {
                this.#eventQueues.delete(event);
            }
        }
    }

    dispose(): void {
        if (this.#gcIntervalId) {
            clearInterval(this.#gcIntervalId);
        }

        this.removeAllListeners();
        this.clearBuffer();
        this.#metrics.clear();
    }
}
