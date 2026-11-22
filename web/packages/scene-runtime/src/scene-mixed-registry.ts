import type { ComponentRegistry } from '@axrone/ecs-runtime';
import {
    ANIMATION_SCENE_BUILT_IN_MANIFESTS,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    getAnimationSceneBuiltInRegistrySource,
} from './scene-animation-registry';
import {
    CORE_SCENE_BUILT_IN_MANIFESTS,
    SCENE_CORE_BUILT_IN_MANIFEST,
    getCoreSceneBuiltInRegistrySource,
} from './scene-core-registry';
import {
    SCENE_UI_BUILT_IN_MANIFEST,
    UI_SCENE_BUILT_IN_MANIFESTS,
    getUISceneBuiltInRegistrySource,
} from './scene-ui-registry';
import {
    SCENE_2D_BUILT_IN_MANIFEST,
    get2DSceneBuiltInRegistrySource,
} from './scene-2d-registry';
import {
    SCENE_3D_BUILT_IN_MANIFEST,
    get3DSceneBuiltInRegistrySource,
} from './scene-3d-registry';
import {
    createSceneBuiltInManifest,
    createSceneRegistryFromBuiltInManifestsWithSource,
    createSceneRegistryWithSource,
    type SceneBuiltInManifest,
    type SceneBuiltInRegistrySource,
    type SceneManifestRegistryBuilderOptions,
    type SceneRegistryBuilderOptions,
} from './scene-built-in-support';
import type { SceneRegistry } from './types';

const SCENE_MIXED_BUILT_IN_REGISTRY_SOURCE: SceneBuiltInRegistrySource = Object.freeze({
    ...getCoreSceneBuiltInRegistrySource(),
    ...getAnimationSceneBuiltInRegistrySource(),
    ...getUISceneBuiltInRegistrySource(),
    ...get2DSceneBuiltInRegistrySource(),
    ...get3DSceneBuiltInRegistrySource(),
});

export const SCENE_MIXED_BUILT_IN_MANIFEST = createSceneBuiltInManifest({
    id: 'scene/mixed',
    builtIns: [
        'Camera',
        'SpriteRenderer',
        'SpriteAnimator',
        'SpriteMask',
        'MeshRenderer',
        'DirectionalLight',
        'PointLight',
        'SpotLight',
        'AreaLight',
        'ReflectionProbe',
        'LODGroup',
        'BillboardRenderer',
        'Terrain',
        'OrbitCameraController',
        'FollowCameraController',
        'LineRenderer',
        'TrailRenderer',
        'ParticleSystem',
        'PathAgent',
    ] as const,
});

export const DEFAULT_SCENE_MIXED_BUILT_IN_MANIFESTS = Object.freeze([
    ...CORE_SCENE_BUILT_IN_MANIFESTS,
    ...ANIMATION_SCENE_BUILT_IN_MANIFESTS,
    ...UI_SCENE_BUILT_IN_MANIFESTS,
    SCENE_2D_BUILT_IN_MANIFEST,
    SCENE_3D_BUILT_IN_MANIFEST,
]) as readonly SceneBuiltInManifest[];

export const getMixedSceneBuiltInRegistrySource = (): SceneBuiltInRegistrySource => ({
    ...SCENE_MIXED_BUILT_IN_REGISTRY_SOURCE,
});

export const createMixedSceneRegistry = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneRegistryBuilderOptions<R> = {}
): SceneRegistry<R> =>
    createSceneRegistryWithSource(SCENE_MIXED_BUILT_IN_REGISTRY_SOURCE, options) as SceneRegistry<R>;

export const createMixedSceneRegistryFromBuiltInManifests = <
    R extends ComponentRegistry = Record<string, never>,
>(
    options: SceneManifestRegistryBuilderOptions<R> = {}
): SceneRegistry<R> =>
    createSceneRegistryFromBuiltInManifestsWithSource(
        SCENE_MIXED_BUILT_IN_REGISTRY_SOURCE,
        {
            registry: options.registry,
            manifests: options.manifests ?? DEFAULT_SCENE_MIXED_BUILT_IN_MANIFESTS,
        }
    );

export { SCENE_ANIMATION_BUILT_IN_MANIFEST, SCENE_CORE_BUILT_IN_MANIFEST, SCENE_UI_BUILT_IN_MANIFEST };
