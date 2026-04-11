import type { Actor } from '@axrone/ecs-runtime';

type SceneActorLifecyclePhase = 'fixedUpdate' | 'update' | 'lateUpdate';

export interface SceneActorLifecycleRunnerOptions {
    readonly getActors: () => readonly Actor[];
}

export class SceneActorLifecycleRunner {
    constructor(private readonly _options: SceneActorLifecycleRunnerOptions) {}

    fixedUpdate(deltaSeconds: number): void {
        this._runPhase('fixedUpdate', deltaSeconds);
    }

    update(deltaSeconds: number): void {
        this._runPhase('update', deltaSeconds);
    }

    lateUpdate(deltaSeconds: number): void {
        this._runPhase('lateUpdate', deltaSeconds);
    }

    private _runPhase(phase: SceneActorLifecyclePhase, deltaSeconds: number): void {
        const actors = this._options.getActors();
        for (let index = 0; index < actors.length; index += 1) {
            actors[index]![phase](deltaSeconds);
        }
    }
}
