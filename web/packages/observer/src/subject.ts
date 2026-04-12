import {
    createNotificationData,
    createObserverId,
    createSubjectId,
    normalizeObserverOptions,
    normalizeSubjectOptions,
    NotificationData,
    ObserverCallback,
    ObserverEmission,
    ObserverId,
    ObserverOptions,
    PRIORITY_VALUES,
    SubjectId,
    SubjectOptions,
    IObservableSubject,
    OBSERVER_MEMORY_SYMBOLS,
    NormalizedObserverOptions,
    NormalizedSubjectOptions,
    UnobserveFn,
} from './definition';
import {
    ConcurrencyLimitError,
    FilterError,
    MaxObserversExceededError,
    ObserverExecutionError,
    SubjectCompletedError,
    SubjectDisposedError,
    TransformError,
    ValidationError,
} from './errors';
import {
    IObserverBuffer,
    IObserverSubscription,
    IReplayBuffer,
    ISubjectLifecycle,
    ISubjectMetrics,
} from './interfaces';

type TimeoutHandle = ReturnType<typeof setTimeout>;

const performanceNow = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

const scheduleTask =
    typeof queueMicrotask === 'function'
        ? queueMicrotask.bind(globalThis)
        : (callback: () => void): void => {
              void Promise.resolve().then(callback);
          };

const isPromiseLike = <T = unknown>(value: unknown): value is PromiseLike<T> =>
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<T>).then === 'function';

const normalizeError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));

class RingBuffer<T> {
    readonly maxSize: number;
    readonly #items: Array<T | undefined>;
    #start = 0;
    #size = 0;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
        this.#items = new Array<T | undefined>(maxSize);
    }

    add(value: T): void {
        if (this.maxSize === 0) {
            return;
        }

        if (this.#size < this.maxSize) {
            this.#items[(this.#start + this.#size) % this.maxSize] = value;
            this.#size++;
            return;
        }

        this.#items[this.#start] = value;
        this.#start = (this.#start + 1) % this.maxSize;
    }

    toArray(): T[] {
        const result = new Array<T>(this.#size);

        for (let index = 0; index < this.#size; index++) {
            result[index] = this.#items[(this.#start + index) % this.maxSize] as T;
        }

        return result;
    }

    last(count: number): T[] {
        if (count <= 0 || this.#size === 0) {
            return [];
        }

        const size = count >= this.#size ? this.#size : count;
        const result = new Array<T>(size);
        const offset = this.#size - size;

        for (let index = 0; index < size; index++) {
            result[index] = this.#items[
                (this.#start + offset + index) % this.maxSize
            ] as T;
        }

        return result;
    }

    takeAll(): T[] {
        const snapshot = this.toArray();
        this.clear();
        return snapshot;
    }

    clear(): void {
        for (let index = 0; index < this.#size; index++) {
            this.#items[(this.#start + index) % this.maxSize] = undefined;
        }

        this.#start = 0;
        this.#size = 0;
    }

    size(): number {
        return this.#size;
    }

    isFull(): boolean {
        return this.#size >= this.maxSize;
    }
}

class NotificationBuffer<T = any> implements IObserverBuffer<T> {
    readonly #buffer: RingBuffer<NotificationData<T>>;

    constructor(maxSize: number) {
        this.#buffer = new RingBuffer(maxSize);
    }

    add(data: NotificationData<T>): void {
        this.#buffer.add(data);
    }

    flush(): ReadonlyArray<NotificationData<T>> {
        return this.#buffer.takeAll();
    }

    clear(): void {
        this.#buffer.clear();
    }

    size(): number {
        return this.#buffer.size();
    }

    isFull(): boolean {
        return this.#buffer.isFull();
    }

    getAll(): ReadonlyArray<NotificationData<T>> {
        return this.#buffer.toArray();
    }
}

class ReplayBuffer<T = any> implements IReplayBuffer<T> {
    readonly #buffer: RingBuffer<T>;
    readonly maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
        this.#buffer = new RingBuffer<T>(maxSize);
    }

    add(data: T): void {
        this.#buffer.add(data);
    }

    getAll(): ReadonlyArray<T> {
        return this.#buffer.toArray();
    }

    getLast(count: number): ReadonlyArray<T> {
        return this.#buffer.last(count);
    }

    clear(): void {
        this.#buffer.clear();
    }

    size(): number {
        return this.#buffer.size();
    }
}

