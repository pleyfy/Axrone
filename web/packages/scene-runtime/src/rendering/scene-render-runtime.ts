import type { IGLStateCache } from '@axrone/render-webgl2';
import { createLightingUniformValueMap } from '@axrone/lighting';
import type { LightingUniformValueMap } from '@axrone/lighting';
import { Vec3, Vec4 } from '@axrone/numeric';
import type { Actor } from '@axrone/ecs-runtime';
import { MeshRenderer } from '../components/mesh-renderer';
import { selectSceneCamera } from '../camera-selector';
import { Animator } from '../components/animator';
import { SceneCameraFrameStateCollector } from '../camera-frame-state';
import { SceneDrawExecutionContextCache } from './draw-execution-context';
import { SceneDrawExecutor } from './draw-executor';
import {
    REFRACTION_COPY_PASS_ID,
    SCENE_COLOR_COPY_TEXTURE_ID,
    SSS_BLUR_PASS_ID,
    SSS_BLUR_TEXTURE_ID,
} from './scene-framebuffer-passes';
import { SceneFrameUniformBinder } from '../frame-uniform-binder';
import { SceneFogUniformBinder } from '../fog-uniform-binder';
import { DEFAULT_SCENE_FOG_STATE, type SceneFogState } from '../fog-state';
import { SceneLightingCollector } from '../lighting-collector';
import type { SceneLightingState } from '../lighting-collector';
import { SceneLightingUniformBinder } from '../lighting-uniform-binder';
import { resolveSceneMaterialPass } from '../material-registry';
import { SceneMaterialTextureBinder } from '../material-texture-binder';
import { SceneMorphMeshRuntime } from '../morph-mesh-runtime';
import { SceneRenderFrameState } from './render-frame-state';
import { SceneRenderListCache } from './render-cache';
import { SceneRenderItemCollector } from './render-item-collector';
import type { SceneRenderItem } from './render-item-collector';
import { SceneRenderPipeline } from './scene-render-pipeline';
import { SceneRenderPassPreparer } from './render-pass-preparer';
import { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import {
    SCENE_RENDER_CAPABILITIES_ALL,
    type SceneRenderCapabilities,
} from '../scene-render-capabilities';
import { SceneSkinningUniformBinder } from '../skinning-uniform-binder';
import type { SceneBatchRuntimeFactory } from './batch-runtime-contract';
import { SceneInstancedMeshRuntime } from './scene-instanced-mesh-runtime';
import { resolveTilemapCameraRect } from './tilemap-render-item-collector';
import type { SceneTilemapRenderRuntimeLike } from './tilemap-render-runtime';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderPassResource } from './render-pass-registry';
import type {
    SceneClearFlag,
    SceneInstancingMode,
    SceneMeshDefinition,
    SceneRenderPlanningOptions,
    SceneRenderPipelineSettings,
    SceneRenderPlanningStats,
    SceneRenderStats,
    SceneUniformValue,
} from '../types';
import { SceneUniformWriter } from '../uniform-writer';

const EMPTY_ACTORS: readonly Actor[] = Object.freeze([]);
const EMPTY_RENDER_ITEMS: readonly SceneRenderItem[] = Object.freeze([]);
const OUTLINE_MATERIAL_PASS_ID = 'outline';
const EMPTY_OPTIONAL_MATERIAL_PASSES: ReadonlySet<string> = new Set<string>();
const OPTIONAL_MATERIAL_PASS_IDS: ReadonlySet<string> = new Set<string>([
    OUTLINE_MATERIAL_PASS_ID,
    REFRACTION_COPY_PASS_ID,
    SSS_BLUR_PASS_ID,
]);
const NO_CLEAR_FLAGS: readonly SceneClearFlag[] = Object.freeze([]);

