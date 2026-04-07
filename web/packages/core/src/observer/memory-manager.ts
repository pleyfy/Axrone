import { SubjectId, ObserverId, IObservableSubject, OBSERVER_MEMORY_SYMBOLS } from './definition';
import { IMemoryManager, IObserverSubscription } from './interfaces';

interface TrackedSubject {
    readonly id: SubjectId;
    readonly subject: WeakRef<IObservableSubject>;
    readonly createdAt: number;
    lastAccessedAt: number;
}

interface TrackedObserver {
    readonly id: ObserverId;
    readonly observer: WeakRef<IObserverSubscription>;
    readonly createdAt: number;
    lastAccessedAt: number;
}

export class MemoryManager implements IMemoryManager {
    readonly #trackedSubjects = new Map<SubjectId, TrackedSubject>();
    readonly #trackedObservers = new Map<ObserverId, TrackedObserver>();
    readonly #gcIntervalId?: ReturnType<typeof setInterval>;
    readonly #enableTracking: boolean;
    #isDisposed = false;

    constructor(
        options: {
            enableTracking?: boolean;
            gcIntervalMs?: number;
            autoGcThresholdMb?: number;
        } = {}
    ) {
        this.#enableTracking = options.enableTracking ?? true;

        if (this.#enableTracking && (options.gcIntervalMs ?? 60000) > 0) {
            this.#gcIntervalId = setInterval(() => {
                this.#runAutomaticGc(options.autoGcThresholdMb ?? 50);
            }, options.gcIntervalMs ?? 60000);
        }
    }

    trackSubject(subject: IObservableSubject<any>): void {
        if (!this.#enableTracking || this.#isDisposed) {
            return;
        }

        const tracked: TrackedSubject = {
            id: subject.id,
            subject: new WeakRef(subject),
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
        };

        this.#trackedSubjects.set(subject.id, tracked);
    }

    untrackSubject(subjectId: SubjectId): void {
        this.#trackedSubjects.delete(subjectId);
    }

    trackObserver(observer: IObserverSubscription): void {
        if (!this.#enableTracking || this.#isDisposed) {
            return;
        }

        const tracked: TrackedObserver = {
            id: observer.id,
            observer: new WeakRef(observer),
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
        };

        this.#trackedObservers.set(observer.id, tracked);
    }

    untrackObserver(observerId: ObserverId): void {
        this.#trackedObservers.delete(observerId);
    }

    getMemoryUsage(): {
        subjects: number;
        observers: number;
        replayBuffers: number;
        observerBuffers: number;
        totalMemoryBytes: number;
    } {
        let replayBufferSize = 0;
        let observerBufferSize = 0;
        let totalMemoryBytes = 0;

        for (const tracked of this.#trackedSubjects.values()) {
            const subject = tracked.subject.deref();
            if (subject) {
                tracked.lastAccessedAt = Date.now();
                const usage = subject.getMemoryUsage();
                replayBufferSize += usage[OBSERVER_MEMORY_SYMBOLS.replayBuffers.toString()] ?? 0;
                observerBufferSize +=
                    usage[OBSERVER_MEMORY_SYMBOLS.observationQueues.toString()] ?? 0;

                totalMemoryBytes += this.#estimateObjectSize(subject);
            }
        }

        for (const tracked of this.#trackedObservers.values()) {
            const observer = tracked.observer.deref();
            if (observer) {
                tracked.lastAccessedAt = Date.now();
                totalMemoryBytes += this.#estimateObjectSize(observer);
            }
        }

        return {
            subjects: this.#trackedSubjects.size,
            observers: this.#trackedObservers.size,
            replayBuffers: replayBufferSize,
            observerBuffers: observerBufferSize,
            totalMemoryBytes,
        };
    }

    async runGarbageCollection(): Promise<{
        subjectsCleared: number;
        observersCleared: number;
        memoryFreed: number;
    }> {
        if (this.#isDisposed) {
            return { subjectsCleared: 0, observersCleared: 0, memoryFreed: 0 };
        }

        const initialMemory = this.getMemoryUsage();
        let subjectsCleared = 0;
        let observersCleared = 0;

        for (const [subjectId, tracked] of this.#trackedSubjects.entries()) {
            const subject = tracked.subject.deref();
            if (!subject) {
                this.#trackedSubjects.delete(subjectId);
                subjectsCleared++;
            } else {
                const now = Date.now();
                const inactiveTime = now - tracked.lastAccessedAt;
                const fiveMinutes = 5 * 60 * 1000;

                if (
                    (subject.isCompleted() || !subject.getObserverCount()) &&
                    inactiveTime > fiveMinutes
                ) {
                    try {
                        subject.dispose();
                        this.#trackedSubjects.delete(subjectId);
                        subjectsCleared++;
                    } catch {
                        // ignore disposal errors
                    }
                }
            }
        }

        for (const [observerId, tracked] of this.#trackedObservers.entries()) {
            const observer = tracked.observer.deref();
            if (!observer || !observer.isActive) {
                this.#trackedObservers.delete(observerId);
                observersCleared++;
            }
        }

        if (global.gc) {
            global.gc();
        }

        const finalMemory = this.getMemoryUsage();
        const memoryFreed = Math.max(
            0,
            initialMemory.totalMemoryBytes - finalMemory.totalMemoryBytes
        );

        return {
            subjectsCleared,
            observersCleared,
            memoryFreed,
        };
    }

    dispose(): void {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;

        if (this.#gcIntervalId) {
            clearInterval(this.#gcIntervalId);
        }

        this.#trackedSubjects.clear();
        this.#trackedObservers.clear();
    }

    getTrackedSubjects(): ReadonlyArray<SubjectId> {
        return Array.from(this.#trackedSubjects.keys());
    }

    getTrackedObservers(): ReadonlyArray<ObserverId> {
        return Array.from(this.#trackedObservers.keys());
    }

    getSubjectAccessTime(subjectId: SubjectId): number | undefined {
        return this.#trackedSubjects.get(subjectId)?.lastAccessedAt;
    }

    getObserverAccessTime(observerId: ObserverId): number | undefined {
        return this.#trackedObservers.get(observerId)?.lastAccessedAt;
    }

    getHealthMetrics(): {
        deadSubjects: number;
        deadObservers: number;
        inactiveSubjects: number;
        inactiveObservers: number;
        totalTracked: number;
        memoryPressure: 'low' | 'medium' | 'high';
    } {
        let deadSubjects = 0;
        let inactiveSubjects = 0;
        const now = Date.now();
        const inactiveThreshold = 10 * 60 * 1000; // 10 minutes

        for (const tracked of this.#trackedSubjects.values()) {
            const subject = tracked.subject.deref();
            if (!subject) {
                deadSubjects++;
            } else if (now - tracked.lastAccessedAt > inactiveThreshold) {
                inactiveSubjects++;
            }
        }

        let deadObservers = 0;
        let inactiveObservers = 0;

        for (const tracked of this.#trackedObservers.values()) {
            const observer = tracked.observer.deref();
            if (!observer) {
                deadObservers++;
            } else if (now - tracked.lastAccessedAt > inactiveThreshold) {
                inactiveObservers++;
            }
        }

        const totalTracked = this.#trackedSubjects.size + this.#trackedObservers.size;
        const deadRatio = (deadSubjects + deadObservers) / Math.max(1, totalTracked);

        let memoryPressure: 'low' | 'medium' | 'high';
        if (deadRatio > 0.3) {
            memoryPressure = 'high';
        } else if (deadRatio > 0.1) {
            memoryPressure = 'medium';
        } else {
            memoryPressure = 'low';
        }

        return {
            deadSubjects,
            deadObservers,
            inactiveSubjects,
            inactiveObservers,
            totalTracked,
            memoryPressure,
        };
    }

    async #runAutomaticGc(thresholdMb: number): Promise<void> {
        const usage = this.getMemoryUsage();
        const usageMb = usage.totalMemoryBytes / (1024 * 1024);

        if (usageMb > thresholdMb) {
            await this.runGarbageCollection();
        }
    }

    #estimateObjectSize(obj: any): number {
        let size = 0;

        if (obj === null || obj === undefined) {
            return 0;
        }

        switch (typeof obj) {
            case 'boolean':
                return 4;
            case 'number':
                return 8;
            case 'string':
                return obj.length * 2;
            case 'object':
                if (obj instanceof Array) {
                    size = 24;
                    for (const item of obj) {
                        size += this.#estimateObjectSize(item);
                    }
                } else if (obj instanceof Map) {
                    size = 32;
                    for (const [key, value] of obj) {
                        size += this.#estimateObjectSize(key);
                        size += this.#estimateObjectSize(value);
                    }
                } else if (obj instanceof Set) {
                    size = 32;
                    for (const item of obj) {
                        size += this.#estimateObjectSize(item);
                    }
                } else {
                    size = 16;
                    for (const key in obj) {
                        if (obj.hasOwnProperty(key)) {
                            size += key.length * 2;
                            size += this.#estimateObjectSize(obj[key]);
                        }
                    }
                }
                break;
            case 'function':
                return 100;
            default:
                return 8;
        }

        return size;
    }
}
