import {
    EventCallback,
    EventPriority,
    EventMap,
    EventKey,
    UnsubscribeFn,
    EventDispatchItem,
} from './definition';

interface TimingSnapshot {
    readonly avg: number;
    readonly max: number;
    readonly min: number;
    readonly total: number;
}

export interface Subscription<T = unknown> {
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
        readonly timing: TimingSnapshot;
    };
    readonly execution: {
        readonly count: number;
        readonly errors: number;
        readonly timing: TimingSnapshot;
    };
}

export interface QueuedEvent<T = unknown> {
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

    emitBatch(events: ReadonlyArray<EventDispatchItem<T>>): Promise<boolean[]>;
}

export interface IEventBuffer<T extends EventMap = EventMap> {
    getQueuedEvents<K extends EventKey<T>>(event: K): ReadonlyArray<QueuedEvent<T[K]>>;

    getQueuedEvents(): ReadonlyArray<QueuedEvent<T[EventKey<T>]>>;

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
