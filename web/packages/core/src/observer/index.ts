// Core types and interfaces
export type {
    ObserverCallback,
    UnobserveFn,
    ObserverId,
    SubjectId,
    ObservationPriority,
    NotificationData,
    NotificationType,
    ObserverFilter,
    ObserverTransform,
    ObserverOptions,
    SubjectOptions,
    IObservableSubject,
    IObserver,
} from './definition';

export {
    DEFAULT_OBSERVER_OPTIONS,
    DEFAULT_SUBJECT_OPTIONS,
    PRIORITY_VALUES,
    OBSERVER_MEMORY_SYMBOLS,
    isValidObserver,
    isValidPriority,
    isValidNotificationType,
} from './definition';

// Error classes
export {
    BaseObserverError,
    ObserverError,
    SubjectError,
    ObserverNotFoundError,
    SubjectCompletedError,
    SubjectDisposedError,
    MaxObserversExceededError,
    ObserverExecutionError,
    ValidationError,
    ConcurrencyLimitError,
    FilterError,
    TransformError,
} from './errors';

// Interfaces
export type {
    IObserverSubscription,
    IObserverRegistry,
    ISubjectLifecycle,
    IObserverMetrics,
    ISubjectMetrics,
    IObserverBuffer,
    IReplayBuffer,
    IObserverScheduler,
    IObserverDebouncer,
    IObserverThrottler,
    IObserverFilterEngine,
    IMemoryManager,
    IObserverValidator,
    IObservableFactory,
    IObserverChain,
    ISubjectGroup,
    IObserverConnection,
} from './interfaces';

export { Subject, ISubject } from './subject';
export { ObserverRegistry } from './registry';
export { MemoryManager } from './memory-manager';

export {
    ObservableFactory,
    BehaviorSubject,
    ReplaySubject,
    AsyncSubject,
    observableFactory,
    createSubject,
    createBehaviorSubject,
    createReplaySubject,
    createAsyncSubject,
    createObserver,
    createRegistry,
} from './factory';

export {
    ObserverChain,
    SubjectGroup,
    ObserverConnection,
    chain,
    group,
    connect,
    pipe,
    merge,
    combineLatest,
    filter,
    map,
    debounce,
    throttle,
} from './operators';

import type {
    IObservableSubject,
    IObserver,
    ObserverCallback,
    UnobserveFn,
    ObserverOptions,
    SubjectOptions,
} from './definition';
import { createSubject } from './factory';
import { DEFAULT_OBSERVER_OPTIONS, DEFAULT_SUBJECT_OPTIONS } from './definition';

export function isObservableSubject(value: unknown): value is IObservableSubject {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as any).notify === 'function' &&
        typeof (value as any).addObserver === 'function' &&
        typeof (value as any).dispose === 'function' &&
        'id' in value
    );
}

export function isObserver(value: unknown): value is IObserver {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as any).callback === 'function' &&
        'id' in value &&
        'createdAt' in value
    );
}

export class ObserverUtils {
    static createTypedSubject<T extends Record<string, any>>(): {
        [K in keyof T]: IObservableSubject<T[K]>;
    } {
        return new Proxy({} as any, {
            get(target, prop) {
                if (typeof prop === 'string' && !(prop in target)) {
                    target[prop] = createSubject();
                }
                return target[prop];
            },
        });
    }

    static fromPromise<T>(promise: Promise<T>): IObservableSubject<T> {
        const subject = createSubject<T>();
        promise
            .then((value) => {
                subject.notify(value);
                subject.complete();
            })
            .catch((error) => {
                subject.error(error);
            });
        return subject;
    }

    static fromArray<T>(array: T[], intervalMs: number = 0): IObservableSubject<T> {
        const subject = createSubject<T>();

        if (intervalMs === 0) {
            array.forEach((item) => subject.notifySync(item));
            subject.complete();
        } else {
            let index = 0;
            const interval = setInterval(() => {
                if (index < array.length) {
                    subject.notify(array[index++]);
                } else {
                    clearInterval(interval);
                    subject.complete();
                }
            }, intervalMs);
        }

        return subject;
    }

    static fromEvent<T = Event>(
        target: EventTarget,
        eventName: string,
        options?: AddEventListenerOptions
    ): IObservableSubject<T> {
        const subject = createSubject<T>();

        const handler = (event: Event) => {
            subject.notify(event as T);
        };

        target.addEventListener(eventName, handler, options);

        const originalDispose = subject.dispose.bind(subject);
        subject.dispose = () => {
            target.removeEventListener(eventName, handler, options);
            originalDispose();
        };

        return subject;
    }

    static interval(intervalMs: number): IObservableSubject<number> {
        const subject = createSubject<number>();
        let count = 0;

        const intervalId = setInterval(() => {
            subject.notify(count++);
        }, intervalMs);

        const originalDispose = subject.dispose.bind(subject);
        subject.dispose = () => {
            clearInterval(intervalId);
            originalDispose();
        };

        return subject;
    }

    static timer(delayMs: number, intervalMs?: number): IObservableSubject<number> {
        const subject = createSubject<number>();
        let count = 0;

        const timeoutId = setTimeout(() => {
            subject.notify(count++);

            if (intervalMs !== undefined) {
                const intervalId = setInterval(() => {
                    subject.notify(count++);
                }, intervalMs);

                const originalDispose = subject.dispose.bind(subject);
                subject.dispose = () => {
                    clearInterval(intervalId);
                    originalDispose();
                };
            } else {
                subject.complete();
            }
        }, delayMs);

        const originalDispose = subject.dispose.bind(subject);
        subject.dispose = () => {
            clearTimeout(timeoutId);
            originalDispose();
        };

        return subject;
    }

    static defer<T>(factory: () => IObservableSubject<T>): IObservableSubject<T> {
        const subject = createSubject<T>();
        let source: IObservableSubject<T> | undefined;
        let unsubscribe: UnobserveFn | undefined;

        const originalAddObserver = subject.addObserver.bind(subject);
        subject.addObserver = (callback, options) => {
            if (!source) {
                source = factory();
                unsubscribe = source.addObserver((data) => {
                    subject.notify(data);
                });
            }
            return originalAddObserver(callback, options);
        };

        const originalDispose = subject.dispose.bind(subject);
        subject.dispose = () => {
            if (unsubscribe) {
                unsubscribe();
            }
            if (source) {
                source.dispose();
            }
            originalDispose();
        };

        return subject;
    }
}

export class ObserverConfig {
    private static instance: ObserverConfig;
    private config = {
        defaultObserverOptions: DEFAULT_OBSERVER_OPTIONS,
        defaultSubjectOptions: DEFAULT_SUBJECT_OPTIONS,
        enableGlobalErrorHandling: true,
        globalErrorHandler: (error: Error, context: any) => {
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
        this.config.defaultObserverOptions = { ...this.config.defaultObserverOptions, ...options };
    }

    setDefaultSubjectOptions(options: Partial<SubjectOptions>): void {
        this.config.defaultSubjectOptions = { ...this.config.defaultSubjectOptions, ...options };
    }

    setGlobalErrorHandler(handler: (error: Error, context: any) => void): void {
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
        return { ...this.config };
    }
}

export const observerConfig = ObserverConfig.getInstance();
