export type {
    SceneBuiltInRegistry,
    SceneCanvasOptions,
    SceneLoopState,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMeshSemantic,
    SceneMeshTopology,
    SceneOptions,
    SceneRegistry,
    SceneShaderDefinition,
    SceneShaderHandle,
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

export type { MeshRendererConfig } from './components/mesh-renderer';
export { MeshRenderer } from './components/mesh-renderer';

export { createScene, createUnlitColorShaderDefinition, Scene } from './scene';