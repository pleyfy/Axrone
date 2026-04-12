import { EventMap, EventKey, EventCallback, UnsubscribeFn, EventPriority } from './definition';
import { IEventEmitter, EventEmitter } from './event-emitter';
import { SubscriptionOptions } from './interfaces';

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof (value as PromiseLike<T>).then === 'function'
    );
}

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

    toAsync: <T, R>(fn: (data: T) => R): ((data: T) => Promise<R>) => (data: T) =>
        Promise.resolve(fn(data)),

    debounce: <T>(callback: EventCallback<T>, wait: number): EventCallback<T> => {
        const delay = Math.max(0, wait);
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let lastData: T;

        return (data: T) => {
            lastData = data;

            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                timeoutId = undefined;
                void callback(lastData);
            }, delay);
        };
    },

    throttle: <T>(callback: EventCallback<T>, limit: number): EventCallback<T> => {
        const duration = Math.max(0, limit);
        let throttled = false;
        let lastResult: void | Promise<void>;

        return (data: T) => {
            if (!throttled || duration === 0) {
                throttled = duration > 0;
                lastResult = callback(data);

                if (duration > 0) {
                    setTimeout(() => {
                        throttled = false;
                    }, duration);
                }
            }

            return lastResult;
        };
    },

    rateLimit: <T>(
        callback: EventCallback<T>,
        maxCalls: number,
        timeWindow: number
    ): EventCallback<T> => {
        const limit = Math.max(0, Math.trunc(maxCalls));
        const windowSize = Math.max(0, Math.trunc(timeWindow));
        const calls: number[] = [];
        let head = 0;

        return (data: T) => {
            if (limit === 0) {
                return;
            }

            const now = Date.now();

            while (head < calls.length && calls[head] <= now - windowSize) {
                head += 1;
            }

            if (head > 64 && head * 2 >= calls.length) {
                calls.splice(0, head);
                head = 0;
            }

            if (calls.length - head < limit) {
                calls.push(now);
                return callback(data);
            }
        };
    },

    once: <T>(callback: EventCallback<T>): EventCallback<T> => {
        let called = false;
        let result: void | Promise<void>;

        return (data: T) => {
            if (!called) {
                called = true;
                result = callback(data);
            }
            return result;
        };
    },

    compose: <T>(...callbacks: EventCallback<T>[]): EventCallback<T> => {
        if (callbacks.length === 0) {
            return () => undefined;
        }

        if (callbacks.length === 1) {
            return callbacks[0]!;
        }

        return async (data: T) => {
            for (let index = 0; index < callbacks.length; index++) {
                await callbacks[index]!(data);
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
            return callback(transform(data));
        };
    },

    catchErrors: <T>(
        callback: EventCallback<T>,
        errorHandler: (error: unknown, data: T) => void
    ): EventCallback<T> => {
        return (data: T) => {
            try {
                const result = callback(data);

                if (isPromiseLike<void>(result)) {
                    return result.catch((error) => {
                        errorHandler(error, data);
                    });
                }

                return result;
            } catch (error) {
                errorHandler(error, data);
            }
        };
    },
};
