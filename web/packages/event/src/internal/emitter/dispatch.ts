import { recordEmitMetric, recordExecutionMetric } from './metrics';
import {
    deleteSubscription,
    hasEvent,
    hasListeners,
    resolveCallback,
    snapshotListeners,
} from './subscriptions';
import { enqueueBufferedEvent } from './buffer';
import { emitTapsFor } from './taps';
import { getScheduler } from './runtime';
import { handleCapturedErrorAsync, reportAsyncError } from './failure';
import { MAX_EMIT_DEPTH, PRIORITY_TO_TASK_PRIORITY } from './state';
import type { EmitterState, InternalSubscription } from './state';
import type { EmitOptions, EmitterHost } from './host';
import { performance } from '../performance';
import { isPromiseLike, toError } from '../utils';
import { DEFAULT_PRIORITY } from '../../definition';
import type {
    EventDispatchItem,
    EventDispatchResult,
    EventKey,
    EventMap,
    EventPriority,
} from '../../definition';
import { EventHandlerError } from '../../errors';

export async function emitInternal<T extends EventMap, K extends EventKey<T>>(
    state: EmitterState,
    host: EmitterHost<T>,
    event: K,
    data: T[K],
    options: EmitOptions = {}
): Promise<boolean> {
    const eventName = String(event);
    const priority = options.priority ?? DEFAULT_PRIORITY;
    const startTime = state.options.metrics ? performance.now() : 0;

    const currentDepth = state.emitDepth.get(eventName) ?? 0;
    if (currentDepth >= MAX_EMIT_DEPTH) {
        console.warn(
            `EventEmitter: Re-entrancy depth exceeded for event "${eventName}" (max ${MAX_EMIT_DEPTH}). Dropping emit.`
        );
        return false;
    }

    if (!state.isPaused && !hasListeners(state, eventName) && state.tapListeners.size === 0) {
        return false;
    }

    state.emitDepth.set(eventName, currentDepth + 1);

    if (state.isPaused) {
        emitTapsFor(state, eventName, data, priority, false, 'start');
        try {
            enqueueBufferedEvent(state, eventName, data as T[EventKey<T>], priority);
            recordEmitMetric(state, eventName, 0, 'buffered');
            emitTapsFor(state, eventName, data, priority, false, 'end');
            return true;
        } catch (error) {
            recordEmitMetric(
                state,
                eventName,
                state.options.metrics ? performance.now() - startTime : 0,
                'buffered'
            );
            emitTapsFor(state, eventName, data, priority, false, 'end');
            throw error;
        }
    }

    emitTapsFor(state, eventName, data, priority, false, 'start');

    try {
        const snapshot = snapshotListeners(state, eventName);

        if (snapshot.length === 0) {
            return false;
        }

        if (state.options.concurrencyLimit === Infinity) {
            const errors: EventHandlerError[] = [];
            for (const subscription of snapshot) {
                if (subscription.disposed) {
                    continue;
                }

                const callback = resolveCallback(state, subscription);
                if (!callback) {
                    continue;
                }

                const metricsOn = state.options.metrics;
                const execStartTime = metricsOn ? performance.now() : 0;
                subscription.executionCount += 1;
                subscription.lastExecuted = Date.now();
                let isError = false;
                try {
                    await (callback as (data: unknown) => unknown)(data);
                } catch (error) {
                    isError = true;
                    const wrapped =
                        error instanceof EventHandlerError
                            ? error
                            : new EventHandlerError(eventName, error);
                    errors.push(wrapped);
                }

                recordExecutionMetric(
                    state,
                    eventName,
                    metricsOn ? performance.now() - execStartTime : 0,
                    isError
                );

                if (subscription.once) {
                    deleteSubscription(state, subscription);
                }
            }

            if (errors.length > 0) {
                if (eventName === 'error') {
                    throw errors.length === 1
                        ? errors[0]
                        : new EventHandlerError(
                              eventName,
                              new AggregateError(
                                  errors as Error[],
                                  `${errors.length} handlers failed`
                              )
                          );
                }
                const errorEvent = 'error' as EventKey<T>;
                if (hasEvent(state, errorEvent)) {
                    for (const err of errors) {
                        host.emitSync(errorEvent, err as T[typeof errorEvent]);
                    }
                } else if (errors.length === 1) {
                    throw errors[0];
                } else {
                    throw new EventHandlerError(
                        eventName,
                        new AggregateError(
                            errors as Error[],
                            `${errors.length} handlers failed`
                        )
                    );
                }
            }

            return true;
        }

        await dispatchAsync(state, host, eventName, data as T[EventKey<T>], snapshot);
        return true;
    } catch (error) {
        throw error;
    } finally {
        recordEmitMetric(
            state,
            eventName,
            state.options.metrics ? performance.now() - startTime : 0,
            'async'
        );
        emitTapsFor(state, eventName, data, priority, false, 'end');
        const depth = state.emitDepth.get(eventName) ?? 1;
        if (depth <= 1) {
            state.emitDepth.delete(eventName);
        } else {
            state.emitDepth.set(eventName, depth - 1);
        }
    }
}

