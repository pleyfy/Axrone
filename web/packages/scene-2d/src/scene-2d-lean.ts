import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { getCoreSceneRuntimeProfile } from '@axrone/scene-runtime/scene-core-profile';
import {
    createSceneRuntimeProfile,
    type SceneRuntimeProfile,
} from '@axrone/scene-runtime/scene-profile-contract';
import { createLean2DSceneBatchRuntimes } from '@axrone/scene-runtime/scene-2d-lean-composition';
import { Camera } from '@axrone/scene-runtime/scene-camera';
import { SpriteRenderer } from '@axrone/scene-runtime/scene-sprite-renderer';
import type { SceneOptions, SceneRegistry } from '@axrone/scene-runtime/types';
import { Scene2D as Scene2DBase } from './scene-2d';

type SceneComposition<R extends ComponentRegistry> = NonNullable<
    SceneOptions<R>['composition']
>;

/**
 * Lean 2D scene: core built-ins (Hierarchy/Transform/PrefabNodeBinding) plus
 * only the components this entry exposes (Camera, SpriteRenderer). Animated
 * sprites and masks are intentionally absent, which keeps `SpriteAnimator`,
 * `SpriteMask`, `Animator` and the `@axrone/animation` chain out of the graph.
 */
export const LEAN_2D_SCENE_PROFILE_ID = 'scene/2d-lean';

const LEAN_2D_SCENE_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneRuntimeProfile({
        id: LEAN_2D_SCENE_PROFILE_ID,
        resolveRegistry: (context) => {
            const core = getCoreSceneRuntimeProfile<any>().resolveRegistry({});
            return {
                ...core,
                Camera,
                SpriteRenderer,
                ...(context.registry ?? {}),
            } as SceneRegistry<any>;
        },
    })
);

export const getLean2DSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => LEAN_2D_SCENE_PROFILE as SceneRuntimeProfile<R>;

/**
 * Lean 2D render composition: the sprite batch family only.
 *
 * A caller-supplied composition keeps its own batch factory (custom render
 * pipelines stay in control); otherwise the sprite family is injected so the
 * lean scene still draws sprites while particle/line/billboard chunks stay
 * out of its module graph.
 */
const resolveLean2DComposition = <
    R extends ComponentRegistry = Record<string, never>,
>(
    composition: SceneComposition<R> | undefined
): SceneComposition<R> => {
    if (composition?.createRenderBatchRuntimes) {
        return composition;
    }
    return {
        ...composition,
        createRenderBatchRuntimes: createLean2DSceneBatchRuntimes,
    };
};

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends Scene2DBase<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? getLean2DSceneRuntimeProfile<R>(),
            composition: resolveLean2DComposition<R>(options.composition),
        });
    }
}
