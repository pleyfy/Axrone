import { Hierarchy } from '../component-system/components/hierarchy';
import { Transform } from '../component-system/components/transform';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import { Animator } from './components/animator';
import { Camera } from './components/camera';
import { DirectionalLight } from './components/directional-light';
import { MeshRenderer } from './components/mesh-renderer';
import { OrbitCameraController } from './components/orbit-camera-controller';
import { PrefabNodeBinding } from './components/prefab-node-binding';
import { PointLight } from './components/point-light';
import { SpotLight } from './components/spot-light';
import type { SceneBuiltInRegistry, SceneRegistry } from './types';

export type SceneBuiltInComponentName = keyof SceneBuiltInRegistry;

export type SceneRegistryForBuiltIns<
    R extends ComponentRegistry,
    TBuiltIns extends readonly SceneBuiltInComponentName[],
> = R & Pick<SceneBuiltInRegistry, TBuiltIns[number]>;

export interface SceneRegistryBuilderOptions<
    R extends ComponentRegistry = Record<string, never>,
    TBuiltIns extends readonly SceneBuiltInComponentName[] | undefined = undefined,
> {
    readonly registry?: R;
    readonly builtIns?: TBuiltIns;
}

const DEFAULT_SCENE_BUILT_IN_REGISTRY: SceneBuiltInRegistry = Object.freeze({
    Hierarchy,
    Transform,
    PrefabNodeBinding,
    Animator,
    Camera,
    MeshRenderer,
    DirectionalLight,
    PointLight,
    SpotLight,
    OrbitCameraController,
});

export const DEFAULT_SCENE_BUILT_IN_COMPONENTS = Object.freeze(
    Object.keys(DEFAULT_SCENE_BUILT_IN_REGISTRY)
) as readonly SceneBuiltInComponentName[];

export const getDefaultSceneBuiltInRegistry = (): SceneBuiltInRegistry => ({
    ...DEFAULT_SCENE_BUILT_IN_REGISTRY,
});

export function createSceneRegistry<R extends ComponentRegistry = Record<string, never>>(
    options?: SceneRegistryBuilderOptions<R>
): SceneRegistry<R>;
export function createSceneRegistry<
    R extends ComponentRegistry,
    const TBuiltIns extends readonly SceneBuiltInComponentName[],
>(options: SceneRegistryBuilderOptions<R, TBuiltIns>): SceneRegistryForBuiltIns<R, TBuiltIns>;
export function createSceneRegistry<
    R extends ComponentRegistry = Record<string, never>,
    TBuiltIns extends readonly SceneBuiltInComponentName[] | undefined = undefined,
>(options: SceneRegistryBuilderOptions<R, TBuiltIns> = {}): ComponentRegistry {
    const registry: Record<string, ComponentConstructor> = {};
    const builtIns = options.builtIns ?? DEFAULT_SCENE_BUILT_IN_COMPONENTS;

    for (const componentName of builtIns) {
        registry[componentName] = DEFAULT_SCENE_BUILT_IN_REGISTRY[componentName];
    }

    return {
        ...registry,
        ...(options.registry ?? {}),
    };
}
