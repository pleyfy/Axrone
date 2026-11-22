export type {
	SceneRuntimeBuiltInComponentName,
	SceneRuntimeBuiltInManifest,
	SceneRuntimeBuiltInRegistry,
	SceneRuntimeRegistry,
} from './scene-runtime-registry';
export {
	DEFAULT_SCENE_RUNTIME_BUILT_IN_MANIFESTS,
	SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST,
	createSceneRuntimeBuiltInManifest,
	createSceneRuntimeRegistry,
	resolveSceneRuntimeBuiltInComponents,
} from './scene-runtime-registry';
export type {
	SceneBuiltInComponentName,
	SceneBuiltInManifest,
	SceneManifestRegistryBuilderOptions,
	SceneRegistryBuilderOptions,
	SceneRegistryForBuiltIns,
} from './scene-registry';
export {
	DEFAULT_SCENE_BUILT_IN_COMPONENTS,
	DEFAULT_SCENE_BUILT_IN_MANIFESTS,
	SCENE_2D_BUILT_IN_MANIFEST,
	SCENE_3D_BUILT_IN_MANIFEST,
	SCENE_ANIMATION_BUILT_IN_MANIFEST,
	SCENE_CORE_BUILT_IN_MANIFEST,
	createSceneBuiltInManifest,
	createSceneRegistry,
	createSceneRegistryFromBuiltInManifests,
	getDefaultSceneBuiltInRegistry,
	resolveSceneBuiltInComponents,
} from './scene-registry';
export type {
	SceneManifestRuntimeProfileOptions,
	ScenePhysicsBridgeSelection,
	SceneRuntimeProfile,
	SceneRuntimeProfileContext,
} from './scene-profile';
export {
	CORE_SCENE_RUNTIME_PROFILE_ID,
	DEFAULT_SCENE_RUNTIME_PROFILE_ID,
	SCENE_2D_RUNTIME_PROFILE_ID,
	SCENE_3D_RUNTIME_PROFILE_ID,
	SCENE_MIXED_RUNTIME_PROFILE_ID,
	createSceneManifestRuntimeProfile,
	createSceneRuntimeProfile,
	get2DSceneRuntimeProfile,
	get3DSceneRuntimeProfile,
	getMixedSceneRuntimeProfile,
	getCoreSceneRuntimeProfile,
	getDefaultSceneRuntimeProfile,
	resolvePhysicsBridgesForProfile,
	resolveSceneRegistryFromProfile,
} from './scene-profile';

export type {
	SceneRuntimeComposition,
	SceneRuntimePhysicsBridge,
	SceneRuntimePhysicsBridgeInput,
	SceneRuntimePhysicsBridgeSelection,
	SceneRuntimePhysicsProfilerStats,
	SceneRuntimePhysicsWorldView,
} from './scene-runtime-kernel';
export {
	getDefaultSceneRuntimeComposition,
	resolveSceneRuntimeComposition,
} from './default-composition';
export type {
	SceneBatchRuntimeFactory,
	SceneBatchRuntimeFactoryContext,
	SceneBatchRuntimeSet,
} from './scene-batch-runtimes';
export { createFullSceneBatchRuntimes } from './scene-batch-runtimes';

/** @deprecated Use `CORE_SCENE_RUNTIME_PROFILE_ID` instead. */
export { CORE_SCENE_RUNTIME_PROFILE_ID as CORE_SCENE_PROFILE_ID } from './scene-profile';

export type { SceneRenderCapabilities } from './scene-render-capabilities';
export {
	SCENE_RENDER_CAPABILITIES_ALL,
	resolveSceneRenderCapabilities,
} from './scene-render-capabilities';

export type { SceneActorRuntimeOptions } from './scene-actor-runtime';
export { SceneActorRuntime } from './scene-actor-runtime';
export type {
	AnimationStreamingBridgeOptions,
	AnimationStreamingBridgeWorld,
	AnimationStreamingChunkResolveResult,
	AnimationStreamingChunkResolver,
	AnimationStreamingRequestEvent,
	AnimationStreamingResolveContext,
	FailedAnimationStreamingChunk,
	FetchAnimationStreamingResolverOptions,
	ResolvedAnimationStreamingChunk,
} from './animation-streaming-bridge';
export {
	AnimationStreamingBridge,
	bindAnimationStreamingBridge,
	createFetchAnimationStreamingResolver,
} from './animation-streaming-bridge';
export {
	DEFAULT_SCENE_AMBIENT_LIGHT,
	DEFAULT_SCENE_CLEAR_COLOR,
	DEFAULT_SCENE_GROUND_LIGHT,
	DEFAULT_SCENE_HEIGHT,
	DEFAULT_SCENE_RENDER_PASS_ID,
	DEFAULT_SCENE_SKY_LIGHT,
	DEFAULT_SCENE_WIDTH,
	resolveSceneAmbientLight,
	resolveSceneClearColor,
	resolveSceneGroundLight,
	resolveSceneSkyLight,
} from './scene-runtime-defaults';
export type {
	SceneSnapshotActorHost,
	SceneSnapshotAssetHost,
	SceneSnapshotRuntimeOptions,
} from './scene-snapshot-runtime';
export { SceneSnapshotRuntime } from './scene-snapshot-runtime';

