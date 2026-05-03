import { Queue } from '@axrone/memory';
import { performance } from './performance';

declare const __taskBrand: unique symbol;
declare const __schedulerBrand: unique symbol;

export type TaskId = number & { readonly [__taskBrand]: true };
export type SchedulerId = string & { readonly [__schedulerBrand]: true };

export const enum TaskPriority {
    IMMEDIATE = 0,
    HIGH = 1,
    NORMAL = 2,
    LOW = 3,
    IDLE = 4,
}

export const enum TaskState {
    PENDING = 0,
    RUNNING = 1,
    COMPLETED = 2,
    FAILED = 3,
    CANCELLED = 4,
}

export interface ITaskMetrics {
    readonly id: TaskId;
    readonly priority: TaskPriority;
    readonly state: TaskState;
    readonly queuedAt: number;
    readonly startedAt?: number;
    readonly completedAt?: number;
    readonly executionTime?: number;
    readonly retryCount: number;
}

export interface ISchedulerOptions {
    readonly concurrencyLimit?: number;
    readonly maxQueueSize?: number;
    readonly enableMetrics?: boolean;
    readonly enableRetries?: boolean;
    readonly maxRetries?: number;
    readonly retryDelay?: number;
    readonly taskTimeout?: number;
    readonly gcIntervalMs?: number;
    readonly name?: string;
}

export interface ISchedulerStats {
    readonly name: string;
    readonly activeCount: number;
    readonly queuedCount: number;
    readonly completedCount: number;
    readonly failedCount: number;
    readonly totalProcessed: number;
    readonly averageExecutionTime: number;
    readonly throughputPerSecond: number;
    readonly memoryUsage: number;
}

interface ITask<T = unknown> {
    readonly id: TaskId;
    readonly fn: () => Promise<T>;
    readonly priority: TaskPriority;
    readonly resolve: (value: T) => void;
    readonly reject: (error: Error) => void;
    readonly queuedAt: number;
    readonly timeout?: number;
    retryCount: number;
    readonly maxRetries: number;
    startedAt?: number;
    timeoutId?: ReturnType<typeof setTimeout>;
    state: TaskState;
}

interface MutableTaskMetrics {
    id: TaskId;
    priority: TaskPriority;
    state: TaskState;
    queuedAt: number;
    startedAt?: number;
    completedAt?: number;
    executionTime?: number;
    retryCount: number;
}

const TASK_PRIORITY_ORDER = [
    TaskPriority.IMMEDIATE,
    TaskPriority.HIGH,
    TaskPriority.NORMAL,
    TaskPriority.LOW,
    TaskPriority.IDLE,
] as const;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === Infinity) {
        return Infinity;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.trunc(value));
}

function normalizeConcurrencyLimit(value: number | undefined, fallback: number): number {
    if (value === Infinity || fallback === Infinity) {
        return value === undefined ? fallback : value;
    }

    return normalizePositiveInteger(value, fallback);
}

