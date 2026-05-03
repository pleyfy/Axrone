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

export type ExtractEventData<
    TEventMap extends EventMap,
    TEventKey extends EventKey<TEventMap>,
> = TEventMap[TEventKey];

export type EventNames<T extends EventMap> = EventKey<T>;

export type OptionalData<T> = [T] extends [undefined] ? T | void : T;

export function isValidEventName(eventName: unknown): eventName is string {
    return typeof eventName === 'string' && eventName.length > 0;
}

export function isValidCallback<T = unknown>(callback: unknown): callback is EventCallback<T> {
    return typeof callback === 'function';
}

export function isValidPriority(priority: unknown): priority is EventPriority {
    return priority === 'high' || priority === 'normal' || priority === 'low';
}

export const PRIORITY_VALUES = Object.freeze({
    high: 0,
    normal: 1,
    low: 2,
} satisfies Readonly<Record<EventPriority, number>>);

export const DEFAULT_PRIORITY: EventPriority = 'normal';

export interface EventOptions {
    readonly captureRejections?: boolean;
    readonly maxListeners?: number;
    readonly weakReferences?: boolean;
    readonly immediateDispatch?: boolean;
    readonly concurrencyLimit?: number;
    readonly bufferSize?: number;
    readonly gcIntervalMs?: number;
}

export const DEFAULT_OPTIONS = Object.freeze({
    captureRejections: false,
    maxListeners: 10,
    weakReferences: false,
    immediateDispatch: true,
    concurrencyLimit: Infinity,
    bufferSize: 1000,
    gcIntervalMs: 60000,
} satisfies Required<EventOptions>);

export const MEMORY_USAGE_SYMBOLS = Object.freeze({
    staticSubscriptions: Symbol('staticSubscriptions'),
    subscriptionMaps: Symbol('subscriptionMaps'),
    priorityQueues: Symbol('priorityQueues'),
    eventBuffer: Symbol('eventBuffer'),
} as const);
