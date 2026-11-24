import type { EntityId } from '@axrone/ecs-runtime';

type SceneEntityLifecyclePhase = 'fixedUpdate' | 'update' | 'lateUpdate';

export interface SceneEntityLifecycleRunnerOptions {
    readonly getEntitys: () => readonly EntityId[];
}

export class SceneEntityLifecycleRunner {
    constructor(private readonly _options: SceneEntityLifecycleRunnerOptions) {}

    fixedUpdate(deltaSeconds: number): void {
        this._runPhase('fixedUpdate', deltaSeconds);
    }

    update(deltaSeconds: number): void {
        this._runPhase('update', deltaSeconds);
    }

    lateUpdate(deltaSeconds: number): void {
        this._runPhase('lateUpdate', deltaSeconds);
    }

    private _runPhase(phase: SceneEntityLifecyclePhase, deltaSeconds: number): void {
        const entities = this._options.getEntitys();
        for (let index = 0; index < entities.length; index += 1) {
            entities[index]![phase](deltaSeconds);
        }
    }
}
