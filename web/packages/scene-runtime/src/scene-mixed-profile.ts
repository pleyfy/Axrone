import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { createMixedSceneRegistry } from './scene-mixed-registry';
import {
    createSceneRuntimeProfile,
    type SceneRuntimeProfile,
} from './scene-profile-contract';

export type { SceneRuntimeProfile, SceneRuntimeProfileContext } from './scene-profile-contract';

export const SCENE_MIXED_RUNTIME_PROFILE_ID = 'scene/mixed-default';

const SCENE_MIXED_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneRuntimeProfile({
        id: SCENE_MIXED_RUNTIME_PROFILE_ID,
        resolveRegistry: ({ registry }) => createMixedSceneRegistry({ registry }),
    })
);

export const getMixedSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => SCENE_MIXED_RUNTIME_PROFILE as SceneRuntimeProfile<R>;
