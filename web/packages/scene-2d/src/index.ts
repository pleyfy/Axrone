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