class ObserverRecord<TInput = any, TDispatch = TInput> implements IObserverSubscription<TDispatch> {
    readonly id: ObserverId;
    readonly createdAt: number;
    readonly subject: IObservableSubject<TInput>;
    readonly priority: number;
    readonly isDebounced: boolean;
    readonly isThrottled: boolean;
    readonly hasFilter: boolean;
    readonly hasTransform: boolean;
    readonly bufferSize: number;
    readonly replayEnabled: boolean;
    readonly options: NormalizedObserverOptions<TInput, any>;
    executionCount = 0;
    lastExecuted?: number;
    isActive = true;
    debounceTimer?: TimeoutHandle;
    bufferTimer?: TimeoutHandle;
    buffer?: RingBuffer<TDispatch>;
    notificationBuffer?: NotificationBuffer<TDispatch>;
    throttleLastExecution = 0;
    readonly #strongCallback?: ObserverCallback<TDispatch>;
    readonly #weakCallback?: WeakRef<ObserverCallback<TDispatch>>;

    constructor(
        subject: IObservableSubject<TInput>,
        callback: ObserverCallback<TDispatch>,
        options: NormalizedObserverOptions<TInput, any>,
        useWeakReference: boolean
    ) {
        this.id = createObserverId();
        this.createdAt = Date.now();
        this.subject = subject;
        this.priority = PRIORITY_VALUES[options.priority];
        this.isDebounced = options.debounceMs > 0;
        this.isThrottled = options.throttleMs > 0;
        this.hasFilter = typeof options.filter === 'function';
        this.hasTransform = typeof options.transform === 'function';
        this.bufferSize = options.buffering.enabled ? options.buffering.maxSize : 0;
        this.replayEnabled = options.replay.enabled;
        this.options = options;

        if (useWeakReference && typeof WeakRef === 'function') {
            this.#weakCallback = new WeakRef(callback);
        } else {
            this.#strongCallback = callback;
        }

        if (options.buffering.enabled) {
            this.buffer = new RingBuffer<TDispatch>(options.buffering.maxSize);
            this.notificationBuffer = new NotificationBuffer<TDispatch>(options.buffering.maxSize);
        }
    }

    get callback(): ObserverCallback<TDispatch> {
        return (this.#strongCallback ?? this.#weakCallback?.deref() ?? (() => undefined)) as ObserverCallback<TDispatch>;
    }

    resolveCallback(): ObserverCallback<TDispatch> | undefined {
        return this.#strongCallback ?? this.#weakCallback?.deref();
    }
}

export interface ISubject<T = any> extends IObservableSubject<T> {
    readonly options: NormalizedSubjectOptions<T>;
    readonly metrics: ISubjectMetrics;
    readonly lifecycle?: ISubjectLifecycle;
    setLifecycle(lifecycle: ISubjectLifecycle): void;
    getReplayBuffer(): ReadonlyArray<T>;
    clearReplayBuffer(): void;
    getMemoryUsage(): Record<string, number>;
}

export class Subject<T = any> implements ISubject<T> {
    readonly id: SubjectId = createSubjectId();
    protected readonly _options: NormalizedSubjectOptions<T>;
    protected readonly _observers = new Map<ObserverId, ObserverRecord<T, any>>();
    protected readonly _buckets: [ObserverRecord<T, any>[], ObserverRecord<T, any>[], ObserverRecord<T, any>[]] =
        [[], [], []];
    protected _replayBuffer?: ReplayBuffer<T>;
    protected _isCompleted = false;
    protected _isDisposed = false;
    protected _lastError?: Error;
    protected _lifecycle?: ISubjectLifecycle;
    protected _gcIntervalId?: ReturnType<typeof setInterval>;
    protected _concurrentNotifications = 0;
    protected _notificationCount = 0;
    protected _errorCount = 0;
    protected readonly _createdAt = Date.now();
    protected _completedAt?: number;
    protected _lastNotificationAt?: number;
    protected _totalNotificationTime = 0;
    protected _notificationDepth = 0;
    protected _needsCompaction = false;

