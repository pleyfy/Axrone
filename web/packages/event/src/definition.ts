export type EventCallback<T = unknown> = (data: T) => void | Promise<void>;
export type UnsubscribeFn = () => boolean;
export type EventMap = Record<string, unknown>;
export type EventKey<T extends EventMap> = Extract<keyof T, string>;
export type EventPriority = 'high' | 'normal' | 'low';

export type EventDispatchItem<T extends EventMap> = {
    [K in EventKey<T>]: {
        readonly event: K;
        readonly data: T[K];
        readonly priority?: EventPriority;
    };
}[EventKey<T>];

/**
 * Per-item result returned by {@link IEventPublisher.emitBatch}.
 *
 * - `success: true` — the underlying emit resolved to `true` (had at least one listener).
 * - `success: false`, no `error` — the underlying emit resolved to `false` (no listeners or no-op).
 * - `success: false`, with `error` — the underlying emit rejected; the error is captured here
 *   instead of rejecting the whole batch (settle-all semantics).
 */
export interface EventDispatchResult {
    readonly success: boolean;
    readonly error?: Error;
}

export type ExtractEventData<
    TEventMap extends EventMap,
    TEventKey extends EventKey<TEventMap>,
> = TEventMap[TEventKey];

export type EventNames<T extends EventMap> = EventKey<T>;

export type OptionalData<T> = [T] extends [undefined] ? T | void : T;

export const PRIORITY_VALUES = Object.freeze({
    high: 0,
    normal: 1,
    low: 2,
} satisfies Readonly<Record<EventPriority, number>>);

export const DEFAULT_PRIORITY: EventPriority = 'normal';

/**
 * Configuration options for {@link EventEmitter}.
 */
export interface EventOptions {
    /**
     * If true, async handler rejections are captured and dispatched as
     * an `error` event instead of being reported as unhandled rejections.
     * @default false
     */
    readonly captureRejections?: boolean;
    /**
     * Maximum number of listeners per event before a one-time warning is emitted.
     * Set to `Infinity` to disable the check.
     * @default 10
     */
    readonly maxListeners?: number;
    /**
     * If true, listener callbacks are held via `WeakRef`. The caller MUST
     * retain a strong reference to the callback — otherwise the listener
     * is silently collected at the next GC and the subscription stops firing.
     * This is intended for long-lived named callbacks, not inline lambdas.
     * @default false
     */
    readonly weakReferences?: boolean;
    /**
     * Maximum number of async listener invocations running concurrently.
     * Set to `Infinity` for unbounded concurrency.
     * @default Infinity
     */
    readonly concurrencyLimit?: number;
    /**
     * Maximum number of events buffered per event name while paused.
     * @default 1000
     */
    readonly bufferSize?: number;
    /**
     * Garbage-collection interval in milliseconds for sweeping dead weak refs,
     * stale metrics, and empty buckets. Set to 0 to disable.
     * @default 60000
     */
    readonly gcIntervalMs?: number;
    /**
     * Policy when `bufferSize` is exceeded for a paused event:
     * - `throw`: raise an {@link EventQueueFullError}
     * - `drop-oldest`: evict the oldest buffered event
     * - `drop-newest`: silently drop the new event
     * @default 'drop-oldest'
     */
    readonly bufferOverflow?: 'throw' | 'drop-oldest' | 'drop-newest';
    /**
     * If true, the emitter collects per-event and per-execution timing metrics
     * accessible via {@link EventEmitter.getMetrics}. When false, all metric
     * recording is skipped — no `performance.now()` calls, no Map lookups,
     * no accumulator updates. Strongly recommended for hot paths.
     * @default false
     */
    readonly metrics?: boolean;
}

export const DEFAULT_OPTIONS = Object.freeze({
    captureRejections: false,
    maxListeners: 10,
    weakReferences: false,
    concurrencyLimit: Infinity,
    bufferSize: 1000,
    gcIntervalMs: 60000,
    bufferOverflow: 'throw',
    metrics: true,
} satisfies Required<EventOptions>);
