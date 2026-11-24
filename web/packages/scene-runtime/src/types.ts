import type { BoundingSphere } from '@axrone/geometry';
import type { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type { EntityId, EntityConfig } from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { ComponentConstructor, ComponentRegistry } from '@axrone/ecs-runtime';
import type { System, SystemQuery } from '@axrone/ecs-runtime';
import type { GameLoopScheduler, GameLoopStatus } from '@axrone/game-loop';
import type { RenderShaderEffectDefinition } from '@axrone/render-core/shader-effect';
import type {
    AnyPostProcessEffect,
    RenderHdrSettings,
    RenderTonemappingSettings,
} from '@axrone/render-core/types';
import type { Camera } from './components/camera';
import type { Animator } from './components/animator';
import type { DirectionalLight } from './components/directional-light';
import type { FollowCameraController } from './components/follow-camera-controller';
import type { MeshRenderer } from './components/mesh-renderer';
import type { OrbitCameraController } from './components/orbit-camera-controller';
import type { PrefabNodeBinding } from '@axrone/scene-prefab';
import type { PointLight } from './components/point-light';
import type { SpriteRenderer } from './components/sprite-renderer';
import type { SpotLight } from './components/spot-light';
import type { Terrain } from './components/terrain';
import type { Hierarchy } from '@axrone/ecs-runtime';
import type { Transform } from '@axrone/ecs-runtime';
import type { ColorSpace, FilterMode, TextureFormat, WrapMode } from '@axrone/render-webgl2';
import type { SceneRuntimeProfile } from './scene-profile';
import type { SceneRuntimeComposition } from './scene-runtime-kernel';
import type { SceneRuntimeProfilerOptions } from './runtime-profiler';

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

import type {
    SceneSerializedValue,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    ScenePrefabOverrideOperation,
    ScenePrefabResolver,
} from '@axrone/scene-prefab';
export type {
    SceneSerializedValue,
    ScenePrefabId,
    ScenePrefabNodeId,
    ScenePrefabInstanceId,
    ScenePrefabComponentId,
    ScenePrefabPropertyPathSegment,
    ScenePrefabPropertyPath,
    ScenePrefabPropertyPathString,
    ScenePrefabNodeSource,
    ScenePrefabMetadata,
    ScenePrefabComponentSelector,
    ScenePrefabEntityField,
    ScenePrefabEntityFieldValue,
    SceneComponentSnapshot,
    SceneEntitySnapshot,
    ScenePrefabReference,
    ScenePrefabOverrideOperation,
    ScenePrefabNestedInstance,
    ScenePrefabDefinition,
    ScenePrefabConflictPolicy,
    ScenePrefabConflictResolution,
    ScenePrefabConflictBaseValue,
    ScenePrefabConflict,
    ScenePrefabConflictResolver,
    ScenePrefabMergeOptions,
    ScenePrefabDiffResult,
    ScenePrefabMergeResult,
    ScenePrefabMergeDefinitionResult,
    ScenePrefabResolvedDefinition,
    ScenePrefabResolveOptions,
    ScenePrefabResolutionResult,
    ScenePrefabRegistrySource,
    ScenePrefabResolver,
    ScenePrefabInstantiateOptions,
} from '@axrone/scene-prefab';

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
    readonly bounds?: BoundingSphere;
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
    readonly colorSpace?: ColorSpace;
}

export type SceneTextureBindingDefinition =
    | string
    | {
          readonly textureId: string;
          readonly samplerId?: string;
          readonly unit?: number;
      };

export type SceneMaterialShadingModel =
    | 'unlit'
    | 'pbr'
    | 'toon'
    | 'hair'
    | 'cloth'
    | 'water'
    | 'foliage'
    | 'sprite'
    | 'particle'
    | 'composable'
    | 'decal'
    | 'post-process'
    | 'volume';
export type SceneMaterialAlphaMode = 'opaque' | 'mask' | 'blend';
export type SceneMaterialUvSet = 0 | 1;