    constructor(options: SubjectOptions<T> = {}) {
        this._options = normalizeSubjectOptions(options);

        if (this._options.replay.enabled) {
            this._replayBuffer = new ReplayBuffer<T>(this._options.replay.bufferSize);
        }

        if (this._options.memoryManagement.enabled && this._options.memoryManagement.gcIntervalMs > 0) {
            this._gcIntervalId = setInterval(() => {
                this._runGarbageCollection();
            }, this._options.memoryManagement.gcIntervalMs);
        }
    }

    get options(): NormalizedSubjectOptions<T> {
        return this._options;
    }

    get metrics(): ISubjectMetrics {
        return {
            notificationCount: this._notificationCount,
            observerCount: this._observers.size,
            errorCount: this._errorCount,
            completedAt: this._completedAt,
            createdAt: this._createdAt,
            averageNotificationTime:
                this._notificationCount === 0
                    ? 0
                    : this._totalNotificationTime / this._notificationCount,
            totalNotificationTime: this._totalNotificationTime,
            lastNotificationAt: this._lastNotificationAt,
            replayBufferSize: this._replayBuffer?.size() ?? 0,
            isCompleted: this._isCompleted,
            isErrored: this._lastError !== undefined,
        };
    }

    get lifecycle(): ISubjectLifecycle | undefined {
        return this._lifecycle;
    }

    setLifecycle(lifecycle: ISubjectLifecycle): void {
        this._lifecycle = lifecycle;
    }

    async notify(data: T): Promise<boolean> {
        this._assertNotDisposed();

        if (this._isCompleted) {
            throw new SubjectCompletedError(this.id);
        }

        const startedAt = performanceNow();

        try {
            this._validateData(data);
            this._enterConcurrencyWindow();

            if (this._lifecycle?.onBeforeNotify) {
                const shouldContinue = await this._lifecycle.onBeforeNotify(data, this);
                if (!shouldContinue) {
                    return false;
                }
            }

            this._replayBuffer?.add(data);

            let pending: Promise<void>[] | undefined;

            this._notificationDepth++;

            try {
                this._forEachObserver((observer) => {
                    const task = this._notifyObserverAsync(observer, data);
                    if (task) {
                        (pending ??= []).push(task);
                    }
                });
            } finally {
                this._notificationDepth--;
                this._compactObserversIfNeeded();
            }

            if (pending) {
                await Promise.allSettled(pending);
            }

            this._notificationCount++;
            this._lastNotificationAt = Date.now();
            this._totalNotificationTime += performanceNow() - startedAt;

            if (this._lifecycle?.onAfterNotify) {
                await this._lifecycle.onAfterNotify(data, this, true);
            }

            return true;
        } catch (error) {
            this._errorCount++;

            if (this._lifecycle?.onAfterNotify) {
                await this._lifecycle.onAfterNotify(data, this, false);
            }

            if (this._options.errorPropagation) {
                throw error;
            }

            return false;
        } finally {
            this._leaveConcurrencyWindow();
        }
    }

    notifySync(data: T): boolean {
        this._assertNotDisposed();

        if (this._isCompleted) {
            throw new SubjectCompletedError(this.id);
        }

        const startedAt = performanceNow();

        try {
            this._validateData(data);
            this._replayBuffer?.add(data);

            this._notificationDepth++;

            try {
                this._forEachObserver((observer) => {
                    this._notifyObserverSync(observer, data);
                });
            } finally {
                this._notificationDepth--;
                this._compactObserversIfNeeded();
            }

            this._notificationCount++;
            this._lastNotificationAt = Date.now();
            this._totalNotificationTime += performanceNow() - startedAt;

            return true;
        } catch (error) {
            this._errorCount++;

            if (this._options.errorPropagation) {
                throw error;
            }

            return false;
        }
    }

