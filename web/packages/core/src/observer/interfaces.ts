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
} from './definition';

export interface IObserverSubscription<T = any> extends IObserver<T> {
    readonly subject: IObservableSubject<T>;
    readonly priority: number;
    readonly isDebounced: boolean;
    readonly isThrottled: boolean;
    readonly hasFilter: boolean;
    readonly hasTransform: boolean;
    readonly bufferSize: number;
    readonly replayEnabled: boolean;
}

export interface IObserverRegistry {
    register<T>(
        subject: IObservableSubject<T>,
        observer: ObserverCallback<T>,
        options?: ObserverOptions
    ): ObserverId;

    unregister(observerId: ObserverId): boolean;

    unregisterByCallback<T>(subject: IObservableSubject<T>, observer: ObserverCallback<T>): boolean;

    getObserver(observerId: ObserverId): IObserverSubscription | undefined;

    getObserversForSubject(subjectId: SubjectId): ReadonlyArray<IObserverSubscription>;

    getActiveObserverCount(): number;

    getSubjectCount(): number;

    clear(): void;

    dispose(): void;
}

export interface ISubjectLifecycle {
    onBeforeNotify?: (data: any, subject: IObservableSubject<any>) => boolean | Promise<boolean>;
    onAfterNotify?: (
        data: any,
        subject: IObservableSubject<any>,
        success: boolean
    ) => void | Promise<void>;
    onObserverAdded?: (observer: IObserverSubscription, subject: IObservableSubject<any>) => void;
    onObserverRemoved?: (observerId: ObserverId, subject: IObservableSubject<any>) => void;
    onComplete?: (subject: IObservableSubject<any>) => void | Promise<void>;
    onError?: (error: Error, subject: IObservableSubject<any>) => void | Promise<void>;
    onDispose?: (subject: IObservableSubject<any>) => void | Promise<void>;
}

export interface IObserverMetrics {
    readonly executionCount: number;
    readonly errorCount: number;
    readonly averageExecutionTime: number;
    readonly totalExecutionTime: number;
    readonly lastExecutionTime?: number;
    readonly createdAt: number;
    readonly lastExecutedAt?: number;
    readonly isActive: boolean;
}

export interface ISubjectMetrics {
    readonly notificationCount: number;
    readonly observerCount: number;
    readonly errorCount: number;
    readonly completedAt?: number;
    readonly createdAt: number;
    readonly averageNotificationTime: number;
    readonly totalNotificationTime: number;
    readonly lastNotificationAt?: number;
    readonly replayBufferSize: number;
    readonly isCompleted: boolean;
    readonly isErrored: boolean;
}

export interface IObserverBuffer<T = any> {
    add(data: NotificationData<T>): void;
    flush(): ReadonlyArray<NotificationData<T>>;
    clear(): void;
    size(): number;
    isFull(): boolean;
    getAll(): ReadonlyArray<NotificationData<T>>;
}

export interface IReplayBuffer<T = any> {
    add(data: T): void;
    getAll(): ReadonlyArray<T>;
    getLast(count: number): ReadonlyArray<T>;
    clear(): void;
    size(): number;
    maxSize: number;
}

export interface IObserverScheduler {
    schedule<T>(
        callback: ObserverCallback<T>,
        data: T,
        subject: IObservableSubject<T>,
        priority: number
    ): Promise<void>;

    scheduleSync<T>(callback: ObserverCallback<T>, data: T, subject: IObservableSubject<T>): void;

    pause(): void;
    resume(): void;
    isPaused(): boolean;
    getPendingCount(): number;
    clear(): void;
    dispose(): void;
}

export interface IObserverDebouncer<T = any> {
    debounce(
        callback: ObserverCallback<T>,
        data: T,
        subject: IObservableSubject<T>,
        delayMs: number
    ): void;

    cancel(observerId: ObserverId): boolean;
    dispose(): void;
}

export interface IObserverThrottler<T = any> {
    throttle(
        callback: ObserverCallback<T>,
        data: T,
        subject: IObservableSubject<T>,
        intervalMs: number,
        observerId: ObserverId
    ): boolean;

    reset(observerId: ObserverId): void;
    dispose(): void;
}

export interface IObserverFilterEngine {
    applyFilter<T>(
        data: T,
        subject: IObservableSubject<T>,
        filter: (data: T, subject: IObservableSubject<T>) => boolean
    ): boolean;

    applyTransform<TInput, TOutput>(
        data: TInput,
        subject: IObservableSubject<TInput>,
        transform: (data: TInput, subject: IObservableSubject<TInput>) => TOutput | Promise<TOutput>
    ): TOutput | Promise<TOutput>;
}

export interface IMemoryManager {
    trackSubject(subject: IObservableSubject<any>): void;
    untrackSubject(subjectId: SubjectId): void;
    trackObserver(observer: IObserverSubscription): void;
    untrackObserver(observerId: ObserverId): void;
    getMemoryUsage(): {
        subjects: number;
        observers: number;
        replayBuffers: number;
        observerBuffers: number;
        totalMemoryBytes: number;
    };
    runGarbageCollection(): Promise<{
        subjectsCleared: number;
        observersCleared: number;
        memoryFreed: number;
    }>;
    dispose(): void;
}

export interface IObserverValidator {
    validateData<T>(data: T, validator?: (data: T) => boolean): boolean;
    validateObserver(observer: ObserverCallback<any>): boolean;
    validateOptions(options: ObserverOptions): boolean;
    validateSubjectOptions(options: SubjectOptions): boolean;
}

export interface IObservableFactory {
    createSubject<T>(options?: SubjectOptions): IObservableSubject<T>;
    createObserver<T>(callback: ObserverCallback<T>, options?: ObserverOptions): IObserver<T>;
    createRegistry(options?: {
        maxSubjects?: number;
        enableMetrics?: boolean;
        enableMemoryTracking?: boolean;
    }): IObserverRegistry;
}

// Advanced interfaces for enterprise features

export interface IObserverChain<T = any> {
    filter(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T>;
    map<U>(transform: (data: T, subject: IObservableSubject<T>) => U): IObserverChain<U>;
    debounce(ms: number): IObserverChain<T>;
    throttle(ms: number): IObserverChain<T>;
    buffer(maxSize: number, flushIntervalMs: number): IObserverChain<T[]>;
    take(count: number): IObserverChain<T>;
    takeUntil(predicate: (data: T, subject: IObservableSubject<T>) => boolean): IObserverChain<T>;
    subscribe(callback: ObserverCallback<T>): UnobserveFn;
}

export interface ISubjectGroup<T = any> {
    readonly subjects: ReadonlyArray<IObservableSubject<T>>;
    add(subject: IObservableSubject<T>): void;
    remove(subject: IObservableSubject<T>): boolean;
    removeById(subjectId: SubjectId): boolean;
    notifyAll(data: T): Promise<boolean[]>;
    notifyAllSync(data: T): boolean[];
    completeAll(): Promise<void>;
    disposeAll(): void;
    addObserver(observer: ObserverCallback<T>, options?: ObserverOptions): UnobserveFn[];
    merge(): IObservableSubject<T>;
    combineLatest(): IObservableSubject<T[]>;
}

export interface IObserverConnection<TSource = any, TTarget = any> {
    readonly source: IObservableSubject<TSource>;
    readonly target: IObservableSubject<TTarget>;
    readonly transform?: (data: TSource) => TTarget | Promise<TTarget>;
    readonly isConnected: boolean;
    connect(): void;
    disconnect(): void;
    dispose(): void;
}
