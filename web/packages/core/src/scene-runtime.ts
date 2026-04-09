export type {
    SceneBuiltInComponentName,
    SceneBuiltInManifest,
    SceneManifestRegistryBuilderOptions,
    SceneRegistryBuilderOptions,
    SceneRegistryForBuiltIns,
} from './scene/registry';
export {
    DEFAULT_SCENE_BUILT_IN_MANIFESTS,
    SCENE_3D_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_CORE_BUILT_IN_MANIFEST,
    createSceneBuiltInManifest,
    createSceneRegistryFromBuiltInManifests,
    resolveSceneBuiltInComponents,
} from './scene/registry';

export type {
    SceneManifestRuntimeProfileOptions,
    SceneRuntimeProfile,
    SceneRuntimeProfileContext,
} from './scene/profile';
export {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    SCENE_3D_RUNTIME_PROFILE_ID,
    createSceneManifestRuntimeProfile,
    createSceneRuntimeProfile,
    get3DSceneRuntimeProfile,
    getCoreSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
    resolveSceneRegistryFromProfile,
} from './scene/profile';

export type { SceneActorRuntimeOptions } from './scene/scene-actor-runtime';
export { SceneActorRuntime } from './scene/scene-actor-runtime';
export type { SceneAssetRuntimeOptions } from './scene/scene-asset-runtime';
export { SceneAssetRuntime } from './scene/scene-asset-runtime';
export type { SceneLifecycleRuntimeOptions } from './scene/scene-lifecycle-runtime';
export { SceneLifecycleRuntime } from './scene/scene-lifecycle-runtime';
export type { SceneRuntimeKernelOptions } from './scene/scene-runtime-kernel';
export { SceneRuntimeKernel } from './scene/scene-runtime-kernel';
export {
    DEFAULT_SCENE_AMBIENT_LIGHT,
    DEFAULT_SCENE_CLEAR_COLOR,
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_RENDER_PASS_ID,
    DEFAULT_SCENE_WIDTH,
    resolveSceneAmbientLight,
    resolveSceneClearColor,
} from './scene/scene-runtime-defaults';
export type {
    SceneSnapshotActorHost,
    SceneSnapshotAssetHost,
    SceneSnapshotRuntimeOptions,
} from './scene/scene-snapshot-runtime';
export { SceneSnapshotRuntime } from './scene/scene-snapshot-runtime';

export type {
    SceneBuiltInRegistry,
    SceneCanvasOptions,
    SceneClearFlag,
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialTextureBindingHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMorphTargetAttribute,
    SceneMorphTargetDefinition,
    SceneMorphTargetSemantic,
    SceneMeshSemantic,
    SceneMeshTopology,
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRegistry,
    SceneRenderPassDefinition,
    SceneRenderPassHandle,
    SceneRenderStats,
    SceneSamplerDefinition,
    SceneSamplerHandle,
    SceneSerializedValue,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
    SceneTextureBindingDefinition,
    SceneTextureCompressedLevelDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
    SceneTextureResourceHandle,
    SceneUniformValue,
    SceneVertexAttribute,
} from './scene/types';

export {
    SceneCanvasError,
    SceneCapabilityError,
    SceneError,
    SceneLifecycleError,
    SceneMaterialError,
    SceneMeshError,
    SceneShaderError,
} from './scene/errors';

export { createScene, createUnlitColorShaderDefinition, Scene } from './scene/scene';