    async complete(): Promise<void> {
        this._assertNotDisposed();

        if (this._isCompleted) {
            return;
        }

        this._isCompleted = true;
        this._completedAt = Date.now();

        this._notificationDepth++;

        try {
            this._forEachObserver((observer) => {
                const callback = this._resolveObserverCallback(observer);
                if (!callback) {
                    return;
                }

                try {
                    const result = callback(undefined as never, this);
                    if (isPromiseLike(result)) {
                        void Promise.resolve(result).catch(() => undefined);
                    }
                } catch {}
            });
        } finally {
            this._notificationDepth--;
            this._compactObserversIfNeeded();
        }

        if (this._lifecycle?.onComplete) {
            await this._lifecycle.onComplete(this);
        }

        if (this._options.autoComplete) {
            this.dispose();
        }
    }

    async error(error: Error): Promise<void> {
        this._assertNotDisposed();

        this._lastError = error;
        this._errorCount++;

        this._notificationDepth++;

        try {
            this._forEachObserver((observer) => {
                const callback = this._resolveObserverCallback(observer);
                if (!callback) {
                    return;
                }

                try {
                    if (observer.options.errorHandling === 'callback' && observer.options.onError) {
                        observer.options.onError(error, error, this);
                        return;
                    }

                    if (observer.options.errorHandling === 'throw') {
                        const result = callback(error as never, this);
                        if (isPromiseLike(result)) {
                            void Promise.resolve(result).catch(() => undefined);
                        }
                    }
                } catch {}
            });
        } finally {
            this._notificationDepth--;
            this._compactObserversIfNeeded();
        }

        if (this._lifecycle?.onError) {
            await this._lifecycle.onError(error, this);
        }
    }

    addObserver<TOptions extends ObserverOptions<T, any> | undefined = undefined>(
        observer: ObserverCallback<ObserverEmission<T, TOptions>>,
        options?: TOptions
    ): UnobserveFn {
        const record = this._addObserverRecord(
            observer as ObserverCallback<any>,
            options as ObserverOptions<T, any> | undefined
        );
        return this._createUnobserve(record.id);
    }

    removeObserver(observer: ObserverCallback<any>): boolean {
        for (const record of this._observers.values()) {
            const callback = record.resolveCallback();
            if (callback === observer) {
                return this.removeObserverById(record.id);
            }
        }

        return false;
    }

    removeObserverById(observerId: ObserverId): boolean {
        const record = this._observers.get(observerId);
        if (!record) {
            return false;
        }

        this._deactivateObserver(record, true);
        return true;
    }

    hasObserver(observer: ObserverCallback<any>): boolean {
        for (const record of this._observers.values()) {
            if (record.resolveCallback() === observer) {
                return true;
            }
        }

        return false;
    }

    getObserverCount(): number {
        return this._observers.size;
    }

    isCompleted(): boolean {
        return this._isCompleted;
    }

    isErrored(): boolean {
        return this._lastError !== undefined;
    }

    getLastError(): Error | undefined {
        return this._lastError;
    }

    getReplayBuffer(): ReadonlyArray<T> {
        return this._replayBuffer?.getAll() ?? [];
    }

    clearReplayBuffer(): void {
        this._replayBuffer?.clear();
    }

    getMemoryUsage(): Record<string, number> {
        let bufferedNotifications = 0;

        for (const observer of this._observers.values()) {
            bufferedNotifications += observer.buffer?.size() ?? 0;
        }

        return {
            [OBSERVER_MEMORY_SYMBOLS.observerMap.toString()]: this._observers.size,
            [OBSERVER_MEMORY_SYMBOLS.replayBuffers.toString()]: this._replayBuffer?.size() ?? 0,
            [OBSERVER_MEMORY_SYMBOLS.observationQueues.toString()]: bufferedNotifications,
        };
    }

    dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;

        if (this._gcIntervalId) {
            clearInterval(this._gcIntervalId);
            this._gcIntervalId = undefined;
        }

        for (const observer of this._observers.values()) {
            this._cleanupObserver(observer);
            observer.isActive = false;
        }

        this._observers.clear();
        this._buckets[0].length = 0;
        this._buckets[1].length = 0;
        this._buckets[2].length = 0;
        this._replayBuffer?.clear();

