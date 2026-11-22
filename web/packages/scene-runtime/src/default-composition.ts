import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { PhysicsBridge2D, type PhysicsBridge2DOptions } from './components/physics-bridge-2d';
import { PhysicsBridge3D, type PhysicsBridge3DOptions } from './components/physics-bridge-3d';
import { createFullSceneBatchRuntimes } from './scene-batch-runtimes';
import { resolvePhysicsBridgesForProfile } from './scene-profile';
import { getDefaultSceneRuntimeProfile } from './scene-full-profile';
import type {
    SceneRuntimeComposition,
    SceneRuntimePhysicsBridgeInput,
    SceneRuntimePhysicsBridgeSelection,
} from './scene-runtime-kernel';

/**
 * Full runtime composition used by the root `Scene` / `Scene2D` entries.
 *
 * This module is deliberately separate from the scene kernel: importing the
 * kernel must not drag in `physics-2d`, `physics-3d` or the full built-in
 * manifest chain. Lean scene entries omit the composition entirely, so their
 * module graph contains neither.
 */

const createBridge3D = (
    world: ConstructorParameters<typeof PhysicsBridge3D>[0],
    options: PhysicsBridge3DOptions | undefined,
    enableProfiler: boolean
): PhysicsBridge3D =>
    new PhysicsBridge3D(
        world,
        enableProfiler
            ? {
                  ...options,
                  worldConfig: {
                      ...options?.worldConfig,
                      enableProfiler: true,
                  },
              }
            : options
    );

const createBridge2D = (
    world: ConstructorParameters<typeof PhysicsBridge2D>[0],
    options: PhysicsBridge2DOptions | undefined,
    enableProfiler: boolean
): PhysicsBridge2D =>
    new PhysicsBridge2D(
        world,
        enableProfiler
            ? {
                  ...options,
                  worldConfig: {
                      ...options?.worldConfig,
                      enableProfiler: true,
                  },
              }
            : options
    );

const DEFAULT_SCENE_RUNTIME_COMPOSITION: SceneRuntimeComposition<any> = Object.freeze({
    defaultProfile: getDefaultSceneRuntimeProfile<any>(),
    // Full built-in registry: every batch family the root profiles can produce
    // stays enabled, matching the pre-injection render runtime behavior.
    createRenderBatchRuntimes: createFullSceneBatchRuntimes,
    // Mirrors the historical kernel behavior: 2D profile → 2D bridge only,
    // mixed profile → both bridges, everything else → 3D bridge only.
    createPhysicsBridges: (
        input: SceneRuntimePhysicsBridgeInput
    ): SceneRuntimePhysicsBridgeSelection => {
        const {
            world,
            profileId,
            enableProfiler,
            physicsBridgeOptions,
            physicsBridge2DOptions,
        } = input;
        const selection = resolvePhysicsBridgesForProfile(profileId);
        return {
            bridge3D: selection.bridge3D
                ? createBridge3D(world as any, physicsBridgeOptions, enableProfiler)
                : null,
            bridge2D: selection.bridge2D
                ? createBridge2D(world as any, physicsBridge2DOptions, enableProfiler)
                : null,
        };
    },
});

export const getDefaultSceneRuntimeComposition = <
    R extends ComponentRegistry = Record<string, never>,
>(): SceneRuntimeComposition<R> => DEFAULT_SCENE_RUNTIME_COMPOSITION as SceneRuntimeComposition<R>;

/**
 * Root-scene composition resolution.
 *
 * A caller-supplied composition keeps replacing the default profile/physics
 * factories exactly as before; only the render batch factory is filled in from
 * the default when the caller did not provide one. That keeps root scenes on
 * the full batch set even when an application overrides just the physics
 * bridges, while lean entries (which never call this) stay batch-free.
 */
export const resolveSceneRuntimeComposition = <
    R extends ComponentRegistry = Record<string, never>,
>(
    composition: SceneRuntimeComposition<R> | undefined
): SceneRuntimeComposition<R> => {
    const defaultComposition = getDefaultSceneRuntimeComposition<R>();
    if (!composition || composition.createRenderBatchRuntimes) {
        return composition ?? defaultComposition;
    }

    return {
        ...composition,
        createRenderBatchRuntimes: defaultComposition.createRenderBatchRuntimes,
    };
};
