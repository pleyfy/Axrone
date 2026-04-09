import type { ComponentRegistry } from '../component-system/types/core';
import {
    DEFAULT_SCENE_BUILT_IN_MANIFESTS,
    SCENE_2D_BUILT_IN_MANIFEST,
    SCENE_3D_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_CORE_BUILT_IN_MANIFEST,
    type SceneBuiltInManifest,
    createSceneRegistryFromBuiltInManifests,
} from './registry';
import type { SceneRegistry } from './types';

export interface SceneRuntimeProfileContext<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly registry?: R;
}

export interface SceneRuntimeProfile<R extends ComponentRegistry = Record<string, never>> {
    readonly id: string;
    resolveRegistry(context: SceneRuntimeProfileContext<R>): SceneRegistry<R>;
}

export interface SceneManifestRuntimeProfileOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly id: string;
    readonly manifests: readonly SceneBuiltInManifest[];
}

export const createSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R>
): SceneRuntimeProfile<R> => profile;

export const createSceneManifestRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneManifestRuntimeProfileOptions<R>
): SceneRuntimeProfile<R> =>
    createSceneRuntimeProfile({
        id: options.id,
        resolveRegistry: ({ registry }) =>
            createSceneRegistryFromBuiltInManifests({
                registry,
                manifests: options.manifests,
            }),
    });

export const CORE_SCENE_RUNTIME_PROFILE_ID = 'scene/core-default';
export const SCENE_2D_RUNTIME_PROFILE_ID = 'scene/2d-default';
export const SCENE_3D_RUNTIME_PROFILE_ID = 'scene/3d-default';
export const DEFAULT_SCENE_RUNTIME_PROFILE_ID = 'scene/full-3d-default';

const CORE_SCENE_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneManifestRuntimeProfile({
        id: CORE_SCENE_RUNTIME_PROFILE_ID,
        manifests: [SCENE_CORE_BUILT_IN_MANIFEST],
    })
);

const SCENE_2D_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneManifestRuntimeProfile({
        id: SCENE_2D_RUNTIME_PROFILE_ID,
        manifests: [
            SCENE_CORE_BUILT_IN_MANIFEST,
            SCENE_ANIMATION_BUILT_IN_MANIFEST,
            SCENE_2D_BUILT_IN_MANIFEST,
        ],
    })
);

const SCENE_3D_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneManifestRuntimeProfile({
        id: SCENE_3D_RUNTIME_PROFILE_ID,
        manifests: [SCENE_CORE_BUILT_IN_MANIFEST, SCENE_3D_BUILT_IN_MANIFEST],
    })
);

const DEFAULT_SCENE_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneManifestRuntimeProfile({
        id: DEFAULT_SCENE_RUNTIME_PROFILE_ID,
        manifests: DEFAULT_SCENE_BUILT_IN_MANIFESTS,
    })
);

export const getCoreSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => CORE_SCENE_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const get2DSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => SCENE_2D_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const get3DSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => SCENE_3D_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const getDefaultSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => DEFAULT_SCENE_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const resolveSceneRegistryFromProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R> | undefined,
    context: SceneRuntimeProfileContext<R> = {}
): SceneRegistry<R> => (profile ?? getDefaultSceneRuntimeProfile<R>()).resolveRegistry(context);
