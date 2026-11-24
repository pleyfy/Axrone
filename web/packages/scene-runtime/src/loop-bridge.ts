import { SystemPhase } from '@axrone/ecs-runtime';
import type { GameLoopSystem } from '@axrone/game-loop';
import type { SceneLoopState } from './types';

export interface SceneLoopBridgeHost {
    executePhase(phase: SystemPhase, delta: number): void;
    fixedUpdateEntities(delta: number): void;
    updateEntities(delta: number): void;
    lateUpdateEntities(delta: number): void;
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
            host.fixedUpdateEntities(context.fixedDelta);
        },
    },
    {
        id: 'scene.update',
        update: (context) => {
            host.updateEntities(context.delta);
            host.executePhase(SystemPhase.Update, context.delta);
            host.lateUpdateEntities(context.delta);
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
