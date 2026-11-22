import { pipeToEmitter } from './internal/utils';
import {
    addTap,
    clearBuffer,
    createEmitterHost,
    createEmitterState,
    disposeRuntime,
    drainRuntime,
    emitBatch,
    emitInternal,
    emitSyncInternal,
    ensureRuntime,
    flushBufferedEvent,
    getBufferSize,
    getEventMetrics,
    getEventNames,
    getListenerCount,
    getListenerCountAll,
    getPendingCount,
    getQueuedEvents,
    getSubscriptions,
    hasEvent,
    hasSubscription,
    initEmitterRuntime,
    normalizeOptions,
    pauseEmitter,
    registerListener,
    removeAllListeners,
    removeAllListenersForEvent,
    removeListenerByCallback,
    removeSubscriptionById,
    resetMetrics,
    resumeEmitter,
} from './internal/emitter';
import type { EmitterHost, EmitterState } from './internal/emitter';
import {
    EventCallback,
    EventPriority,
    EventMap,
    EventKey,
    UnsubscribeFn,
    EventOptions,
    DEFAULT_OPTIONS,
    DEFAULT_PRIORITY,
    EventDispatchItem,
    EventDispatchResult,
} from './definition';
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
import { EVENT_EMITTER_TAP, EventTap } from './internals';

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
    readonly #state: EmitterState;
    readonly #host: EmitterHost<T>;

    constructor(options: EventOptions = {}) {
        const state = createEmitterState(normalizeOptions(options));
        this.#state = state;
        this.#host = createEmitterHost(state, {
            emit: (event, data, emitOptions) => this.emit(event, data, emitOptions),
            emitSync: (event, data, emitOptions) => this.emitSync(event, data, emitOptions),
            offById: (subscriptionId) => this.offById(subscriptionId),
        });
        initEmitterRuntime(state, this.#host);
    }

    get maxListeners(): number {
        return this.#state.options.maxListeners;
    }

    set maxListeners(value: number) {
        if (value !== Infinity && (value < 0 || !Number.isInteger(value))) {
            throw new TypeError('maxListeners must be a non-negative integer');
        }
        this.#state.options = { ...this.#state.options, maxListeners: value };
    }

    resetMaxListeners(): void {
        this.#state.options = {
            ...this.#state.options,
            maxListeners: DEFAULT_OPTIONS.maxListeners,
        };
    }

    public on<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: SubscriptionOptions = {}
    ): UnsubscribeFn {
        ensureRuntime(this.#state);

        const id = registerListener(this.#state, event, callback, {
            once: options.once ?? false,
            priority: options.priority ?? DEFAULT_PRIORITY,
        });

        return () => this.offById(id);
    }

    public once<K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options: Omit<SubscriptionOptions, 'once'> = {}
    ): UnsubscribeFn {
        ensureRuntime(this.#state);

        const id = registerListener(this.#state, event, callback, {
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
        return pipeToEmitter(
            (callback) => this.on(event, callback as EventCallback<T[K]>),
            emitter,
            targetEvent ?? (event as string)
        );
    }

    public off<K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>): boolean {
        return removeListenerByCallback(this.#state, String(event), callback as EventCallback<any> | undefined);
    }

    public offById(subscriptionId: symbol): boolean {
        return removeSubscriptionById(this.#state, subscriptionId);
    }

    /**
     * Asynchronously dispatch an event to all currently-subscribed listeners.
     *
     * **Dispatch semantics — snapshot model.** The listener set is captured
     * at the moment this method is called, and dispatch iterates only that
     * snapshot. Concretely:
     *
     * - *Snapshot at dispatch start.* The snapshot is built from the
     *   listener bucket in priority order (high → normal → low) before any
     *   handler runs. The set of listeners that will fire is fixed for the
     *   lifetime of this `emit`.
     * - *Mutations during dispatch are deferred.* Subscriptions added via
     *   `on()` / `once()` during this `emit` are stored in the bucket but
     *   are NOT in the snapshot, so they do not fire in this dispatch —
     *   they become visible to the next `emit`.
     * - *`off()` during dispatch.* Removing a listener via `off()` /
     *   `offById()` while this `emit` is in-flight sets the subscription's
     *   `disposed` flag. Both the async fast-path (`concurrencyLimit ===
     *   Infinity`) and the scheduler path re-check this flag before
     *   invocation, so a listener removed during the current dispatch is
     *   skipped for the remainder of this `emit`. The snapshot itself is
     *   not re-read — the bucket, not the snapshot, is the source of truth
     *   for "still subscribed". This is the snapshot model: a fixed list
     *   at start, not a live-growing list.
     * - *`once` removal is post-dispatch.* A `once` listener fires on the
     *   first matching emit after registration and is unregistered only
     *   after its handler returns (or throws). It is NEVER removed before
     *   being invoked in this `emit`, even if `off()` is called on it from
     *   inside its own handler.
     * - *Re-entrant emits complete in full.* A handler that calls `emit()`
     *   for the same event runs a nested, full dispatch that snapshots
     *   and completes before the outer iteration resumes. There is no
     *   implicit short-circuit or skip of the outer iteration.
     * - *Re-entrancy is bounded.* Nested emits for the same event are
     *   capped at `MAX_EMIT_DEPTH` (32). Deeper recursion is dropped and
     *   logged once.
     *
     * **Divergence from `@axrone/observer`.** This snapshot model differs
     * deliberately from `@axrone/observer`'s `Subject`, which iterates a
     * live, growing array and therefore FIRES listeners added
     * mid-dispatch. Use `Subject` for observer-style live fan-out; use
     * `EventEmitter` for stable per-emit fan-out (the common case for
     * game and event systems).
     *
     * @typeParam K - Event key, narrowed against `T`.
     * @param event - The event to dispatch.
     * @param data - The payload delivered to every listener.
     * @param options - Per-emit overrides; `priority` is accepted for
     *   parity but does not change the dispatch order within the
     *   snapshot.
     * @returns A promise that resolves to `true` if at least one listener
     *   was invoked, `false` if the emitter was paused, had no listeners,
     *   exceeded re-entrancy depth, or the snapshot was empty. Rejects
     *   with collected handler errors (an `EventHandlerError` or
     *   `AggregateError`) when `captureRejections` is disabled and at
     *   least one handler threw.
     */
    public emit<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): Promise<boolean> {
        ensureRuntime(this.#state);
        return emitInternal(this.#state, this.#host, event, data, options);
    }

    /**
     * Synchronously dispatch an event to all currently-subscribed listeners.
     *
     * **Dispatch semantics — snapshot model.** The listener set is captured
     * at the moment this method is called, and dispatch iterates only that
     * snapshot. Concretely:
     *
     * - *Snapshot at dispatch start.* The snapshot is built from the
     *   listener bucket in priority order (high → normal → low) before any
     *   handler runs. The set of listeners that will fire is fixed for the
     *   lifetime of this `emitSync`.
     * - *Mutations during dispatch are deferred.* Subscriptions added via
     *   `on()` / `once()` during this `emitSync` are stored in the bucket
     *   but are NOT in the snapshot, so they do not fire in this
     *   dispatch — they become visible to the next emit.
     * - *`off()` during dispatch is a no-op for the current dispatch.*
     *   Unlike the async `emit()` path, the sync fast-path does NOT
     *   re-check the `disposed` flag before invocation. A listener
     *   removed via `off()` / `offById()` while this `emitSync` is
     *   in-flight will STILL be invoked once, because the snapshot — not
     *   the live bucket — determines what fires. (If the snapshot
     *   callback was wrapped in a `WeakRef` and the underlying callback
     *   has been garbage-collected, the listener is skipped — but that
     *   is a separate `WeakRef`-resolution failure, not a removal
     *   effect.)
     * - *`once` removal is post-dispatch.* A `once` listener fires on the
     *   first matching emit after registration and is unregistered only
     *   after its handler returns (or throws). It is NEVER removed before
     *   being invoked in this `emitSync`, even if `off()` is called on it
     *   from inside its own handler.
     * - *Async handlers are warned, not awaited.* If a handler returns a
     *   thenable, this method returns immediately and a warning is
     *   logged to the console; the promise's outcome is observed in the
     *   background and routed through `captureRejections` or
     *   `reportAsyncError`. For awaitable semantics, use `emit()`.
     * - *Re-entrancy is bounded.* Nested `emitSync` calls for the same
     *   event are capped at `MAX_EMIT_DEPTH` (32). Deeper recursion is
     *   dropped and logged once.
     *
     * **Divergence from `@axrone/observer`.** This snapshot model differs
     * deliberately from `@axrone/observer`'s `Subject`, which iterates a
     * live, growing array and therefore FIRES listeners added
     * mid-dispatch. Use `Subject` for observer-style live fan-out; use
     * `EventEmitter` for stable per-emit fan-out (the common case for
     * game and event systems).
     *
     * @typeParam K - Event key, narrowed against `T`.
     * @param event - The event to dispatch.
     * @param data - The payload delivered to every listener.
     * @param options - Per-emit overrides; `priority` is accepted for
     *   parity but does not change the dispatch order within the
     *   snapshot.
     * @returns `true` if at least one listener was invoked (or any
     *   handler returned a thenable, in which case that promise is
     *   still pending), `false` if the emitter was paused, had no
     *   listeners, exceeded re-entrancy depth, or the snapshot was
     *   empty. Throws collected handler errors as `EventHandlerError` /
     *   `AggregateError` when at least one handler threw synchronously.
     */
    public emitSync<K extends EventKey<T>>(
        event: K,
        data: T[K],
        options: { priority?: EventPriority } = {}
    ): boolean {
        ensureRuntime(this.#state);
        return emitSyncInternal(this.#state, this.#host, event, data, options);
    }

    /**
     * Emit a batch of events with settle-all, per-item error isolation.
     *
     * Replaces the previous `Promise.all` fail-fast implementation. Now every
     * input gets a corresponding {@link EventDispatchResult} in the output:
     *
     * - `{ success: true }` — the underlying `emit()` resolved to `true`.
     * - `{ success: false }` — the underlying `emit()` resolved to `false`
     *   (no listeners, re-entrancy cap, etc.).
     * - `{ success: false, error }` — the underlying `emit()` rejected; the
     *   error is captured here instead of rejecting the whole batch, so
     *   sibling emissions are not discarded.
     *
     * The returned promise only rejects if the emitter was disposed before
     * the call (mirroring `emit()`'s precondition).
     */
    public async emitBatch(
        events: ReadonlyArray<EventDispatchItem<T>>
    ): Promise<ReadonlyArray<EventDispatchResult>> {
        if (events.length === 0) return [];

        ensureRuntime(this.#state);

        return emitBatch(this.#host, events);
    }

    public has<K extends EventKey<T>>(event: K): boolean {
        return hasEvent(this.#state, String(event));
    }

    public hasSubscription(subscriptionId: symbol): boolean {
        return hasSubscription(this.#state, subscriptionId);
    }

    public listenerCount<K extends EventKey<T>>(event: K): number {
        return getListenerCount(this.#state, String(event));
    }

    public listenerCountAll(): number {
        return getListenerCountAll(this.#state);
    }

    public eventNames(): EventKey<T>[] {
        return getEventNames<T>(this.#state);
    }

    public getSubscriptions<K extends EventKey<T>>(event: K): ReadonlyArray<Subscription<T[K]>> {
        return getSubscriptions<T[K]>(this.#state, String(event));
    }

    public removeAllListeners<K extends EventKey<T>>(event?: K): this {
        if (event) {
            removeAllListenersForEvent(this.#state, String(event));
        } else {
            removeAllListeners(this.#state);
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

        ensureRuntime(this.#state);

        const subscriptionIds = new Array<symbol>(callbacks.length);

        for (let index = 0; index < callbacks.length; index++) {
            const callback = callbacks[index]!;
            subscriptionIds[index] = registerListener(this.#state, event, callback, {
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
        return getQueuedEvents(this.#state, event ? String(event) : undefined);
    }

    public getPendingCount<K extends EventKey<T>>(event?: K): number {
        return getPendingCount(this.#state, event ? String(event) : undefined);
    }

    public getBufferSize(): number {
        return getBufferSize(this.#state);
    }

    public clearBuffer<K extends EventKey<T>>(event?: K): number {
        return clearBuffer(this.#state, event ? String(event) : undefined);
    }

    public pause(): void {
        pauseEmitter(this.#state);
    }

    public resume(): void {
        resumeEmitter(this.#state, this.#host);
    }

    public isPaused(): boolean {
        return this.#state.isPaused;
    }

    public drain(options: { maxIterations?: number; timeoutMs?: number } = {}): Promise<void> {
        return drainRuntime(this.#state, options);
    }

    public flush<K extends EventKey<T>>(event: K): Promise<void> {
        return flushBufferedEvent(this.#state, this.#host, event);
    }

    public getMetrics<K extends EventKey<T>>(event: K): EventMetrics {
        return getEventMetrics(this.#state, String(event));
    }

    public resetMetrics<K extends EventKey<T>>(event?: K): void {
        resetMetrics(this.#state, event ? String(event) : undefined);
    }

    public [EVENT_EMITTER_TAP](tap: EventTap): UnsubscribeFn {
        return addTap(this.#state, tap);
    }

    public dispose(): void {
        disposeRuntime(this.#state);
    }

    public get isDisposed(): boolean {
        return this.#state.isDisposed;
    }
}
