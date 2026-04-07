export type EventCallback<T> = (data: T) => void | Promise<void>;
export type UnsubscribeFn = () => boolean;
export type EventKey<T> = string & keyof T;
export type EventMap = Record<string, any>;
export type EventPriority = 'high' | 'normal' | 'low';

export type ExtractEventData<
    TEventMap extends EventMap,
    TEventKey extends keyof TEventMap,
> = TEventMap[TEventKey];

export type EventNames<T extends EventMap> = keyof T & string;

export type OptionalData<T> = T extends undefined ? T | void : T;

export function isValidEventName(eventName: unknown): eventName is string {
    return typeof eventName === 'string' && eventName.length > 0;
}

export function isValidCallback(callback: unknown): callback is EventCallback<any> {
    return typeof callback === 'function';
}

export function isValidPriority(priority: unknown): priority is EventPriority {
    return typeof priority === 'string' && ['high', 'normal', 'low'].includes(priority);
}

export const PRIORITY_VALUES: Record<EventPriority, number> = {
    high: 0,
    normal: 1,
    low: 2,
} as const;

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

export const DEFAULT_OPTIONS: Required<EventOptions> = Object.freeze({
    captureRejections: false,
    maxListeners: 10,
    weakReferences: false,
    immediateDispatch: true,
    concurrencyLimit: Infinity,
    bufferSize: 1000,
    gcIntervalMs: 60000,
} as const);

export const MEMORY_USAGE_SYMBOLS = Object.freeze({
    staticSubscriptions: Symbol('staticSubscriptions'),
    subscriptionMaps: Symbol('subscriptionMaps'),
    priorityQueues: Symbol('priorityQueues'),
    eventBuffer: Symbol('eventBuffer'),
} as const);
