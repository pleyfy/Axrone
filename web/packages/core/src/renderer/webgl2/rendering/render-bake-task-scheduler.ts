import { RenderBakeTaskError } from './errors';
import type { RenderBakeTaskState, RenderLightBakeTask } from './types';

export interface ScheduledRenderBakeTask<TPayload = unknown> extends RenderLightBakeTask<TPayload> {
    state: RenderBakeTaskState;
    priority: number;
    retries: number;
    maxRetries: number;
    createdAt: number;
    scheduledAt: number;
    lastError: string | null;
}

export interface RenderBakeTaskSelectionSettings {
    readonly enabled: boolean;
    readonly maxTasksPerFrame: number;
    readonly budgetMs: number;
    readonly throttleFrames: number;
}

const EMPTY_RENDER_BAKE_TASKS = Object.freeze([]) as readonly ScheduledRenderBakeTask[];

const RENDER_BAKE_TASK_COST: Readonly<Record<ScheduledRenderBakeTask['type'], number>> =
    Object.freeze({
        lightmap: 0.28,
        probe: 0.18,
        'irradiance-cache': 0.22,
    });

export const getRenderBakeTaskCost = (
    task: Pick<ScheduledRenderBakeTask, 'type'>
): number => RENDER_BAKE_TASK_COST[task.type];

export const sumRenderBakeTaskCost = (
    tasks: readonly Pick<ScheduledRenderBakeTask, 'type'>[]
): number => tasks.reduce((sum, task) => sum + getRenderBakeTaskCost(task), 0);

export class RenderBakeTaskScheduler {
    private readonly _tasks = new Map<string, ScheduledRenderBakeTask>();

    constructor(private readonly _defaultMaxRetries: number) {}

    get size(): number {
        return this._tasks.size;
    }

    enqueue<TPayload = unknown>(task: RenderLightBakeTask<TPayload>): void {
        const now = Date.now();
        this._tasks.set(task.id, {
            ...task,
            state: task.state ?? 'queued',
            priority: task.priority ?? 0,
            retries: task.retries ?? 0,
            maxRetries: task.maxRetries ?? this._defaultMaxRetries,
            createdAt: task.createdAt ?? now,
            scheduledAt: task.scheduledAt ?? 0,
            lastError: task.lastError ?? null,
        });
    }

    list(): readonly RenderLightBakeTask[] {
        return Object.freeze(Array.from(this._tasks.values()).map((task) => ({ ...task })));
    }

    get(id: string): RenderLightBakeTask | null {
        const task = this._tasks.get(id);
        return task ? { ...task } : null;
    }

    complete(id: string, locale: string): void {
        const task = this._tasks.get(id);
        if (!task) {
            throw new RenderBakeTaskError(locale, { id });
        }

        task.state = 'completed';
        task.lastError = null;
    }

    fail(id: string, error: string, locale: string): void {
        const task = this._tasks.get(id);
        if (!task) {
            throw new RenderBakeTaskError(locale, { id });
        }

        task.retries += 1;
        task.lastError = error;
        task.state = task.retries > task.maxRetries ? 'failed' : 'queued';
    }

    remove(id: string): boolean {
        return this._tasks.delete(id);
    }

    clear(): void {
        this._tasks.clear();
    }

    select(
        frame: number,
        settings: RenderBakeTaskSelectionSettings
    ): readonly ScheduledRenderBakeTask[] {
        if (!settings.enabled || this._tasks.size === 0) {
            return EMPTY_RENDER_BAKE_TASKS;
        }

        const candidates = Array.from(this._tasks.values())
            .filter((task) => {
                if (task.state === 'completed' || task.state === 'failed') {
                    return false;
                }

                if (
                    task.scheduledAt > 0 &&
                    frame - task.scheduledAt < settings.throttleFrames
                ) {
                    return false;
                }

                return true;
            })
            .sort(
                (a, b) =>
                    b.priority - a.priority ||
                    a.retries - b.retries ||
                    a.createdAt - b.createdAt
            );

        const selected: ScheduledRenderBakeTask[] = [];
        let spentBudget = 0;

        for (
            let i = 0;
            i < candidates.length && selected.length < settings.maxTasksPerFrame;
            i += 1
        ) {
            const task = candidates[i]!;
            const taskCost = getRenderBakeTaskCost(task);
            if (
                settings.budgetMs > 0 &&
                selected.length > 0 &&
                spentBudget + taskCost > settings.budgetMs
            ) {
                continue;
            }

            spentBudget += taskCost;
            task.state = 'running';
            task.scheduledAt = frame;
            selected.push(task);
        }

        return Object.freeze(selected);
    }
}