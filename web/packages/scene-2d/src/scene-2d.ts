import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { type ActorConfig } from '@axrone/ecs-runtime';
import type { SceneActorRuntime, SceneOptions } from '@axrone/scene-runtime';
import { SceneAssetFacade } from '@axrone/scene-runtime/scene-asset-facade';
import type { CameraConfig } from '@axrone/scene-runtime/scene-camera';
import {
    type SpriteAnimatorConfig,
    type SpriteMaskConfig,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-2d-support';
import { Scene2DActorRuntime, type Scene2DBulkSpriteConfig } from './scene-2d-actor-runtime';
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
        actors: SceneActorRuntime<R>
    ) => Scene2DAnimationRuntime<R>;
}

/**
 * Base 2D scene facade. Installs no default profile and no runtime
 * composition; root and lean entries supply their own through subclasses.
 */
export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _actors2d: Scene2DActorRuntime<R>;

    constructor(
        options: SceneOptions<R> = {},
        actorsComposition: Scene2DActorComposition<R> = {}
    ) {
        super(options);
        const actors = this._kernel.actors;
        this._actors2d = new Scene2DActorRuntime({
            actors,
            // The bulk sprite path resolves one archetype for the whole batch.
            world: this._kernel.world,
            animation: actorsComposition.createAnimation?.(actors),
        });
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createCameraActor(actorConfig, cameraConfig);
    }

    createSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createSpriteActor(actorConfig, spriteConfig);
    }

    /**
     * Creates many sprite actors through the single-archetype bulk path.
     * Prefer this over a `createSpriteActor` loop for large sprite fields.
     */
    createSpriteActors(configs: readonly Scene2DBulkSpriteConfig[]) {
        this.assertNotDisposed();
        return this._actors2d.createSpriteActors(configs);
    }

    createAnimatedSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {},
        animatorConfig: SpriteAnimatorConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createAnimatedSpriteActor(
            actorConfig,
            spriteConfig,
            animatorConfig
        );
    }

    createMaskActor(
        actorConfig: ActorConfig = {},
        maskConfig: SpriteMaskConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createMaskActor(actorConfig, maskConfig);
    }
}