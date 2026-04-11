import { SystemPhase } from '@axrone/ecs-runtime';
import type { GameLoopSystem } from '@axrone/game-loop';
import type { SceneLoopState } from './types';

export interface SceneLoopBridgeHost {
    executePhase(phase: SystemPhase, delta: number): void;
    fixedUpdateActors(delta: number): void;
    updateActors(delta: number): void;
    lateUpdateActors(delta: number): void;
    render(delta: number): void;
}

export const createSceneLoopSystems = (
    host: SceneLoopBridgeHost
): readonly GameLoopSystem<SceneLoopState>[] => [
    {
        id: 'scene.pre-update',
        beforeUpdate: (context) => {
            host.executePhase(SystemPhase.PreUpdate, context.delta);
        },
    },
    {
        id: 'scene.fixed-update',
        fixedUpdate: (context) => {
            host.fixedUpdateActors(context.fixedDelta);
        },
    },
    {
        id: 'scene.update',
        update: (context) => {
            host.updateActors(context.delta);
            host.executePhase(SystemPhase.Update, context.delta);
            host.lateUpdateActors(context.delta);
            host.executePhase(SystemPhase.PostUpdate, context.delta);
        },
    },
    {
        id: 'scene.render',
        render: (context) => {
            host.executePhase(SystemPhase.Render, context.delta);
            host.render(context.delta);
        },
    },
];
