import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type { ActorConfig } from '@axrone/ecs-runtime';
import {
    TilemapCollider2D,
    TilemapRenderer,
    type SceneTilemapRenderRuntimeLike,
    type TilemapCollider2DConfig,
    type TilemapRendererConfig,
} from '@axrone/scene-runtime/scene-tilemap';
import type { SceneRuntimeComposition } from '@axrone/scene-runtime';
import { requireRegisteredComponent } from '@axrone/scene-runtime/scene-capability-guard';
import type { Scene2D } from './scene-2d';

export interface TilemapActorConfig {
    readonly actor?: ActorConfig;
    readonly renderer?: TilemapRendererConfig;
    readonly collider?: TilemapCollider2DConfig;
}

/** Composition fragment that opts a scene into tilemap rendering. */
export const createTilemapRenderComposition = <
    R extends ComponentRegistry = Record<string, never>,
>(
    runtimes: () => readonly SceneTilemapRenderRuntimeLike[]
): SceneRuntimeComposition<R> => ({
    createTilemapRuntimes: runtimes,
});

/**
 * Opt-in tilemap actor helper. Mirrors `createSpriteActor`: the components must
 * already be registered through `createTilemapSceneRegistry()`.
 */
export const createTilemapActor = <R extends ComponentRegistry = Record<string, never>>(
    scene: Scene2D<R>,
    config: TilemapActorConfig = {}
) => {
    requireRegisteredComponent(
        scene,
        TilemapRenderer,
        'tilemap actor creation requires the TilemapRenderer component; compose createTilemapSceneRegistry()'
    );
    const actor = scene.createActor(config.actor);
    actor.addComponent(TilemapRenderer, config.renderer ?? {});
    if (config.collider !== undefined) {
        requireRegisteredComponent(
            scene,
            TilemapCollider2D,
            'tilemap collider creation requires the TilemapCollider2D component'
        );
        actor.addComponent(TilemapCollider2D, config.collider);
    }
    return actor;
};