export type {
	AnimatorConfig,
	AnimatorClipConfig,
	AnimatorTrackConfig,
} from './components/animator';
export { Animator } from './components/animator';
export { SceneRagdollPoseSource } from './components/ragdoll-pose-source';
export {
	SceneAnimationClipAssetLibrary,
	sceneAnimationClipAssets,
	resolveAnimationClipAssets,
} from './scene-animation-clip-assets';
export type {
	SceneAnimationClipAsset,
	AnimatorClipAssetReference,
} from './scene-animation-clip-assets';

export type {
	CompiledRenderShaderEffect,
	RenderShaderAttributeDefinition,
	RenderShaderEffectDefinition,
	RenderShaderEffectRenderStateDefinition,
	RenderShaderInspectorControlDefinition,
	RenderShaderInspectorOptionDefinition,
	RenderShaderInterfaceDefinition,
	RenderShaderLibraryDefinition,
	RenderShaderPropertyDefinition,
	RenderShaderSerializableValue,
	RenderShaderStageDefinition,
	RenderShaderStageName,
	RenderShaderValueType,
} from '@axrone/render-core/shader-effect';
export {
	cloneRenderShaderEffectDefinition,
	compileRenderShaderEffect,
} from '@axrone/render-core/shader-effect';
export type { SceneShaderDefinitionFromEffectOptions } from './shader-effect';
export { createSceneShaderDefinitionFromEffect } from './shader-effect';
export type {
	SceneMaterialInspectorControlDefinition,
	SceneMaterialInspectorControlKind,
	SceneMaterialInspectorSection,
} from './material-inspector';
export {
	createSceneMaterialInspectorControls,
	createSceneMaterialInspectorSections,
} from './material-inspector';
// Prefab functions and workflow moved to @axrone/scene-prefab.
// Use the ./prefab subpath or import from @axrone/scene-prefab directly.

export type {
	SceneBuiltInRegistry,
	SceneCanvasOptions,
	SceneClearFlag,
	SceneLoopState,
	SceneMaterialAlphaMode,
	SceneMaterialDefinition,
	SceneMaterialHandle,
	SceneMaterialPassDefinition,
	SceneMaterialPassPrimitive,
	SceneMaterialSurfaceDefinition,
	SceneMaterialSurfaceFeaturesDefinition,
	SceneMaterialSurfaceTextureBindingDefinition,
	SceneMaterialShadingModel,
	SceneMaterialTextureBindingHandle,
	SceneMeshDefinition,
	SceneMeshHandle,
	SceneMorphTargetAttribute,
	SceneMorphTargetDefinition,
	SceneMorphTargetSemantic,
	SceneMeshSemantic,
	SceneMeshTopology,
	SceneInstancingMode,
	SceneOptions,
	ScenePrefabActorField,
	ScenePrefabActorFieldValue,
	ScenePrefabComponentId,
	ScenePrefabComponentSelector,
	ScenePrefabConflict,
	ScenePrefabConflictBaseValue,
	ScenePrefabConflictPolicy,
	ScenePrefabConflictResolution,
	ScenePrefabConflictResolver,
	ScenePrefabDefinition,
	ScenePrefabDiffResult,
	ScenePrefabId,
	ScenePrefabInstantiateOptions,
	ScenePrefabInstanceId,
	ScenePrefabMergeDefinitionResult,
	ScenePrefabMergeOptions,
	ScenePrefabMergeResult,
	ScenePrefabMetadata,
	ScenePrefabNestedInstance,
	ScenePrefabNodeId,
	ScenePrefabNodeSource,
	ScenePrefabOverrideOperation,
	ScenePrefabPropertyPath,
	ScenePrefabPropertyPathSegment,
	ScenePrefabPropertyPathString,
	ScenePrefabReference,
	ScenePrefabRegistrySource,
	ScenePrefabResolveOptions,
	ScenePrefabResolvedDefinition,
	ScenePrefabResolutionResult,
	ScenePrefabResolver,
	SceneRegistry,
	SceneRenderPlanningOptions,
	SceneRenderPipelineSettings,
	SceneRenderPlanningStats,
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
} from './types';

export {
	SceneCanvasError,
	SceneCapabilityError,
	SceneError,
	SceneLifecycleError,
	ScenePrefabConflictError,
	ScenePrefabError,
	ScenePrefabResolutionError,
	ScenePrefabValidationError,
	SceneShaderError,
} from './errors';

export type { SceneCapabilityGuardHost } from './scene-capability-guard';
export { requireRegisteredComponent } from './scene-capability-guard';

export type {
	SceneRuntimeFrameRecord,
	SceneRuntimePhysicsStats,
	SceneRuntimeProfilerListener,
	SceneRuntimeProfilerOptions,
	SceneRuntimeProfilerPhaseId,
	SceneRuntimeProfilerSummary,
	SceneRuntimeRenderStats,
	SceneRuntimeStackSample,
	SceneRuntimeStackSampleFrame,
} from './runtime-profiler';
export {
	SCENE_RUNTIME_PROFILER_PHASES,
	SceneRuntimeProfiler,
} from './runtime-profiler';
