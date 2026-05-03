export type ObserverCallback<T> = (
    data: T,
    subject: IObservableSubject<any>
) => void | Promise<void>;

export type UnobserveFn = () => boolean;
export type ObserverId = symbol;
export type SubjectId = symbol;

export type ObservationPriority = 'high' | 'normal' | 'low';
export type NotificationType = 'update' | 'complete' | 'error' | 'lifecycle';
export type ObserverErrorHandling = 'throw' | 'silent' | 'callback';

export interface NotificationData<T = any> {
    readonly timestamp: number;
    readonly data: T;
    readonly type: NotificationType;
    readonly source: SubjectId;
}

export type ObserverFilter<T> = (data: T, subject: IObservableSubject<any>) => boolean;

export type ObserverTransform<TInput, TOutput> = (
    data: TInput,
    subject: IObservableSubject<any>
) => TOutput | Promise<TOutput>;

export interface ObserverBufferingOptions {
    readonly enabled?: boolean;
    readonly maxSize?: number;
    readonly flushIntervalMs?: number;
}

export interface ObserverReplayOptions {
    readonly enabled?: boolean;
    readonly bufferSize?: number;
}

export interface SubjectMemoryManagementOptions {
    readonly enabled?: boolean;
    readonly gcIntervalMs?: number;
    readonly weakReferences?: boolean;
}

export interface SubjectReplayOptions {
    readonly enabled?: boolean;
    readonly bufferSize?: number;
}

export interface SubjectConcurrencyOptions {
    readonly enabled?: boolean;
    readonly maxConcurrent?: number;
}

export interface SubjectValidationOptions<T = any> {
    readonly enabled?: boolean;
    readonly validator?: (data: T) => boolean;
}

export interface ObserverOptions<TInput = any, TOutput = TInput> {
    readonly priority?: ObservationPriority;
    readonly once?: boolean;
    readonly filter?: ObserverFilter<TInput>;
    readonly transform?: ObserverTransform<TInput, TOutput>;
    readonly debounceMs?: number;
    readonly throttleMs?: number;
    readonly buffering?: ObserverBufferingOptions;
    readonly replay?: ObserverReplayOptions;
    readonly weakReference?: boolean;
    readonly errorHandling?: ObserverErrorHandling;
    readonly onError?: (
        error: Error,
        data: TOutput | readonly TOutput[],
        subject: IObservableSubject<TInput>
    ) => void;
}

export interface SubjectOptions<T = any> {
    readonly maxObservers?: number;
    readonly autoComplete?: boolean;
    readonly errorPropagation?: boolean;
    readonly memoryManagement?: SubjectMemoryManagementOptions;
    readonly replay?: SubjectReplayOptions;
    readonly concurrency?: SubjectConcurrencyOptions;
    readonly validation?: SubjectValidationOptions<T>;
}

export interface NormalizedObserverBufferingOptions {
    readonly enabled: boolean;
    readonly maxSize: number;
    readonly flushIntervalMs: number;
}

export interface NormalizedObserverReplayOptions {
    readonly enabled: boolean;
    readonly bufferSize: number;
}

export interface NormalizedSubjectMemoryManagementOptions {
    readonly enabled: boolean;
    readonly gcIntervalMs: number;
    readonly weakReferences: boolean;
}

export interface NormalizedSubjectReplayOptions {
    readonly enabled: boolean;
    readonly bufferSize: number;
}

export interface NormalizedSubjectConcurrencyOptions {
    readonly enabled: boolean;
    readonly maxConcurrent: number;
}

export interface NormalizedSubjectValidationOptions<T = any> {
    readonly enabled: boolean;
    readonly validator?: (data: T) => boolean;
}

export interface NormalizedObserverOptions<TInput = any, TOutput = TInput> {
    readonly priority: ObservationPriority;
    readonly once: boolean;
    readonly filter?: ObserverFilter<TInput>;
    readonly transform?: ObserverTransform<TInput, TOutput>;
    readonly debounceMs: number;
    readonly throttleMs: number;
    readonly buffering: NormalizedObserverBufferingOptions;
    readonly replay: NormalizedObserverReplayOptions;
    readonly weakReference: boolean;
    readonly errorHandling: ObserverErrorHandling;
    readonly onError?: (
        error: Error,
        data: TOutput | readonly TOutput[],
        subject: IObservableSubject<TInput>
    ) => void;
}

export interface NormalizedSubjectOptions<T = any> {
    readonly maxObservers: number;
    readonly autoComplete: boolean;
    readonly errorPropagation: boolean;
    readonly memoryManagement: NormalizedSubjectMemoryManagementOptions;
    readonly replay: NormalizedSubjectReplayOptions;
    readonly concurrency: NormalizedSubjectConcurrencyOptions;
    readonly validation: NormalizedSubjectValidationOptions<T>;
}

