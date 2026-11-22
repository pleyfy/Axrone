import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { getCoreSceneRuntimeProfile } from '@axrone/scene-runtime/scene-core-profile';
import {
    createSceneRuntimeProfile,
    type SceneRuntimeProfile,
} from '@axrone/scene-runtime/scene-profile-contract';
import { Camera } from '@axrone/scene-runtime/scene-camera';
import { MeshRenderer } from '@axrone/scene-runtime/scene-mesh-renderer';
import type { SceneOptions, SceneRegistry } from '@axrone/scene-runtime/types';
import { Scene as SceneBase } from './scene';

/**
 * Lean 3D scene: core built-ins (Hierarchy/Transform/PrefabNodeBinding) plus
 * only the components this entry exposes (Camera, MeshRenderer).
 *
 * Deliberately no lights, terrain, particles, animation, UI, 2D or physics:
 * those families are not reachable from the lean surface, so keeping their
 * modules would be dead weight in a render-only bundle.
 */
export const LEAN_3D_SCENE_PROFILE_ID = 'scene/3d-lean';

const LEAN_3D_SCENE_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneRuntimeProfile({
        id: LEAN_3D_SCENE_PROFILE_ID,
        resolveRegistry: (context) => {
            const core = getCoreSceneRuntimeProfile<any>().resolveRegistry({});
            return {
                ...core,
                Camera,
                MeshRenderer,
                ...(context.registry ?? {}),
            } as SceneRegistry<any>;
        },
    })
);

export const getLean3DSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => LEAN_3D_SCENE_PROFILE as SceneRuntimeProfile<R>;

export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneBase<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? getLean3DSceneRuntimeProfile<R>(),
        });
    }
}
