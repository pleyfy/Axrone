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

export type { Scene3DActorRuntimeOptions } from './scene-3d-actor-runtime';
export { Scene3DActorRuntime } from './scene-3d-actor-runtime';

export type {
	AnimatorClipConfig,
	AnimatorConfig,
	AnimatorTrackConfig,
} from '../../scene-runtime/src/components/animator';
export type { CameraConfig } from '../../scene-runtime/src/components/camera';
export type { DirectionalLightConfig } from '../../scene-runtime/src/components/directional-light';
export type {
	MeshRendererConfig,
	MeshRendererMorphConfig,
	MeshRendererSkinConfig,
} from '../../scene-runtime/src/components/mesh-renderer';
export type { OrbitCameraControllerConfig } from '../../scene-runtime/src/components/orbit-camera-controller';
export type { PointLightConfig } from '../../scene-runtime/src/components/point-light';
export type { SpotLightConfig } from '../../scene-runtime/src/components/spot-light';
export { Animator } from '../../scene-runtime/src/components/animator';
export { Camera } from '../../scene-runtime/src/components/camera';
export { DirectionalLight } from '../../scene-runtime/src/components/directional-light';
export { MeshRenderer } from '../../scene-runtime/src/components/mesh-renderer';
export { OrbitCameraController } from '../../scene-runtime/src/components/orbit-camera-controller';
export { PointLight } from '../../scene-runtime/src/components/point-light';
export { SpotLight } from '../../scene-runtime/src/components/spot-light';

export { createScene } from './scene-factory';
export { createUnlitColorShaderDefinition } from '../../core/src/scene/scene-default-shaders';
export { Scene } from './scene';