export interface SceneRenderRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly ambientLight: Vec3;
    readonly skyLight: Vec3;
    readonly groundLight: Vec3;
    readonly defaultClearColor: Vec4;
    readonly getActors: () => readonly Actor[];
    readonly createMeshResource: (definition: SceneMeshDefinition) => SceneMeshResource;
    readonly disposeMesh: (mesh: SceneMeshResource) => void;
    readonly applyMissingVertexAttributeDefaults: (mesh: SceneMeshResource) => void;
    readonly planning?: SceneRenderPlanningOptions;
    readonly pipeline?: SceneRenderPipelineSettings;
    /**
     * Render families the scene registry can produce. Defaults to "all" so a
     * directly constructed runtime keeps the full pre-gating behaviour.
     */
    readonly capabilities?: SceneRenderCapabilities;
    /** Optional GL state cache — when provided, texture unbinds and raw-GL guards stay in sync. */
    readonly stateCache?: IGLStateCache;
    /** Initial fog state; updated at runtime via `setFogState`. */
    readonly fog?: SceneFogState;
    /** Opt-in derived instanced draw path; defaults to `off`. */
    readonly instancing?: SceneInstancingMode;
    /**
     * Optional render batch families (sprite/particle/line/billboard).
     *
     * The factory is supplied by the scene runtime composition: root scene
     * entries inject the full set, lean entries inject only the families
     * their registry exposes (or none). Omitting it keeps the four batch
     * families out of the module graph; the pipeline already skips a family
     * whose runtime is absent. Mesh and instanced-mesh draws are unaffected.
     */
    readonly batchRuntimes?: SceneBatchRuntimeFactory;
    /**
     * Optional opt-in tilemap draw sources. They are rendered after the batch
     * families for each pass through the shared sprite instance renderer.
     */
    readonly tilemapRuntimes?: () => readonly SceneTilemapRenderRuntimeLike[];
}

export interface SceneRenderRuntimeParams {
    readonly frame: number;
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    /** Interpolation factor between the previous and current fixed step. */
    readonly alpha?: number;
}

export class SceneRenderRuntime {
    private static readonly _EMPTY_PLANNING_STATS: SceneRenderPlanningStats = Object.freeze({
        passCount: 0,
        opaqueCount: 0,
        transparentCount: 0,
        meshTransparentCount: 0,
        spriteTransparentCount: 0,
        spriteBatchCount: 0,
        skippedSpriteCount: 0,
        warnings: Object.freeze([]) as readonly string[],
    });

    private readonly _lightingCollector: SceneLightingCollector;
    private readonly _cameraFrameCollector = new SceneCameraFrameStateCollector();
    private readonly _renderItemCollector = new SceneRenderItemCollector();
    private readonly _renderListCache = new SceneRenderListCache();
    private readonly _renderFrameState = new SceneRenderFrameState();
    private readonly _drawExecutionContextCache = new SceneDrawExecutionContextCache();
    private readonly _materialTextureBinder: SceneMaterialTextureBinder;
    private readonly _renderPassPreparer: SceneRenderPassPreparer;
    private readonly _renderStateApplier: SceneRenderStateApplier;
    private readonly _uniformWriter: SceneUniformWriter;
    private readonly _frameUniformBinder: SceneFrameUniformBinder;
    private readonly _lightingUniformBinder: SceneLightingUniformBinder;
    private readonly _fogUniformBinder: SceneFogUniformBinder;
    private readonly _skinningUniformBinder: SceneSkinningUniformBinder;
    private readonly _morphMeshRuntime: SceneMorphMeshRuntime;
    private readonly _drawExecutor: SceneDrawExecutor;
    private readonly _renderPipeline: SceneRenderPipeline;
    private readonly _instancedMeshRuntime: SceneInstancedMeshRuntime | null;
    private readonly _instancing: SceneInstancingMode;
    private readonly _capabilities: SceneRenderCapabilities;
    /**
     * Environment-only lighting resolved once for scenes whose registry has no
     * light components; re-collecting it per frame would scan every actor.
     */
    private _staticLighting: SceneLightingState | null = null;
    /**
     * Lighting uniform map for mesh-free scenes. Mesh draws are the only
     * consumer of `lightingValues`, so it is built once and then reused; no
     * draw path reads it while `meshRenderers` is false.
     */
    private _meshFreeLightingValues: LightingUniformValueMap | null = null;
    private _fogState: SceneFogState;
    private _planningStats: SceneRenderPlanningStats = SceneRenderRuntime._EMPTY_PLANNING_STATS;
    private readonly _textureUniformSetter = (
        shader: Parameters<SceneUniformWriter['write']>[0],
        name: string,
        value: SceneUniformValue | null | undefined
    ): void => {
        this._uniformWriter.write(shader, name, value);
    };
    /**
     * Memoized per-renderer blend resolution.
     *
     * The scene collector asks every actor's renderer whether it is blended on
     * every collection pass (which dynamic scenes run every frame). The answer
     * only depends on the material/shader resources and the pass, so caching
     * it keyed by those identities removes three registry lookups plus a
     * material-pass resolution per actor per frame.
     */
    private readonly _blendedCache = new WeakMap<
        import('../components/mesh-renderer').MeshRenderer,
        {
            readonly renderPass: import('./render-pass-registry').SceneRenderPassResource;
            readonly materialId: string | null;
            readonly material: unknown;
            readonly shader: unknown;
            readonly materialRevision: number;
            readonly shaderRevision: number;
            readonly value: boolean;
        }
    >();
    private _frameMaterialRevision = -1;
    private _frameShaderRevision = -1;
    private _outlineRenderPass: SceneRenderPassResource | null = null;
    private _outlineRenderPassOrder = 0;
    private _outlineRenderPassRendererPassId: string | null = null;
    private _optionalPassRevision = Number.NaN;
    private _optionalPassIds: ReadonlySet<string> = EMPTY_OPTIONAL_MATERIAL_PASSES;
    private _framebufferTextureKey = '';
    private _framePassSource: readonly SceneRenderPassResource[] | null = null;
    private _framePasses: readonly SceneRenderPassResource[] | null = null;

