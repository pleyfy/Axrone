export type {
    SceneBuiltInComponentName,
    SceneRegistryBuilderOptions,
    SceneRegistryForBuiltIns,
} from './registry';
export {
    DEFAULT_SCENE_BUILT_IN_COMPONENTS,
    createSceneRegistry,
    getDefaultSceneBuiltInRegistry,
} from './registry';
export type { SceneRuntimeProfile, SceneRuntimeProfileContext } from './profile';
export {
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    createSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
    resolveSceneRegistryFromProfile,
} from './profile';
export type { SceneComponentTypeResolver } from './component-catalog';
export { SceneComponentCatalog, getSceneComponentTypeName } from './component-catalog';
export type { SceneShaderRegistrationResult, SceneShaderResource } from './shader-registry';
export { cloneSceneShaderDefinition, SceneShaderRegistry } from './shader-registry';
export type {
    SceneMaterialResource,
    SceneMaterialTextureBinding,
    SceneMaterialTextureSlot,
} from './material-registry';
export {
    cloneSceneMaterialDefinition,
    normalizeSceneTextureBinding,
    SceneMaterialRegistry,
} from './material-registry';
export type { SceneMeshRegistrationResult, SceneMeshResource } from './mesh-registry';
export { cloneSceneMeshDefinition, SceneMeshRegistry } from './mesh-registry';
export type { SceneLightingState } from './lighting-collector';
export { SceneLightingCollector } from './lighting-collector';
export type { SceneRenderItem } from './render-item-collector';
export { SceneRenderItemCollector } from './render-item-collector';
export type {
    SceneResourceRuntimeClearCallbacks,
    SceneResourceRuntimeOptions,
    SceneResourceRuntimeSerializationResult,
} from './scene-resource-runtime';
export { SceneResourceRuntime } from './scene-resource-runtime';
export type { SceneSamplerRegistrationResult, SceneSamplerResource } from './sampler-registry';
export { cloneSceneSamplerDefinition, SceneSamplerRegistry } from './sampler-registry';
export type { SceneTextureRegistrationResult, SceneTextureResource } from './texture-registry';
export { cloneSceneTextureDefinition, SceneTextureRegistry } from './texture-registry';
export type { SceneRenderPassResource, SceneRenderPassRegistryOptions } from './render-pass-registry';
export {
    cloneSceneRenderPassDefinition,
    SceneRenderPassRegistry,
} from './render-pass-registry';

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
} from './types';

export {
    SceneCanvasError,
    SceneError,
    SceneLifecycleError,
    SceneMaterialError,
    SceneMeshError,
    SceneShaderError,
} from './errors';

export type { CameraConfig } from './components/camera';
export { Camera } from './components/camera';

export type {
    AnimatorClipConfig,
    AnimatorConfig,
    AnimatorTrackConfig,
} from './components/animator';
export { Animator } from './components/animator';

export type { DirectionalLightConfig } from './components/directional-light';
export { DirectionalLight } from './components/directional-light';

export type {
    MeshRendererConfig,
    MeshRendererMorphConfig,
} from './components/mesh-renderer';
export { MeshRenderer } from './components/mesh-renderer';

export type { PrefabNodeBindingConfig } from './components/prefab-node-binding';
export { PrefabNodeBinding } from './components/prefab-node-binding';

export type { OrbitCameraControllerConfig } from './components/orbit-camera-controller';
export { OrbitCameraController } from './components/orbit-camera-controller';

export type { PointLightConfig } from './components/point-light';
export { PointLight } from './components/point-light';

export type { SpotLightConfig } from './components/spot-light';
export { SpotLight } from './components/spot-light';

export {
    FilterMode,
    TextureDimension,
    TextureFormat,
    TextureUsage,
    WrapMode,
} from '../renderer/webgl2/texture/interfaces';

export { decodeSceneValue, encodeSceneValue } from './serialization';

export { createScene, createUnlitColorShaderDefinition, Scene } from './scene';
