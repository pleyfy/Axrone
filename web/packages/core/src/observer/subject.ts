import { PriorityQueue } from '@axrone/utility';
import { EventEmitter, IEventEmitter } from '../event';
import {
    ObserverCallback,
    UnobserveFn,
    ObserverId,
    SubjectId,
    ObserverOptions,
    SubjectOptions,
    NotificationData,
    NotificationType,
    IObservableSubject,
    IObserver,
    DEFAULT_OBSERVER_OPTIONS,
    DEFAULT_SUBJECT_OPTIONS,
    PRIORITY_VALUES,
    OBSERVER_MEMORY_SYMBOLS,
} from './definition';
import {
    SubjectError,
    SubjectCompletedError,
    SubjectDisposedError,
    MaxObserversExceededError,
    ObserverExecutionError,
    ValidationError,
    ConcurrencyLimitError,
    FilterError,
    TransformError,
} from './errors';
import {
    IObserverSubscription,
    IObserverMetrics,
    ISubjectMetrics,
    ISubjectLifecycle,
    IObserverBuffer,
    IReplayBuffer,
} from './interfaces';

interface InternalObserver<T = any> extends IObserver<T> {
    readonly priority: number;
    debounceTimer?: ReturnType<typeof setTimeout>;
    throttleLastExecution?: number;
    buffer?: IObserverBuffer<T>;
    readonly filter?: (data: T, subject: IObservableSubject<T>) => boolean;
    readonly transform?: (data: T, subject: IObservableSubject<T>) => any | Promise<any>;
    executionCount: number;
    lastExecuted?: number;
    isActive: boolean;
    weakRef?: WeakRef<ObserverCallback<T>>;
}

class ObserverBuffer<T = any> implements IObserverBuffer<T> {
    private readonly buffer: NotificationData<T>[] = [];
    private readonly maxSize: number;

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    add(data: NotificationData<T>): void {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift();
        }
        this.buffer.push(data);
    }

    flush(): ReadonlyArray<NotificationData<T>> {
        const items = [...this.buffer];
        this.buffer.length = 0;
        return items;
    }

    clear(): void {
        this.buffer.length = 0;
    }

    size(): number {
        return this.buffer.length;
    }

    isFull(): boolean {
        return this.buffer.length >= this.maxSize;
    }

    getAll(): ReadonlyArray<NotificationData<T>> {
        return [...this.buffer];
    }
}

class ReplayBuffer<T = any> implements IReplayBuffer<T> {
    private readonly buffer: T[] = [];
    public readonly maxSize: number;

    constructor(maxSize: number = 10) {
        this.maxSize = maxSize;
    }

    add(data: T): void {
        if (this.buffer.length >= this.maxSize) {
            this.buffer.shift();
        }
        this.buffer.push(data);
    }

    getAll(): ReadonlyArray<T> {
        return [...this.buffer];
    }

    getLast(count: number): ReadonlyArray<T> {
        const startIndex = Math.max(0, this.buffer.length - count);
        return this.buffer.slice(startIndex);
    }

    clear(): void {
        this.buffer.length = 0;
    }

    size(): number {
        return this.buffer.length;
    }
}

export interface ISubject<T = any> extends IObservableSubject<T> {
    readonly options: Required<SubjectOptions>;
    readonly metrics: ISubjectMetrics;
    readonly lifecycle?: ISubjectLifecycle;
    setLifecycle(lifecycle: ISubjectLifecycle): void;
    getReplayBuffer(): ReadonlyArray<T>;
    clearReplayBuffer(): void;
    getMemoryUsage(): Record<string, number>;
}

export class Subject<T = any> implements ISubject<T> {
    readonly #id: SubjectId = Symbol('Subject');
    readonly #observers = new Map<ObserverId, InternalObserver<T>>();
    readonly #options: Required<SubjectOptions>;
    readonly #eventEmitter: IEventEmitter;
    #replayBuffer?: ReplayBuffer<T>;
    #isCompleted = false;
    #isDisposed = false;
    #lastError?: Error;
    #lifecycle?: ISubjectLifecycle;
    #gcIntervalId?: ReturnType<typeof setInterval>;
    #concurrentNotifications = 0;