function normalizeDuration(value: number | undefined, fallback: number): number {
    if (value === Infinity) {
        return 0;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.trunc(value));
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export class EventScheduler {
    private readonly id: SchedulerId;
    private readonly concurrencyLimit: number;
    private readonly maxQueueSize: number;
    private readonly enableMetrics: boolean;
    private readonly enableRetries: boolean;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private readonly taskTimeout: number;
    private readonly gcIntervalMs: number;
    private readonly name: string;

    private readonly taskQueues: Record<TaskPriority, Queue<ITask<any>>> = {
        [TaskPriority.IMMEDIATE]: new Queue<ITask<any>>(),
        [TaskPriority.HIGH]: new Queue<ITask<any>>(),
        [TaskPriority.NORMAL]: new Queue<ITask<any>>(),
        [TaskPriority.LOW]: new Queue<ITask<any>>(),
        [TaskPriority.IDLE]: new Queue<ITask<any>>(),
    };
    private readonly activeTasks = new Map<TaskId, ITask<any>>();
    private readonly taskMetrics = new Map<TaskId, MutableTaskMetrics>();
    private readonly drainWaiters: Array<() => void> = [];

    private taskIdCounter = 0;
    private queuedCountValue = 0;
    private delayedRetryCount = 0;
    private completedCount = 0;
    private failedCount = 0;
    private totalExecutionTime = 0;
    private lastThroughputCheck = performance.now();
    private throughputCounter = 0;

    private gcIntervalId?: ReturnType<typeof setInterval>;
    private isDisposed = false;

    constructor(options: ISchedulerOptions = {}) {
        this.id =
            `scheduler_${Date.now()}_${Math.random().toString(36).substring(2, 11)}` as SchedulerId;
        this.concurrencyLimit = normalizeConcurrencyLimit(options.concurrencyLimit, Infinity);
        this.maxQueueSize = normalizePositiveInteger(options.maxQueueSize, 10000);
        this.enableMetrics = options.enableMetrics ?? true;
        this.enableRetries = options.enableRetries ?? false;
        this.maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? 3));
        this.retryDelay = normalizeDuration(options.retryDelay, 1000);
        this.taskTimeout = normalizeDuration(options.taskTimeout, 30000);
        this.gcIntervalMs = Math.max(1000, normalizeDuration(options.gcIntervalMs, 60000));
        this.name = options.name ?? `EventScheduler-${this.id}`;

        if (this.gcIntervalMs > 0) {
            this.startGarbageCollection();
        }
    }

    get activeCount(): number {
        return this.activeTasks.size;
    }

    get queuedCount(): number {
        return this.queuedCountValue;
    }

    get isAtCapacity(): boolean {
        return this.queuedCountValue >= this.maxQueueSize;
    }

    get disposed(): boolean {
        return this.isDisposed;
    }

    schedule<T>(
        fn: () => Promise<T>,
        priority: TaskPriority = TaskPriority.NORMAL,
        timeout?: number
    ): Promise<T> {
        if (this.isDisposed) {
            return Promise.reject(new Error('Scheduler has been disposed'));
        }

        if (this.isAtCapacity) {
            return Promise.reject(new Error(`Task queue is full (${this.maxQueueSize})`));
        }

        let _resolve!: (value: T) => void;
        let _reject!: (error: Error) => void;

        const promise: Promise<T> = new Promise<T>((res, rej) => {
            _resolve = res;
            _reject = rej;
        });

        const taskId = this.generateTaskId();
        const now = performance.now();

        const task: ITask<T> = {
            id: taskId,
            fn,
            priority,
            resolve: _resolve,
            reject: _reject,
            queuedAt: now,
            timeout: timeout ?? this.taskTimeout,
            retryCount: 0,
            maxRetries: this.enableRetries ? this.maxRetries : 0,
            state: TaskState.PENDING,
        };

        promise.catch(() => {});

        if (this.enableMetrics) {
            this.taskMetrics.set(taskId, {
                id: taskId,
                priority,
                state: TaskState.PENDING,
                queuedAt: now,
                retryCount: 0,
            });
        }

        try {
            if (this.activeCount < this.concurrencyLimit && this.queuedCountValue === 0) {
                this.executeTask(task);
            } else {
                this.enqueueTask(task);
                this.processQueue();
            }
        } catch (error) {
            _reject(new Error('Failed to enqueue task'));
            return promise;
        }

        return promise;
    }

    trySchedule<T>(
        fn: () => Promise<T>,
        priority: TaskPriority = TaskPriority.NORMAL,
        timeout?: number
    ): Promise<T> | null {
        if (this.isDisposed || this.isAtCapacity) {
            return null;
        }

        try {
            return this.schedule(fn, priority, timeout);
        } catch {
            return null;
        }
    }

    async drain(): Promise<void> {
        if (this.isDisposed || this.isIdle()) {
            return;
        }

        await new Promise<void>((resolve) => {
            this.drainWaiters.push(resolve);
        });
    }

    getStats(): ISchedulerStats {
        const now = performance.now();
        const timeDiff = now - this.lastThroughputCheck;
        const throughput = timeDiff > 0 ? (this.throughputCounter * 1000) / timeDiff : 0;

        return {
            name: this.name,
            activeCount: this.activeCount,
            queuedCount: this.queuedCount,
            completedCount: this.completedCount,
            failedCount: this.failedCount,
            totalProcessed: this.completedCount + this.failedCount,
            averageExecutionTime:
                this.completedCount > 0 ? this.totalExecutionTime / this.completedCount : 0,
            throughputPerSecond: throughput,
            memoryUsage: this.calculateMemoryUsage(),
        };
    }

    getTaskMetrics(taskId: TaskId): ITaskMetrics | null {
        const metrics = this.taskMetrics.get(taskId);
        return metrics ? { ...metrics } : null;
    }

    getAllTaskMetrics(): ReadonlyArray<ITaskMetrics> {
        return Array.from(this.taskMetrics.values(), (metrics) => ({ ...metrics }));
    }

    clearMetrics(): void {
        this.taskMetrics.clear();
        this.completedCount = 0;
        this.failedCount = 0;
        this.totalExecutionTime = 0;
        this.throughputCounter = 0;
        this.lastThroughputCheck = performance.now();
    }

    dispose(): void {
        if (this.isDisposed) return;

        this.isDisposed = true;

        if (this.gcIntervalId) {
            clearInterval(this.gcIntervalId);
            this.gcIntervalId = undefined;
        }

        this.activeTasks.forEach((task) => {
            task.state = TaskState.CANCELLED;
            if (task.timeoutId) {
                clearTimeout(task.timeoutId);
            }
            try {
                task.reject(new Error('Scheduler disposed'));
            } catch {}
        });

        for (const priority of TASK_PRIORITY_ORDER) {
            const queue = this.taskQueues[priority];
            for (;;) {
                const task = queue.tryDequeue();
                if (!task) {
                    break;
                }

                task.state = TaskState.CANCELLED;
                try {
                    task.reject(new Error('Scheduler disposed'));
                } catch {}
            }
        }

        this.queuedCountValue = 0;
        this.delayedRetryCount = 0;
        this.activeTasks.clear();
        this.taskMetrics.clear();
        this.resolveDrainWaiters();
    }

    async gracefulDispose(): Promise<void> {
        if (this.isDisposed) return;

        await this.drain();

        this.dispose();
    }

    private processQueue(): void {
        if (this.isDisposed) return;

        while (this.activeCount < this.concurrencyLimit) {
            const task = this.dequeueTask();
            if (!task) break;

            this.executeTask(task);
        }

        this.resolveDrainWaitersIfIdle();
    }

    private async executeTask<T>(task: ITask<T>): Promise<void> {
        const now = performance.now();
        task.startedAt = now;
        task.state = TaskState.RUNNING;

        this.activeTasks.set(task.id, task);

        if (this.enableMetrics) {
            const metrics = this.taskMetrics.get(task.id);
            if (metrics) {
                (metrics as any).state = TaskState.RUNNING;
                (metrics as any).startedAt = now;
            }
        }

        if (task.timeout && task.timeout > 0) {
            task.timeoutId = setTimeout(() => {
                this.handleTaskTimeout(task);
            }, task.timeout);
        }

        try {
            const result = await task.fn();
            this.handleTaskSuccess(task, result, now);
        } catch (error) {
            this.handleTaskError(task, toError(error), now);
        }
    }

    private handleTaskSuccess<T>(task: ITask<T>, result: T, startTime: number): void {
        if (!this.activeTasks.has(task.id) || task.state !== TaskState.RUNNING) {
            return;
        }

        const executionTime = performance.now() - startTime;

        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = undefined;
        }

        this.activeTasks.delete(task.id);
        task.state = TaskState.COMPLETED;
        this.completedCount++;
        this.totalExecutionTime += executionTime;
        this.throughputCounter++;

        if (this.enableMetrics) {
            const metrics = this.taskMetrics.get(task.id);
            if (metrics) {
                (metrics as any).state = TaskState.COMPLETED;
                (metrics as any).completedAt = performance.now();
                (metrics as any).executionTime = executionTime;
            }
        }

        task.resolve(result);
        this.processQueue();
    }

    private handleTaskError<T>(task: ITask<T>, error: Error, startTime: number): void {
        if (!this.activeTasks.has(task.id) || task.state !== TaskState.RUNNING) {
            return;
        }

        const executionTime = performance.now() - startTime;

        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
            task.timeoutId = undefined;
        }

        this.activeTasks.delete(task.id);

        if (this.enableRetries && task.retryCount < task.maxRetries) {
            task.retryCount++;
            task.state = TaskState.PENDING;

            if (this.enableMetrics) {
                const metrics = this.taskMetrics.get(task.id);
                if (metrics) {
                    metrics.retryCount = task.retryCount;
                    metrics.state = TaskState.PENDING;
                }
            }

            this.delayedRetryCount++;
            setTimeout(() => {
                this.delayedRetryCount--;

                if (this.isDisposed) {
                    task.reject(error);
                    this.resolveDrainWaitersIfIdle();
                    return;
                }

                if (this.activeCount < this.concurrencyLimit && this.queuedCountValue === 0) {
                    this.executeTask(task);
                    return;
                }

                if (this.isAtCapacity) {
                    task.reject(error);
                } else {
                    this.enqueueTask(task);
                    this.processQueue();
                }
            }, this.retryDelay);

            return;
        }

        task.state = TaskState.FAILED;
        this.failedCount++;
        this.totalExecutionTime += executionTime;
        this.throughputCounter++;

        if (this.enableMetrics) {
            const metrics = this.taskMetrics.get(task.id);
            if (metrics) {
                metrics.state = TaskState.FAILED;
                metrics.completedAt = performance.now();
                metrics.executionTime = executionTime;
            }
        }

        task.reject(error);
        this.processQueue();
    }

    private handleTaskTimeout<T>(task: ITask<T>): void {
        if (!this.activeTasks.has(task.id)) return;

        const error = new Error(`Task ${task.id} timed out after ${task.timeout}ms`);
        this.handleTaskError(task, error, task.startedAt ?? performance.now());
    }

    private generateTaskId(): TaskId {
        return ++this.taskIdCounter as TaskId;
    }

    private startGarbageCollection(): void {
        this.gcIntervalId = setInterval(() => {
            this.runGarbageCollection();
        }, this.gcIntervalMs);

        if (typeof this.gcIntervalId === 'object' && 'unref' in this.gcIntervalId) {
            (this.gcIntervalId as any).unref();
        }
    }

    private runGarbageCollection(): void {
        if (this.isDisposed) return;

        const now = performance.now();
        const cutoffTime = now - this.gcIntervalMs * 2;

        this.taskMetrics.forEach((metrics, taskId) => {
            if (metrics.completedAt && metrics.completedAt < cutoffTime) {
                this.taskMetrics.delete(taskId);
            }
        });

        if (now - this.lastThroughputCheck > 60000) {
            this.throughputCounter = 0;
            this.lastThroughputCheck = now;
        }
    }

    private calculateMemoryUsage(): number {
        const taskSize = 160;
        const metricsSize = 80;

        return (
            this.activeTasks.size * taskSize +
            this.queuedCountValue * taskSize +
            this.delayedRetryCount * 32 +
            this.taskMetrics.size * metricsSize
        );
    }

    private enqueueTask(task: ITask<any>): void {
        this.taskQueues[task.priority].enqueue(task);
        this.queuedCountValue++;
    }

    private dequeueTask(): ITask<any> | undefined {
        for (const priority of TASK_PRIORITY_ORDER) {
            const task = this.taskQueues[priority].tryDequeue();
            if (task) {
                this.queuedCountValue--;
                return task;
            }
        }

        return undefined;
    }

    private isIdle(): boolean {
        return this.activeTasks.size === 0 && this.queuedCountValue === 0 && this.delayedRetryCount === 0;
    }

    private resolveDrainWaitersIfIdle(): void {
        if (this.isIdle()) {
            this.resolveDrainWaiters();
        }
    }

    private resolveDrainWaiters(): void {
        if (this.drainWaiters.length === 0) {
            return;
        }

        const waiters = this.drainWaiters.splice(0, this.drainWaiters.length);
        for (const resolve of waiters) {
            resolve();
        }
    }
}
