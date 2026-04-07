import {
    ObserverCallback,
    UnobserveFn,
    ObserverId,
    SubjectId,
    ObserverOptions,
    IObservableSubject,
    OBSERVER_MEMORY_SYMBOLS,
} from './definition';
import { ObserverNotFoundError } from './errors';
import { IObserverRegistry, IObserverSubscription, IMemoryManager } from './interfaces';

interface RegisteredObserver<T = any> extends IObserverSubscription<T> {
    readonly unsubscribe: UnobserveFn;
}

export class ObserverRegistry implements IObserverRegistry {
    readonly #observers = new Map<ObserverId, RegisteredObserver>();
    readonly #subjectObservers = new Map<SubjectId, Set<ObserverId>>();
    readonly #memoryManager?: IMemoryManager;
    #isDisposed = false;

    constructor(
        options: {
            enableMemoryTracking?: boolean;
            memoryManager?: IMemoryManager;
        } = {}
    ) {
        if (options.enableMemoryTracking && options.memoryManager) {
            this.#memoryManager = options.memoryManager;
        }
    }

    register<T>(
        subject: IObservableSubject<T>,
        observer: ObserverCallback<T>,
        options: ObserverOptions = {}
    ): ObserverId {
        this.#throwIfDisposed();

        const unsubscribe = subject.addObserver(observer, options);
        const observerId = Symbol('RegisteredObserver');

        const registeredObserver: RegisteredObserver<T> = {
            id: observerId,
            callback: observer,
            options: options as Required<ObserverOptions>,
            createdAt: Date.now(),
            executionCount: 0,
            isActive: true,
            subject,
            priority: 1,
            isDebounced: (options.debounceMs ?? 0) > 0,
            isThrottled: (options.throttleMs ?? 0) > 0,
            hasFilter: !!options.filter,
            hasTransform: !!options.transform,
            bufferSize: options.buffering?.maxSize ?? 0,
            replayEnabled: options.replay?.enabled ?? false,
            unsubscribe,
        };

        this.#observers.set(observerId, registeredObserver);

        if (!this.#subjectObservers.has(subject.id)) {
            this.#subjectObservers.set(subject.id, new Set());
        }
        this.#subjectObservers.get(subject.id)!.add(observerId);

        if (this.#memoryManager) {
            this.#memoryManager.trackObserver(registeredObserver);
        }

        return observerId;
    }

    unregister(observerId: ObserverId): boolean {
        const observer = this.#observers.get(observerId);
        if (!observer) {
            return false;
        }

        observer.unsubscribe();

        this.#observers.delete(observerId);

        const subjectObservers = this.#subjectObservers.get(observer.subject.id);
        if (subjectObservers) {
            subjectObservers.delete(observerId);
            if (subjectObservers.size === 0) {
                this.#subjectObservers.delete(observer.subject.id);
            }
        }

        if (this.#memoryManager) {
            this.#memoryManager.untrackObserver(observerId);
        }

        return true;
    }

    unregisterByCallback<T>(
        subject: IObservableSubject<T>,
        observer: ObserverCallback<T>
    ): boolean {
        const subjectObservers = this.#subjectObservers.get(subject.id);
        if (!subjectObservers) {
            return false;
        }

        let unregistered = false;
        for (const observerId of subjectObservers) {
            const registeredObserver = this.#observers.get(observerId);
            if (registeredObserver && registeredObserver.callback === observer) {
                this.unregister(observerId);
                unregistered = true;
            }
        }

        return unregistered;
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
        for (const observer of this.#observers.values()) {
            observer.unsubscribe();
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

        if (this.#memoryManager) {
            this.#memoryManager.dispose();
        }
    }

    getMemoryUsage(): Record<string, number> {
        return {
            [OBSERVER_MEMORY_SYMBOLS.observerMap.toString()]: this.#observers.size,
            [OBSERVER_MEMORY_SYMBOLS.subjectRegistry.toString()]: this.#subjectObservers.size,
        };
    }

    getObserversByPriority(priority: number): ReadonlyArray<IObserverSubscription> {
        return Array.from(this.#observers.values()).filter(
            (observer) => observer.priority === priority
        );
    }

    getObserversWithFilters(): ReadonlyArray<IObserverSubscription> {
        return Array.from(this.#observers.values()).filter((observer) => observer.hasFilter);
    }

    getObserversWithTransforms(): ReadonlyArray<IObserverSubscription> {
        return Array.from(this.#observers.values()).filter((observer) => observer.hasTransform);
    }

    getDebounceObservers(): ReadonlyArray<IObserverSubscription> {
        return Array.from(this.#observers.values()).filter((observer) => observer.isDebounced);
    }

    getThrottledObservers(): ReadonlyArray<IObserverSubscription> {
        return Array.from(this.#observers.values()).filter((observer) => observer.isThrottled);
    }

    validateRegistry(): {
        isHealthy: boolean;
        issues: string[];
        totalObservers: number;
        activeObservers: number;
        inactiveObservers: number;
    } {
        const issues: string[] = [];
        let activeCount = 0;
        let inactiveCount = 0;

        for (const [observerId, observer] of this.#observers.entries()) {
            if (observer.isActive) {
                activeCount++;
            } else {
                inactiveCount++;
                issues.push(`Observer ${String(observerId)} is inactive but still registered`);
            }

            if (!this.#subjectObservers.has(observer.subject.id)) {
                issues.push(`Observer ${String(observerId)} references non-existent subject`);
            }
        }

        for (const [subjectId, observerIds] of this.#subjectObservers.entries()) {
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
            activeObservers: activeCount,
            inactiveObservers: inactiveCount,
        };
    }

    #throwIfDisposed(): void {
        if (this.#isDisposed) {
            throw new Error('ObserverRegistry has been disposed');
        }
    }
}