        if (this._lifecycle?.onDispose) {
            const result = this._lifecycle.onDispose(this);
            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch(() => undefined);
            }
        }
    }

    protected _addObserverRecord(
        observer: ObserverCallback<any>,
        options?: ObserverOptions<T, any>
    ): ObserverRecord<T, any> {
        this._assertNotDisposed();

        if (this._isCompleted) {
            throw new SubjectCompletedError(this.id);
        }

        if (this._observers.size >= this._options.maxObservers) {
            throw new MaxObserversExceededError(
                this._options.maxObservers,
                this._observers.size,
                this.id
            );
        }

        const normalizedOptions = normalizeObserverOptions<T, any>(options);
        const useWeakReference =
            typeof WeakRef === 'function' &&
            (normalizedOptions.weakReference || this._options.memoryManagement.weakReferences);
        const record = new ObserverRecord<T, any>(
            this,
            observer,
            normalizedOptions,
            useWeakReference
        );

        this._observers.set(record.id, record);
        this._buckets[record.priority].push(record);

        if (this._lifecycle?.onObserverAdded) {
            this._lifecycle.onObserverAdded(record, this);
        }

        if (record.replayEnabled && this._replayBuffer) {
            this._scheduleObserverValues(
                record,
                this._replayBuffer.getLast(record.options.replay.bufferSize)
            );
        }

        return record;
    }

    protected _createUnobserve(observerId: ObserverId): UnobserveFn {
        return () => this.removeObserverById(observerId);
    }

    protected _scheduleObserverValues(observer: ObserverRecord<T, any>, values: ReadonlyArray<T>): void {
        if (values.length === 0) {
            return;
        }

        for (const value of values) {
            scheduleTask(() => {
                if (!observer.isActive || this._isDisposed) {
                    return;
                }

                const task = this._notifyObserverAsync(observer, value);
                if (task) {
                    void task;
                }
            });
        }
    }

    protected _assertNotDisposed(): void {
        if (this._isDisposed) {
            throw new SubjectDisposedError(this.id);
        }
    }

    protected _finalizeObserverExecution(observer: ObserverRecord<T, any>): void {
        observer.executionCount++;
        observer.lastExecuted = Date.now();

        if (observer.options.once) {
            this._deactivateObserver(observer, true);
        }
    }

    protected _handleAsyncObserverFailure(
        observer: ObserverRecord<T, any>,
        error: unknown,
        data: unknown
    ): void {
        this._errorCount++;
        const normalized = normalizeError(error);

        if (observer.options.errorHandling === 'callback' && observer.options.onError) {
            try {
                observer.options.onError(normalized, data as never, this);
            } catch {}
        }
    }

    protected _handleSyncObserverFailure(
        observer: ObserverRecord<T, any>,
        error: unknown,
        data: unknown
    ): never | void {
        const normalized = normalizeError(error);

        if (observer.options.errorHandling === 'callback' && observer.options.onError) {
            observer.options.onError(normalized, data as never, this);
            return;
        }

        if (observer.options.errorHandling === 'silent') {
            return;
        }

        throw new ObserverExecutionError(
            observer.id,
            normalized,
            createNotificationData(this.id, 'update', data)
        );
    }

    protected _notifyObserverAsync(observer: ObserverRecord<T, any>, data: T): Promise<void> | undefined {
        if (!observer.isActive) {
            return undefined;
        }

        const callback = this._resolveObserverCallback(observer);
        if (!callback) {
            return undefined;
        }

        try {
            const filter = observer.options.filter;
            if (filter && !filter(data, this)) {
                return undefined;
            }
        } catch (error) {
            this._handleAsyncObserverFailure(
                observer,
                new FilterError(error, observer.options.filter as Function),
                data
            );
            return undefined;
        }

        if (observer.options.transform) {
            try {
                const transformed = observer.options.transform(data, this);

                if (isPromiseLike(transformed)) {
                    return Promise.resolve(transformed).then(
                        (value) => this._dispatchObserverAsync(observer, value),
                        (error) => {
                            this._handleAsyncObserverFailure(
                                observer,
                                new TransformError(error, observer.options.transform as Function, data),
                                data
                            );
                        }
                    );
                }

                return this._dispatchObserverAsync(observer, transformed);
            } catch (error) {
                this._handleAsyncObserverFailure(
                    observer,
                    new TransformError(error, observer.options.transform, data),
                    data
                );
                return undefined;
            }
        }

        return this._dispatchObserverAsync(observer, data);
    }

    protected _dispatchObserverAsync(
        observer: ObserverRecord<T, any>,
        data: unknown
    ): Promise<void> | undefined {
        if (!observer.isActive) {
            return undefined;
        }

        if (observer.buffer) {
            this._enqueueBufferedValue(observer, data);
            return undefined;
        }

        if (observer.options.debounceMs > 0) {
            if (observer.debounceTimer) {
                clearTimeout(observer.debounceTimer);
            }

            observer.debounceTimer = setTimeout(() => {
                observer.debounceTimer = undefined;
                const task = this._invokeObserverAsync(observer, data);
                if (task) {
                    void task;
                }
            }, observer.options.debounceMs);

            return undefined;
        }

        if (observer.options.throttleMs > 0) {
            const now = Date.now();

            if (now - observer.throttleLastExecution < observer.options.throttleMs) {
                return undefined;
            }

            observer.throttleLastExecution = now;
        }

        return this._invokeObserverAsync(observer, data);
    }

    protected _invokeObserverAsync(
        observer: ObserverRecord<T, any>,
        data: unknown
    ): Promise<void> | undefined {
        if (!observer.isActive) {
            return undefined;
        }

        const callback = this._resolveObserverCallback(observer);
        if (!callback) {
            return undefined;
        }

        try {
            const result = callback(data, this);

            if (isPromiseLike(result)) {
                return Promise.resolve(result).then(
                    () => {
                        this._finalizeObserverExecution(observer);
                    },
                    (error) => {
                        this._handleAsyncObserverFailure(observer, error, data);
                    }
                );
            }

            this._finalizeObserverExecution(observer);
            return undefined;
        } catch (error) {
            this._handleAsyncObserverFailure(observer, error, data);
            return undefined;
        }
    }

    protected _notifyObserverSync(observer: ObserverRecord<T, any>, data: T): void {
        if (!observer.isActive) {
            return;
        }

        this._resolveObserverCallback(observer);
        if (!observer.isActive) {
            return;
        }

        try {
            const filter = observer.options.filter;
            if (filter && !filter(data, this)) {
                return;
            }
        } catch (error) {
            this._handleSyncObserverFailure(
                observer,
                new FilterError(error, observer.options.filter as Function),
                data
            );
            return;
        }

        let transformed: unknown = data;

        if (observer.options.transform) {
            try {
                const result = observer.options.transform(data, this);
                if (isPromiseLike(result)) {
                    throw new TransformError(
                        new Error('Async transforms are not supported in synchronous notifications'),
                        observer.options.transform,
                        data
                    );
                }

                transformed = result;
            } catch (error) {
                this._handleSyncObserverFailure(
                    observer,
                    error instanceof TransformError
                        ? error
                        : new TransformError(error, observer.options.transform, data),
                    data
                );
                return;
            }
        }

        if (observer.buffer) {
            this._enqueueBufferedValue(observer, transformed);
            return;
        }

        if (observer.options.debounceMs > 0) {
            if (observer.debounceTimer) {
                clearTimeout(observer.debounceTimer);
            }

            observer.debounceTimer = setTimeout(() => {
                observer.debounceTimer = undefined;

                try {
                    this._invokeObserverSyncImmediate(observer, transformed);
                } catch {}
            }, observer.options.debounceMs);
            return;
        }

        if (observer.options.throttleMs > 0) {
            const now = Date.now();

            if (now - observer.throttleLastExecution < observer.options.throttleMs) {
                return;
            }

            observer.throttleLastExecution = now;
        }

        this._invokeObserverSyncImmediate(observer, transformed);
    }

    protected _invokeObserverSyncImmediate(observer: ObserverRecord<T, any>, data: unknown): void {
        if (!observer.isActive) {
            return;
        }

        const callback = this._resolveObserverCallback(observer);
        if (!callback) {
            return;
        }

        try {
            const result = callback(data, this);

            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch((error) => {
                    try {
                        this._handleSyncObserverFailure(observer, error, data);
                    } catch {}
                });
            }

            this._finalizeObserverExecution(observer);
        } catch (error) {
            this._handleSyncObserverFailure(observer, error, data);
        }
    }

    protected _resolveObserverCallback(
        observer: ObserverRecord<T, any>
    ): ObserverCallback<any> | undefined {
        const callback = observer.resolveCallback();

        if (!callback) {
            this._deactivateObserver(observer, false);
            return undefined;
        }

        return callback;
    }

    protected _enqueueBufferedValue(observer: ObserverRecord<T, any>, data: unknown): void {
        observer.buffer?.add(data);
        observer.notificationBuffer?.add(createNotificationData(this.id, 'update', data));

        if (observer.buffer?.isFull()) {
            this._flushObserverBuffer(observer);
            return;
        }

        if (!observer.bufferTimer) {
            observer.bufferTimer = setTimeout(() => {
                observer.bufferTimer = undefined;
                this._flushObserverBuffer(observer);
            }, observer.options.buffering.flushIntervalMs);
        }
    }

    protected _flushObserverBuffer(observer: ObserverRecord<T, any>): void {
        if (!observer.isActive || !observer.buffer || observer.buffer.size() === 0) {
            return;
        }

        if (observer.bufferTimer) {
            clearTimeout(observer.bufferTimer);
            observer.bufferTimer = undefined;
        }

        const batch = observer.buffer.takeAll();
        observer.notificationBuffer?.flush();

        const task = this._dispatchObserverAsync(observer, batch);
        if (task) {
            void task;
        }
    }

    protected _validateData(data: T): void {
        const validator = this._options.validation.validator;
        if (this._options.validation.enabled && validator && !validator(data)) {
            throw new ValidationError('Data validation failed', data, this.id);
        }
    }

    protected _enterConcurrencyWindow(): void {
        if (!this._options.concurrency.enabled) {
            return;
        }

        if (this._concurrentNotifications >= this._options.concurrency.maxConcurrent) {
            throw new ConcurrencyLimitError(
                this._options.concurrency.maxConcurrent,
                this._concurrentNotifications,
                this.id
            );
        }

        this._concurrentNotifications++;
    }

    protected _leaveConcurrencyWindow(): void {
        if (!this._options.concurrency.enabled || this._concurrentNotifications === 0) {
            return;
        }

        this._concurrentNotifications--;
    }

    protected _forEachObserver(visitor: (observer: ObserverRecord<T, any>) => void): void {
        for (let priority = 0; priority < this._buckets.length; priority++) {
            const bucket = this._buckets[priority];

            for (let index = 0; index < bucket.length; index++) {
                const observer = bucket[index];

                if (!observer || !observer.isActive) {
                    this._needsCompaction = true;
                    continue;
                }

                visitor(observer);
            }
        }
    }

    protected _deactivateObserver(observer: ObserverRecord<T, any>, notifyLifecycle: boolean): void {
        if (!observer.isActive && !this._observers.has(observer.id)) {
            return;
        }

        observer.isActive = false;
        this._cleanupObserver(observer);
        this._observers.delete(observer.id);

        if (this._notificationDepth === 0) {
            this._removeFromBucket(observer);
        } else {
            this._needsCompaction = true;
        }

        if (notifyLifecycle && this._lifecycle?.onObserverRemoved) {
            this._lifecycle.onObserverRemoved(observer.id, this);
        }
    }

    protected _cleanupObserver(observer: ObserverRecord<T, any>): void {
        if (observer.debounceTimer) {
            clearTimeout(observer.debounceTimer);
            observer.debounceTimer = undefined;
        }

        if (observer.bufferTimer) {
            clearTimeout(observer.bufferTimer);
            observer.bufferTimer = undefined;
        }

        observer.buffer?.clear();
        observer.notificationBuffer?.clear();
    }

    protected _removeFromBucket(observer: ObserverRecord<T, any>): void {
        const bucket = this._buckets[observer.priority];
        const index = bucket.findIndex((entry) => entry.id === observer.id);

        if (index >= 0) {
            bucket.splice(index, 1);
        }
    }

    protected _compactObserversIfNeeded(): void {
        if (this._notificationDepth !== 0 || !this._needsCompaction) {
            return;
        }

        for (let priority = 0; priority < this._buckets.length; priority++) {
            const bucket = this._buckets[priority];
            let writeIndex = 0;

            for (let readIndex = 0; readIndex < bucket.length; readIndex++) {
                const observer = bucket[readIndex];

                if (observer && observer.isActive && this._observers.has(observer.id)) {
                    bucket[writeIndex++] = observer;
                }
            }

            bucket.length = writeIndex;
        }

        this._needsCompaction = false;
    }

    protected _runGarbageCollection(): void {
        for (const observer of this._observers.values()) {
            if (!observer.isActive || !observer.resolveCallback()) {
                this._deactivateObserver(observer, false);
            }
        }

        this._compactObserversIfNeeded();
    }
}