export function emitSyncInternal<T extends EventMap, K extends EventKey<T>>(
    state: EmitterState,
    host: EmitterHost<T>,
    event: K,
    data: T[K],
    options: EmitOptions = {}
): boolean {
    const eventName = String(event);
    const priority = options.priority ?? DEFAULT_PRIORITY;
    const startTime = state.options.metrics ? performance.now() : 0;

    const currentDepth = state.emitDepth.get(eventName) ?? 0;
    if (currentDepth >= MAX_EMIT_DEPTH) {
        console.warn(
            `EventEmitter: Re-entrancy depth exceeded for event "${eventName}" (max ${MAX_EMIT_DEPTH}). Dropping emit.`
        );
        return false;
    }

    if (!state.isPaused && !hasListeners(state, eventName) && state.tapListeners.size === 0) {
        return false;
    }

    state.emitDepth.set(eventName, currentDepth + 1);

    if (state.isPaused) {
        try {
            emitTapsFor(state, eventName, data, priority, true, 'start');
            enqueueBufferedEvent(state, eventName, data as T[EventKey<T>], priority);
            recordEmitMetric(state, eventName, 0, 'buffered');
            emitTapsFor(state, eventName, data, priority, true, 'end');
            return true;
        } catch (error) {
            recordEmitMetric(
                state,
                eventName,
                state.options.metrics ? performance.now() - startTime : 0,
                'buffered'
            );
            emitTapsFor(state, eventName, data, priority, true, 'end');
            throw error;
        }
    }

    emitTapsFor(state, eventName, data, priority, true, 'start');

    try {
        const snapshot = snapshotListeners(state, eventName);

        if (snapshot.length === 0) {
            return false;
        }

        let hadAsyncCallbacks = false;
        const errors: Error[] = [];

        for (const subscription of snapshot) {
            const callback = resolveCallback(state, subscription);

            if (!callback) {
                continue;
            }

            const metricsOn = state.options.metrics;
            const execStartTime = metricsOn ? performance.now() : 0;
            subscription.executionCount++;
            subscription.lastExecuted = Date.now();

            try {
                const result = callback(data);

                if (subscription.once) {
                    deleteSubscription(state, subscription);
                }

                if (isPromiseLike<void>(result)) {
                    hadAsyncCallbacks = true;
                    void Promise.resolve(result).then(
                        () => {
                            recordExecutionMetric(
                                state,
                                eventName,
                                metricsOn ? performance.now() - execStartTime : 0,
                                false
                            );
                        },
                        (error) => {
                            const wrapped = new EventHandlerError(eventName, error);
                            recordExecutionMetric(
                                state,
                                eventName,
                                metricsOn ? performance.now() - execStartTime : 0,
                                true
                            );
                            if (
                                state.options.captureRejections &&
                                eventName !== 'error' &&
                                hasEvent(state, 'error' as EventKey<T>)
                            ) {
                                try {
                                    host.emitSync('error' as EventKey<T>, wrapped as T[EventKey<T>]);
                                } catch (emitError) {
                                    reportAsyncError(emitError);
                                }
                            } else {
                                reportAsyncError(wrapped);
                            }
                        }
                    );
                } else {
                    recordExecutionMetric(
                        state,
                        eventName,
                        metricsOn ? performance.now() - execStartTime : 0,
                        false
                    );
                }
            } catch (error) {
                if (subscription.once) {
                    deleteSubscription(state, subscription);
                }

                recordExecutionMetric(
                    state,
                    eventName,
                    metricsOn ? performance.now() - execStartTime : 0,
                    true
                );

                const wrapped = new EventHandlerError(eventName, error);
                errors.push(wrapped);
            }
        }

        if (errors.length > 0) {
            if (eventName === 'error') {
                throw errors.length === 1
                    ? errors[0]
                    : new EventHandlerError(
                          eventName,
                          new AggregateError(errors, `${errors.length} handlers failed`)
                      );
            }
            const errorEvent = 'error' as EventKey<T>;

            if (hasEvent(state, errorEvent)) {
                for (const err of errors) {
                    host.emitSync(errorEvent, err as T[typeof errorEvent]);
                }
            } else if (errors.length === 1) {
                throw errors[0];
            } else {
                throw new EventHandlerError(
                    eventName,
                    new AggregateError(errors, `${errors.length} handlers failed`)
                );
            }
        }

        if (hadAsyncCallbacks) {
            console.warn(
                `EventEmitter: Event "${eventName}" was emitted synchronously but had async listeners. Consider using emit() instead.`
            );
        }

        return true;
    } catch (error) {
        throw error;
    } finally {
        recordEmitMetric(
            state,
            eventName,
            state.options.metrics ? performance.now() - startTime : 0,
            'sync'
        );
        emitTapsFor(state, eventName, data, priority, true, 'end');
        const depth = state.emitDepth.get(eventName) ?? 1;
        if (depth <= 1) {
            state.emitDepth.delete(eventName);
        } else {
            state.emitDepth.set(eventName, depth - 1);
        }
    }
}