    constructor(private readonly _options: SceneRenderRuntimeOptions) {
        this._capabilities = _options.capabilities ?? SCENE_RENDER_CAPABILITIES_ALL;
        this._lightingCollector = new SceneLightingCollector(4);
        this._materialTextureBinder = new SceneMaterialTextureBinder(
            _options.gl,
            _options.stateCache
        );
        this._renderPassPreparer = new SceneRenderPassPreparer(
            _options.gl,
            _options.defaultClearColor
        );
        this._renderStateApplier = new SceneRenderStateApplier(_options.gl);
        this._uniformWriter = new SceneUniformWriter(_options.gl);
        this._frameUniformBinder = new SceneFrameUniformBinder(this._uniformWriter);
        this._lightingUniformBinder = new SceneLightingUniformBinder(this._uniformWriter);
        this._fogUniformBinder = new SceneFogUniformBinder(this._uniformWriter);
        this._skinningUniformBinder = new SceneSkinningUniformBinder(
            this._uniformWriter,
            this._options.gl
        );
        this._fogState = _options.fog ?? DEFAULT_SCENE_FOG_STATE;
        this._morphMeshRuntime = new SceneMorphMeshRuntime({
            gl: _options.gl,
            createMeshResource: _options.createMeshResource,
            disposeMesh: _options.disposeMesh,
        });
        this._drawExecutor = new SceneDrawExecutor({
            gl: _options.gl,
            resources: _options.resources,
            morphMeshRuntime: this._morphMeshRuntime,
            renderStateApplier: this._renderStateApplier,
            frameUniformBinder: this._frameUniformBinder,
            lightingUniformBinder: this._lightingUniformBinder,
            fogUniformBinder: this._fogUniformBinder,
            skinningUniformBinder: this._skinningUniformBinder,
            materialTextureBinder: this._materialTextureBinder,
            uniformWriter: this._uniformWriter,
            textureUniformSetter: this._textureUniformSetter,
            applyMissingVertexAttributeDefaults: _options.applyMissingVertexAttributeDefaults,
        });
        const batchRuntimes =
            _options.batchRuntimes?.({
                gl: _options.gl,
                resources: _options.resources,
                renderStateApplier: this._renderStateApplier,
                uniformWriter: this._uniformWriter,
                materialTextureBinder: this._materialTextureBinder,
                textureUniformSetter: this._textureUniformSetter,
                stateCache: _options.stateCache,
            }) ?? {};
        const spriteBatchRuntime = batchRuntimes.sprite ?? undefined;
        const particleBatchRuntime = batchRuntimes.particle ?? undefined;
        const lineBatchRuntime = batchRuntimes.line ?? undefined;
        const billboardBatchRuntime = batchRuntimes.billboard ?? undefined;
        this._instancing = _options.instancing ?? 'off';
        this._instancedMeshRuntime =
            this._instancing === 'auto'
                ? new SceneInstancedMeshRuntime({
                      gl: _options.gl,
                      resources: _options.resources,
                      renderStateApplier: this._renderStateApplier,
                      uniformWriter: this._uniformWriter,
                      lightingUniformBinder: this._lightingUniformBinder,
                      fogUniformBinder: this._fogUniformBinder,
                      materialTextureBinder: this._materialTextureBinder,
                      textureUniformSetter: this._textureUniformSetter,
                      // The instanced path binds its own group textures; the
                      // individual draw executor's texture cache must not trust
                      // its signature afterwards.
                      invalidateTextureBindings: () =>
                          this._drawExecutor.invalidateTextureBindings(),
                  })
                : null;
        this._renderPipeline = new SceneRenderPipeline({
            gl: _options.gl,
            drawExecutor: this._drawExecutor,
            spriteBatchRuntime,
            particleBatchRuntime,
            lineBatchRuntime,
            billboardBatchRuntime,
            planning: _options.planning,
            pipeline: _options.pipeline,
            capabilities: this._capabilities,
            ...(this._instancedMeshRuntime
                ? {
                      instancing: this._instancing,
                      instancedMeshRuntime: this._instancedMeshRuntime,
                  }
                : {}),
        });
    }