export class BehaviorSubject<T> extends Subject<T> {
    #currentValue: T;

    constructor(initialValue: T, options: SubjectOptions<T> = {}) {
        super(options);
        this.#currentValue = initialValue;
    }

    get value(): T {
        return this.#currentValue;
    }

    override async notify(data: T): Promise<boolean> {
        this.#currentValue = data;
        return super.notify(data);
    }

    override notifySync(data: T): boolean {
        this.#currentValue = data;
        return super.notifySync(data);
    }

    override addObserver<TOptions extends ObserverOptions<T, any> | undefined = undefined>(
        observer: ObserverCallback<ObserverEmission<T, TOptions>>,
        options?: TOptions
    ): UnobserveFn {
        const record = this._addObserverRecord(
            observer as ObserverCallback<any>,
            options as ObserverOptions<T, any> | undefined
        );
        scheduleTask(() => {
            if (!record.isActive || this._isDisposed) {
                return;
            }

            const task = this._notifyObserverAsync(record, this.#currentValue);
            if (task) {
                void task;
            }
        });
        return this._createUnobserve(record.id);
    }
}

export class ReplaySubject<T> extends Subject<T> {
    constructor(options: SubjectOptions<T> = {}) {
        super({
            ...options,
            replay: {
                enabled: true,
                bufferSize: options.replay?.bufferSize,
            },
        });
    }

