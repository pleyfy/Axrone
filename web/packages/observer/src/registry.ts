import {
    mergeObserverOptions,
    normalizeObserverOptions,
    ObserverCallback,
    ObserverId,
    ObserverOptions,
    PRIORITY_VALUES,
    SubjectId,
    IObservableSubject,
    OBSERVER_MEMORY_SYMBOLS,
} from './definition';
import { IObserverRegistry, IObserverSubscription, IMemoryManager } from './interfaces';

interface RegisteredObserver<T = any> extends IObserverSubscription<T> {
    readonly unsubscribe: () => boolean;
}

export class ObserverRegistry implements IObserverRegistry {
    readonly #observers = new Map<ObserverId, RegisteredObserver>();
    readonly #subjectObservers = new Map<SubjectId, Set<ObserverId>>();
    readonly #memoryManager?: IMemoryManager;
    readonly #disposeMemoryManager: boolean;
    #isDisposed = false;

    constructor(
        options: {
            enableMemoryTracking?: boolean;
            memoryManager?: IMemoryManager;
            disposeMemoryManager?: boolean;
        } = {}
    ) {
        if (options.enableMemoryTracking && options.memoryManager) {
            this.#memoryManager = options.memoryManager;
        }

        this.#disposeMemoryManager = options.disposeMemoryManager === true;
    }

    register<T, TOptions extends ObserverOptions<T, any> | undefined = undefined>(
        subject: IObservableSubject<T>,
        observer: ObserverCallback<any>,
        options?: TOptions
    ): ObserverId {
        this.#throwIfDisposed();

        const unsubscribe = subject.addObserver(observer, options);
        const resolvedOptions = normalizeObserverOptions(mergeObserverOptions({}, options ?? {}));
        const observerId = Symbol('RegisteredObserver');

        const registeredObserver: RegisteredObserver = {
            id: observerId,
            callback: observer,
            options: resolvedOptions,
            createdAt: Date.now(),
            executionCount: 0,
            lastExecuted: undefined,
            isActive: true,
            subject,
            priority: PRIORITY_VALUES[resolvedOptions.priority],
            isDebounced: resolvedOptions.debounceMs > 0,
            isThrottled: resolvedOptions.throttleMs > 0,
            hasFilter: typeof resolvedOptions.filter === 'function',
            hasTransform: typeof resolvedOptions.transform === 'function',
            bufferSize: resolvedOptions.buffering.enabled ? resolvedOptions.buffering.maxSize : 0,
            replayEnabled: resolvedOptions.replay.enabled,
            unsubscribe,
        };

        this.#observers.set(observerId, registeredObserver);

        let observerIds = this.#subjectObservers.get(subject.id);
        if (!observerIds) {
            observerIds = new Set<ObserverId>();
            this.#subjectObservers.set(subject.id, observerIds);
        }
        observerIds.add(observerId);

        this.#memoryManager?.trackObserver(registeredObserver);

        return observerId;
    }

    unregister(observerId: ObserverId): boolean {
        const observer = this.#observers.get(observerId);
        if (!observer) {
            return false;
        }

        observer.unsubscribe();
        (observer as { isActive: boolean }).isActive = false;
        this.#observers.delete(observerId);

        const subjectObservers = this.#subjectObservers.get(observer.subject.id);
        if (subjectObservers) {
            subjectObservers.delete(observerId);
            if (subjectObservers.size === 0) {
                this.#subjectObservers.delete(observer.subject.id);
            }
        }

        this.#memoryManager?.untrackObserver(observerId);
        return true;
    }

    unregisterByCallback<T>(subject: IObservableSubject<T>, observer: ObserverCallback<any>): boolean {
        const subjectObservers = this.#subjectObservers.get(subject.id);
        if (!subjectObservers || subjectObservers.size === 0) {
            return false;
        }

        let removed = false;

        for (const observerId of [...subjectObservers]) {
            const registered = this.#observers.get(observerId);
            if (registered?.callback === observer) {
                removed = this.unregister(observerId) || removed;
            }
        }

        return removed;
    }

