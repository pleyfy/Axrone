import { EventMap, EventKey, EventCallback, UnsubscribeFn, EventPriority } from './definition';
import { IEventEmitter, EventEmitter } from './event-emitter';
import {
    SubscriptionOptions,
    IEventPublisher,
    Subscription,
    EventMetrics,
    QueuedEvent,
} from './interfaces';

export class EventGroup<T extends EventMap> implements IEventEmitter<T> {
    readonly #emitter: IEventEmitter<T>;
    readonly #subscriptions: Set<symbol> = new Set();

    constructor(baseEmitter?: IEventEmitter<T>) {
        this.#emitter = baseEmitter || new EventEmitter<T>();
    }

    get maxListeners(): number {
        return this.#emitter.maxListeners;
    }

    set maxListeners(value: number) {
        this.#emitter.maxListeners = value;
    }

    on<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: SubscriptionOptions
    ): UnsubscribeFn {
        const unsubscribe = this.#emitter.on(event, callback, options);
        const subscription = this.#emitter
            .getSubscriptions(event)
            .find((s) => s.callback === callback);

        if (subscription) {
            this.#subscriptions.add(subscription.id);
        }

        return () => {
            const result = unsubscribe();
            if (subscription) {
                this.#subscriptions.delete(subscription.id);
            }
            return result;
        };
    }

    once<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: Omit<SubscriptionOptions, 'once'>
    ): UnsubscribeFn {
        const unsubscribe = this.#emitter.once(event, callback, options);
        const subscription = this.#emitter
            .getSubscriptions(event)
            .find((s) => s.callback === callback);

        if (subscription) {
            this.#subscriptions.add(subscription.id);
        }

        const wrappedUnsubscribe = () => {
            const result = unsubscribe();
            if (subscription) {
                this.#subscriptions.delete(subscription.id);
            }
            return result;
        };

        const wrappedCallback: EventCallback<T[K]> = (data) => {
            if (subscription) {
                this.#subscriptions.delete(subscription.id);
            }
            return callback(data);
        };

        return wrappedUnsubscribe;
    }

    off<K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>): boolean {
        if (callback) {
            const subscription = this.#emitter
                .getSubscriptions(event)
                .find((s) => s.callback === callback);
            if (subscription) {
                this.#subscriptions.delete(subscription.id);
            }
        } else {
            for (const subscription of this.#emitter.getSubscriptions(event)) {
                this.#subscriptions.delete(subscription.id);
            }
        }

        return this.#emitter.off(event, callback);
    }

    offById(subscriptionId: symbol): boolean {
        const result = this.#emitter.offById(subscriptionId);
        if (result) {
            this.#subscriptions.delete(subscriptionId);
        }
        return result;
    }

    pipe<K extends EventKey<T>>(
        event: K,
        emitter: IEventPublisher<any>,
        targetEvent?: string
    ): UnsubscribeFn {
        return this.on(
            event,
            (data) => void emitter.emit((targetEvent as any) || (event as any), data)
        );
    }

    emit<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        return this.#emitter.emit(event, data, options);
    }

    emitSync<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ): boolean {
        return this.#emitter.emitSync(event, data, options);
    }

    emitBatch<K extends EventKey<T>>(
        events: Array<{ event: K; data: T[K]; priority?: EventPriority }>
    ): Promise<boolean[]> {
        return this.#emitter.emitBatch(events);
    }

    has<K extends EventKey<T>>(event: K): boolean {
        return this.#emitter.has(event);
    }

    listenerCount<K extends EventKey<T>>(event: K): number {
        return this.#emitter.listenerCount(event);
    }

    listenerCountAll(): number {
        return this.#emitter.listenerCountAll();
    }

    eventNames(): EventKey<T>[] {
        return this.#emitter.eventNames();
    }

    getSubscriptions<K extends EventKey<T>>(event: K): ReadonlyArray<Subscription<T[K]>> {
        return this.#emitter.getSubscriptions(event).filter((s) => this.#subscriptions.has(s.id));
    }

    hasSubscription(subscriptionId: symbol): boolean {
        return (
            this.#subscriptions.has(subscriptionId) && this.#emitter.hasSubscription(subscriptionId)
        );
    }

    getMetrics<K extends EventKey<T>>(event: K): EventMetrics {
        return this.#emitter.getMetrics(event);
    }

    getMemoryUsage(): Record<string, number> {
        return this.#emitter.getMemoryUsage();
    }

    getQueuedEvents<K extends EventKey<T>>(event?: K): ReadonlyArray<QueuedEvent> {
        return this.#emitter.getQueuedEvents(event);
    }

    getPendingCount<K extends EventKey<T>>(event?: K): number {
        return this.#emitter.getPendingCount(event);
    }

    getBufferSize(): number {
        return this.#emitter.getBufferSize();
    }

    clearBuffer<K extends EventKey<T>>(event?: K): number {
        return this.#emitter.clearBuffer(event);
    }

    pause(): void {
        this.#emitter.pause();
    }

    resume(): void {
        this.#emitter.resume();
    }

    isPaused(): boolean {
        return this.#emitter.isPaused();
    }

    removeAllListeners<K extends EventKey<T>>(event?: K): this {
        if (event) {
            for (const subscription of this.#emitter.getSubscriptions(event)) {
                this.#subscriptions.delete(subscription.id);
            }
        } else {
            this.#subscriptions.clear();
        }

        this.#emitter.removeAllListeners(event);
        return this;
    }

    batchSubscribe<K extends EventKey<T>>(
        event: K,
        callbacks: ReadonlyArray<EventCallback<T[K]>>,
        options?: SubscriptionOptions
    ): ReadonlyArray<symbol> {
        const ids = this.#emitter.batchSubscribe(event, callbacks, options);

        for (const id of ids) {
            this.#subscriptions.add(id);
        }

        return ids;
    }

    batchUnsubscribe(subscriptionIds: ReadonlyArray<symbol>): number {
        const count = this.#emitter.batchUnsubscribe(subscriptionIds);

        for (const id of subscriptionIds) {
            this.#subscriptions.delete(id);
        }

        return count;
    }

    resetMaxListeners(): void {
        this.#emitter.resetMaxListeners();
    }

    async drain(): Promise<void> {
        return this.#emitter.drain();
    }

    async flush<K extends EventKey<T>>(event: K): Promise<void> {
        return this.#emitter.flush(event);
    }

    resetMetrics<K extends EventKey<T>>(event?: K): void {
        this.#emitter.resetMetrics(event);
    }

    dispose(): void {
        for (const id of this.#subscriptions) {
            this.#emitter.offById(id);
        }
        this.#subscriptions.clear();
    }
}
