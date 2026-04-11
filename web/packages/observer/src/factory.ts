import {
    ObserverCallback,
    ObserverId,
    SubjectId,
    ObserverOptions,
    SubjectOptions,
    IObservableSubject,
    IObserver,
    UnobserveFn,
    DEFAULT_OBSERVER_OPTIONS,
} from './definition';
import { IObservableFactory, IObserverRegistry, IMemoryManager } from './interfaces';
import { Subject } from './subject';
import { ObserverRegistry } from './registry';
import { MemoryManager } from './memory-manager';

class ObserverImpl<T = any> implements IObserver<T> {
    readonly id: ObserverId;
    readonly callback: ObserverCallback<T>;
    readonly options: Required<ObserverOptions>;
    readonly createdAt: number;
    readonly executionCount: number;
    readonly lastExecuted?: number;
    readonly isActive: boolean;

    constructor(callback: ObserverCallback<T>, options: ObserverOptions = {}) {
        this.id = Symbol('Observer');
        this.callback = callback;
        this.options = { ...DEFAULT_OBSERVER_OPTIONS, ...options } as Required<ObserverOptions>;
        this.createdAt = Date.now();
        this.executionCount = 0;
        this.isActive = true;
    }
}

export class ObservableFactory implements IObservableFactory {
    readonly #memoryManager: IMemoryManager;
    readonly #defaultSubjectOptions: SubjectOptions;
    readonly #defaultObserverOptions: ObserverOptions;

    constructor(
        options: {
            defaultSubjectOptions?: SubjectOptions;
            defaultObserverOptions?: ObserverOptions;
            enableMemoryTracking?: boolean;
            memoryManager?: IMemoryManager;
        } = {}
    ) {
        this.#defaultSubjectOptions = options.defaultSubjectOptions ?? {};
        this.#defaultObserverOptions = options.defaultObserverOptions ?? {};

        this.#memoryManager =
            options.memoryManager ??
            new MemoryManager({
                enableTracking: options.enableMemoryTracking ?? true,
            });
    }

    createSubject<T>(options: SubjectOptions = {}): IObservableSubject<T> {
        const mergedOptions = { ...this.#defaultSubjectOptions, ...options };
        const subject = new Subject<T>(mergedOptions);

        this.#memoryManager.trackSubject(subject);

        return subject;
    }

    createObserver<T>(callback: ObserverCallback<T>, options: ObserverOptions = {}): IObserver<T> {
        const mergedOptions = { ...this.#defaultObserverOptions, ...options };
        return new ObserverImpl<T>(callback, mergedOptions);
    }

    createRegistry(
        options: {
            maxSubjects?: number;
            enableMetrics?: boolean;
            enableMemoryTracking?: boolean;
        } = {}
    ): IObserverRegistry {
        return new ObserverRegistry({
            enableMemoryTracking: options.enableMemoryTracking ?? true,
            memoryManager: this.#memoryManager,
        });
    }

    createBehaviorSubject<T>(initialValue: T, options: SubjectOptions = {}): BehaviorSubject<T> {
        return new BehaviorSubject<T>(initialValue, options);
    }

    createReplaySubject<T>(
        bufferSize: number = 10,
        options: SubjectOptions = {}
    ): ReplaySubject<T> {
        const replayOptions: SubjectOptions = {
            ...options,
            replay: {
                enabled: true,
                bufferSize,
                ...options.replay,
            },
        };
        return new ReplaySubject<T>(replayOptions);
    }

    createAsyncSubject<T>(options: SubjectOptions = {}): AsyncSubject<T> {
        return new AsyncSubject<T>(options);
    }

    dispose(): void {
        this.#memoryManager.dispose();
    }

    getMemoryUsage() {
        return this.#memoryManager.getMemoryUsage();
    }

    async runGarbageCollection() {
        return this.#memoryManager.runGarbageCollection();
    }
}

export class BehaviorSubject<T> extends Subject<T> {
    #currentValue: T;
    #hasValue = true;

    constructor(initialValue: T, options: SubjectOptions = {}) {
        super(options);
        this.#currentValue = initialValue;
    }

    get value(): T {
        if (!this.#hasValue) {
            throw new Error('BehaviorSubject has no current value');
        }
        return this.#currentValue;
    }

    async notify(data: T): Promise<boolean> {
        this.#currentValue = data;
        this.#hasValue = true;
        return super.notify(data);
    }

    notifySync(data: T): boolean {
        this.#currentValue = data;
        this.#hasValue = true;
        return super.notifySync(data);
    }

    addObserver(callback: ObserverCallback<T>, options: ObserverOptions = {}) {
        const unsubscribe = super.addObserver(callback, options);

        if (this.#hasValue) {
            setTimeout(() => {
                callback(this.#currentValue, this);
            }, 0);
        }

        return unsubscribe;
    }
}

export class ReplaySubject<T> extends Subject<T> {
    constructor(options: SubjectOptions = {}) {
        const replayOptions: SubjectOptions = {
            ...options,
            replay: {
                enabled: true,
                bufferSize: 10,
                ...options.replay,
            },
        };
        super(replayOptions);
    }

    addObserver(callback: ObserverCallback<T>, options: ObserverOptions = {}): UnobserveFn {
        const replayOptions: ObserverOptions = {
            ...options,
            replay: {
                enabled: true,
                bufferSize: this.options.replay.bufferSize,
                ...options.replay,
            },
        };
        return super.addObserver(callback, replayOptions);
    }
}

export class AsyncSubject<T> extends Subject<T> {
    #lastValue?: T;
    #hasValue = false;

    async notify(data: T): Promise<boolean> {
        this.#lastValue = data;
        this.#hasValue = true;
        return true;
    }

    notifySync(data: T): boolean {
        this.#lastValue = data;
        this.#hasValue = true;
        return true;
    }

    async complete(): Promise<void> {
        if (this.#hasValue && this.#lastValue !== undefined) {
            await super.notify(this.#lastValue);
        }

        (this as any).isCompleted = true;
        (this as any).metrics.completedAt = Date.now();
    }
}

export const observableFactory = new ObservableFactory();

export const createSubject = <T>(options?: SubjectOptions) =>
    observableFactory.createSubject<T>(options);

export const createBehaviorSubject = <T>(initialValue: T, options?: SubjectOptions) =>
    observableFactory.createBehaviorSubject<T>(initialValue, options);

export const createReplaySubject = <T>(bufferSize?: number, options?: SubjectOptions) =>
    observableFactory.createReplaySubject<T>(bufferSize, options);

export const createAsyncSubject = <T>(options?: SubjectOptions) =>
    observableFactory.createAsyncSubject<T>(options);

export const createObserver = <T>(callback: ObserverCallback<T>, options?: ObserverOptions) =>
    observableFactory.createObserver<T>(callback, options);

export const createRegistry = (options?: Parameters<ObservableFactory['createRegistry']>[0]) =>
    observableFactory.createRegistry(options);
