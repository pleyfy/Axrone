export type { SceneEntityLifecycleRunnerOptions } from './entity-lifecycle-runner';
export { SceneEntityLifecycleRunner } from './entity-lifecycle-runner';

export type { SceneComponentTypeResolver } from './component-catalog';
export {
    SceneComponentCatalog,
    getSceneComponentTypeName,
} from './component-catalog';

export { SceneGeometryMeshBuilder } from './scene-geometry-mesh-builder';

export type {
    SceneShaderRegistrationResult,
    SceneShaderResource,
} from './shader-registry';
export {
    cloneSceneShaderDefinition,
    SceneShaderRegistry,
} from './shader-registry';
export type { SceneShaderFactoryOptions } from './scene-shader-factory';
export {
    generateSceneShaderVariantKey,
    SceneShaderFactory,
} from './scene-shader-factory';
export type { SceneShaderVariantResolverDependencies } from './scene-shader-variant-resolver';
export { SceneShaderVariantResolver } from './scene-shader-variant-resolver';

export type {
    SceneMaterialResource,
    SceneMaterialTextureBinding,
    SceneMaterialTextureSlot,
} from './material-registry';
export {
    cloneSceneMaterialSurfaceDefinition,
    cloneSceneMaterialDefinition,
    normalizeSceneTextureBinding,
    SceneMaterialRegistry,
} from './material-registry';
export { FEATURE_TO_KEYWORD, resolveSurfaceFeatures } from './material-feature-keyword-map';
export type {
    SceneMaterialCloneEvent,
    SceneMaterialKeywordChangeEvent,
    SceneMaterialLifecycleEvent,
    SceneMaterialTextureChangeEvent,
    SceneMaterialUniformChangeEvent,
} from './material-observables';
export { SceneMaterialObservables } from './material-observables';
export type {
    SceneMaterialAdapterDependencies,
    SceneMaterialAdapterTextureEntry,
} from './scene-material-instance-adapter';
export {
    convertSceneUniformValue,
    SceneMaterialInstanceAdapter,
} from './scene-material-instance-adapter';
export type {
    SceneMaterialTextureBinderResources,
    SceneMaterialTextureUniformSetter,
} from './material-texture-binder';
export { SceneMaterialTextureBinder } from './material-texture-binder';

export type {
    SceneMeshRegistrationResult,
    SceneMeshResource,
} from './mesh-registry';
export {
    cloneSceneMeshDefinition,
    SceneMeshRegistry,
} from './mesh-registry';
export type { SceneMeshFactoryOptions } from './scene-mesh-factory';
export { SceneMeshFactory } from './scene-mesh-factory';

export type { SceneLightingState } from './lighting-collector';
export { SceneLightingCollector } from './lighting-collector';
export { SceneLightingUniformBinder } from './lighting-uniform-binder';

export type { SceneFogState, SceneFogMode } from './fog-state';
export { DEFAULT_SCENE_FOG_STATE, resolveSceneFogState } from './fog-state';
export { SceneFogUniformBinder } from './fog-uniform-binder';

export type { SceneCameraFrameState } from './camera-frame-state';
export { SceneCameraFrameStateCollector } from './camera-frame-state';
export { selectSceneCamera } from './camera-selector';

export type { SceneFrameUniformContext } from './frame-uniform-binder';
export { SceneFrameUniformBinder } from './frame-uniform-binder';

export type { SceneLoopBridgeHost } from './loop-bridge';
export { createSceneLoopSystems } from './loop-bridge';

export { SceneDrawExecutionContextCache } from './rendering/draw-execution-context';
export type { SceneDrawExecutorContext } from './rendering/draw-executor';
export { SceneDrawExecutor } from './rendering/draw-executor';
export { SceneRenderFrameState } from './rendering/render-frame-state';
export { SceneRenderPassPreparer } from './rendering/render-pass-preparer';
export type { SceneRenderItem } from './rendering/render-item-collector';
export { SceneRenderItemCollector } from './rendering/render-item-collector';

export type {
    SceneMorphMeshRegistry,
    SceneMorphMeshRuntimeOptions,
} from './morph-mesh-runtime';
export { SceneMorphMeshRuntime } from './morph-mesh-runtime';

export type {
    SceneResourceRuntimeClearCallbacks,
    SceneResourceRuntimeOptions,
    SceneResourceRuntimeSerializationResult,
} from './scene-resource-runtime';
export { SceneResourceRuntime } from './scene-resource-runtime';
export { SceneRenderStateApplier } from './rendering/render-state-applier';
export type { SceneUniformWriteTarget } from './uniform-writer';
export { SceneUniformWriter } from './uniform-writer';
export type { SceneSkinningUniformSource } from './skinning-uniform-binder';
export { SceneSkinningUniformBinder } from './skinning-uniform-binder';

export type {
    SceneSamplerRegistrationResult,
    SceneSamplerResource,
} from './sampler-registry';
export {
    cloneSceneSamplerDefinition,
    SceneSamplerRegistry,
} from './sampler-registry';

