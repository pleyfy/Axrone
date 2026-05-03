import {
    mergeObserverOptions,
    mergeSubjectOptions,
    normalizeObserverOptions,
    ObserverCallback,
    ObserverOptions,
    SubjectOptions,
    IObservableSubject,
    IObserver,
} from './definition';
import { IObservableFactory, IMemoryManager, IObserverRegistry } from './interfaces';
import { MemoryManager } from './memory-manager';
import { ObserverRegistry } from './registry';
import { AsyncSubject, BehaviorSubject, ReplaySubject, Subject } from './subject';

class ObserverImpl<T = any> implements IObserver<T> {
    readonly id = Symbol('Observer');
    readonly callback: ObserverCallback<T>;
    readonly options: IObserver<T>['options'];
    readonly createdAt = Date.now();
    readonly executionCount = 0;
    readonly lastExecuted = undefined;
    readonly isActive = true;

    constructor(callback: ObserverCallback<T>, options: ObserverOptions<T> = {}) {
        this.callback = callback;
        this.options = normalizeObserverOptions(options);
    }
}

export class ObservableFactory implements IObservableFactory {
    readonly #memoryManager: IMemoryManager;
    readonly #ownsMemoryManager: boolean;
    readonly #defaultSubjectOptions: SubjectOptions<any>;
    readonly #defaultObserverOptions: ObserverOptions<any>;

    constructor(
        options: {
            defaultSubjectOptions?: SubjectOptions<any>;
            defaultObserverOptions?: ObserverOptions<any>;
            enableMemoryTracking?: boolean;
            memoryManager?: IMemoryManager;
        } = {}
    ) {
        this.#defaultSubjectOptions = options.defaultSubjectOptions ?? {};
        this.#defaultObserverOptions = options.defaultObserverOptions ?? {};
        this.#ownsMemoryManager = options.memoryManager === undefined;
        this.#memoryManager =
            options.memoryManager ??
            new MemoryManager({
                enableTracking: options.enableMemoryTracking ?? true,
            });
    }

    createSubject<T>(options: SubjectOptions<T> = {}): IObservableSubject<T> {
        const mergedOptions = mergeSubjectOptions<T>(
            this.#defaultSubjectOptions as SubjectOptions<T>,
            options
        );
        const subject = new Subject<T>(mergedOptions);
        this.#memoryManager.trackSubject(subject);
        return subject;
    }

    createObserver<T>(callback: ObserverCallback<T>, options: ObserverOptions<T> = {}): IObserver<T> {
        const mergedOptions = mergeObserverOptions<T>(
            this.#defaultObserverOptions as ObserverOptions<T>,
            options
        );
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
            disposeMemoryManager: false,
        });
    }

    createBehaviorSubject<T>(initialValue: T, options: SubjectOptions<T> = {}): BehaviorSubject<T> {
        return new BehaviorSubject<T>(
            initialValue,
            mergeSubjectOptions<T>(this.#defaultSubjectOptions as SubjectOptions<T>, options)
        );
    }

    createReplaySubject<T>(
        bufferSize: number = 10,
        options: SubjectOptions<T> = {}
    ): ReplaySubject<T> {
        return new ReplaySubject<T>(
            mergeSubjectOptions<T>(this.#defaultSubjectOptions as SubjectOptions<T>, {
                ...options,
                replay: {
                    enabled: true,
                    bufferSize,
                    ...options.replay,
                },
            })
        );
    }

    createAsyncSubject<T>(options: SubjectOptions<T> = {}): AsyncSubject<T> {
        return new AsyncSubject<T>(
            mergeSubjectOptions<T>(this.#defaultSubjectOptions as SubjectOptions<T>, options)
        );
    }

    dispose(): void {
        if (this.#ownsMemoryManager) {
            this.#memoryManager.dispose();
        }
    }

    getMemoryUsage() {
        return this.#memoryManager.getMemoryUsage();
    }

    async runGarbageCollection() {
        return this.#memoryManager.runGarbageCollection();
    }
}

export const observableFactory = new ObservableFactory();

export const createSubject = <T>(options?: SubjectOptions<T>) =>
    observableFactory.createSubject<T>(options);

export const createBehaviorSubject = <T>(initialValue: T, options?: SubjectOptions<T>) =>
    observableFactory.createBehaviorSubject<T>(initialValue, options);

export const createReplaySubject = <T>(bufferSize?: number, options?: SubjectOptions<T>) =>
    observableFactory.createReplaySubject<T>(bufferSize, options);

export const createAsyncSubject = <T>(options?: SubjectOptions<T>) =>
    observableFactory.createAsyncSubject<T>(options);

export const createObserver = <T>(callback: ObserverCallback<T>, options?: ObserverOptions<T>) =>
    observableFactory.createObserver<T>(callback, options);

export const createRegistry = (options?: Parameters<ObservableFactory['createRegistry']>[0]) =>
    observableFactory.createRegistry(options);