    getObserver(observerId: ObserverId): IObserverSubscription | undefined {
        return this.#observers.get(observerId);
    }

    getObserversForSubject(subjectId: SubjectId): ReadonlyArray<IObserverSubscription> {
        const observerIds = this.#subjectObservers.get(subjectId);
        if (!observerIds) {
            return [];
        }

        const observers: IObserverSubscription[] = [];

        for (const observerId of observerIds) {
            const observer = this.#observers.get(observerId);
            if (observer) {
                observers.push(observer);
            }
        }

        return observers;
    }

    getActiveObserverCount(): number {
        let activeCount = 0;

        for (const observer of this.#observers.values()) {
            if (observer.isActive) {
                activeCount++;
            }
        }

        return activeCount;
    }

    getSubjectCount(): number {
        return this.#subjectObservers.size;
    }

    clear(): void {
        for (const [observerId, observer] of this.#observers) {
            observer.unsubscribe();
            this.#memoryManager?.untrackObserver(observerId);
            (observer as { isActive: boolean }).isActive = false;
        }

        this.#observers.clear();
        this.#subjectObservers.clear();
    }

    dispose(): void {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;
        this.clear();

        if (this.#disposeMemoryManager) {
            this.#memoryManager?.dispose();
        }
    }

    getMemoryUsage(): Record<string, number> {
        return {
            [OBSERVER_MEMORY_SYMBOLS.observerMap.toString()]: this.#observers.size,
            [OBSERVER_MEMORY_SYMBOLS.subjectRegistry.toString()]: this.#subjectObservers.size,
        };
    }

    getObserversByPriority(priority: number): ReadonlyArray<IObserverSubscription> {
        const result: IObserverSubscription[] = [];
        for (const observer of this.#observers.values()) {
            if (observer.priority === priority) {
                result.push(observer);
            }
        }
        return result;
    }

    getObserversWithFilters(): ReadonlyArray<IObserverSubscription> {
        const result: IObserverSubscription[] = [];
        for (const observer of this.#observers.values()) {
            if (observer.hasFilter) {
                result.push(observer);
            }
        }
        return result;
    }

    getObserversWithTransforms(): ReadonlyArray<IObserverSubscription> {
        const result: IObserverSubscription[] = [];
        for (const observer of this.#observers.values()) {
            if (observer.hasTransform) {
                result.push(observer);
            }
        }
        return result;
    }

    getDebounceObservers(): ReadonlyArray<IObserverSubscription> {
        const result: IObserverSubscription[] = [];
        for (const observer of this.#observers.values()) {
            if (observer.isDebounced) {
                result.push(observer);
            }
        }
        return result;
    }

    getThrottledObservers(): ReadonlyArray<IObserverSubscription> {
        const result: IObserverSubscription[] = [];
        for (const observer of this.#observers.values()) {
            if (observer.isThrottled) {
                result.push(observer);
            }
        }
        return result;
    }

    validateRegistry(): {
        isHealthy: boolean;
        issues: string[];
        totalObservers: number;
        activeObservers: number;
        inactiveObservers: number;
    } {
        const issues: string[] = [];
        let activeObservers = 0;
        let inactiveObservers = 0;

        for (const [observerId, observer] of this.#observers) {
            if (observer.isActive) {
                activeObservers++;
            } else {
                inactiveObservers++;
                issues.push(`Observer ${String(observerId)} is inactive but still registered`);
            }

            if (!this.#subjectObservers.has(observer.subject.id)) {
                issues.push(`Observer ${String(observerId)} references non-existent subject`);
            }
        }

        for (const [subjectId, observerIds] of this.#subjectObservers) {
            for (const observerId of observerIds) {
                if (!this.#observers.has(observerId)) {
                    issues.push(
                        `Subject ${String(subjectId)} references non-existent observer ${String(observerId)}`
                    );
                }
            }
        }

        return {
            isHealthy: issues.length === 0,
            issues,
            totalObservers: this.#observers.size,
            activeObservers,
            inactiveObservers,
        };
    }

    #throwIfDisposed(): void {
        if (this.#isDisposed) {
            throw new Error('ObserverRegistry has been disposed');
        }
    }
}
