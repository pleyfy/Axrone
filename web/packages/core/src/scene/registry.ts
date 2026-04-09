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

export interface SceneBuiltInManifest<
    TBuiltIns extends readonly SceneBuiltInComponentName[] = readonly SceneBuiltInComponentName[],
> {
    readonly id: string;
    readonly builtIns: TBuiltIns;
}

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

export interface SceneManifestRegistryBuilderOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly registry?: R;
    readonly manifests?: readonly SceneBuiltInManifest[];
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

export const createSceneBuiltInManifest = <
    const TBuiltIns extends readonly SceneBuiltInComponentName[],
>(
    manifest: SceneBuiltInManifest<TBuiltIns>
): SceneBuiltInManifest<TBuiltIns> =>
    Object.freeze({
        id: manifest.id,
        builtIns: Object.freeze([...manifest.builtIns]) as TBuiltIns,
    });

export const SCENE_CORE_BUILT_IN_MANIFEST = createSceneBuiltInManifest({
    id: 'scene/core',
    builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
});

export const SCENE_ANIMATION_BUILT_IN_MANIFEST = createSceneBuiltInManifest({
    id: 'scene/animation',
    builtIns: ['Animator'] as const,
});

export const SCENE_3D_BUILT_IN_MANIFEST = createSceneBuiltInManifest({
    id: 'scene/3d',
    builtIns: [
        'Camera',
        'MeshRenderer',
        'DirectionalLight',
        'PointLight',
        'SpotLight',
        'OrbitCameraController',
    ] as const,
});

export const DEFAULT_SCENE_BUILT_IN_MANIFESTS = Object.freeze([
    SCENE_CORE_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_3D_BUILT_IN_MANIFEST,
]) as readonly SceneBuiltInManifest[];

export const resolveSceneBuiltInComponents = (
    manifests: readonly SceneBuiltInManifest[] = DEFAULT_SCENE_BUILT_IN_MANIFESTS
): readonly SceneBuiltInComponentName[] => {
    const resolved: SceneBuiltInComponentName[] = [];
    const included = new Set<SceneBuiltInComponentName>();

    for (let manifestIndex = 0; manifestIndex < manifests.length; manifestIndex += 1) {
        const manifest = manifests[manifestIndex]!;
        for (let builtInIndex = 0; builtInIndex < manifest.builtIns.length; builtInIndex += 1) {
            const builtIn = manifest.builtIns[builtInIndex]!;
            if (included.has(builtIn)) {
                continue;
            }

            included.add(builtIn);
            resolved.push(builtIn);
        }
    }

    return Object.freeze(resolved);
};

export const DEFAULT_SCENE_BUILT_IN_COMPONENTS = resolveSceneBuiltInComponents();

export const getDefaultSceneBuiltInRegistry = (): SceneBuiltInRegistry => ({
    ...DEFAULT_SCENE_BUILT_IN_REGISTRY,
});

export const createSceneRegistryFromBuiltInManifests = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneManifestRegistryBuilderOptions<R> = {}
): SceneRegistry<R> =>
    createSceneRegistry({
        registry: options.registry,
        builtIns: resolveSceneBuiltInComponents(options.manifests),
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
