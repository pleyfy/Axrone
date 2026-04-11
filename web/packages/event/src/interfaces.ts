import { EventCallback, EventPriority, EventMap, EventKey, UnsubscribeFn } from './definition';

export interface Subscription<T = any> {
    readonly id: symbol;
    readonly event: string;
    readonly callback: EventCallback<T>;
    readonly once: boolean;
    readonly priority: EventPriority;
    readonly createdAt: number;
    lastExecuted?: number;
    executionCount: number;
}

export interface SubscriptionOptions {
    readonly once?: boolean;
    readonly priority?: EventPriority;
}

export interface EventMetrics {
    readonly emit: {
        readonly count: number;
        readonly timing: {
            readonly avg: number;
            readonly max: number;
            readonly min: number;
            readonly total: number;
        };
    };
    readonly execution: {
        readonly count: number;
        readonly errors: number;
        readonly timing: {
            readonly avg: number;
            readonly max: number;
            readonly min: number;
            readonly total: number;
        };
    };
}

export interface QueuedEvent<T = any> {
    readonly id: number;
    readonly event: string;
    readonly data: T;
    readonly timestamp: number;
    readonly priority: EventPriority;
}

export interface IEventSubscriber<T extends EventMap = EventMap> {
    on<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: SubscriptionOptions
    ): UnsubscribeFn;

    once<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: Omit<SubscriptionOptions, 'once'>
    ): UnsubscribeFn;

    off<K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>): boolean;

    offById(subscriptionId: symbol): boolean;

    pipe<K extends EventKey<T>>(
        event: K,
        emitter: IEventPublisher<any>,
        targetEvent?: string
    ): UnsubscribeFn;
}

export interface IEventPublisher<T extends EventMap = EventMap> {
    emit<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ): Promise<boolean>;

    emitSync<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ): boolean;

    emitBatch<K extends EventKey<T>>(
        events: Array<{ event: K; data: T[K]; priority?: EventPriority }>
    ): Promise<boolean[]>;
}

export interface IEventBuffer<T extends EventMap = EventMap> {
    getQueuedEvents<K extends EventKey<T>>(event?: K): ReadonlyArray<QueuedEvent>;

    getPendingCount<K extends EventKey<T>>(event?: K): number;

    getBufferSize(): number;

    clearBuffer<K extends EventKey<T>>(event?: K): number;

    pause(): void;

    resume(): void;

    isPaused(): boolean;
}

export interface IEventObserver<T extends EventMap = EventMap> {
    has<K extends EventKey<T>>(event: K): boolean;

    listenerCount<K extends EventKey<T>>(event: K): number;

    maxListeners: number;

    listenerCountAll(): number;

    eventNames(): EventKey<T>[];

    getSubscriptions<K extends EventKey<T>>(event: K): ReadonlyArray<Subscription<T[K]>>;

    hasSubscription(subscriptionId: symbol): boolean;

    getMetrics<K extends EventKey<T>>(event: K): EventMetrics;

    getMemoryUsage(): Record<string, number>;
}
