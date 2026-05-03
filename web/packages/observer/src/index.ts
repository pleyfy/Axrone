export type {
    NotificationData,
    NotificationType,
    ObservationPriority,
    ObserverBufferingOptions,
    ObserverCallback,
    ObserverEmission,
    ObserverErrorHandling,
    ObserverFilter,
    ObserverId,
    ObserverOptions,
    ObserverReplayOptions,
    ObserverTransform,
    SubjectConcurrencyOptions,
    SubjectId,
    SubjectMemoryManagementOptions,
    SubjectOptions,
    SubjectReplayOptions,
    SubjectValidationOptions,
    IObservableSubject,
    IObserver,
    UnobserveFn,
} from './definition';

export {
    createNotificationData,
    createObserverId,
    createSubjectId,
    DEFAULT_OBSERVER_OPTIONS,
    DEFAULT_SUBJECT_OPTIONS,
    mergeObserverOptions,
    mergeSubjectOptions,
    normalizeObserverOptions,
    normalizeSubjectOptions,
    OBSERVER_MEMORY_SYMBOLS,
    PRIORITY_VALUES,
    isValidNotificationType,
    isValidObserver,
    isValidPriority,
} from './definition';

export {
    BaseObserverError,
    ConcurrencyLimitError,
    FilterError,
    MaxObserversExceededError,
    ObserverError,
    ObserverExecutionError,
    ObserverNotFoundError,
    SubjectCompletedError,
    SubjectDisposedError,
    SubjectError,
    TransformError,
    ValidationError,
} from './errors';

export type {
    IMemoryManager,
    IObservableFactory,
    IObserverBuffer,
    IObserverChain,
    IObserverConnection,
    IObserverDebouncer,
    IObserverFilterEngine,
    IObserverMetrics,
    IObserverRegistry,
    IObserverScheduler,
    IObserverSubscription,
    IObserverThrottler,
    IObserverValidator,
    IReplayBuffer,
    ISubjectGroup,
    ISubjectLifecycle,
    ISubjectMetrics,
} from './interfaces';

export type { ISubject } from './subject';
export { AsyncSubject, BehaviorSubject, ReplaySubject, Subject } from './subject';
export { MemoryManager } from './memory-manager';
export { ObserverRegistry } from './registry';

export {
    ObservableFactory,
    createAsyncSubject,
    createBehaviorSubject,
    createObserver,
    createRegistry,
    createReplaySubject,
    createSubject,
    observableFactory,
} from './factory';

export {
    ObserverChain,
    ObserverConnection,
    SubjectGroup,
    chain,
    combineLatest,
    connect,
    debounce,
    filter,
    group,
    map,
    merge,
    pipe,
    throttle,
} from './operators';

import type {
    IObservableSubject,
    IObserver,
    ObserverCallback,
    ObserverOptions,
    SubjectOptions,
    UnobserveFn,
} from './definition';
import {
    mergeObserverOptions,
    mergeSubjectOptions,
    normalizeObserverOptions,
    normalizeSubjectOptions,
    DEFAULT_OBSERVER_OPTIONS,
    DEFAULT_SUBJECT_OPTIONS,
} from './definition';
import { createSubject } from './factory';

const attachCleanup = <T>(subject: IObservableSubject<T>, cleanup: () => void): IObservableSubject<T> => {
    const originalDispose = subject.dispose.bind(subject);
    let cleaned = false;

    subject.dispose = () => {
        if (!cleaned) {
            cleaned = true;
            cleanup();
        }

        originalDispose();
    };

    return subject;
};

export function isObservableSubject(value: unknown): value is IObservableSubject {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as IObservableSubject).notify === 'function' &&
        typeof (value as IObservableSubject).addObserver === 'function' &&
        typeof (value as IObservableSubject).dispose === 'function' &&
        'id' in value
    );
}

export function isObserver(value: unknown): value is IObserver {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as IObserver).callback === 'function' &&
        'id' in value &&
        'createdAt' in value
    );
}

export class ObserverUtils {
    static createTypedSubject<T extends Record<PropertyKey, any>>(): {
        [K in keyof T]: IObservableSubject<T[K]>;
    } {
        return new Proxy({} as { [K in keyof T]?: IObservableSubject<T[K]> }, {
            get(target, key: keyof T) {
                if (!(key in target)) {
                    target[key] = createSubject<T[typeof key]>();
                }
                return target[key];
            },
        }) as {
            [K in keyof T]: IObservableSubject<T[K]>;
        };
    }

    static fromPromise<T>(promise: Promise<T>): IObservableSubject<T> {
        const subject = createSubject<T>();

        void promise
            .then(async (value) => {
                await subject.notify(value);
                await subject.complete();
            })
            .catch(async (error) => {
                await subject.error(error instanceof Error ? error : new Error(String(error)));
            });

        return subject;
    }

