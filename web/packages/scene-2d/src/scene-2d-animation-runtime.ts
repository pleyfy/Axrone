import type {
    Actor,
    ActorConfig,
    ComponentRegistry,
} from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { SceneActorRuntime, SceneRegistry } from '@axrone/scene-runtime';
import { requireRegisteredComponent } from '@axrone/scene-runtime/scene-facade';
import {
    SpriteAnimator,
    type SpriteAnimatorConfig,
    SpriteMask,
    type SpriteMaskConfig,
    SpriteRenderer,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-2d-support';

/**
 * Animated/mask sprite factories, split out of the base 2D actor runtime.
 *
 * Importing this module is what retains `SpriteAnimator`/`SpriteMask` and the
 * `@axrone/animation` chain. The root `Scene2D` installs it; the lean entry
 * does not, so a sprite-only consumer never pays for animation.
 */
export interface Scene2DAnimationRuntime<
    R extends ComponentRegistry = Record<string, never>,
> {
    createAnimatedSpriteActor(
        actorConfig: ActorConfig,
        spriteConfig: SpriteRendererConfig,
        animatorConfig: SpriteAnimatorConfig
    ): Actor<World<SceneRegistry<R>>>;

    createMaskActor(
        actorConfig: ActorConfig,
        maskConfig: SpriteMaskConfig
    ): Actor<World<SceneRegistry<R>>>;
}

export const createScene2DAnimationRuntime = <
    R extends ComponentRegistry = Record<string, never>,
>(
    actors: SceneActorRuntime<R>
): Scene2DAnimationRuntime<R> => ({
    createAnimatedSpriteActor(actorConfig, spriteConfig, animatorConfig) {
        requireRegisteredComponent(
            actors,
            SpriteRenderer,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        requireRegisteredComponent(
            actors,
            SpriteAnimator,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        const actor = actors.createActor(actorConfig);
        actor.addComponent(SpriteRenderer, spriteConfig);
        actor.addComponent(SpriteAnimator, animatorConfig);
        return actor;
    },

    createMaskActor(actorConfig, maskConfig) {
        requireRegisteredComponent(
            actors,
            SpriteMask,
            'mask actor creation requires the 2D scene capability/profile'
        );
        const actor = actors.createActor(actorConfig);
        actor.addComponent(SpriteMask, maskConfig);
        return actor;
    },
});
