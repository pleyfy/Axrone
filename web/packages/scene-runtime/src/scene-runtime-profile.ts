import type { ComponentRegistry } from '../../core/src/component-system/types/core';
import {
    DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS,
    SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST,
    createSceneRuntimeRegistry,
} from './scene-runtime-registry';
import type {
    SceneRuntimeBuiltInManifest,
    SceneRuntimeRegistry,
} from './scene-runtime-registry';

export interface SceneRuntimeManifestProfileOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly id: string;
    readonly manifests: readonly SceneRuntimeBuiltInManifest[];
}

export interface SceneRuntimeProfileContext<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly registry?: R;
}

export interface SceneRuntimeProfile<R extends ComponentRegistry = Record<string, never>> {
    readonly id: string;
    resolveRegistry(context: SceneRuntimeProfileContext<R>): SceneRuntimeRegistry<R>;
}

export const createSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R>
): SceneRuntimeProfile<R> =>
    profile;

export const createSceneRuntimeManifestProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneRuntimeManifestProfileOptions<R>
): SceneRuntimeProfile<R> =>
    createSceneRuntimeProfile({
        id: options.id,
        resolveRegistry: ({ registry }: SceneRuntimeProfileContext<R>) =>
            createSceneRuntimeRegistry({ registry, manifests: options.manifests }),
    });

export const CORE_SCENE_RUNTIME_PROFILE_ID = 'scene-runtime/core-default';

const CORE_SCENE_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneRuntimeManifestProfile({
        id: CORE_SCENE_RUNTIME_PROFILE_ID,
        manifests: [SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST],
    })
);

const DEFAULT_SCENE_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze(
    createSceneRuntimeManifestProfile({
        id: CORE_SCENE_RUNTIME_PROFILE_ID,
        manifests: DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS,
    })
);

export const getCoreSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => CORE_SCENE_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const getDefaultSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => DEFAULT_SCENE_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const resolveSceneRuntimeRegistryFromProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R> | undefined,
    context: SceneRuntimeProfileContext<R> = {}
): SceneRuntimeRegistry<R> =>
    (profile ?? getDefaultSceneRuntimeProfile<R>()).resolveRegistry(context);