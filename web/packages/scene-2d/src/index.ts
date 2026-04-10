export * from '@axrone/scene-runtime';

export type { SceneAssetRuntimeOptions } from '../../scene-runtime/src/scene-asset-runtime';
export { SceneAssetRuntime } from '../../scene-runtime/src/scene-asset-runtime';
export { SceneAssetFacade } from '../../scene-runtime/src/scene-asset-facade';
export { SceneLifecycleFacade } from '../../scene-runtime/src/scene-lifecycle-facade';
export type { SceneLifecycleRuntimeOptions } from '../../scene-runtime/src/scene-lifecycle-runtime';
export { SceneLifecycleRuntime } from '../../scene-runtime/src/scene-lifecycle-runtime';
export type { SceneRuntimeKernelOptions } from '../../scene-runtime/src/scene-runtime-kernel';
export { SceneRuntimeKernel } from '../../scene-runtime/src/scene-runtime-kernel';
export { SceneRuntimeFacade } from '../../scene-runtime/src/scene-runtime-facade';
export { SceneSnapshotFacade } from '../../scene-runtime/src/scene-snapshot-facade';

export {
	SCENE_2D_BUILT_IN_MANIFEST,
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
	CORE_SCENE_RUNTIME_PROFILE_ID,
	SCENE_2D_RUNTIME_PROFILE_ID,
	createSceneManifestRuntimeProfile,
	createSceneRuntimeProfile,
	get2DSceneRuntimeProfile,
	getCoreSceneRuntimeProfile,
	resolveSceneRegistryFromProfile,
} from '../../scene-runtime/src/scene-profile';

export type {
	AnimatorClipConfig,
	AnimatorConfig,
	AnimatorTrackConfig,
} from '../../scene-runtime/src/components/animator';
export type { CameraConfig } from '../../scene-runtime/src/components/camera';
export {
	Animator,
} from '../../scene-runtime/src/components/animator';
export { Camera } from '../../scene-runtime/src/components/camera';

export { createScene2D } from './scene-2d-factory';
export { Scene2D } from './scene-2d';