export type ObserverEmission<
    TInput,
    TOptions extends ObserverOptions<TInput, any> | undefined,
> = TOptions extends ObserverOptions<TInput, infer TOutput>
    ? TOptions extends { buffering: { enabled: true } }
        ? TOutput[]
        : TOutput
    : TInput;

export const DEFAULT_OBSERVER_OPTIONS: NormalizedObserverOptions<any, any> = Object.freeze({
    priority: 'normal',
    once: false,
    debounceMs: 0,
    throttleMs: 0,
    buffering: Object.freeze({
        enabled: false,
        maxSize: 100,
        flushIntervalMs: 1000,
    }),
    replay: Object.freeze({
        enabled: false,
        bufferSize: 10,
    }),
    weakReference: false,
    errorHandling: 'throw',
});

export const DEFAULT_SUBJECT_OPTIONS: NormalizedSubjectOptions<any> = Object.freeze({
    maxObservers: 100,
    autoComplete: false,
    errorPropagation: true,
    memoryManagement: Object.freeze({
        enabled: true,
        gcIntervalMs: 60000,
        weakReferences: false,
    }),
    replay: Object.freeze({
        enabled: false,
        bufferSize: 10,
    }),
    concurrency: Object.freeze({
        enabled: true,
        maxConcurrent: 10,
    }),
    validation: Object.freeze({
        enabled: false,
        validator: undefined,
    }),
});

export const PRIORITY_VALUES: Readonly<Record<ObservationPriority, 0 | 1 | 2>> = Object.freeze({
    high: 0,
    normal: 1,
    low: 2,
});

export const OBSERVER_MEMORY_SYMBOLS = Object.freeze({
    observerMap: Symbol('observerMap'),
    subjectRegistry: Symbol('subjectRegistry'),
    replayBuffers: Symbol('replayBuffers'),
    observationQueues: Symbol('observationQueues'),
    filterFunctions: Symbol('filterFunctions'),
    transformFunctions: Symbol('transformFunctions'),
});

export interface IObservableSubject<T = any> {
    readonly id: SubjectId;
    notify(data: T): Promise<boolean>;
    notifySync(data: T): boolean;
    complete(): Promise<void>;
    error(error: Error): Promise<void>;
    addObserver<TOptions extends ObserverOptions<T, any> | undefined = undefined>(
        observer: ObserverCallback<ObserverEmission<T, TOptions>>,
        options?: TOptions
    ): UnobserveFn;
    removeObserver(observer: ObserverCallback<any>): boolean;
    removeObserverById(observerId: ObserverId): boolean;
    hasObserver(observer: ObserverCallback<any>): boolean;
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
    readonly options: NormalizedObserverOptions<any, any>;
    readonly createdAt: number;
    readonly executionCount: number;
    readonly lastExecuted?: number;
    readonly isActive: boolean;
}

const normalizeNonNegativeInteger = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fallback;
    }

    return Math.floor(value);
};

const normalizePositiveInteger = (value: unknown, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return fallback;
    }

    return Math.floor(value);
};

export function createObserverId(description: string = 'Observer'): ObserverId {
    return Symbol(description);
}

export function createSubjectId(description: string = 'Subject'): SubjectId {
    return Symbol(description);
}

export function createNotificationData<T>(
    source: SubjectId,
    type: NotificationType,
    data: T,
    timestamp: number = Date.now()
): NotificationData<T> {
    return {
        timestamp,
        data,
        type,
        source,
    };
}

export function isValidObserver(observer: unknown): observer is ObserverCallback<any> {
    return typeof observer === 'function';
}

export function isValidPriority(priority: unknown): priority is ObservationPriority {
    return priority === 'high' || priority === 'normal' || priority === 'low';
}

export function isValidNotificationType(type: unknown): type is NotificationType {
    return type === 'update' || type === 'complete' || type === 'error' || type === 'lifecycle';
}

export function mergeObserverOptions<TInput = any, TOutput = TInput>(
    base: ObserverOptions<TInput, TOutput> | NormalizedObserverOptions<TInput, TOutput> = {},
    override: ObserverOptions<TInput, TOutput> = {}
): ObserverOptions<TInput, TOutput> {
    return {
        ...base,
        ...override,
        buffering:
            base.buffering || override.buffering
                ? {
                      ...(base.buffering ?? {}),
                      ...(override.buffering ?? {}),
                  }
                : undefined,
        replay:
            base.replay || override.replay
                ? {
                      ...(base.replay ?? {}),
                      ...(override.replay ?? {}),
                  }
                : undefined,
    };
}