    override addObserver<TOptions extends ObserverOptions<T, any> | undefined = undefined>(
        observer: ObserverCallback<ObserverEmission<T, TOptions>>,
        options?: TOptions
    ): UnobserveFn {
        const replaySize = this.options.replay.bufferSize;
        const mergedOptions = {
            ...(options ?? {}),
            replay: {
                enabled: true,
                bufferSize:
                    (options as ObserverOptions<T, any> | undefined)?.replay?.bufferSize ??
                    replaySize,
            },
        } as TOptions;

        return super.addObserver(observer, mergedOptions);
    }
}

export class AsyncSubject<T> extends Subject<T> {
    #lastValue?: T;
    #hasValue = false;

    override async notify(data: T): Promise<boolean> {
        this._assertNotDisposed();

        if (this._isCompleted) {
            throw new SubjectCompletedError(this.id);
        }

        this.#lastValue = data;
        this.#hasValue = true;
        return true;
    }

    override notifySync(data: T): boolean {
        this._assertNotDisposed();

        if (this._isCompleted) {
            throw new SubjectCompletedError(this.id);
        }

        this.#lastValue = data;
        this.#hasValue = true;
        return true;
    }

    override async complete(): Promise<void> {
        this._assertNotDisposed();

        if (this._isCompleted) {
            return;
        }

        if (this.#hasValue) {
            await super.notify(this.#lastValue as T);
        }

        this._isCompleted = true;
        this._completedAt = Date.now();

        if (this._lifecycle?.onComplete) {
            await this._lifecycle.onComplete(this);
        }

        if (this._options.autoComplete) {
            this.dispose();
        }
    }
}
