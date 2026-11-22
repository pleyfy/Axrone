import type { ComponentRegistry } from '@axrone/ecs-runtime';
import {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    getCoreSceneRuntimeProfile,
} from './scene-core-profile';
import {
    SCENE_2D_RUNTIME_PROFILE_ID,
    get2DSceneRuntimeProfile,
} from './scene-2d-profile';
import {
    SCENE_3D_RUNTIME_PROFILE_ID,
    get3DSceneRuntimeProfile,
} from './scene-3d-profile';
import {
    SCENE_MIXED_RUNTIME_PROFILE_ID,
    getMixedSceneRuntimeProfile,
} from './scene-mixed-profile';
import {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    getDefaultSceneRuntimeProfile,
} from './scene-full-profile';
import {
    resolveSceneRegistryFromProfileWithFallback,
    type SceneRuntimeProfile,
    type SceneRuntimeProfileContext,
} from './scene-profile-contract';

export type { SceneManifestRuntimeProfileOptions } from './scene-manifest-profile';
export { createSceneManifestRuntimeProfile } from './scene-manifest-profile';
export { createSceneRuntimeProfile } from './scene-profile-contract';

export type { SceneRuntimeProfile, SceneRuntimeProfileContext };

export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    SCENE_2D_RUNTIME_PROFILE_ID,
    SCENE_3D_RUNTIME_PROFILE_ID,
    SCENE_MIXED_RUNTIME_PROFILE_ID,
    getCoreSceneRuntimeProfile,
    get2DSceneRuntimeProfile,
    get3DSceneRuntimeProfile,
    getMixedSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
};

export const resolveSceneRegistryFromProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R> | undefined,
    context: SceneRuntimeProfileContext<R> = {}
): ReturnType<SceneRuntimeProfile<R>['resolveRegistry']> =>
    resolveSceneRegistryFromProfileWithFallback(
        profile,
        getDefaultSceneRuntimeProfile<R>(),
        context
    );

export type ScenePhysicsBridgeSelection = {
    readonly bridge3D: boolean;
    readonly bridge2D: boolean;
};

/**
 * Which physics bridges a scene profile needs. The 2D profile steps 2D only,
 * the mixed profile steps both, everything else (3D / full / core / unknown)
 * steps 3D only so pure-3D runtimes never pay for an idle 2D world.
 *
 * The two built-in ids are recognised exactly. Manifest profiles carry
 * application-chosen ids, so a 2D scene that renamed its profile would lose the
 * 2D bridge entirely — the dimension tokens below keep a declared 2D scene wired
 * up no matter what its author called it, while a name that mentions 3D as well
 * keeps both bridges rather than trading one for the other.
 */
const MIXED_PROFILE_TOKEN = /mixed/i;
const TWO_DIMENSION_PROFILE_TOKEN = /2d/i;
const THREE_DIMENSION_PROFILE_TOKEN = /3d/i;

export const resolvePhysicsBridgesForProfile = (
    profileId: string | undefined
): ScenePhysicsBridgeSelection => {
    if (profileId === SCENE_2D_RUNTIME_PROFILE_ID) {
        return { bridge3D: false, bridge2D: true };
    }
    if (profileId === SCENE_MIXED_RUNTIME_PROFILE_ID) {
        return { bridge3D: true, bridge2D: true };
    }
    if (profileId) {
        if (MIXED_PROFILE_TOKEN.test(profileId)) {
            return { bridge3D: true, bridge2D: true };
        }
        if (TWO_DIMENSION_PROFILE_TOKEN.test(profileId)) {
            return { bridge3D: THREE_DIMENSION_PROFILE_TOKEN.test(profileId), bridge2D: true };
        }
    }
    return { bridge3D: true, bridge2D: false };
};