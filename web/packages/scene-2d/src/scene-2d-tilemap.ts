import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type { EntityConfig } from '@axrone/ecs-runtime';
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

export interface TilemapEntityConfig {
    readonly entity?: EntityConfig;
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
 * Opt-in tilemap entity helper. Mirrors `createSpriteEntity`: the components must
 * already be registered through `createTilemapSceneRegistry()`.
 */
export const createTilemapEntity = <R extends ComponentRegistry = Record<string, never>>(
    scene: Scene2D<R>,
    config: TilemapEntityConfig = {}
) => {
    requireRegisteredComponent(
        scene,
        TilemapRenderer,
        'tilemap entity creation requires the TilemapRenderer component; compose createTilemapSceneRegistry()'
    );
    const entity = scene.createEntity(config.entity);
    entity.addComponent(TilemapRenderer, config.renderer ?? {});
    if (config.collider !== undefined) {
        requireRegisteredComponent(
            scene,
            TilemapCollider2D,
            'tilemap collider creation requires the TilemapCollider2D component'
        );
        entity.addComponent(TilemapCollider2D, config.collider);
    }
    return entity;
};
