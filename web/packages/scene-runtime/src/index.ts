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
	SceneRuntimeManifestProfileOptions,
	SceneRuntimeProfile,
	SceneRuntimeProfileContext,
} from './scene-runtime-profile';
export {
	CORE_SCENE_RUNTIME_PROFILE_ID,
	createSceneRuntimeProfile,
	createSceneRuntimeManifestProfile,
	getCoreSceneRuntimeProfile,
	getDefaultSceneRuntimeProfile,
	resolveSceneRuntimeRegistryFromProfile,
} from './scene-runtime-profile';
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
export {
	CORE_SCENE_RUNTIME_PROFILE_ID as CORE_SCENE_PROFILE_ID,
	DEFAULT_SCENE_RUNTIME_PROFILE_ID,
	SCENE_2D_RUNTIME_PROFILE_ID,
	SCENE_3D_RUNTIME_PROFILE_ID,
	createSceneManifestRuntimeProfile,
	get2DSceneRuntimeProfile,
	get3DSceneRuntimeProfile,
	resolveSceneRegistryFromProfile,
} from './scene-profile';
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
	DEFAULT_SCENE_HEIGHT,
	DEFAULT_SCENE_RENDER_PASS_ID,
	DEFAULT_SCENE_WIDTH,
	resolveSceneAmbientLight,
	resolveSceneClearColor,
} from './scene-runtime-defaults';
export type {
	SceneSnapshotActorHost,
	SceneSnapshotAssetHost,
	SceneSnapshotRuntimeOptions,
} from './scene-snapshot-runtime';
export { SceneSnapshotRuntime } from './scene-snapshot-runtime';

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
} from '@axrone/render-core';
export {
	cloneRenderShaderEffectDefinition,
	compileRenderShaderEffect,
} from '@axrone/render-core';
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
export type {
	ResolveScenePrefabOptions,
	ScenePrefabWorkflowOptions,
} from './scene-prefab-workflow';
export {
	createScenePrefabWorkflow,
	resolveScenePrefab,
	ScenePrefabWorkflow,
} from './scene-prefab-workflow';
export {
	applyScenePrefabOverrides,
} from './scene-prefab-operations';
export {
	diffScenePrefabDefinitions,
	mergeScenePrefabDefinitions,
} from './scene-prefab-diff';
export {
	createScenePrefabComponentSelector,
	createScenePrefabScopedNodeId,
	findScenePrefabComponentIndex,
	getScenePrefabComponentSelectorKey,
	hasScenePrefabComposition,
	serializeScenePrefabPropertyPath,
} from './scene-prefab-internals';

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
} from './errors';
