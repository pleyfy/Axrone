import type { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type { Actor, ActorConfig } from '../component-system/core/actor';
import type { World } from '../component-system/core/world';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import type { GameLoopScheduler, GameLoopStatus } from '../game-loop';
import type { Camera } from './components/camera';
import type { Animator } from './components/animator';
import type { DirectionalLight } from './components/directional-light';
import type { MeshRenderer } from './components/mesh-renderer';
import type { OrbitCameraController } from './components/orbit-camera-controller';
import type { PrefabNodeBinding } from './components/prefab-node-binding';
import type { PointLight } from './components/point-light';
import type { SpotLight } from './components/spot-light';
import type { Hierarchy } from '../component-system/components/hierarchy';
import type { Transform } from '../component-system/components/transform';
import type { FilterMode, TextureFormat, WrapMode } from '../renderer/webgl2/texture/interfaces';

export type SceneMeshSemantic =
    | 'position'
    | 'normal'
    | 'uv0'
    | 'uv1'
    | 'tangent'
    | 'color0'
    | 'joints0'
    | 'weights0';
export type SceneMorphTargetSemantic = 'position' | 'normal' | 'tangent';
export type SceneMeshTopology = 'triangles' | 'lines' | 'points';
export type SceneClearFlag = 'color' | 'depth';

export type SceneUniformValue =
    | number
    | boolean
    | readonly number[]
    | Float32Array
    | Int32Array
    | Uint32Array
    | Vec2
    | Vec3
    | Vec4
    | Quat
    | Mat4;

export type SceneSerializedValue =
    | string
    | number
    | boolean
    | null
    | readonly SceneSerializedValue[]
    | { readonly [key: string]: SceneSerializedValue };

export interface SceneVertexAttribute {
    readonly semantic: SceneMeshSemantic;
    readonly componentCount: 1 | 2 | 3 | 4;
    readonly offset: number;
    readonly stride: number;
    readonly type?: number;
    readonly normalized?: boolean;
    readonly integer?: boolean;
}

export interface SceneMorphTargetAttribute {
    readonly semantic: SceneMorphTargetSemantic;
    readonly componentCount: 3;
    readonly values: Float32Array;
}

export interface SceneMorphTargetDefinition {
    readonly name?: string;
    readonly attributes: readonly SceneMorphTargetAttribute[];
}

export interface SceneMeshDefinition {
    readonly id: string;
    readonly vertices: BufferSource;
    readonly attributes: readonly SceneVertexAttribute[];
    readonly morphTargets?: readonly SceneMorphTargetDefinition[];
    readonly indices?: Uint8Array | Uint16Array | Uint32Array;
    readonly vertexCount?: number;
    readonly topology?: SceneMeshTopology;
    readonly usage?: number;
}

export interface SceneSamplerDefinition {
    readonly id: string;
    readonly minFilter?: FilterMode;
    readonly magFilter?: FilterMode;
    readonly wrapS?: WrapMode;
    readonly wrapT?: WrapMode;
    readonly wrapR?: WrapMode;
    readonly maxAnisotropy?: number;
}

export interface SceneTextureCompressedLevelDefinition {
    readonly level: number;
    readonly width: number;
    readonly height: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export type SceneTextureSourceDefinition =
    | {
          readonly kind: 'color';
          readonly color: readonly [number, number, number, number];
          readonly width?: number;
          readonly height?: number;
      }
    | {
          readonly kind: 'checker';
          readonly size?: number;
          readonly colorA?: readonly [number, number, number, number];
          readonly colorB?: readonly [number, number, number, number];
      }
    | {
          readonly kind: 'data';
          readonly width: number;
          readonly height: number;
          readonly data: readonly number[];
          readonly channels?: 1 | 2 | 3 | 4;
      }
    | {
          readonly kind: 'url';
          readonly url: string;
          readonly crossOrigin?: string | null;
        }
        | {
            readonly kind: 'bytes';
            readonly bytes: readonly number[] | Uint8Array;
            readonly mimeType: string;
            readonly uri?: string;
        }
        | {
            readonly kind: 'compressed';
            readonly bytes: readonly number[] | Uint8Array;
            readonly levels: readonly SceneTextureCompressedLevelDefinition[];
            readonly container?: 'ktx2' | 'basisu';
            readonly uri?: string;
      };

export interface SceneTextureDefinition {
    readonly id: string;
    readonly source: SceneTextureSourceDefinition;
    readonly format?: TextureFormat;
    readonly generateMipmaps?: boolean;
    readonly samplerId?: string;
}

export type SceneTextureBindingDefinition =
    | string
    | {
          readonly textureId: string;
          readonly samplerId?: string;
          readonly unit?: number;
      };

export interface SceneShaderDefinition {
    readonly id: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly attributes?: Partial<Record<SceneMeshSemantic, string>>;
    readonly uniforms?: readonly string[];
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface SceneMaterialDefinition {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms?: Readonly<Record<string, SceneUniformValue>>;
    readonly textures?: Readonly<Record<string, SceneTextureBindingDefinition>>;
}

export interface SceneRenderPassDefinition {
    readonly id: string;
    readonly order?: number;
    readonly enabled?: boolean;
    readonly rendererPassId?: string;
    readonly clearFlags?: readonly SceneClearFlag[];
    readonly clearColor?: Vec4 | readonly [number, number, number, number] | null;
    readonly clearDepth?: number | null;
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface SceneCanvasOptions {
    readonly canvas?: HTMLCanvasElement;
    readonly gl?: WebGL2RenderingContext;
    readonly parent?: HTMLElement;
    readonly width?: number;
    readonly height?: number;
    readonly pixelRatio?: number;
    readonly className?: string;
    readonly appendToDom?: boolean;
    readonly contextAttributes?: WebGLContextAttributes;
    readonly createCanvas?: () => HTMLCanvasElement;
}

export interface SceneOptions<R extends ComponentRegistry = Record<string, never>>
    extends SceneCanvasOptions {
    readonly registry?: R;
    readonly worldConfig?: {
        readonly maxEntities?: number;
        readonly enableMetrics?: boolean;
        readonly enableValidation?: boolean;
        readonly enableEventBatching?: boolean;
        readonly cacheSize?: number;
    };
    readonly scheduler?: GameLoopScheduler;
    readonly autoStart?: boolean;
    readonly fixedDelta?: number;
    readonly maxDelta?: number;
    readonly maxSubSteps?: number;
    readonly clearColor?: Vec4 | readonly [number, number, number, number];
    readonly ambientLight?: Vec3 | readonly [number, number, number];
    readonly renderPasses?: readonly SceneRenderPassDefinition[];
}

export interface SceneShaderHandle {
    readonly id: string;
    readonly uniformNames: readonly string[];
}

export interface SceneMeshHandle {
    readonly id: string;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly topology: SceneMeshTopology;
}

export interface SceneMaterialHandle {
    readonly id: string;
    readonly shaderId: string;
    readonly textureBindings: readonly string[];
}

export interface SceneTextureHandle {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly samplerId: string | null;
}

export interface SceneSamplerHandle {
    readonly id: string;
}

export interface SceneRenderPassHandle {
    readonly id: string;
    readonly order: number;
    readonly rendererPassId: string;
    readonly enabled: boolean;
}

export interface SceneComponentSnapshot {
    readonly type: string;
    readonly data: SceneSerializedValue;
}

export interface SceneActorSnapshot {
    readonly nodeId?: string;
    readonly parentNodeId?: string | null;
    readonly name: string;
    readonly layer: number;
    readonly tag: string;
    readonly active: boolean;
    readonly persistent: boolean;
    readonly pooled: boolean;
    readonly components: readonly SceneComponentSnapshot[];
}

export interface ScenePrefabDefinition {
    readonly id: string;
    readonly actors: readonly SceneActorSnapshot[];
}

export interface SceneSnapshot {
    readonly version: 1;
    readonly prefab: ScenePrefabDefinition;
    readonly shaders: readonly SceneShaderDefinition[];
    readonly meshes: readonly SceneMeshDefinition[];
    readonly materials: readonly SceneMaterialDefinition[];
    readonly textures: readonly SceneTextureDefinition[];
    readonly samplers: readonly SceneSamplerDefinition[];
    readonly renderPasses: readonly SceneRenderPassDefinition[];
}

export interface ScenePrefabInstantiateOptions {
    readonly namePrefix?: string;
    readonly componentArgsResolver?: (
        componentName: string,
        data: SceneSerializedValue
    ) => readonly unknown[] | undefined;
}

export interface SceneSnapshotLoadOptions extends ScenePrefabInstantiateOptions {
    readonly clearExisting?: boolean;
}

export type SceneBuiltInRegistry = {
    readonly Hierarchy: typeof Hierarchy;
    readonly Transform: typeof Transform;
    readonly PrefabNodeBinding: typeof PrefabNodeBinding;
    readonly Animator: typeof Animator;
    readonly Camera: typeof Camera;
    readonly MeshRenderer: typeof MeshRenderer;
    readonly DirectionalLight: typeof DirectionalLight;
    readonly PointLight: typeof PointLight;
    readonly SpotLight: typeof SpotLight;
    readonly OrbitCameraController: typeof OrbitCameraController;
};

export type SceneRegistry<R extends ComponentRegistry = Record<string, never>> = R &
    SceneBuiltInRegistry;

export interface SceneLoopState {
    readonly sceneId: string;
}

export interface SceneRenderStats {
    readonly frame: number;
    readonly drawCalls: number;
    readonly trianglesSubmitted: number;
}

export interface SceneActorFactory<R extends ComponentRegistry = Record<string, never>> {
    createActor(config?: ActorConfig): Actor<World<SceneRegistry<R>>>;
}

export interface SceneLifecycle<R extends ComponentRegistry = Record<string, never>>
    extends SceneActorFactory<R> {
    readonly status: GameLoopStatus;
    readonly isDisposed: boolean;
    readonly renderStats: SceneRenderStats;
    start(now?: number): this;
    pause(): this;
    resume(now?: number): this;
    stop(): this;
    renderNow(): this;
    resize(width?: number, height?: number, pixelRatio?: number): this;
    dispose(): void;
}

export interface SceneSystemHost<R extends ComponentRegistry = Record<string, never>> {
    addSystem<Q extends SystemQuery<SceneRegistry<R>>>(
        system: System<SceneRegistry<R>, Q>,
        phase?: string
    ): this;
    removeSystem(systemId: string): boolean;
}

export interface SceneComponentHost<R extends ComponentRegistry = Record<string, never>> {
    registerComponent<T extends ComponentConstructor>(componentType: T): this;
    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean;
    getRegisteredComponentNames(): readonly string[];
}

export interface SceneTextureHost {
    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle;
    getSampler(id: string): SceneSamplerHandle | null;
    registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle>;
    getTexture(id: string): SceneTextureHandle | null;
}

export interface SceneSerializationHost {
    createPrefab(id: string, actors?: readonly Actor[]): ScenePrefabDefinition;
    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options?: ScenePrefabInstantiateOptions
    ): readonly Actor[];
    serializeScene(): SceneSnapshot;
    loadScene(
        snapshot: SceneSnapshot,
        options?: SceneSnapshotLoadOptions
    ): Promise<readonly Actor[]>;
}

export interface SceneRenderPassHost {
    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle;
    getRenderPass(id: string): SceneRenderPassHandle | null;
    getRenderPasses(): readonly SceneRenderPassHandle[];
}