export type {
    SceneTextureRegistrationResult,
    SceneTextureResource,
} from './texture-registry';
export {
    cloneSceneTextureDefinition,
    SceneTextureRegistry,
} from './texture-registry';
export type { SceneTextureFactoryOptions } from './scene-texture-factory';
export { SceneTextureFactory } from './scene-texture-factory';
export type { SceneSnapshotLoaderOptions } from './scene-snapshot-loader';
export { SceneSnapshotLoader } from './scene-snapshot-loader';

export type { ResolvedSceneSurface } from './scene-surface-resolver';
export { resolveSceneSurface } from './scene-surface-resolver';

export {
    DEFAULT_SCENE_ATTRIBUTE_NAMES,
    SCENE_ATTRIBUTE_LOCATIONS,
} from './scene-vertex-layout';

export type {
    SceneRenderPassResource,
    SceneRenderPassRegistryOptions,
} from './rendering/render-pass-registry';
export {
    cloneSceneRenderPassDefinition,
    SceneRenderPassRegistry,
} from './rendering/render-pass-registry';

export type {
    SceneRenderRuntimeOptions,
    SceneRenderRuntimeParams,
} from './rendering/scene-render-runtime';
export { SceneRenderRuntime } from './rendering/scene-render-runtime';

export type { DirectionalLightConfig } from './components/directional-light';
export { DirectionalLight } from './components/directional-light';
export type { FollowCameraControllerConfig } from './components/follow-camera-controller';
export { FollowCameraController } from './components/follow-camera-controller';
export type {
    MeshRendererConfig,
    MeshRendererMorphConfig,
    MeshRendererSkinConfig,
} from './components/mesh-renderer';
export { MeshRenderer } from './components/mesh-renderer';
export type { PrefabNodeBindingConfig } from '@axrone/scene-prefab';
export { PrefabNodeBinding } from '@axrone/scene-prefab';
export type { OrbitCameraControllerConfig } from './components/orbit-camera-controller';
export { OrbitCameraController } from './components/orbit-camera-controller';
export type { PointLightConfig } from './components/point-light';
export { PointLight } from './components/point-light';
export type { SpotLightConfig } from './components/spot-light';
export { SpotLight } from './components/spot-light';
export type { TerrainConfig } from './components/terrain';
export { Terrain } from './components/terrain';
export {
    DEFAULT_TERRAIN_SPLAT_SHADER_ID,
    createTerrainSplatShaderDefinition,
} from './terrain-splat-shader';
export {
    DEFAULT_TERRAIN_FOLIAGE_SHADER_ID,
    createTerrainFoliageShaderDefinition,
} from './terrain-foliage-shader';
export type { AreaLightConfig, AreaLightShape } from './components/area-light';
export { AreaLight } from './components/area-light';
export type {
    TrailRendererConfig,
    TrailRendererGradientStop,
    TrailTextureMode,
    TrailAlignment,
} from './components/trail-renderer';
export { TrailRenderer } from './components/trail-renderer';
export type {
    LineRendererConfig,
    LineRendererGradientStop,
    LineTextureMode,
    LineAlignment,
} from './components/line-renderer';
export { LineRenderer } from './components/line-renderer';
export type { LODGroupConfig, LODLevel, LODLevelConfig } from './components/lod-group';
export { LODGroup } from './components/lod-group';
export type {
    ReflectionProbeConfig,
    ReflectionProbeMode,
    ReflectionProbeShape,
    ReflectionProbeRefreshMode,
    ReflectionProbeTimeSlicingMode,
    ReflectionProbeClearFlags,
} from './components/reflection-probe';
export { ReflectionProbe } from './components/reflection-probe';
export type {
    BillboardRendererConfig,
    BillboardMode,
} from './components/billboard-renderer';
export { BillboardRenderer } from './components/billboard-renderer';
export type {
    PathAgentConfig,
    PathAgentPathStatus,
    PathAgentObstacleAvoidanceQuality,
    PathAgentPath,
} from './components/path-agent';
export { PathAgent } from './components/path-agent';
export type {
    ParticleSystemConfig,
    ParticleRenderData,
    ParticleBurst,
    ParticleShapeType,
    ParticleSimulationSpace,
    ParticleRenderMode,
    ParticleBlendMode,
    ParticleSpriteMode,
    ParticleStopAction,
    ParticleColorMode,
} from './components/particle-system';
export { ParticleSystem } from './components/particle-system';
export { createParticleShaderDefinition, DEFAULT_SCENE_PARTICLE_SHADER_ID } from './particle-shader';
export type {
    SceneParticleBatchRuntimeOptions,
    SceneParticleBatchRuntimeRenderParams,
    SceneParticleBatchRuntimeRenderStats,
} from './rendering/particle-batch-runtime';
export { SceneParticleBatchRuntime } from './rendering/particle-batch-runtime';

export { decodeSceneValue, encodeSceneValue } from './serialization';