export async function dispatchAsync<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>,
    event: EventKey<T> | string,
    data: T[EventKey<T>],
    snapshot: ReadonlyArray<InternalSubscription>
): Promise<void> {
    const eventName = String(event);

    if (snapshot.length === 1) {
        let scheduled = scheduleDispatch(state, eventName, snapshot[0]!, data);

        if (state.options.captureRejections) {
            scheduled = scheduled.catch((error) => handleCapturedErrorAsync(host, eventName, error));
        }

        await scheduled;
        return;
    }

    const scheduled = new Array<Promise<void>>(snapshot.length);

    for (let index = 0; index < snapshot.length; index++) {
        let task = scheduleDispatch(state, eventName, snapshot[index]!, data);

        if (state.options.captureRejections) {
            task = task.catch((error) => handleCapturedErrorAsync(host, eventName, error));
        }

        scheduled[index] = task;
    }

    await Promise.all(scheduled);
}

export function scheduleDispatch<T extends EventMap>(
    state: EmitterState,
    event: EventKey<T> | string,
    subscription: InternalSubscription,
    data: T[EventKey<T>]
): Promise<void> {
    const eventName = String(event);

    return getScheduler(state).schedule(
        async () => {
            if (subscription.disposed) {
                return;
            }

            const callback = resolveCallback(state, subscription);

            if (!callback) {
                return;
            }

            const startTime = state.options.metrics ? performance.now() : 0;
            subscription.executionCount += 1;
            subscription.lastExecuted = Date.now();

            try {
                await callback(data as never);
                recordExecutionMetric(
                    state,
                    eventName,
                    state.options.metrics ? performance.now() - startTime : 0,
                    false
                );
            } catch (error) {
                recordExecutionMetric(
                    state,
                    eventName,
                    state.options.metrics ? performance.now() - startTime : 0,
                    true
                );
                if (subscription.once) {
                    deleteSubscription(state, subscription);
                }
                throw new EventHandlerError(eventName, error);
            }

            if (subscription.once) {
                deleteSubscription(state, subscription);
            }
        },
        PRIORITY_TO_TASK_PRIORITY[subscription.priority]
    );
}

export async function dispatchBatchItem<T extends EventMap, K extends EventKey<T>>(
    host: EmitterHost<T>,
    event: K,
    data: T[K],
    priority: EventPriority | undefined
): Promise<EventDispatchResult> {
    try {
        const dispatched = await host.emit(event, data, priority ? { priority } : undefined);
        return { success: dispatched };
    } catch (error) {
        return { success: false, error: toError(error) };
    }
}

export function emitBatch<T extends EventMap>(
    host: EmitterHost<T>,
    events: ReadonlyArray<EventDispatchItem<T>>
): Promise<ReadonlyArray<EventDispatchResult>> {
    const tasks = new Array<Promise<EventDispatchResult>>(events.length);
    for (let index = 0; index < events.length; index++) {
        const { event, data, priority } = events[index]!;
        tasks[index] = dispatchBatchItem(host, event, data, priority);
    }

    return Promise.all(tasks);
}
