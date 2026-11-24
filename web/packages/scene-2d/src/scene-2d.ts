import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { type EntityConfig } from '@axrone/ecs-runtime';
import type { SceneEntityRuntime, SceneOptions } from '@axrone/scene-runtime';
import { SceneAssetFacade } from '@axrone/scene-runtime/scene-asset-facade';
import type { CameraConfig } from '@axrone/scene-runtime/scene-camera';
import {
    type SpriteAnimatorConfig,
    type SpriteMaskConfig,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-2d-support';
import { Scene2DActorRuntime, type Scene2DBulkSpriteConfig } from './scene-2d-entity-runtime';
import type { Scene2DAnimationRuntime } from './scene-2d-animation-runtime';

/**
 * Optional animated/mask wiring for the base 2D scene.
 *
 * Root `Scene2D` injects `createScene2DAnimationRuntime`; lean scenes omit it
 * so `SpriteAnimator`/`SpriteMask` never enter their module graph.
 */
export interface Scene2DActorComposition<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly createAnimation?: (
        entities: SceneEntityRuntime<R>
    ) => Scene2DAnimationRuntime<R>;
}

/**
 * Base 2D scene facade. Installs no default profile and no runtime
 * composition; root and lean entries supply their own through subclasses.
 */
export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _entitys2d: Scene2DActorRuntime<R>;

    constructor(
        options: SceneOptions<R> = {},
        entitysComposition: Scene2DActorComposition<R> = {}
    ) {
        super(options);
        const entities = this._kernel.entities;
        this._entitys2d = new Scene2DActorRuntime({
            entities,
            // The bulk sprite path resolves one archetype for the whole batch.
            world: this._kernel.world,
            animation: entitysComposition.createAnimation?.(entities),
        });
    }

    createCameraEntity(
        entityConfig: EntityConfig = {},
        cameraConfig: CameraConfig = {}
    ) {
        this.assertNotDisposed();
        return this._entitys2d.createCameraEntity(entityConfig, cameraConfig);
    }

    createSpriteEntity(
        entityConfig: EntityConfig = {},
        spriteConfig: SpriteRendererConfig = {}
    ) {
        this.assertNotDisposed();
        return this._entitys2d.createSpriteEntity(entityConfig, spriteConfig);
    }

    /**
     * Creates many sprite entities through the single-archetype bulk path.
     * Prefer this over a `createSpriteEntity` loop for large sprite fields.
     */
    createSpriteEntities(configs: readonly Scene2DBulkSpriteConfig[]) {
        this.assertNotDisposed();
        return this._entitys2d.createSpriteEntities(configs);
    }

    createAnimatedSpriteEntity(
        entityConfig: EntityConfig = {},
        spriteConfig: SpriteRendererConfig = {},
        animatorConfig: SpriteAnimatorConfig = {}
    ) {
        this.assertNotDisposed();
        return this._entitys2d.createAnimatedSpriteEntity(
            entityConfig,
            spriteConfig,
            animatorConfig
        );
    }

    createMaskEntity(
        entityConfig: EntityConfig = {},
        maskConfig: SpriteMaskConfig = {}
    ) {
        this.assertNotDisposed();
        return this._entitys2d.createMaskEntity(entityConfig, maskConfig);
    }
}