import type { ComponentRegistry } from '../component-system/types/core';
import { createSceneRegistry } from './registry';
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

export const createSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R>
): SceneRuntimeProfile<R> => profile;

export const DEFAULT_SCENE_RUNTIME_PROFILE_ID = 'scene/full-3d-default';

const DEFAULT_SCENE_RUNTIME_PROFILE: SceneRuntimeProfile<any> = Object.freeze({
    id: DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    resolveRegistry: ({ registry }) =>
        createSceneRegistry({
            registry,
        }),
});

export const getDefaultSceneRuntimeProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeProfile<R> => DEFAULT_SCENE_RUNTIME_PROFILE as SceneRuntimeProfile<R>;

export const resolveSceneRegistryFromProfile = <
    R extends ComponentRegistry = Record<string, never>,
>(
    profile: SceneRuntimeProfile<R> | undefined,
    context: SceneRuntimeProfileContext<R> = {}
): SceneRegistry<R> => (profile ?? getDefaultSceneRuntimeProfile<R>()).resolveRegistry(context);