    static fromArray<T>(array: readonly T[], intervalMs: number = 0): IObservableSubject<T> {
        const subject = createSubject<T>();

        if (intervalMs <= 0) {
            for (const item of array) {
                subject.notifySync(item);
            }
            void subject.complete();
            return subject;
        }

        let index = 0;
        const interval = setInterval(() => {
            if (index >= array.length) {
                clearInterval(interval);
                void subject.complete();
                return;
            }

            void subject.notify(array[index++]).catch(() => undefined);
        }, Math.max(1, Math.floor(intervalMs)));

        return attachCleanup(subject, () => {
            clearInterval(interval);
        });
    }

    static fromEvent<T = Event>(
        target: EventTarget,
        eventName: string,
        options?: AddEventListenerOptions
    ): IObservableSubject<T> {
        const subject = createSubject<T>();
        const handler = (event: Event) => {
            void subject.notify(event as T).catch(() => undefined);
        };

        target.addEventListener(eventName, handler, options);

        return attachCleanup(subject, () => {
            target.removeEventListener(eventName, handler, options);
        });
    }

    static interval(intervalMs: number): IObservableSubject<number> {
        const subject = createSubject<number>();
        let current = 0;
        const interval = setInterval(() => {
            void subject.notify(current++).catch(() => undefined);
        }, Math.max(1, Math.floor(intervalMs)));

        return attachCleanup(subject, () => {
            clearInterval(interval);
        });
    }

    static timer(delayMs: number, intervalMs?: number): IObservableSubject<number> {
        const subject = createSubject<number>();
        let current = 0;
        let interval: ReturnType<typeof setInterval> | undefined;

        const timeout = setTimeout(() => {
            void subject.notify(current++).catch(() => undefined);

            if (intervalMs === undefined) {
                void subject.complete();
                return;
            }

            interval = setInterval(() => {
                void subject.notify(current++).catch(() => undefined);
            }, Math.max(1, Math.floor(intervalMs)));
        }, Math.max(0, Math.floor(delayMs)));

        return attachCleanup(subject, () => {
            clearTimeout(timeout);
            if (interval) {
                clearInterval(interval);
            }
        });
    }

    static defer<T>(factory: () => IObservableSubject<T>): IObservableSubject<T> {
        const subject = createSubject<T>();
        let source: IObservableSubject<T> | undefined;
        let sourceUnsubscribe: UnobserveFn | undefined;

        const ensureSource = (): void => {
            if (source) {
                return;
            }

            source = factory();
            sourceUnsubscribe = source.addObserver((data) => {
                void subject.notify(data).catch(() => undefined);
            });
        };

        const originalAddObserver = subject.addObserver.bind(subject);
        subject.addObserver = ((callback: ObserverCallback<T>, options?: ObserverOptions<T>) => {
            ensureSource();
            return originalAddObserver(callback, options);
        }) as IObservableSubject<T>['addObserver'];

        return attachCleanup(subject, () => {
            sourceUnsubscribe?.();
            source?.dispose();
        });
    }
}

export class ObserverConfig {
    private static instance?: ObserverConfig;

    private config = {
        defaultObserverOptions: normalizeObserverOptions(DEFAULT_OBSERVER_OPTIONS),
        defaultSubjectOptions: normalizeSubjectOptions(DEFAULT_SUBJECT_OPTIONS),
        enableGlobalErrorHandling: true,
        globalErrorHandler: (error: Error, context: unknown) => {
            console.error('Observer Error:', error, context);
        },
        enableMemoryTracking: true,
        enablePerformanceTracking: true,
    };

    static getInstance(): ObserverConfig {
        if (!ObserverConfig.instance) {
            ObserverConfig.instance = new ObserverConfig();
        }

        return ObserverConfig.instance;
    }

    setDefaultObserverOptions(options: Partial<ObserverOptions>): void {
        this.config.defaultObserverOptions = normalizeObserverOptions(
            mergeObserverOptions(this.config.defaultObserverOptions, options)
        );
    }

    setDefaultSubjectOptions(options: Partial<SubjectOptions>): void {
        this.config.defaultSubjectOptions = normalizeSubjectOptions(
            mergeSubjectOptions(this.config.defaultSubjectOptions, options)
        );
    }

    setGlobalErrorHandler(handler: (error: Error, context: unknown) => void): void {
        this.config.globalErrorHandler = handler;
    }

    enableGlobalErrorHandling(enable: boolean): void {
        this.config.enableGlobalErrorHandling = enable;
    }

    enableMemoryTracking(enable: boolean): void {
        this.config.enableMemoryTracking = enable;
    }

    enablePerformanceTracking(enable: boolean): void {
        this.config.enablePerformanceTracking = enable;
    }

    getConfig() {
        return {
            defaultObserverOptions: this.config.defaultObserverOptions,
            defaultSubjectOptions: this.config.defaultSubjectOptions,
            enableGlobalErrorHandling: this.config.enableGlobalErrorHandling,
            globalErrorHandler: this.config.globalErrorHandler,
            enableMemoryTracking: this.config.enableMemoryTracking,
            enablePerformanceTracking: this.config.enablePerformanceTracking,
        };
    }
}

export const observerConfig = ObserverConfig.getInstance();
