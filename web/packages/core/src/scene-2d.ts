export * from './scene-runtime';

export type { SceneAssetRuntimeOptions } from './scene/scene-asset-runtime';
export { SceneAssetRuntime } from './scene/scene-asset-runtime';
export { SceneAssetFacade } from './scene/scene-asset-facade';
export { SceneLifecycleFacade } from './scene/scene-lifecycle-facade';
export type { SceneLifecycleRuntimeOptions } from './scene/scene-lifecycle-runtime';
export { SceneLifecycleRuntime } from './scene/scene-lifecycle-runtime';
export type { SceneRuntimeKernelOptions } from './scene/scene-runtime-kernel';
export { SceneRuntimeKernel } from './scene/scene-runtime-kernel';
export { SceneRuntimeFacade } from './scene/scene-runtime-facade';
export { SceneSnapshotFacade } from './scene/scene-snapshot-facade';

export {
    SCENE_2D_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_CORE_BUILT_IN_MANIFEST,
    createSceneBuiltInManifest,
    createSceneRegistry,
    createSceneRegistryFromBuiltInManifests,
    resolveSceneBuiltInComponents,
} from './scene/registry';

export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    SCENE_2D_RUNTIME_PROFILE_ID,
    createSceneManifestRuntimeProfile,
    createSceneRuntimeProfile,
    get2DSceneRuntimeProfile,
    getCoreSceneRuntimeProfile,
    resolveSceneRegistryFromProfile,
} from './scene/profile';

export type { CameraConfig } from './scene/components/camera';
export { Camera } from './scene/components/camera';
export type {
    AnimatorClipConfig,
    AnimatorConfig,
    AnimatorTrackConfig,
} from './scene/components/animator';
export { Animator } from './scene/components/animator';

export { createScene2D } from './scene/scene-2d-factory';
export { Scene2D } from './scene/scene-2d';