    get stats(): SceneRenderStats {
        return {
            frame: this._renderFrameState.frame,
            drawCalls: this._renderFrameState.drawCalls,
            trianglesSubmitted: this._renderFrameState.trianglesSubmitted,
            planning: this._planningStats,
        };
    }

    private _isBlendedRenderer(
        renderer: import('../components/mesh-renderer').MeshRenderer,
        renderPass: import('./render-pass-registry').SceneRenderPassResource
    ): boolean {
        // Fast path: the renderer revision, pass identity and per-frame
        // registry revisions fully determine the answer — the resource lookups
        // below would only re-confirm what the cache already knows.
        const cached = this._blendedCache.get(renderer);
        if (
            cached &&
            cached.renderPass === renderPass &&
            cached.materialId === renderer.materialId &&
            cached.materialRevision === this._frameMaterialRevision &&
            cached.shaderRevision === this._frameShaderRevision
        ) {
            return cached.value;
        }

        const materialId = renderer.materialId;
        const material =
            materialId !== null ? this._options.resources.materials.get(materialId) : undefined;
        const materialPass = material
            ? resolveSceneMaterialPass(material, renderPass.materialPassId)
            : null;
        const shader = material
            ? this._options.resources.shaders.get(materialPass?.shaderId ?? material.shaderId)
            : undefined;

        const value = this._computeBlendedRenderer(renderer, renderPass, material, shader);
        this._blendedCache.set(renderer, {
            renderPass,
            materialId,
            material: material ?? null,
            shader: shader ?? null,
            materialRevision: this._frameMaterialRevision,
            shaderRevision: this._frameShaderRevision,
            value,
        });
        return value;
    }

    private _computeBlendedRenderer(
        renderer: import('../components/mesh-renderer').MeshRenderer,
        renderPass: import('./render-pass-registry').SceneRenderPassResource,
        material: import('../material-registry').SceneMaterialResource | undefined,
        shader: import('../shader-registry').SceneShaderResource | undefined
    ): boolean {
        if (renderer.materialId === null || !material || !shader) {
            return false;
        }

        const materialPass = resolveSceneMaterialPass(material, renderPass.materialPassId);
        if (renderPass.materialPassId !== null && !materialPass) {
            return false;
        }

        return this._renderStateApplier.resolveBlendEnabled(shader, renderPass, materialPass);
    }

    /**
     * Appends the internally owned outline pass when a renderer in view uses a
     * material declaring one and no registered pass already drives it. The
     * synthetic pass stays out of the registry on purpose: a caller must keep
     * seeing exactly the pass set it configured.
     */
    private _resolveFramePasses(
        registeredPasses: readonly SceneRenderPassResource[]
    ): readonly SceneRenderPassResource[] {
        if (registeredPasses.length === 0 || !this._capabilities.meshRenderers) {
            return registeredPasses;
        }

        for (let index = 0; index < registeredPasses.length; index += 1) {
            if (registeredPasses[index]!.materialPassId === OUTLINE_MATERIAL_PASS_ID) {
                return registeredPasses;
            }
        }

        if (!this._declaresOutlineMaterialPass()) {
            return registeredPasses;
        }

        if (this._framePassSource === registeredPasses && this._framePasses !== null) {
            return this._framePasses;
        }

        const combined: SceneRenderPassResource[] = [];
        for (let index = 0; index < registeredPasses.length; index += 1) {
            combined.push(registeredPasses[index]!);
        }
        combined.push(this._createOutlineRenderPass(registeredPasses));

        this._framePassSource = registeredPasses;
        this._framePasses = Object.freeze(combined);
        return this._framePasses;
    }