    #metrics: {
        notificationCount: number;
        errorCount: number;
        createdAt: number;
        completedAt?: number;
        lastNotificationAt?: number;
        notificationTimings: number[];
    };

    constructor(options: SubjectOptions = {}) {
        this.#options = { ...DEFAULT_SUBJECT_OPTIONS, ...options };
        this.#eventEmitter = new EventEmitter();

        this.#metrics = {
            notificationCount: 0,
            errorCount: 0,
            createdAt: Date.now(),
            notificationTimings: [],
        };

        if (this.#options.replay.enabled) {
            this.#replayBuffer = new ReplayBuffer<T>(this.#options.replay.bufferSize);
        }

        if (
            this.#options.memoryManagement.enabled &&
            this.#options.memoryManagement.gcIntervalMs > 0
        ) {
            this.#startGarbageCollection();
        }
    }

    get id(): SubjectId {
        return this.#id;
    }

    get options(): Required<SubjectOptions> {
        return { ...this.#options };
    }

    get metrics(): ISubjectMetrics {
        const avgTime =
            this.#metrics.notificationTimings.length > 0
                ? this.#metrics.notificationTimings.reduce((a, b) => a + b, 0) /
                  this.#metrics.notificationTimings.length
                : 0;

        return {
            notificationCount: this.#metrics.notificationCount,
            observerCount: this.#observers.size,
            errorCount: this.#metrics.errorCount,
            completedAt: this.#metrics.completedAt,
            createdAt: this.#metrics.createdAt,
            averageNotificationTime: avgTime,
            totalNotificationTime: this.#metrics.notificationTimings.reduce((a, b) => a + b, 0),
            lastNotificationAt: this.#metrics.lastNotificationAt,
            replayBufferSize: this.#replayBuffer?.size() ?? 0,
            isCompleted: this.#isCompleted,
            isErrored: !!this.#lastError,
        };
    }

    get lifecycle(): ISubjectLifecycle | undefined {
        return this.#lifecycle;
    }

    setLifecycle(lifecycle: ISubjectLifecycle): void {
        this.#lifecycle = lifecycle;
    }

    async notify(data: T): Promise<boolean> {
        this.#throwIfDisposed();

        if (this.#isCompleted) {
            throw new SubjectCompletedError(this.#id);
        }

        const startTime = performance.now();

        try {
            if (this.#options.validation.enabled && this.#options.validation.validator) {
                if (!this.#options.validation.validator(data)) {
                    throw new ValidationError('Data validation failed', data, this.#id);
                }
            }

            if (this.#options.concurrency.enabled) {
                if (this.#concurrentNotifications >= this.#options.concurrency.maxConcurrent) {
                    throw new ConcurrencyLimitError(
                        this.#options.concurrency.maxConcurrent,
                        this.#concurrentNotifications,
                        this.#id
                    );
                }
                this.#concurrentNotifications++;
            }

            if (this.#lifecycle?.onBeforeNotify) {
                const shouldContinue = await this.#lifecycle.onBeforeNotify(data, this);
                if (!shouldContinue) {
                    return false;
                }
            }

            if (this.#replayBuffer) {
                this.#replayBuffer.add(data);
            }

            const notificationPromises: Promise<void>[] = [];
            const observerArray = Array.from(this.#observers.values());

            for (const observer of observerArray) {
                if (!observer.isActive) continue;

                const notificationPromise = this.#notifyObserver(observer, data);
                notificationPromises.push(notificationPromise);
            }

            await Promise.allSettled(notificationPromises);

            const endTime = performance.now();
            const executionTime = endTime - startTime;
            this.#metrics.notificationCount++;
            this.#metrics.lastNotificationAt = Date.now();
            this.#metrics.notificationTimings.push(executionTime);

            if (this.#metrics.notificationTimings.length > 100) {
                this.#metrics.notificationTimings = this.#metrics.notificationTimings.slice(-100);
            }

            if (this.#lifecycle?.onAfterNotify) {
                await this.#lifecycle.onAfterNotify(data, this, true);
            }

            return true;
        } catch (error) {
            this.#metrics.errorCount++;

            if (this.#lifecycle?.onAfterNotify) {
                await this.#lifecycle.onAfterNotify(data, this, false);
            }

            if (this.#options.errorPropagation) {
                throw error;
            }

            return false;
        } finally {
            if (this.#options.concurrency.enabled) {
                this.#concurrentNotifications--;
            }
        }
    }

    notifySync(data: T): boolean {
        this.#throwIfDisposed();

        if (this.#isCompleted) {
            throw new SubjectCompletedError(this.#id);
        }

        const startTime = performance.now();

        try {
            if (this.#options.validation.enabled && this.#options.validation.validator) {
                if (!this.#options.validation.validator(data)) {
                    throw new ValidationError('Data validation failed', data, this.#id);
                }
            }

            if (this.#replayBuffer) {
                this.#replayBuffer.add(data);
            }

            const observerArray = Array.from(this.#observers.values());

            for (const observer of observerArray) {
                if (!observer.isActive) continue;
                this.#notifyObserverSync(observer, data);
            }

            const endTime = performance.now();
            const executionTime = endTime - startTime;
            this.#metrics.notificationCount++;
            this.#metrics.lastNotificationAt = Date.now();
            this.#metrics.notificationTimings.push(executionTime);

            return true;
        } catch (error) {
            this.#metrics.errorCount++;

            if (this.#options.errorPropagation) {
                throw error;
            }

            return false;
        }
    }

    async complete(): Promise<void> {
        this.#throwIfDisposed();

        if (this.#isCompleted) {
            return;
        }

        this.#isCompleted = true;
        this.#metrics.completedAt = Date.now();

        const notificationData: NotificationData<undefined> = {
            timestamp: Date.now(),
            data: undefined,
            type: 'complete',
            source: this.#id,
        };

        for (const observer of this.#observers.values()) {
            if (observer.isActive) {
                try {
                    await observer.callback(undefined as any, this);
                } catch (error) {}
            }
        }

        if (this.#lifecycle?.onComplete) {
            await this.#lifecycle.onComplete(this);
        }

        if (this.#options.autoComplete) {
            this.dispose();
        }
    }

    async error(error: Error): Promise<void> {
        this.#throwIfDisposed();

        this.#lastError = error;
        this.#metrics.errorCount++;

        const notificationData: NotificationData<Error> = {
            timestamp: Date.now(),
            data: error,
            type: 'error',
            source: this.#id,
        };

        for (const observer of this.#observers.values()) {
            if (observer.isActive) {
                try {
                    if (observer.options.errorHandling === 'callback' && observer.options.onError) {
                        observer.options.onError(error, notificationData.data, this);
                    } else if (observer.options.errorHandling === 'throw') {
                        await observer.callback(error as any, this);
                    }
                } catch (executionError) {}
            }
        }

        if (this.#lifecycle?.onError) {
            await this.#lifecycle.onError(error, this);
        }
    }

    addObserver(observer: ObserverCallback<T>, options: ObserverOptions = {}): UnobserveFn {
        this.#throwIfDisposed();

        if (this.#isCompleted) {
            throw new SubjectCompletedError(this.#id);
        }

        if (this.#observers.size >= this.#options.maxObservers) {
            throw new MaxObserversExceededError(
                this.#options.maxObservers,
                this.#observers.size,
                this.#id
            );
        }

        const observerId = Symbol('Observer');
        const mergedOptions = { ...DEFAULT_OBSERVER_OPTIONS, ...options };

        const internalObserver: InternalObserver<T> = {
            id: observerId,
            callback: observer,
            options: mergedOptions as Required<ObserverOptions>,
            createdAt: Date.now(),
            executionCount: 0,
            isActive: true,
            priority: PRIORITY_VALUES[mergedOptions.priority],
            filter: options.filter,
            transform: options.transform,
        };

        if (mergedOptions.weakReference) {
            internalObserver.weakRef = new WeakRef(observer);
        }

        if (mergedOptions.buffering.enabled) {
            internalObserver.buffer = new ObserverBuffer<T>(mergedOptions.buffering.maxSize);
        }

        this.#observers.set(observerId, internalObserver);

        if (this.#replayBuffer && mergedOptions.replay.enabled) {
            const replayData = this.#replayBuffer.getLast(mergedOptions.replay.bufferSize);
            for (const data of replayData) {
                setTimeout(() => {
                    if (internalObserver.isActive) {
                        this.#notifyObserver(internalObserver, data).catch(() => {});
                    }
                }, 0);
            }
        }

        if (this.#lifecycle?.onObserverAdded) {
            this.#lifecycle.onObserverAdded(internalObserver as IObserverSubscription, this);
        }

        return () => this.removeObserverById(observerId);
    }

    removeObserver(observer: ObserverCallback<T>): boolean {
        for (const [id, internalObserver] of this.#observers.entries()) {
            if (internalObserver.callback === observer) {
                return this.removeObserverById(id);
            }
        }
        return false;
    }

    removeObserverById(observerId: ObserverId): boolean {
        const observer = this.#observers.get(observerId);
        if (!observer) {
            return false;
        }

        observer.isActive = false;

        if (observer.debounceTimer) {
            clearTimeout(observer.debounceTimer);
        }

        this.#observers.delete(observerId);

        if (this.#lifecycle?.onObserverRemoved) {
            this.#lifecycle.onObserverRemoved(observerId, this);
        }

        return true;
    }

    hasObserver(observer: ObserverCallback<T>): boolean {
        for (const internalObserver of this.#observers.values()) {
            if (internalObserver.callback === observer) {
                return true;
            }
        }
        return false;
    }

    getObserverCount(): number {
        return this.#observers.size;
    }

    isCompleted(): boolean {
        return this.#isCompleted;
    }

    isErrored(): boolean {
        return !!this.#lastError;
    }

    getLastError(): Error | undefined {
        return this.#lastError;
    }

    getReplayBuffer(): ReadonlyArray<T> {
        return this.#replayBuffer?.getAll() ?? [];
    }

    clearReplayBuffer(): void {
        this.#replayBuffer?.clear();
    }

    getMemoryUsage(): Record<string, number> {
        const usage: Record<string, number> = {};

        usage[OBSERVER_MEMORY_SYMBOLS.observerMap.toString()] = this.#observers.size;
        usage[OBSERVER_MEMORY_SYMBOLS.replayBuffers.toString()] = this.#replayBuffer?.size() ?? 0;

        let bufferCount = 0;
        for (const observer of this.#observers.values()) {
            if (observer.buffer) {
                bufferCount += observer.buffer.size();
            }
        }
        usage[OBSERVER_MEMORY_SYMBOLS.observationQueues.toString()] = bufferCount;

        return usage;
    }

    dispose(): void {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;

        for (const observer of this.#observers.values()) {
            observer.isActive = false;
            if (observer.debounceTimer) {
                clearTimeout(observer.debounceTimer);
            }
        }
        this.#observers.clear();

        this.#replayBuffer?.clear();

        if (this.#gcIntervalId) {
            clearInterval(this.#gcIntervalId);
        }

        this.#eventEmitter.dispose();

        if (this.#lifecycle?.onDispose) {
            const result = this.#lifecycle.onDispose(this);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        }
    }

    async #notifyObserver(observer: InternalObserver<T>, data: T): Promise<void> {
        if (!observer.isActive) {
            return;
        }

        try {
            if (observer.weakRef) {
                const callback = observer.weakRef.deref();
                if (!callback) {
                    observer.isActive = false;
                    return;
                }
            }

            if (observer.filter) {
                try {
                    const shouldNotify = observer.filter(data, this);
                    if (!shouldNotify) {
                        return;
                    }
                } catch (error) {
                    throw new FilterError(error as Error, observer.filter);
                }
            }

            let transformedData = data;
            if (observer.transform) {
                try {
                    transformedData = await observer.transform(data, this);
                } catch (error) {
                    throw new TransformError(error as Error, observer.transform, data);
                }
            }

            if (observer.options.debounceMs > 0) {
                if (observer.debounceTimer) {
                    clearTimeout(observer.debounceTimer);
                }

                (observer as any).debounceTimer = setTimeout(() => {
                    this.#executeObserver(observer, transformedData);
                }, observer.options.debounceMs);
                return;
            }

            if (observer.options.throttleMs > 0) {
                const now = Date.now();
                if (
                    observer.throttleLastExecution &&
                    now - observer.throttleLastExecution < observer.options.throttleMs
                ) {
                    return;
                }
                (observer as any).throttleLastExecution = now;
            }

            await this.#executeObserver(observer, transformedData);
        } catch (error) {
            throw new ObserverExecutionError(observer.id, error as Error, {
                timestamp: Date.now(),
                data,
                type: 'update',
                source: this.#id,
            });
        }
    }

    #notifyObserverSync(observer: InternalObserver<T>, data: T): void {
        if (!observer.isActive) {
            return;
        }

        try {
            if (observer.filter) {
                const shouldNotify = observer.filter(data, this);
                if (!shouldNotify) {
                    return;
                }
            }

            let transformedData = data;
            if (observer.transform) {
                const result = observer.transform(data, this);
                if (result instanceof Promise) {
                    throw new Error('Async transforms not supported in sync notification');
                }
                transformedData = result;
            }

            this.#executeObserverSync(observer, transformedData);
        } catch (error) {
            throw new ObserverExecutionError(observer.id, error as Error, {
                timestamp: Date.now(),
                data,
                type: 'update',
                source: this.#id,
            });
        }
    }

    async #executeObserver(observer: InternalObserver<T>, data: T): Promise<void> {
        const startTime = performance.now();

        try {
            await observer.callback(data, this);
            observer.executionCount++;
            observer.lastExecuted = Date.now();

            if (observer.options.once) {
                observer.isActive = false;
                this.#observers.delete(observer.id);
            }
        } catch (error) {
            if (observer.options.errorHandling === 'throw') {
                throw error;
            } else if (observer.options.errorHandling === 'callback' && observer.options.onError) {
                observer.options.onError(error as Error, data, this);
            }
        }
    }

    #executeObserverSync(observer: InternalObserver<T>, data: T): void {
        if (observer.options.debounceMs > 0) {
            if (observer.debounceTimer) {
                clearTimeout(observer.debounceTimer);
            }

            (observer as any).debounceTimer = setTimeout(() => {
                this.#executeObserverSyncImmediate(observer, data);
            }, observer.options.debounceMs);
            return;
        }

        if (observer.options.throttleMs > 0) {
            const now = Date.now();
            if (
                observer.throttleLastExecution &&
                now - observer.throttleLastExecution < observer.options.throttleMs
            ) {
                return;
            }
            observer.throttleLastExecution = now;
        }

        this.#executeObserverSyncImmediate(observer, data);
    }

    #executeObserverSyncImmediate(observer: InternalObserver<T>, data: T): void {
        try {
            const result = observer.callback(data, this);
            if (result instanceof Promise) {
                result.catch(() => {});
            }

            observer.executionCount++;
            observer.lastExecuted = Date.now();

            if (observer.options.once) {
                observer.isActive = false;
                this.#observers.delete(observer.id);
            }
        } catch (error) {
            if (observer.options.errorHandling === 'throw') {
                throw error;
            } else if (observer.options.errorHandling === 'callback' && observer.options.onError) {
                observer.options.onError(error as Error, data, this);
            }
        }
    }

    #startGarbageCollection(): void {
        this.#gcIntervalId = setInterval(() => {
            this.#runGarbageCollection();
        }, this.#options.memoryManagement.gcIntervalMs);
    }

    #runGarbageCollection(): void {
        for (const [id, observer] of this.#observers.entries()) {
            if (!observer.isActive) {
                this.#observers.delete(id);
                continue;
            }

            if (observer.weakRef && !observer.weakRef.deref()) {
                observer.isActive = false;
                this.#observers.delete(id);
            }
        }

        if (this.#metrics.notificationTimings.length > 100) {
            this.#metrics.notificationTimings = this.#metrics.notificationTimings.slice(-50);
        }
    }

    #throwIfDisposed(): void {
        if (this.#isDisposed) {
            throw new SubjectDisposedError(this.#id);
        }
    }
}
