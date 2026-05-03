import { SubjectId, ObserverId, IObservableSubject, OBSERVER_MEMORY_SYMBOLS } from './definition';
import { IMemoryManager, IObserverSubscription } from './interfaces';

interface TrackedSubject {
    readonly id: SubjectId;
    readonly subject: WeakRef<IObservableSubject<any>>;
    readonly createdAt: number;
    lastAccessedAt: number;
}

interface TrackedObserver {
    readonly id: ObserverId;
    readonly observer: WeakRef<IObserverSubscription>;
    readonly createdAt: number;
    lastAccessedAt: number;
}

const SUBJECT_OVERHEAD_BYTES = 256;
const OBSERVER_OVERHEAD_BYTES = 128;
const BUFFER_ENTRY_BYTES = 32;

const runtimeGc = (): void => {
    const maybeGc = (globalThis as { gc?: () => void }).gc;
    if (typeof maybeGc === 'function') {
        maybeGc();
    }
};

export class MemoryManager implements IMemoryManager {
    readonly #trackedSubjects = new Map<SubjectId, TrackedSubject>();
    readonly #trackedObservers = new Map<ObserverId, TrackedObserver>();
    readonly #gcIntervalId?: ReturnType<typeof setInterval>;
    readonly #enableTracking: boolean;
    readonly #autoGcThresholdMb: number;
    #isDisposed = false;

    constructor(
        options: {
            enableTracking?: boolean;
            gcIntervalMs?: number;
            autoGcThresholdMb?: number;
        } = {}
    ) {
        this.#enableTracking = options.enableTracking ?? true;
        this.#autoGcThresholdMb = options.autoGcThresholdMb ?? 50;

        if (this.#enableTracking && (options.gcIntervalMs ?? 60000) > 0 && typeof WeakRef === 'function') {
            this.#gcIntervalId = setInterval(() => {
                void this.#runAutomaticGc();
            }, options.gcIntervalMs ?? 60000);
        }
    }

    trackSubject(subject: IObservableSubject<any>): void {
        if (!this.#enableTracking || this.#isDisposed || typeof WeakRef !== 'function') {
            return;
        }

        const now = Date.now();
        this.#trackedSubjects.set(subject.id, {
            id: subject.id,
            subject: new WeakRef(subject),
            createdAt: now,
            lastAccessedAt: now,
        });
    }

    untrackSubject(subjectId: SubjectId): void {
        this.#trackedSubjects.delete(subjectId);
    }

    trackObserver(observer: IObserverSubscription): void {
        if (!this.#enableTracking || this.#isDisposed || typeof WeakRef !== 'function') {
            return;
        }

        const now = Date.now();
        this.#trackedObservers.set(observer.id, {
            id: observer.id,
            observer: new WeakRef(observer),
            createdAt: now,
            lastAccessedAt: now,
        });
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
        let replayBuffers = 0;
        let observerBuffers = 0;
        let totalMemoryBytes = 0;

        for (const tracked of this.#trackedSubjects.values()) {
            const subject = tracked.subject.deref();
            if (!subject) {
                continue;
            }

            tracked.lastAccessedAt = Date.now();
            const usage = subject.getMemoryUsage();
            const replayEntries = usage[OBSERVER_MEMORY_SYMBOLS.replayBuffers.toString()] ?? 0;
            const observerEntries = usage[OBSERVER_MEMORY_SYMBOLS.observationQueues.toString()] ?? 0;

            replayBuffers += replayEntries;
            observerBuffers += observerEntries;
            totalMemoryBytes +=
                SUBJECT_OVERHEAD_BYTES +
                replayEntries * BUFFER_ENTRY_BYTES +
                observerEntries * BUFFER_ENTRY_BYTES;
        }

        for (const tracked of this.#trackedObservers.values()) {
            const observer = tracked.observer.deref();
            if (!observer) {
                continue;
            }

            tracked.lastAccessedAt = Date.now();
            totalMemoryBytes += OBSERVER_OVERHEAD_BYTES;
        }

        return {
            subjects: this.#trackedSubjects.size,
            observers: this.#trackedObservers.size,
            replayBuffers,
            observerBuffers,
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

        const initialMemory = this.getMemoryUsage().totalMemoryBytes;
        let subjectsCleared = 0;
        let observersCleared = 0;
        const now = Date.now();
        const idleThresholdMs = 5 * 60 * 1000;

        for (const [subjectId, tracked] of this.#trackedSubjects) {
            const subject = tracked.subject.deref();
            if (!subject) {
                this.#trackedSubjects.delete(subjectId);
                subjectsCleared++;
                continue;
            }

            if (
                (subject.isCompleted() || subject.getObserverCount() === 0) &&
                now - tracked.lastAccessedAt > idleThresholdMs
            ) {
                try {
                    subject.dispose();
                } catch {}

                this.#trackedSubjects.delete(subjectId);
                subjectsCleared++;
            }
        }

        for (const [observerId, tracked] of this.#trackedObservers) {
            const observer = tracked.observer.deref();
            if (!observer || !observer.isActive) {
                this.#trackedObservers.delete(observerId);
                observersCleared++;
            }
        }

        runtimeGc();

        const finalMemory = this.getMemoryUsage().totalMemoryBytes;

        return {
            subjectsCleared,
            observersCleared,
            memoryFreed: Math.max(0, initialMemory - finalMemory),
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
        return [...this.#trackedSubjects.keys()];
    }

    getTrackedObservers(): ReadonlyArray<ObserverId> {
        return [...this.#trackedObservers.keys()];
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
        let deadObservers = 0;
        let inactiveSubjects = 0;
        let inactiveObservers = 0;
        const now = Date.now();
        const inactivityThreshold = 10 * 60 * 1000;

        for (const tracked of this.#trackedSubjects.values()) {
            const subject = tracked.subject.deref();
            if (!subject) {
                deadSubjects++;
            } else if (now - tracked.lastAccessedAt > inactivityThreshold) {
                inactiveSubjects++;
            }
        }

        for (const tracked of this.#trackedObservers.values()) {
            const observer = tracked.observer.deref();
            if (!observer) {
                deadObservers++;
            } else if (now - tracked.lastAccessedAt > inactivityThreshold) {
                inactiveObservers++;
            }
        }

        const totalTracked = this.#trackedSubjects.size + this.#trackedObservers.size;
        const usage = this.getMemoryUsage().totalMemoryBytes / (1024 * 1024);
        const deadRatio = (deadSubjects + deadObservers) / Math.max(1, totalTracked);
        const memoryPressure: 'low' | 'medium' | 'high' =
            usage > this.#autoGcThresholdMb || deadRatio > 0.3
                ? 'high'
                : usage > this.#autoGcThresholdMb * 0.5 || deadRatio > 0.1
                  ? 'medium'
                  : 'low';

        return {
            deadSubjects,
            deadObservers,
            inactiveSubjects,
            inactiveObservers,
            totalTracked,
            memoryPressure,
        };
    }

    async #runAutomaticGc(): Promise<void> {
        const usageMb = this.getMemoryUsage().totalMemoryBytes / (1024 * 1024);
        if (usageMb > this.#autoGcThresholdMb) {
            await this.runGarbageCollection();
        }
    }
}