    /**
     * Optional material passes (outline, offscreen framebuffer effects) the
     * scene's materials declare, keyed by material-registry revision. One
     * traversal feeds every conditional scene pass so adding a gated effect
     * does not add a per-frame actor scan.
     */
    private _getOptionalMaterialPassIds(): ReadonlySet<string> {
        const materials = this._options.resources.materials;
        const revision = materials.revision;
        if (typeof revision === 'number' && revision === this._optionalPassRevision) {
            return this._optionalPassIds;
        }

        this._optionalPassIds = this._scanOptionalMaterialPasses();
        this._optionalPassRevision = typeof revision === 'number' ? revision : Number.NaN;
        return this._optionalPassIds;
    }

    /**
     * Publishes the offscreen scene-colour copy and subsurface blur targets into
     * the texture registry under their well-known ids, so a gated material's
     * `_SceneColorTexture` / `_SubsurfaceBlurTexture` slot resolves to the real
     * target instead of falling back to the material's own textures. Targets are
     * persistent, so this runs only when the set or resolution actually changed.
     */
    private _syncFramebufferTextures(): void {
        const bindings = this._renderPipeline.framebufferTextureBindings;
        const sceneColor = bindings?.sceneColorTexture ?? null;
        const sssBlur = bindings?.sssBlurTexture ?? null;
        const key = `${sceneColor === null ? 0 : sceneColor.width}x${
            sceneColor === null ? 0 : sceneColor.height
        }/${sssBlur === null ? 0 : sssBlur.width}x${sssBlur === null ? 0 : sssBlur.height}`;
        if (key === this._framebufferTextureKey) {
            return;
        }

        this._framebufferTextureKey = key;
        const textures = this._options.resources.textures;
        if (sceneColor !== null) {
            textures.register(
                {
                    id: SCENE_COLOR_COPY_TEXTURE_ID,
                    source: {
                        kind: 'color',
                        color: [0, 0, 0, 1],
                        width: sceneColor.width,
                        height: sceneColor.height,
                    },
                },
                {
                    id: SCENE_COLOR_COPY_TEXTURE_ID,
                    texture: sceneColor,
                    width: sceneColor.width,
                    height: sceneColor.height,
                    samplerId: null,
                }
            );
        }

        if (sssBlur !== null) {
            textures.register(
                {
                    id: SSS_BLUR_TEXTURE_ID,
                    source: {
                        kind: 'color',
                        color: [0, 0, 0, 1],
                        width: sssBlur.width,
                        height: sssBlur.height,
                    },
                },
                {
                    id: SSS_BLUR_TEXTURE_ID,
                    texture: sssBlur,
                    width: sssBlur.width,
                    height: sssBlur.height,
                    samplerId: null,
                }
            );
        }
    }

    private _declaresOutlineMaterialPass(): boolean {
        return this._getOptionalMaterialPassIds().has(OUTLINE_MATERIAL_PASS_ID);
    }

    private _scanOptionalMaterialPasses(): ReadonlySet<string> {
        const actors = this._options.getActors();
        const materials = this._options.resources.materials;
        const declared = new Set<string>();

        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index];
            if (!actor?.active) {
                continue;
            }

            const materialId = actor.getComponent(MeshRenderer)?.materialId ?? null;
            if (materialId === null) {
                continue;
            }

            const passes = materials.get(materialId)?.passes;
            if (!passes) {
                continue;
            }

            for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
                const passId = passes[passIndex]?.id;
                if (passId === undefined || !OPTIONAL_MATERIAL_PASS_IDS.has(passId)) {
                    continue;
                }

