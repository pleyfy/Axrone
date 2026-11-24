import type {
    EntityId,
    EntityConfig,
    ComponentRegistry,
} from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { SceneEntityRuntime, SceneRegistry } from '@axrone/scene-runtime';
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
 * Animated/mask sprite factories, split out of the base 2D entity runtime.
 *
 * Importing this module is what retains `SpriteAnimator`/`SpriteMask` and the
 * `@axrone/animation` chain. The root `Scene2D` installs it; the lean entry
 * does not, so a sprite-only consumer never pays for animation.
 */
export interface Scene2DAnimationRuntime<
    R extends ComponentRegistry = Record<string, never>,
> {
    createAnimatedSpriteEntity(
        entityConfig: EntityConfig,
        spriteConfig: SpriteRendererConfig,
        animatorConfig: SpriteAnimatorConfig
    ): EntityId<World<SceneRegistry<R>>>;

    createMaskEntity(
        entityConfig: EntityConfig,
        maskConfig: SpriteMaskConfig
    ): EntityId<World<SceneRegistry<R>>>;
}

export const createScene2DAnimationRuntime = <
    R extends ComponentRegistry = Record<string, never>,
>(
    entities: SceneEntityRuntime<R>
): Scene2DAnimationRuntime<R> => ({
    createAnimatedSpriteEntity(entityConfig, spriteConfig, animatorConfig) {
        requireRegisteredComponent(
            entities,
            SpriteRenderer,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        requireRegisteredComponent(
            entities,
            SpriteAnimator,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        const entity = entities.createEntity(entityConfig);
        entity.addComponent(SpriteRenderer, spriteConfig);
        entity.addComponent(SpriteAnimator, animatorConfig);
        return entity;
    },

    createMaskEntity(entityConfig, maskConfig) {
        requireRegisteredComponent(
            entities,
            SpriteMask,
            'mask entity creation requires the 2D scene capability/profile'
        );
        const entity = entities.createEntity(entityConfig);
        entity.addComponent(SpriteMask, maskConfig);
        return entity;
    },
});
