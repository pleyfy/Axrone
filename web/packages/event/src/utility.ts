import { EventMap, EventKey, EventCallback, UnsubscribeFn, EventPriority } from './definition';
import { IEventEmitter, EventEmitter } from './event-emitter';
import { SubscriptionOptions } from './interfaces';

export function createHooks<T extends EventMap>(): {
    on: <K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: SubscriptionOptions
    ) => UnsubscribeFn;
    once: <K extends EventKey<T>>(
        event: K,
        callback: EventCallback<T[K]>,
        options?: Omit<SubscriptionOptions, 'once'>
    ) => UnsubscribeFn;
    off: <K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>) => boolean;
    emit: <K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ) => Promise<boolean>;
    emitSync: <K extends EventKey<T>>(
        event: K,
        data: T[K],
        options?: { priority?: EventPriority }
    ) => boolean;
    useEmitter: () => IEventEmitter<T>;
} {
    const emitter = new EventEmitter<T>();

    return {
        on: <K extends EventKey<T>>(
            event: K,
            callback: EventCallback<T[K]>,
            options?: SubscriptionOptions
        ) => emitter.on(event, callback, options),
        once: <K extends EventKey<T>>(
            event: K,
            callback: EventCallback<T[K]>,
            options?: Omit<SubscriptionOptions, 'once'>
        ) => emitter.once(event, callback, options),
        off: <K extends EventKey<T>>(event: K, callback?: EventCallback<T[K]>) =>
            emitter.off(event, callback),
        emit: <K extends EventKey<T>>(
            event: K,
            data: T[K],
            options?: { priority?: EventPriority }
        ) => emitter.emit(event, data, options),
        emitSync: <K extends EventKey<T>>(
            event: K,
            data: T[K],
            options?: { priority?: EventPriority }
        ) => emitter.emitSync(event, data, options),
        useEmitter: () => emitter,
    };
}

export const EventUtils = {
    createKey: <T>(name: string): EventKey<{ [key: string]: T }> => name as any,

    toAsync: <T, R>(fn: (data: T) => R): ((data: T) => Promise<R>) => {
        return async (data: T) => fn(data);
    },

    debounce: <T>(callback: EventCallback<T>, wait: number): EventCallback<T> => {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let lastData: T;

        return (data: T) => {
            lastData = data;

            if (timeout !== null) {
                clearTimeout(timeout);
            }

            timeout = setTimeout(() => {
                timeout = null;
                callback(lastData);
            }, wait);
        };
    },

    throttle: <T>(callback: EventCallback<T>, limit: number): EventCallback<T> => {
        let inThrottle = false;
        let lastResult: Promise<void> | void;

        return (data: T) => {
            if (!inThrottle) {
                inThrottle = true;
                lastResult = callback(data);

                setTimeout(() => {
                    inThrottle = false;
                }, limit);
            }

            return lastResult instanceof Promise ? lastResult : Promise.resolve(lastResult);
        };
    },

    rateLimit: <T>(
        callback: EventCallback<T>,
        maxCalls: number,
        timeWindow: number
    ): EventCallback<T> => {
        const calls: number[] = [];

        return (data: T) => {
            const now = Date.now();

            while (calls.length > 0 && calls[0] <= now - timeWindow) {
                calls.shift();
            }

            if (calls.length < maxCalls) {
                calls.push(now);
                return callback(data);
            }

            return Promise.resolve();
        };
    },

    once: <T>(callback: EventCallback<T>): EventCallback<T> => {
        let called = false;
        let result: any;

        return (data: T) => {
            if (!called) {
                called = true;
                result = callback(data);
            }
            return result;
        };
    },

    compose: <T>(...callbacks: EventCallback<T>[]): EventCallback<T> => {
        return async (data: T) => {
            for (const callback of callbacks) {
                await callback(data);
            }
        };
    },

    filter: <T>(predicate: (data: T) => boolean, callback: EventCallback<T>): EventCallback<T> => {
        return (data: T) => {
            if (predicate(data)) {
                return callback(data);
            }
        };
    },

    map: <T, U>(transform: (data: T) => U, callback: EventCallback<U>): EventCallback<T> => {
        return (data: T) => {
            const transformed = transform(data);
            return callback(transformed);
        };
    },

    catchErrors: <T>(
        callback: EventCallback<T>,
        errorHandler: (error: unknown, data: T) => void
    ): EventCallback<T> => {
        return async (data: T) => {
            try {
                await callback(data);
            } catch (error) {
                errorHandler(error, data);
            }
        };
    },
};