export function mergeSubjectOptions<T = any>(
    base: SubjectOptions<T> | NormalizedSubjectOptions<T> = {},
    override: SubjectOptions<T> = {}
): SubjectOptions<T> {
    return {
        ...base,
        ...override,
        memoryManagement:
            base.memoryManagement || override.memoryManagement
                ? {
                      ...(base.memoryManagement ?? {}),
                      ...(override.memoryManagement ?? {}),
                  }
                : undefined,
        replay:
            base.replay || override.replay
                ? {
                      ...(base.replay ?? {}),
                      ...(override.replay ?? {}),
                  }
                : undefined,
        concurrency:
            base.concurrency || override.concurrency
                ? {
                      ...(base.concurrency ?? {}),
                      ...(override.concurrency ?? {}),
                  }
                : undefined,
        validation:
            base.validation || override.validation
                ? {
                      ...(base.validation ?? {}),
                      ...(override.validation ?? {}),
                  }
                : undefined,
    };
}

export function normalizeObserverOptions<TInput = any, TOutput = TInput>(
    options: ObserverOptions<TInput, TOutput> = {}
): NormalizedObserverOptions<TInput, TOutput> {
    const priority = isValidPriority(options.priority)
        ? options.priority
        : DEFAULT_OBSERVER_OPTIONS.priority;
    const errorHandling: ObserverErrorHandling =
        options.errorHandling === 'silent' ||
        options.errorHandling === 'callback' ||
        options.errorHandling === 'throw'
            ? options.errorHandling
            : DEFAULT_OBSERVER_OPTIONS.errorHandling;

    return Object.freeze({
        priority,
        once: options.once === true,
        filter: options.filter,
        transform: options.transform,
        debounceMs: normalizeNonNegativeInteger(
            options.debounceMs,
            DEFAULT_OBSERVER_OPTIONS.debounceMs
        ),
        throttleMs: normalizeNonNegativeInteger(
            options.throttleMs,
            DEFAULT_OBSERVER_OPTIONS.throttleMs
        ),
        buffering: Object.freeze({
            enabled: options.buffering?.enabled === true,
            maxSize: normalizePositiveInteger(
                options.buffering?.maxSize,
                DEFAULT_OBSERVER_OPTIONS.buffering.maxSize
            ),
            flushIntervalMs: normalizePositiveInteger(
                options.buffering?.flushIntervalMs,
                DEFAULT_OBSERVER_OPTIONS.buffering.flushIntervalMs
            ),
        }),
        replay: Object.freeze({
            enabled: options.replay?.enabled === true,
            bufferSize: normalizePositiveInteger(
                options.replay?.bufferSize,
                DEFAULT_OBSERVER_OPTIONS.replay.bufferSize
            ),
        }),
        weakReference: options.weakReference === true,
        errorHandling,
        onError: options.onError,
    });
}

export function normalizeSubjectOptions<T = any>(
    options: SubjectOptions<T> = {}
): NormalizedSubjectOptions<T> {
    return Object.freeze({
        maxObservers: normalizePositiveInteger(
            options.maxObservers,
            DEFAULT_SUBJECT_OPTIONS.maxObservers
        ),
        autoComplete: options.autoComplete === true,
        errorPropagation:
            typeof options.errorPropagation === 'boolean'
                ? options.errorPropagation
                : DEFAULT_SUBJECT_OPTIONS.errorPropagation,
        memoryManagement: Object.freeze({
            enabled:
                typeof options.memoryManagement?.enabled === 'boolean'
                    ? options.memoryManagement.enabled
                    : DEFAULT_SUBJECT_OPTIONS.memoryManagement.enabled,
            gcIntervalMs: normalizeNonNegativeInteger(
                options.memoryManagement?.gcIntervalMs,
                DEFAULT_SUBJECT_OPTIONS.memoryManagement.gcIntervalMs
            ),
            weakReferences:
                typeof options.memoryManagement?.weakReferences === 'boolean'
                    ? options.memoryManagement.weakReferences
                    : DEFAULT_SUBJECT_OPTIONS.memoryManagement.weakReferences,
        }),
        replay: Object.freeze({
            enabled:
                typeof options.replay?.enabled === 'boolean'
                    ? options.replay.enabled
                    : DEFAULT_SUBJECT_OPTIONS.replay.enabled,
            bufferSize: normalizePositiveInteger(
                options.replay?.bufferSize,
                DEFAULT_SUBJECT_OPTIONS.replay.bufferSize
            ),
        }),
        concurrency: Object.freeze({
            enabled:
                typeof options.concurrency?.enabled === 'boolean'
                    ? options.concurrency.enabled
                    : DEFAULT_SUBJECT_OPTIONS.concurrency.enabled,
            maxConcurrent: normalizePositiveInteger(
                options.concurrency?.maxConcurrent,
                DEFAULT_SUBJECT_OPTIONS.concurrency.maxConcurrent
            ),
        }),
        validation: Object.freeze({
            enabled:
                typeof options.validation?.enabled === 'boolean'
                    ? options.validation.enabled
                    : DEFAULT_SUBJECT_OPTIONS.validation.enabled,
            validator: options.validation?.validator,
        }),
    });
}