export interface SceneMaterialSurfaceFeaturesDefinition {
    readonly useVertexColor?: boolean;
    readonly hasSecondUv?: boolean;
    readonly useNormalMap?: boolean;
    readonly useTwoSided?: boolean;
    readonly useAlbedoMap?: boolean;
    readonly useOpacityMap?: boolean;
    readonly usePbrMap?: boolean;
    readonly useMetallicRoughnessMap?: boolean;
    readonly useOcclusionMap?: boolean;
    readonly useEmissiveMap?: boolean;
    readonly useClearcoat?: boolean;
    readonly useClearcoatMap?: boolean;
    readonly useClearcoatRoughnessMap?: boolean;
    readonly useClearcoatNormalMap?: boolean;
    readonly useAlphaTest?: boolean;
    readonly useAnisotropy?: boolean;
    readonly useSheen?: boolean;
    readonly useSubsurface?: boolean;
    readonly useTransmission?: boolean;
    readonly useIridescence?: boolean;
}

export interface SceneMaterialSurfaceTextureBindingDefinition {
    readonly textureId?: string | null;
    readonly samplerId?: string;
    readonly unit?: number;
    readonly texCoord?: SceneMaterialUvSet;
    readonly scale?: readonly [number, number];
    readonly offset?: readonly [number, number];
    readonly rotation?: number;
}

export interface SceneMaterialSurfaceDefinition {
    readonly shadingModel?: SceneMaterialShadingModel;
    readonly alphaMode?: SceneMaterialAlphaMode;
    readonly alphaCutoff?: number;
    readonly pbrUvSet?: SceneMaterialUvSet;
    readonly features?: SceneMaterialSurfaceFeaturesDefinition;
    readonly tilingOffset?: readonly [number, number, number, number];
    readonly albedo?: readonly [number, number, number, number];
    readonly albedoScale?: readonly [number, number, number];
    readonly normalScale?: number;
    readonly occlusion?: number;
    readonly roughness?: number;
    readonly metallic?: number;
    readonly clearcoat?: number;
    readonly clearcoatRoughness?: number;
    readonly clearcoatNormalScale?: number;
    readonly specularIntensity?: number;
    readonly emissive?: readonly [number, number, number];
    readonly emissiveScale?: readonly [number, number, number];
    readonly sheenFactor?: number;
    readonly sheenColor?: readonly [number, number, number];
    readonly sheenRoughness?: number;
    readonly anisotropy?: number;
    readonly anisotropyRotation?: number;
    readonly subsurfaceFactor?: number;
    readonly subsurfaceColor?: readonly [number, number, number];
    readonly subsurfaceThickness?: number;
    readonly transmissionFactor?: number;
    readonly ior?: number;
    readonly thickness?: number;
    readonly iridescenceFactor?: number;
    readonly iridescenceIor?: number;
    readonly iridescenceThickness?: number;
    readonly albedoMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly normalMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly pbrMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly metallicRoughnessMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly occlusionMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly emissiveMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly clearcoatMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly clearcoatRoughnessMap?: SceneMaterialSurfaceTextureBindingDefinition;
    readonly clearcoatNormalMap?: SceneMaterialSurfaceTextureBindingDefinition;
}

export type SceneMaterialPassPrimitive = 'triangle-list' | 'line-list' | 'point-list';
export type SceneMaterialPolygonMode = 'fill' | 'line' | 'point';
export type SceneMaterialShadeModel = 'gouraud' | 'flat';
export type SceneMaterialCullMode = 'none' | 'front' | 'back';
export type SceneMaterialFrontFace = 'ccw' | 'cw';
export type SceneMaterialCompareFunction =
    | 'never'
    | 'less'
    | 'equal'
    | 'lequal'
    | 'greater'
    | 'notequal'
    | 'gequal'
    | 'always';
