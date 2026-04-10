export * from '@axrone/scene-runtime';

export type { SceneAssetRuntimeOptions } from '../../core/src/scene/scene-asset-runtime';
export { SceneAssetRuntime } from '../../core/src/scene/scene-asset-runtime';
export { SceneAssetFacade } from '../../core/src/scene/scene-asset-facade';
export { SceneLifecycleFacade } from '../../core/src/scene/scene-lifecycle-facade';
export type { SceneLifecycleRuntimeOptions } from '../../core/src/scene/scene-lifecycle-runtime';
export { SceneLifecycleRuntime } from '../../core/src/scene/scene-lifecycle-runtime';
export type { SceneRuntimeKernelOptions } from '../../core/src/scene/scene-runtime-kernel';
export { SceneRuntimeKernel } from '../../core/src/scene/scene-runtime-kernel';
export { SceneRuntimeFacade } from '../../core/src/scene/scene-runtime-facade';
export { SceneSnapshotFacade } from '../../core/src/scene/scene-snapshot-facade';

export {
	DEFAULT_SCENE_BUILT_IN_MANIFESTS,
	SCENE_3D_BUILT_IN_MANIFEST,
	SCENE_ANIMATION_BUILT_IN_MANIFEST,
	SCENE_CORE_BUILT_IN_MANIFEST,
	createSceneBuiltInManifest,
	createSceneRegistry,
	createSceneRegistryFromBuiltInManifests,
	resolveSceneBuiltInComponents,
} from '@axrone/scene-runtime';

export type {
	SceneManifestRuntimeProfileOptions,
	SceneRuntimeProfile,
	SceneRuntimeProfileContext,
} from '../../scene-runtime/src/scene-profile';
export {
	DEFAULT_SCENE_RUNTIME_PROFILE_ID,
	SCENE_3D_RUNTIME_PROFILE_ID,
	createSceneManifestRuntimeProfile,
	createSceneRuntimeProfile,
	get3DSceneRuntimeProfile,
	getDefaultSceneRuntimeProfile,
	resolveSceneRegistryFromProfile,
} from '../../scene-runtime/src/scene-profile';

export type { Scene3DActorRuntimeOptions } from '../../core/src/scene/scene-3d-actor-runtime';
export { Scene3DActorRuntime } from '../../core/src/scene/scene-3d-actor-runtime';

export type { CameraConfig } from '../../core/src/scene/components/camera';
export { Camera } from '../../core/src/scene/components/camera';
export type {
	MeshRendererConfig,
	MeshRendererMorphConfig,
} from '../../core/src/scene/components/mesh-renderer';
export { MeshRenderer } from '../../core/src/scene/components/mesh-renderer';
export type { DirectionalLightConfig } from '../../core/src/scene/components/directional-light';
export { DirectionalLight } from '../../core/src/scene/components/directional-light';
export type { PointLightConfig } from '../../core/src/scene/components/point-light';
export { PointLight } from '../../core/src/scene/components/point-light';
export type { SpotLightConfig } from '../../core/src/scene/components/spot-light';
export { SpotLight } from '../../core/src/scene/components/spot-light';
export type { OrbitCameraControllerConfig } from '../../core/src/scene/components/orbit-camera-controller';
export { OrbitCameraController } from '../../core/src/scene/components/orbit-camera-controller';
export type {
	AnimatorClipConfig,
	AnimatorConfig,
	AnimatorTrackConfig,
} from '../../core/src/scene/components/animator';
export { Animator } from '../../core/src/scene/components/animator';

export { createScene } from '../../core/src/scene/scene-factory';
export { createUnlitColorShaderDefinition } from '../../core/src/scene/scene-default-shaders';
export { Scene } from '../../core/src/scene/scene';