                declared.add(passId);
            }
        }

        return declared;
    }

    private _createOutlineRenderPass(
        registeredPasses: readonly SceneRenderPassResource[]
    ): SceneRenderPassResource {
        let order = registeredPasses[0]!.order;
        for (let index = 1; index < registeredPasses.length; index += 1) {
            const passOrder = registeredPasses[index]!.order;
            if (passOrder > order) {
                order = passOrder;
            }
        }
        const rendererPassId = registeredPasses[0]!.rendererPassId;

        if (
            this._outlineRenderPass !== null &&
            this._outlineRenderPassOrder === order &&
            this._outlineRenderPassRendererPassId === rendererPassId
        ) {
            return this._outlineRenderPass;
        }

        this._outlineRenderPassOrder = order;
        this._outlineRenderPassRendererPassId = rendererPassId;
        this._outlineRenderPass = Object.freeze({
            id: OUTLINE_MATERIAL_PASS_ID,
            order: order + 1,
            rendererPassId,
            materialPassId: OUTLINE_MATERIAL_PASS_ID,
            enabled: true,
            clearFlags: NO_CLEAR_FLAGS,
            clearColor: null,
            clearDepth: null,
        });
        return this._outlineRenderPass;
    }

    private _resolveLightingValues(lighting: SceneLightingState): LightingUniformValueMap {
        if (this._capabilities.meshRenderers) {
            return createLightingUniformValueMap(lighting);
        }

        if (!this._meshFreeLightingValues) {
            this._meshFreeLightingValues = createLightingUniformValueMap(lighting);
        }
        return this._meshFreeLightingValues;
    }

    private _resolveLighting(
        actors: readonly Actor[],
        cameraPosition: Readonly<Vec3> | undefined
    ): SceneLightingState {
        if (this._capabilities.lights) {
            return this._lightingCollector.collect(
                actors,
                this._options.ambientLight,
                this._options.skyLight,
                this._options.groundLight,
                cameraPosition
            );
        }

        // No light component is registered, so the actor scan can never find
        // one. Resolve the environment-only state once and reuse it.
        if (!this._staticLighting) {
            this._staticLighting = this._lightingCollector.collect(
                EMPTY_ACTORS,
                this._options.ambientLight,
                this._options.skyLight,
                this._options.groundLight
            );
        }
        return this._staticLighting;
    }

    render(params: SceneRenderRuntimeParams): void {
        const renderFrame = this._renderFrameState.begin(params.frame);
        renderFrame.setTrackActiveRenderers(this._morphMeshRuntime.hasCachedMeshes);
        this._planningStats = SceneRenderRuntime._EMPTY_PLANNING_STATS;
        this._frameMaterialRevision = this._options.resources.materials.revision;
        this._frameShaderRevision = this._options.resources.shaders.revision;
        const actors = this._options.getActors();
        if (params.alpha !== undefined && params.alpha > 0) {
            for (let index = 0; index < actors.length; index += 1) {
                const animator = actors[index]!.getComponent(Animator);
                if (animator?.interpolateOnRender) {
                    animator.applyInterpolatedPose(params.alpha);
                }
            }
        }
        const camera = selectSceneCamera(actors);
        const cameraFrame = this._cameraFrameCollector.collect(
            camera,
            params.viewportWidth,
            params.viewportHeight
        );
        const lighting = this._resolveLighting(actors, cameraFrame?.position);
        // Derive the lighting uniform map once per frame — every mesh draw
        // in every pass below shares it instead of rebuilding it per draw.
        // Sprite / particle / line / billboard passes do not read it, so mesh-
        // free scenes skip building it entirely.
        const lightingValues = this._resolveLightingValues(lighting);
        const registeredPasses = this._options.resources.renderPasses.getEnabledResources();
        const renderPasses = this._resolveFramePasses(registeredPasses);

        if (renderPasses.length === 0) {
            return;
        }
        this._syncFramebufferTextures();
        this._options.gl.viewport(0, 0, params.viewportWidth, params.viewportHeight);

        let planningPassCount = 0;
        let planningOpaqueCount = 0;
        let planningTransparentCount = 0;
        let planningMeshTransparentCount = 0;
        let planningSpriteTransparentCount = 0;
        let planningSpriteBatchCount = 0;
        let planningSkippedSpriteCount = 0;
        let planningSpriteBatchPassCount = 0;
        let planningSpriteBatchCacheHit = true;
        let planningRenderListCacheHit = true;
        let planningPrimitiveCacheHit = true;
        let planningInstanced = false;
        let planningInstancedGroupCount = 0;
        let planningInstancedInstanceCount = 0;
        let planningInstancedDrawCalls = 0;
        let planningInstancedPlanReused = true;
        let planningCachedPassCount = 0;
        const planningWarnings: string[] = [];

        for (const renderPass of renderPasses) {
            if (!cameraFrame) {
                this._renderPassPreparer.prepare(renderPass);
                continue;
            }

            const drawContext = this._drawExecutionContextCache.prepare({
                renderPass,
                cameraFrame,
                lighting,
                lightingValues,
                fog: this._fogState,
                elapsedSeconds: params.elapsedSeconds,
                deltaSeconds: params.deltaSeconds,
                frame: params.frame,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
            });

            const materialRevision = this._options.resources.materials.revision;
            const meshRevision = this._options.resources.meshes.revision;
            const shaderRevision = this._options.resources.shaders.revision;

            // Reuses the previous sorted item list when nothing render-relevant
            // changed; otherwise runs the full collect/cull/sort path. A
            // registry without mesh renderers cannot produce any item, so the
            // collect path (two component probes per actor) is skipped.
            let renderItems: readonly SceneRenderItem[] = EMPTY_RENDER_ITEMS;
            let renderListCacheHit = true;
            if (this._capabilities.meshRenderers) {
                const renderListResult = this._renderListCache.resolve({
                    rendererPassId: renderPass.rendererPassId,
                    renderPass,
                    actors,
                    cameraFrame,
                    viewportWidth: params.viewportWidth,
                    viewportHeight: params.viewportHeight,
                    materialRevision,
                    meshRevision,
                    shaderRevision,
                    collect: () =>
                        this._renderItemCollector.collect(actors, renderPass.rendererPassId, {
                            cameraPosition: cameraFrame.position,
                            cameraFrustum: cameraFrame.camera3D.frustum,
                            resolveBounds: (renderer) => {
                                const meshId = renderer.meshId;
                                return meshId
                                    ? this._options.resources.meshes.getDefinition(meshId)?.bounds
                                    : undefined;
                            },
                            isBlended: (renderer) => this._isBlendedRenderer(renderer, renderPass),
                        }),
                });
                renderItems = renderListResult.items;
                renderListCacheHit = renderListResult.hit;
            }

            const meshPlanning = this._renderPipeline.render({
                frame: params.frame,
                deltaSeconds: params.deltaSeconds,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
                actors,
                cameraFrame,
                lighting,
                renderPass,
                drawContext,
                frameState: renderFrame,
                renderItems,
                materialRevision,
                meshRevision,
                shaderRevision,
                renderListCacheHit,
                enabledMaterialPassIds: this._getOptionalMaterialPassIds(),
                resolveBounds: (renderer) => {
                    const meshId = renderer.meshId;
                    return meshId
                        ? this._options.resources.meshes.getDefinition(meshId)?.bounds
                        : undefined;
                },
                resolveMaterial: (renderer) => {
                    const material =
                        renderer.materialId !== null
                            ? this._options.resources.materials.get(renderer.materialId)
                            : undefined;
                    const rawShadingModel = material?.surface?.shadingModel ?? 'custom';
                    const shadingModel =
                        rawShadingModel === 'unlit' || rawShadingModel === 'pbr'
                            ? rawShadingModel
                            : ('custom' as const);
                    return {
                        materialId: material?.id ?? renderer.materialId,
                        shadingModel,
                        alphaMode: material?.surface?.alphaMode ?? 'opaque',
                        transparent:
                            (material?.surface?.alphaMode ?? 'opaque') === 'blend' ||
                            this._isBlendedRenderer(renderer, renderPass),
                    };
                },
            });

            const tilemapRuntimes = this._options.tilemapRuntimes?.() ?? [];
            if (tilemapRuntimes.length > 0 && cameraFrame !== null) {
                const cameraRect = resolveTilemapCameraRect(
                    cameraFrame,
                    params.viewportWidth,
                    params.viewportHeight
                );
                if (cameraRect !== null) {
                    for (const runtime of tilemapRuntimes) {
                        runtime.render({
                            renderPass,
                            cameraFrame,
                            frameState: renderFrame,
                            cameraRect,
                        });
                    }
                }
            }

            planningCachedPassCount += 1;
            planningRenderListCacheHit = planningRenderListCacheHit && renderListCacheHit;            planningPrimitiveCacheHit =
                planningPrimitiveCacheHit && (meshPlanning.primitiveCacheHit ?? false);

            planningPassCount += meshPlanning.passCount;
            planningOpaqueCount += meshPlanning.opaqueCount;
            planningTransparentCount += meshPlanning.transparentCount;
            planningMeshTransparentCount += meshPlanning.meshTransparentCount;
            for (const warning of meshPlanning.warnings) {
                if (!planningWarnings.includes(warning)) {
                    planningWarnings.push(warning);
                }
            }

            planningSpriteTransparentCount += meshPlanning.spriteTransparentCount;
            planningSpriteBatchCount += meshPlanning.spriteBatchCount;
            planningSkippedSpriteCount += meshPlanning.skippedSpriteCount;
            if (meshPlanning.instancing !== undefined) {
                planningInstanced = true;
                planningInstancedGroupCount += meshPlanning.instancedGroupCount ?? 0;
                planningInstancedInstanceCount += meshPlanning.instancedInstanceCount ?? 0;
                planningInstancedDrawCalls += meshPlanning.instancedDrawCalls ?? 0;
                planningInstancedPlanReused =
                    planningInstancedPlanReused && meshPlanning.instancedPlanReused === true;
            }
            if (meshPlanning.spriteBatchCacheHit !== undefined) {
                planningSpriteBatchPassCount += 1;
                planningSpriteBatchCacheHit =
                    planningSpriteBatchCacheHit && meshPlanning.spriteBatchCacheHit;
            }
        }

        this._planningStats = Object.freeze({
            passCount: planningPassCount,
            opaqueCount: planningOpaqueCount,
            transparentCount: planningTransparentCount,
            meshTransparentCount: planningMeshTransparentCount,
            spriteTransparentCount: planningSpriteTransparentCount,
            spriteBatchCount: planningSpriteBatchCount,
            skippedSpriteCount: planningSkippedSpriteCount,
            ...(planningSpriteBatchPassCount > 0
                ? { spriteBatchCacheHit: planningSpriteBatchCacheHit }
                : {}),
            ...(planningCachedPassCount > 0
                ? {
                      renderListCacheHit: planningRenderListCacheHit,
                      primitiveCacheHit: planningPrimitiveCacheHit,
                  }
                : {}),
            ...(planningInstanced
                ? {
                      instancing: 'auto' as const,
                      instancedGroupCount: planningInstancedGroupCount,
                      instancedInstanceCount: planningInstancedInstanceCount,
                      instancedDrawCalls: planningInstancedDrawCalls,
                      instancedPlanReused: planningInstancedPlanReused,
                  }
                : {}),
            warnings: Object.freeze(planningWarnings),
        });

        this._options.gl.bindVertexArray(null);
        if (renderFrame.tracksActiveRenderers) {
            this._morphMeshRuntime.prune(renderFrame.activeRendererIds);
        }
    }

    releaseBaseMesh(meshId: string): void {
        this._morphMeshRuntime.releaseBaseMesh(meshId);
    }

    /**
     * Updates the fog state used for subsequent render calls. When fog is
     * enabled the draw executor resolves the FOG shader variant and writes
     * fog uniforms to every mesh draw call.
     */
    setFogState(fog: SceneFogState): void {
        this._fogState = fog;
    }

    get fogState(): SceneFogState {
        return this._fogState;
    }

    clear(): void {
        this._planningStats = SceneRenderRuntime._EMPTY_PLANNING_STATS;
        this._renderListCache.clear();
        this._renderPassPreparer.reset();
        this._renderPipeline.reset();
        this._instancedMeshRuntime?.clear();
        this._morphMeshRuntime.clear();
    }

    /**
     * Forgets context-owned GPU caches after a restored WebGL context so the
     * next frame rebuilds them lazily. See
     * {@link SceneRenderPipeline.invalidateContextResources}.
     */
    invalidateContextResources(): void {
        this._planningStats = SceneRenderRuntime._EMPTY_PLANNING_STATS;
        this._renderPassPreparer.reset();
        this._renderPipeline.invalidateContextResources();
        this._instancedMeshRuntime?.invalidateContextResources();
        this._morphMeshRuntime.clear();
    }
}