export type SceneMaterialStencilOperation =
    | 'keep'
    | 'zero'
    | 'replace'
    | 'invert'
    | 'incr'
    | 'incr-wrap'
    | 'decr'
    | 'decr-wrap';
export type SceneMaterialBlendFactor =
    | 'zero'
    | 'one'
    | 'src-color'
    | 'one-minus-src-color'
    | 'dst-color'
    | 'one-minus-dst-color'
    | 'src-alpha'
    | 'one-minus-src-alpha'
    | 'dst-alpha'
    | 'one-minus-dst-alpha'
    | 'constant-color'
    | 'one-minus-constant-color'
    | 'constant-alpha'
    | 'one-minus-constant-alpha'
    | 'src-alpha-saturate';
export type SceneMaterialBlendOperation =
    | 'add'
    | 'subtract'
    | 'reverse-subtract'
    | 'min'
    | 'max';

export interface SceneMaterialStencilFaceStateDefinition {
    readonly stencilTest?: boolean;
    readonly stencilFunc?: SceneMaterialCompareFunction;
    readonly stencilReadMask?: number;
    readonly stencilWriteMask?: number;
    readonly stencilFailOp?: SceneMaterialStencilOperation;
    readonly stencilZFailOp?: SceneMaterialStencilOperation;
    readonly stencilPassOp?: SceneMaterialStencilOperation;
    readonly stencilRef?: number;
}

export interface SceneMaterialRasterizerStateDefinition {
    readonly discard?: boolean;
    readonly polygonMode?: SceneMaterialPolygonMode;
    readonly shadeModel?: SceneMaterialShadeModel;
    readonly cullMode?: SceneMaterialCullMode;
    readonly frontFace?: SceneMaterialFrontFace;
    readonly depthBias?: number;
    readonly depthBiasClamp?: number;
    readonly depthBiasSlopeScale?: number;
    readonly depthClip?: boolean;
    readonly multisample?: boolean;
    readonly lineWidth?: number;
}

export interface SceneMaterialDepthStencilStateDefinition {
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly depthFunc?: SceneMaterialCompareFunction;
    readonly front?: SceneMaterialStencilFaceStateDefinition;
    readonly back?: SceneMaterialStencilFaceStateDefinition;
}

export interface SceneMaterialBlendTargetStateDefinition {
    readonly blend?: boolean;
    readonly srcColorFactor?: SceneMaterialBlendFactor;
    readonly dstColorFactor?: SceneMaterialBlendFactor;
    readonly colorOp?: SceneMaterialBlendOperation;
    readonly srcAlphaFactor?: SceneMaterialBlendFactor;
    readonly dstAlphaFactor?: SceneMaterialBlendFactor;
    readonly alphaOp?: SceneMaterialBlendOperation;
    readonly colorWriteMask?: readonly [boolean, boolean, boolean, boolean];
}

export interface SceneMaterialBlendStateDefinition {
    readonly alphaToCoverage?: boolean;
    readonly independentBlend?: boolean;
    readonly blendColor?: readonly [number, number, number, number];
    readonly targets?: readonly SceneMaterialBlendTargetStateDefinition[];
}

export interface SceneMaterialPassDefinition {
    readonly id: string;
    readonly shaderId?: string;
    readonly phase?: string;
    readonly priority?: number;
    readonly primitive?: SceneMaterialPassPrimitive;
    readonly stage?: string;
    readonly rasterizerState?: SceneMaterialRasterizerStateDefinition;
    readonly depthStencilState?: SceneMaterialDepthStencilStateDefinition;
    readonly blendState?: SceneMaterialBlendStateDefinition;
}

export interface SceneShaderDefinition {
    readonly id: string;
    readonly vertexSource?: string;
    readonly fragmentSource?: string;
    readonly effect?: RenderShaderEffectDefinition;
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
    readonly surface?: SceneMaterialSurfaceDefinition;
    readonly passes?: readonly SceneMaterialPassDefinition[];
}

