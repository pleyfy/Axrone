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
    DEFAULT_SCENE_BUILT_IN_MANIFESTS,
    SCENE_3D_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_CORE_BUILT_IN_MANIFEST,
    createSceneBuiltInManifest,
    createSceneRegistry,
    createSceneRegistryFromBuiltInManifests,
    resolveSceneBuiltInComponents,
} from './scene/registry';

export {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    SCENE_3D_RUNTIME_PROFILE_ID,
    createSceneManifestRuntimeProfile,
    createSceneRuntimeProfile,
    get3DSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
    resolveSceneRegistryFromProfile,
} from './scene/profile';

export type { Scene3DActorRuntimeOptions } from './scene/scene-3d-actor-runtime';
export { Scene3DActorRuntime } from './scene/scene-3d-actor-runtime';

export type { CameraConfig } from './scene/components/camera';
export { Camera } from './scene/components/camera';
export type {
    MeshRendererConfig,
    MeshRendererMorphConfig,
} from './scene/components/mesh-renderer';
export { MeshRenderer } from './scene/components/mesh-renderer';
export type { DirectionalLightConfig } from './scene/components/directional-light';
export { DirectionalLight } from './scene/components/directional-light';
export type { PointLightConfig } from './scene/components/point-light';
export { PointLight } from './scene/components/point-light';
export type { SpotLightConfig } from './scene/components/spot-light';
export { SpotLight } from './scene/components/spot-light';
export type { OrbitCameraControllerConfig } from './scene/components/orbit-camera-controller';
export { OrbitCameraController } from './scene/components/orbit-camera-controller';
export type {
    AnimatorClipConfig,
    AnimatorConfig,
    AnimatorTrackConfig,
} from './scene/components/animator';
export { Animator } from './scene/components/animator';

export { createScene } from './scene/scene-factory';
export { createUnlitColorShaderDefinition } from './scene/scene-default-shaders';
export { Scene } from './scene/scene';
