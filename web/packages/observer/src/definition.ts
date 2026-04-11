export type ObserverCallback<T> = (
    data: T,
    subject: IObservableSubject<any>
) => void | Promise<void>;
export type UnobserveFn = () => boolean;
export type ObserverId = symbol;
export type SubjectId = symbol;

export type ObservationPriority = 'high' | 'normal' | 'low';

export type NotificationData<T = any> = {
    readonly timestamp: number;
    readonly data: T;
    readonly type: NotificationType;
    readonly source: SubjectId;
};

export type NotificationType = 'update' | 'complete' | 'error' | 'lifecycle';

export type ObserverFilter<T> = (data: T, subject: IObservableSubject<any>) => boolean;

export type ObserverTransform<TInput, TOutput> = (
    data: TInput,
    subject: IObservableSubject<any>
) => TOutput | Promise<TOutput>;

export interface ObserverOptions {
    readonly priority?: ObservationPriority;
    readonly once?: boolean;
    readonly filter?: ObserverFilter<any>;
    readonly transform?: ObserverTransform<any, any>;
    readonly debounceMs?: number;
    readonly throttleMs?: number;
    readonly buffering?: {
        readonly enabled: boolean;
        readonly maxSize: number;
        readonly flushIntervalMs: number;
    };
    readonly replay?: {
        readonly enabled: boolean;
        readonly bufferSize: number;
    };
    readonly weakReference?: boolean;
    readonly errorHandling?: 'throw' | 'silent' | 'callback';
    readonly onError?: (error: Error, data: any, subject: IObservableSubject<any>) => void;
}

export interface SubjectOptions {
    readonly maxObservers?: number;
    readonly autoComplete?: boolean;
    readonly errorPropagation?: boolean;
    readonly memoryManagement?: {
        readonly enabled: boolean;
        readonly gcIntervalMs: number;
        readonly weakReferences: boolean;
    };
    readonly replay?: {
        readonly enabled: boolean;
        readonly bufferSize: number;
    };
    readonly concurrency?: {
        readonly enabled: boolean;
        readonly maxConcurrent: number;
    };
    readonly validation?: {
        readonly enabled: boolean;
        readonly validator?: (data: any) => boolean;
    };
}

export const DEFAULT_OBSERVER_OPTIONS: Required<
    Omit<ObserverOptions, 'filter' | 'transform' | 'onError'>
> = Object.freeze({
    priority: 'normal',
    once: false,
    debounceMs: 0,
    throttleMs: 0,
    buffering: {
        enabled: false,
        maxSize: 100,
        flushIntervalMs: 1000,
    },
    replay: {
        enabled: false,
        bufferSize: 10,
    },
    weakReference: false,
    errorHandling: 'throw',
} as const);

export const DEFAULT_SUBJECT_OPTIONS: Required<Omit<SubjectOptions, 'validator'>> = Object.freeze({
    maxObservers: 100,
    autoComplete: false,
    errorPropagation: true,
    memoryManagement: {
        enabled: true,
        gcIntervalMs: 60000,
        weakReferences: false,
    },
    replay: {
        enabled: false,
        bufferSize: 10,
    },
    concurrency: {
        enabled: true,
        maxConcurrent: 10,
    },
    validation: {
        enabled: false,
    },
} as const);

export const PRIORITY_VALUES: Record<ObservationPriority, number> = {
    high: 0,
    normal: 1,
    low: 2,
} as const;

export function isValidObserver(observer: unknown): observer is ObserverCallback<any> {
    return typeof observer === 'function';
}

export function isValidPriority(priority: unknown): priority is ObservationPriority {
    return typeof priority === 'string' && ['high', 'normal', 'low'].includes(priority);
}

export function isValidNotificationType(type: unknown): type is NotificationType {
    return typeof type === 'string' && ['update', 'complete', 'error', 'lifecycle'].includes(type);
}

export const OBSERVER_MEMORY_SYMBOLS = Object.freeze({
    observerMap: Symbol('observerMap'),
    subjectRegistry: Symbol('subjectRegistry'),
    replayBuffers: Symbol('replayBuffers'),
    observationQueues: Symbol('observationQueues'),
    filterFunctions: Symbol('filterFunctions'),
    transformFunctions: Symbol('transformFunctions'),
} as const);

export interface IObservableSubject<T = any> {
    readonly id: SubjectId;
    notify(data: T): Promise<boolean>;
    notifySync(data: T): boolean;
    complete(): Promise<void>;
    error(error: Error): Promise<void>;
    addObserver(observer: ObserverCallback<T>, options?: ObserverOptions): UnobserveFn;
    removeObserver(observer: ObserverCallback<T>): boolean;
    removeObserverById(observerId: ObserverId): boolean;
    hasObserver(observer: ObserverCallback<T>): boolean;
    getObserverCount(): number;
    isCompleted(): boolean;
    isErrored(): boolean;
    getLastError(): Error | undefined;
    getMemoryUsage(): Record<string, number>;
    dispose(): void;
}

export interface IObserver<T = any> {
    readonly id: ObserverId;
    readonly callback: ObserverCallback<T>;
    readonly options: Required<ObserverOptions>;
    readonly createdAt: number;
    readonly executionCount: number;
    readonly lastExecuted?: number;
    readonly isActive: boolean;
}