export interface SceneRenderPassDefinition {
    readonly id: string;
    readonly order?: number;
    readonly enabled?: boolean;
    readonly rendererPassId?: string;
    readonly materialPassId?: string;
    readonly clearFlags?: readonly SceneClearFlag[];
    readonly clearColor?: Vec4 | readonly [number, number, number, number] | null;
    readonly clearDepth?: number | null;
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
    readonly stencilTest?: boolean;
    readonly stencilFunc?: number;
    readonly stencilRef?: number;
    readonly stencilMask?: number;
    readonly stencilFail?: number;
    readonly stencilZFail?: number;
    readonly stencilZPass?: number;
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
    readonly profile?: SceneRuntimeProfile<R>;
    /**
     * Optional runtime composition (default-registry fallback and physics
     * bridge factories). The root scene entries install the full composition;
     * lean entries omit it to keep physics and the full manifest chain out of
     * their module graph.
     */
    readonly composition?: SceneRuntimeComposition<R>;
    readonly renderPlanning?: SceneRenderPlanningOptions;
    readonly renderPipeline?: SceneRenderPipelineSettings;
    /**
     * Opt-in derived instanced draw path for homogeneous opaque `MeshRenderer`
     * scenes. Default `off` keeps one draw call per entity; `auto` groups
     * eligible entities by mesh/material/render state into one instanced draw
     * per group while leaving the ECS/entity model, culling and per-component
     * API untouched. Ineligible entities (morph, skin, transparency, per-object
     * uniforms, unsupported shader shapes) keep the individual draw path.
     */
    readonly instancing?: SceneInstancingMode;
    readonly profiler?: boolean | SceneRuntimeProfilerOptions;
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
    readonly skyLight?: Vec3 | readonly [number, number, number];
    readonly groundLight?: Vec3 | readonly [number, number, number];
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
    readonly passIds: readonly string[];
}

export interface SceneTextureHandle {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly samplerId: string | null;
}

export interface SceneTextureResourceHandle extends SceneTextureHandle {
    readonly nativeTexture: WebGLTexture;
    readonly nativeSampler: WebGLSampler | null;
}

export interface SceneMaterialTextureBindingHandle {
    readonly materialId: string;
    readonly uniformName: string;
    readonly textureId: string;
    readonly samplerId: string | null;
    readonly unit: number | null;
    readonly width: number;
    readonly height: number;
    readonly nativeTexture: WebGLTexture;
    readonly nativeSampler: WebGLSampler | null;
}

export interface SceneSamplerHandle {
    readonly id: string;
}

export interface SceneRenderPassHandle {
    readonly id: string;
    readonly order: number;
    readonly rendererPassId: string;
    readonly materialPassId: string | null;
    readonly enabled: boolean;
}

// Prefab types moved to @axrone/scene-prefab
// (ScenePrefabDefinition, SceneSerializedValue, etc. are imported above)

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

export interface SceneSnapshotLoadOptions extends ScenePrefabInstantiateOptions {
    readonly clearExisting?: boolean;
}

export type SceneBuiltInRegistry = {
    readonly Hierarchy: typeof Hierarchy;
    readonly Transform: typeof Transform;
    readonly PrefabNodeBinding: typeof PrefabNodeBinding;
    readonly Animator: typeof Animator;
    readonly Camera: typeof Camera;
    readonly SpriteRenderer: typeof SpriteRenderer;
    readonly SpriteAnimator: typeof import('./components/sprite-animator').SpriteAnimator;
    readonly SpriteMask: typeof import('./components/sprite-mask').SpriteMask;
    readonly MeshRenderer: typeof MeshRenderer;
    readonly DirectionalLight: typeof DirectionalLight;
    readonly PointLight: typeof PointLight;
    readonly SpotLight: typeof SpotLight;
    readonly Terrain: typeof Terrain;
    readonly OrbitCameraController: typeof OrbitCameraController;
    readonly FollowCameraController: typeof FollowCameraController;
    readonly UIHost: typeof import('./components/ui-host').UIHost;
    readonly TilemapRenderer: typeof import('./components/tilemap-renderer').TilemapRenderer;
    readonly TilemapCollider2D: typeof import('./components/tilemap-collider-2d').TilemapCollider2D;
    readonly TilemapAgent: typeof import('./components/tilemap-agent').TilemapAgent;
};

export type SceneRegistry<R extends ComponentRegistry = Record<string, never>> = R &
    SceneBuiltInRegistry;

export interface SceneLoopState {
    readonly sceneId: string;
}

export interface SceneRenderPlanningOptions {
    readonly maxTransparentPrimitives?: number;
}

/**
 * Scene-level render mode for homogeneous `MeshRenderer` batching.
 * `off` (default) submits one draw per entity; `auto` derives instanced groups
 * for eligible opaque entities and falls back per entity otherwise.
 */
export type SceneInstancingMode = 'off' | 'auto';

export interface SceneRenderPipelineSettings {
    readonly hdr?: boolean | Partial<RenderHdrSettings>;
    readonly tonemapping?: Partial<RenderTonemappingSettings>;
    readonly postProcess?: readonly AnyPostProcessEffect[];
    readonly maxPostProcessPasses?: number;
}

export interface SceneRenderPlanningStats {
    readonly passCount: number;
    readonly opaqueCount: number;
    readonly transparentCount: number;
    readonly meshTransparentCount: number;
    readonly spriteTransparentCount: number;
    readonly spriteBatchCount: number;
    readonly skippedSpriteCount: number;
    /** Offscreen scene-colour copies issued for this pass (transmission). */
    readonly refractionCopyCount?: number;
    /** Offscreen subsurface blur passes issued for this pass. */
    readonly sssBlurCount?: number;
    /** Optional diagnostics: the sprite batch path reused its cached build. */
    readonly spriteBatchCacheHit?: boolean;
    /** Optional diagnostics: the 3D render-item collection was reused. */
    readonly renderListCacheHit?: boolean;
    /** Optional diagnostics: the 3D primitive list/material snapshots were reused. */
    readonly primitiveCacheHit?: boolean;
    /** Present when the opt-in instanced path is active for this pass. */
    readonly instancing?: SceneInstancingMode;
    /** Number of derived instance groups drawn (one draw call each). */
    readonly instancedGroupCount?: number;
    /** Number of entities submitted through the instanced path. */
    readonly instancedInstanceCount?: number;
    /** Draw calls issued by the instanced path this frame. */
    readonly instancedDrawCalls?: number;
    /** Optional diagnostics: the retained instance plan was replayed unchanged. */
    readonly instancedPlanReused?: boolean;
    readonly warnings: readonly string[];
}

export interface SceneRenderStats {
    readonly frame: number;
    readonly drawCalls: number;
    readonly trianglesSubmitted: number;
    readonly planning: SceneRenderPlanningStats;
}

export interface SceneEntityFactory<R extends ComponentRegistry = Record<string, never>> {
    createEntity(config?: EntityConfig): EntityId<World<SceneRegistry<R>>>;
}

export interface SceneLifecycle<R extends ComponentRegistry = Record<string, never>>
    extends SceneEntityFactory<R> {
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
    getTextureResource(id: string): SceneTextureResourceHandle | null;
}

export interface SceneSerializationHost {
    createPrefab(id: string, entities?: readonly EntityId[]): ScenePrefabDefinition;
    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options?: ScenePrefabInstantiateOptions
    ): readonly EntityId[];
    serializeScene(): SceneSnapshot;
    loadScene(
        snapshot: SceneSnapshot,
        options?: SceneSnapshotLoadOptions
    ): Promise<readonly EntityId[]>;
}

export interface SceneRenderPassHost {
    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle;
    getRenderPass(id: string): SceneRenderPassHandle | null;
    getRenderPasses(): readonly SceneRenderPassHandle[];
}
