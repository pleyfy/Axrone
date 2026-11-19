import type { Actor } from '@axrone/ecs-runtime';
import { RenderPipeline } from '@axrone/render-core';
import type {
    AnyPostProcessEffect,
    RenderCameraState,
    RenderClearState,
    RenderHdrSettings,
    RenderLight,
    RenderMaterialSnapshot,
    RenderPrimitiveInstance,
    ResolvedRenderPass,
    RenderTonemappingSettings,
} from '@axrone/render-core/types';
import {
    createWebGL2RenderPassLibrary,
    createWebGL2RenderResourceAllocator,
    defineWebGL2RenderPassExecutor,
    type ManagedWebGL2RenderPassLibrary,
    type WebGL2RenderResourceHandle,
} from '@axrone/render-webgl2/pipeline';
import type { BoundingSphere } from '@axrone/geometry';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { MeshRenderer } from '../components/mesh-renderer';
import type { SceneDrawExecutor, SceneDrawExecutorContext } from './draw-executor';
import type { SceneLightingState } from '../lighting-collector';
import { ScenePrimitiveCache } from './render-cache';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderItem } from './render-item-collector';
import type { SceneRenderPassResource } from './render-pass-registry';
import {
    planSceneFramebufferPasses,
    SCENE_FRAMEBUFFER_EMPTY_PLAN,
    type SceneFramebufferPassDefinition,
} from './scene-framebuffer-passes';
import {
    SceneFramebufferPassRuntime,
    type SceneFramebufferPassStats,
    type SceneFramebufferTextureBindings,
} from './scene-offscreen-framebuffer-passes';
import type { SceneSpriteBatchRuntime } from './sprite-batch-runtime';
import type { SceneParticleBatchRuntime } from './particle-batch-runtime';
import type { SceneLineBatchRuntime } from './line-batch-runtime';
import type { SceneBillboardBatchRuntime } from './billboard-batch-runtime';
import type {
    SceneInstancedMeshRuntime,
    SceneInstancedPassPlan,
} from './scene-instanced-mesh-runtime';
import type {
    SceneRenderCapabilities,
} from '../scene-render-capabilities';
import { SCENE_RENDER_CAPABILITIES_ALL } from '../scene-render-capabilities';
import type {
    SceneInstancingMode,
    SceneMaterialAlphaMode,
    SceneRenderPlanningOptions,
    SceneRenderPipelineSettings,
    SceneRenderPlanningStats,
} from '../types';

export interface SceneRenderPipelineParams {
    readonly actors?: readonly Actor[];
    readonly frame: number;
    readonly deltaSeconds: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly cameraFrame: SceneCameraFrameState;
    readonly lighting: SceneLightingState;
    readonly renderPass: SceneRenderPassResource;
    readonly drawContext: SceneDrawExecutorContext;
    readonly frameState: SceneRenderFrameState;
    readonly renderItems: readonly SceneRenderItem[];
    readonly resolveBounds: (renderer: MeshRenderer) => Readonly<BoundingSphere> | null | undefined;
    readonly resolveMaterial: (renderer: MeshRenderer) => {
        readonly materialId: string | null;
        readonly shadingModel: 'unlit' | 'pbr' | 'custom';
        readonly alphaMode: SceneMaterialAlphaMode;
        readonly transparent: boolean;
    };
    /**
     * Current material-registry revision. When both revisions are provided the
     * primitive list is cached per pass and reused while the scene is static.
     */
    readonly materialRevision?: number;
    /** Current mesh-registry revision; see {@link materialRevision}. */
    readonly meshRevision?: number;
    /** Current shader-registry revision; see {@link materialRevision}. */
    readonly shaderRevision?: number;
    /**
     * True when the scene's render-item list cache reported a hit for this
     * pass: the item set, transforms, camera and registry revisions are
     * unchanged, so an instanced plan may be replayed without rebuilding.
     */
    readonly renderListCacheHit?: boolean;
    /**
     * Material-pass ids declared by the materials in view (`refraction-copy`,
     * `sss-blur`). These schedule the offscreen framebuffer passes that run
     * between the opaque and transparent draws. Absent or empty keeps the frame
     * at its existing single-pass cost — no targets, no blit, no filter.
     */
    readonly enabledMaterialPassIds?: ReadonlySet<string> | readonly string[];
}

type SceneSpriteBatchRenderer = Pick<SceneSpriteBatchRuntime, 'render' | 'clear'>;
type SceneParticleBatchRenderer = Pick<SceneParticleBatchRuntime, 'render' | 'clear'>;
type SceneLineBatchRenderer = Pick<SceneLineBatchRuntime, 'render' | 'clear'>;
type SceneBillboardBatchRenderer = Pick<SceneBillboardBatchRuntime, 'render' | 'clear'>;

const DEFAULT_SCENE_RENDER_PLANNING_STATS: SceneRenderPlanningStats = Object.freeze({
    passCount: 0,
    opaqueCount: 0,
    transparentCount: 0,
    meshTransparentCount: 0,
    spriteTransparentCount: 0,
    spriteBatchCount: 0,
    skippedSpriteCount: 0,
    warnings: Object.freeze([]) as readonly string[],
});

/**
 * Empty submission inputs shared by mesh-free / light-free scenes. They are
 * module constants so the hot path never allocates a throwaway array.
 */
const EMPTY_PRIMITIVES: readonly RenderPrimitiveInstance[] = Object.freeze([]);
const EMPTY_PRIMITIVE_LOOKUP: ReadonlyMap<string, SceneRenderItem> = new Map();
const EMPTY_RENDER_LIGHTS: readonly RenderLight[] = Object.freeze([]);

const clampCosine = (value: number): number => Math.min(1, Math.max(-1, value));

const toVector3Tuple = (
    value:
        | { readonly x: number; readonly y: number; readonly z: number }
        | readonly [number, number, number]
): readonly [number, number, number] =>
    'x' in value ? [value.x, value.y, value.z] : [value[0], value[1], value[2]];

const toVector4Tuple = (
    value:
        | { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
        | readonly [number, number, number, number]
): readonly [number, number, number, number] =>
    'x' in value ? [value.x, value.y, value.z, value.w] : [value[0], value[1], value[2], value[3]];

const createDirectionalLightId = (index: number): string => `scene-light:directional:${index}`;
const createPointLightId = (index: number): string => `scene-light:point:${index}`;
const createSpotLightId = (index: number): string => `scene-light:spot:${index}`;

const toRenderBounds = (
    bounds: Readonly<BoundingSphere> | null | undefined
): RenderPrimitiveInstance['bounds'] | undefined => {
    if (!bounds) {
        return undefined;
    }

    return {
        center: toVector3Tuple(bounds.center),
        extents: [bounds.radius, bounds.radius, bounds.radius],
    };
};

const resolveRenderClearState = (
    cameraFrame: SceneCameraFrameState,
    renderPass: SceneRenderPassResource
): RenderClearState => {
    const clearFlags = cameraFrame.camera.clearFlags
        ? renderPass.clearFlags.filter((flag) => cameraFrame.camera.clearFlags.includes(flag))
        : renderPass.clearFlags;

    return {
        ...(clearFlags.includes('color')
            ? {
                  color: toVector4Tuple(renderPass.clearColor ?? cameraFrame.camera.clearColor),
              }
            : {}),
        ...(clearFlags.includes('depth')
            ? {
                  depth: renderPass.clearDepth ?? cameraFrame.camera.clearDepth,
              }
            : {}),
    };
};

const toRenderCameraState = (
    cameraFrame: SceneCameraFrameState,
    clearState: RenderClearState
): RenderCameraState => ({
    id: `scene-camera:${cameraFrame.camera.id}`,
    viewMatrix: cameraFrame.viewMatrix,
    projectionMatrix: cameraFrame.projectionMatrix,
    viewProjectionMatrix: cameraFrame.viewProjectionMatrix,
    camera3D: cameraFrame.camera3D,
    frustum: cameraFrame.camera3D.frustum,
    position: toVector3Tuple(cameraFrame.position),
    near: cameraFrame.camera.near,
    far: cameraFrame.camera.far,
    clearState,
});

const toRenderLights = (lighting: SceneLightingState): readonly RenderLight[] => {
    const lights: RenderLight[] = [];

    for (let index = 0; index < lighting.stats.selectedDirectionalCount; index += 1) {
        const offset = index * 3;
        lights.push({
            type: 'directional',
            id: createDirectionalLightId(index),
            direction: [
                lighting.directionalDirections[offset] ?? 0,
                lighting.directionalDirections[offset + 1] ?? -1,
                lighting.directionalDirections[offset + 2] ?? 0,
            ],
            color: [
                lighting.directionalColors[offset] ?? 1,
                lighting.directionalColors[offset + 1] ?? 1,
                lighting.directionalColors[offset + 2] ?? 1,
            ],
            intensity: lighting.directionalIntensities[index] ?? 1,
        });
    }

    for (let index = 0; index < lighting.stats.selectedPointCount; index += 1) {
        const offset = index * 3;
        lights.push({
            type: 'point',
            id: createPointLightId(index),
            position: [
                lighting.pointPositions[offset] ?? 0,
                lighting.pointPositions[offset + 1] ?? 0,
                lighting.pointPositions[offset + 2] ?? 0,
            ],
            color: [
                lighting.pointColors[offset] ?? 1,
                lighting.pointColors[offset + 1] ?? 1,
                lighting.pointColors[offset + 2] ?? 1,
            ],
            intensity: lighting.pointIntensities[index] ?? 1,
            range: lighting.pointRanges[index] ?? 1,
            attenuation: lighting.pointAttenuations[index] ?? 2,
        });
    }

    for (let index = 0; index < lighting.stats.selectedSpotCount; index += 1) {
        const offset = index * 3;
        lights.push({
            type: 'spot',
            id: createSpotLightId(index),
            position: [
                lighting.spotPositions[offset] ?? 0,
                lighting.spotPositions[offset + 1] ?? 0,
                lighting.spotPositions[offset + 2] ?? 0,
            ],
            direction: [
                lighting.spotDirections[offset] ?? 0,
                lighting.spotDirections[offset + 1] ?? -1,
                lighting.spotDirections[offset + 2] ?? 0,
            ],
            color: [
                lighting.spotColors[offset] ?? 1,
                lighting.spotColors[offset + 1] ?? 1,
                lighting.spotColors[offset + 2] ?? 1,
            ],
            intensity: lighting.spotIntensities[index] ?? 1,
            range: lighting.spotRanges[index] ?? 1,
            innerConeRadians: Math.acos(clampCosine(lighting.spotInnerConeCosines[index] ?? 0)),
            outerConeRadians: Math.acos(clampCosine(lighting.spotOuterConeCosines[index] ?? 0)),
        });
    }

    return lights;
};

const createMaterialSnapshot = (
    item: SceneRenderItem,
    resolvedMaterial: SceneRenderPipelineParams['resolveMaterial'] extends (
        renderer: MeshRenderer
    ) => infer TResult
        ? TResult
        : never
): RenderMaterialSnapshot => {
    const materialId = resolvedMaterial.materialId ?? `scene-material:${item.renderer.id}`;
    const baseQueue =
        resolvedMaterial.alphaMode === 'blend'
            ? 3000
            : resolvedMaterial.alphaMode === 'mask'
              ? 2450
              : 2000;

    return {
        id: materialId,
        model: resolvedMaterial.shadingModel,
        renderQueue: baseQueue + item.renderer.renderOrder,
        transparent: resolvedMaterial.transparent,
        alphaClipped: resolvedMaterial.alphaMode === 'mask',
        castsShadows: resolvedMaterial.transparent === false,
    };
};

const resolveSceneHdrOption = (
    settings: SceneRenderPipelineSettings | undefined
): false | true | Partial<RenderHdrSettings> => {
    const hdr = settings?.hdr;

    if (hdr === undefined || hdr === false) {
        return false;
    }

    if (hdr === true) {
        return true;
    }

    return {
        ...hdr,
        enabled: hdr.enabled ?? true,
    };
};

const isHdrEnabled = (value: false | true | Partial<RenderHdrSettings>): boolean =>
    value === true || (typeof value === 'object' && (value.enabled ?? true));

const resolveSceneTonemappingOption = (
    settings: SceneRenderPipelineSettings | undefined,
    hdrEnabled: boolean
): Partial<RenderTonemappingSettings> | undefined => {
    if (settings?.tonemapping) {
        return settings.tonemapping;
    }

    if (hdrEnabled) {
        return undefined;
    }

    return {
        mode: 'none',
    };
};

const resolveScenePostProcessOptions = (
    settings: SceneRenderPipelineSettings | undefined
): readonly AnyPostProcessEffect[] => settings?.postProcess ?? Object.freeze([]);

const hasEnabledScenePostProcessEffects = (
    settings: SceneRenderPipelineSettings | undefined
): boolean => settings?.postProcess?.some((effect) => effect.enabled !== false) ?? false;

const pushUniqueWarnings = (target: string[], warnings: readonly string[]): void => {
    for (let index = 0; index < warnings.length; index += 1) {
        const warning = warnings[index]!;
        if (!target.includes(warning)) {
            target.push(warning);
        }
    }
};

interface SceneRenderPipelineOptions {
    readonly gl: WebGL2RenderingContext;
    readonly drawExecutor: Pick<SceneDrawExecutor, 'execute'> & {
        readonly resetState?: () => void;
        readonly flushTextureBindings?: () => void;
    };
    readonly spriteBatchRuntime?: SceneSpriteBatchRenderer;
    readonly particleBatchRuntime?: SceneParticleBatchRenderer;
    readonly lineBatchRuntime?: SceneLineBatchRenderer;
    readonly billboardBatchRuntime?: SceneBillboardBatchRenderer;
    readonly planning?: SceneRenderPlanningOptions;
    readonly pipeline?: SceneRenderPipelineSettings;
    /**
     * Opt-in derived instanced draw path. `off` (default) keeps the individual
     * per-actor draw path byte-for-byte; `auto` groups homogeneous opaque
     * `MeshRenderer`s into one instanced draw per mesh/material/render-state.
     */
    readonly instancing?: SceneInstancingMode;
    /** Required when {@link instancing} is `auto`. */
    readonly instancedMeshRuntime?: Pick<SceneInstancedMeshRuntime, 'build' | 'draw'>;
    /**
     * Render families the scene registry can produce. When a family is absent
     * its collector/batch runtime is skipped for the frame instead of scanning
     * every actor and finding nothing.
     */
    readonly capabilities?: SceneRenderCapabilities;
}

interface ActiveExecutionState {
    readonly drawContext: SceneDrawExecutorContext;
    readonly frameState: SceneRenderFrameState;
    readonly primitiveLookup: ReadonlyMap<string, SceneRenderItem>;
    readonly instancedPlan: SceneInstancedPassPlan | null;
    readonly instancedDrawParams: Parameters<SceneInstancedMeshRuntime['draw']>[1] | null;
    instancedDrawCalls: number;
    readonly framebufferPlan: readonly SceneFramebufferPassDefinition[];
    framebufferStats: SceneFramebufferPassStats | null;
    framebufferResolved: boolean;
}

/**
 * Internal link from a built primitive back to its render item so the draw
 * pass can skip the per-primitive string-keyed lookup. Falls back to the
 * lookup map for primitives that were not produced by this pipeline.
 */
const PRIMITIVE_RENDER_ITEM: unique symbol = Symbol('axrone.scenePrimitiveRenderItem');

type ScenePrimitiveWithItem = RenderPrimitiveInstance & {
    [PRIMITIVE_RENDER_ITEM]?: SceneRenderItem;
};

interface MutablePrimitiveMatrices {
    worldMatrix: RenderPrimitiveInstance['worldMatrix'];
}

export class SceneRenderPipeline {
    private readonly _primitiveCache = new ScenePrimitiveCache();
    private readonly _options: SceneRenderPipelineOptions;
    private readonly _capabilities: SceneRenderCapabilities;
    private _activeExecution: ActiveExecutionState | null = null;
    private _backend: ManagedWebGL2RenderPassLibrary;
    private _pipeline: RenderPipeline<WebGL2RenderResourceHandle>;
    /**
     * Created on the first frame that actually schedules an offscreen pass, so
     * a scene without transmission or subsurface scattering never allocates a
     * framebuffer.
     */
    private _framebufferRuntime: SceneFramebufferPassRuntime | null = null;
    /**
     * Frame index the offscreen passes last ran for. A frame is drawn as
     * several scene passes, and the scene-colour copy is a per-frame resolve:
     * repeating it per scene pass would multiply its cost.
     */
    private _framebufferFrame = -1;

    constructor(options: SceneRenderPipelineOptions) {
        this._options = options;
        this._capabilities = options.capabilities ?? SCENE_RENDER_CAPABILITIES_ALL;
        this._backend = this._createBackend();
        this._pipeline = this._createPipeline();
    }

    get framebufferTextureBindings(): SceneFramebufferTextureBindings | null {
        return this._framebufferRuntime?.getTextureBindings() ?? null;
    }

    private _ensureFramebufferRuntime(): SceneFramebufferPassRuntime {
        if (this._framebufferRuntime === null) {
            this._framebufferRuntime = new SceneFramebufferPassRuntime(this._options.gl);
        }

        return this._framebufferRuntime;
    }

    private _createBackend(): ManagedWebGL2RenderPassLibrary {
        const hdr = resolveSceneHdrOption(this._options.pipeline);
        const hdrEnabled = isHdrEnabled(hdr);
        const tonemapping = resolveSceneTonemappingOption(this._options.pipeline, hdrEnabled);
        const hasPostProcess = hasEnabledScenePostProcessEffects(this._options.pipeline);

        return createWebGL2RenderPassLibrary({
            gl: this._options.gl,
            directFrameOutput:
                !hdrEnabled && (tonemapping?.mode ?? 'none') === 'none' && !hasPostProcess,
            executors: [
                defineWebGL2RenderPassExecutor({
                    kind: 'opaque',
                    name: 'scene-draw-opaque',
                    execute: (pass) => this._executeDrawPass(pass),
                }),
                defineWebGL2RenderPassExecutor({
                    kind: 'transparent',
                    name: 'scene-draw-transparent',
                    execute: (pass) => this._executeDrawPass(pass),
                }),
            ],
        });
    }

    private _createPipeline(): RenderPipeline<WebGL2RenderResourceHandle> {
        const hdr = resolveSceneHdrOption(this._options.pipeline);
        const hdrEnabled = isHdrEnabled(hdr);
        const tonemapping = resolveSceneTonemappingOption(this._options.pipeline, hdrEnabled);
        const postProcess = resolveScenePostProcessOptions(this._options.pipeline);

        return new RenderPipeline<WebGL2RenderResourceHandle>({
            name: 'SceneRenderPipeline',
            hdr,
            ...(tonemapping ? { tonemapping } : {}),
            shadows: false,
            gi: {
                mode: 'disabled',
            },
            volumetrics: {
                enabled: false,
            },
            lightBaking: false,
            postProcess,
            enableDepthPrepass: false,
            maxActiveReflectionProbes: 0,
            maxActiveLocalLights: 4,
            maxTransparentPrimitives: this._options.planning?.maxTransparentPrimitives,
            ...(this._options.pipeline?.maxPostProcessPasses !== undefined
                ? {
                      maxPostProcessPasses: this._options.pipeline.maxPostProcessPasses,
                  }
                : {}),
            backend: this._backend,
            resourceAllocator: createWebGL2RenderResourceAllocator(this._options.gl),
        });
    }

    private _executeDrawPass(pass: ResolvedRenderPass): { readonly drawCalls: number } {
        if (!this._activeExecution) {
            return { drawCalls: 0 };
        }

        const drawCallsBefore = this._activeExecution.frameState.drawCalls;
        const active = this._activeExecution;

        // The resolved scene colour only exists once the opaque draws landed in
        // the frame target, and every blended draw has to read it after that.
        // Resolving here — not in a separate scene pass — is what keeps opaque
        // and non-transmissive geometry from being drawn and blended twice.
        if (pass.kind === 'transparent' && !active.framebufferResolved) {
            active.framebufferResolved = true;
            if (active.framebufferPlan.length > 0) {
                active.framebufferStats = this
                    ._ensureFramebufferRuntime()
                    .execute(active.framebufferPlan);
                this._framebufferFrame = active.drawContext.frame;
            }
        }

        const primitiveLookup = this._activeExecution.primitiveLookup;
        const instancedPlan = this._activeExecution.instancedPlan;
        const instancedDrawParams = this._activeExecution.instancedDrawParams;

        // Instance groups only carry opaque state (depth-tested, unblended), so
        // they belong to the opaque pass. Drawing them first preserves the
        // pipeline's per-pass ordering guarantees: opaque draws are order
        // independent, transparent draws never take this path.
        if (pass.kind === 'opaque' && instancedPlan && instancedDrawParams) {
            const instancedRuntime = this._options.instancedMeshRuntime;
            if (instancedRuntime) {
                this._activeExecution.instancedDrawCalls = instancedRuntime.draw(
                    instancedPlan,
                    instancedDrawParams
                );
            }
        }

        const passItems = pass.items;
        if (passItems) {
            for (let index = 0; index < passItems.length; index += 1) {
                const primitive = passItems.at(index) as ScenePrimitiveWithItem;
                const item = primitive[PRIMITIVE_RENDER_ITEM] ?? primitiveLookup.get(primitive.id);
                if (item) {
                    this._options.drawExecutor.execute(
                        item,
                        this._activeExecution.drawContext,
                        this._activeExecution.frameState
                    );
                }
            }
        }

        // Release texture units kept bound by the draw executor's binding
        // cache; the next pass or render family starts from clean units.
        this._options.drawExecutor.flushTextureBindings?.();

        return {
            drawCalls: this._activeExecution.frameState.drawCalls - drawCallsBefore,
        };
    }

    render(params: SceneRenderPipelineParams): SceneRenderPlanningStats {
        this._options.drawExecutor.resetState?.();
        const clearState = resolveRenderClearState(params.cameraFrame, params.renderPass);
        const camera = toRenderCameraState(params.cameraFrame, clearState);
        // No registered light component can contribute a render light; the
        // per-frame conversion allocates arrays/objects for nothing.
        const lights = this._capabilities.lights
            ? toRenderLights(params.lighting)
            : EMPTY_RENDER_LIGHTS;

        const cacheEnabled =
            params.materialRevision !== undefined && params.meshRevision !== undefined;
        const meshesEnabled = this._capabilities.meshRenderers;
        const instancedRuntime =
            this._options.instancing === 'auto' && meshesEnabled
                ? (this._options.instancedMeshRuntime ?? null)
                : null;

        // When every render item in this pass is instanced the derived plan
        // owns the draws; otherwise the remaining items keep the individual
        // path. Building the plan first also lets the primitive cache and the
        // render-core classifier skip work for instanced actors.
        let instancedPlan: SceneInstancedPassPlan | null = null;
        let instancedDrawParams: Parameters<SceneInstancedMeshRuntime['draw']>[1] | null = null;
        let renderItems = params.renderItems;
        if (instancedRuntime) {
            instancedPlan = instancedRuntime.build({
                renderPass: params.renderPass,
                renderItems: params.renderItems,
                cameraFrame: params.cameraFrame,
                lighting: params.lighting,
                lightingValues: params.drawContext.lightingValues,
                fog: params.drawContext.fog,
                frame: params.frame,
                elapsedSeconds: params.drawContext.elapsedSeconds,
                deltaSeconds: params.deltaSeconds,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
                frameState: params.frameState,
                stable: params.renderListCacheHit === true,
                materialRevision: params.materialRevision ?? -1,
                meshRevision: params.meshRevision ?? -1,
                shaderRevision: params.shaderRevision ?? -1,
            });
            renderItems = instancedPlan.individualItems;
            instancedDrawParams = {
                renderPass: params.renderPass,
                cameraFrame: params.cameraFrame,
                lighting: params.lighting,
                lightingValues: params.drawContext.lightingValues,
                fog: params.drawContext.fog,
                frame: params.frame,
                elapsedSeconds: params.drawContext.elapsedSeconds,
                deltaSeconds: params.deltaSeconds,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
                frameState: params.frameState,
            };
        }

        let primitives: readonly RenderPrimitiveInstance[];
        let primitiveLookup: ReadonlyMap<string, SceneRenderItem>;
        let primitiveCacheHit = false;

        if (!meshesEnabled || renderItems.length === 0) {
            // A registry without mesh renderers (or a pass whose items are all
            // claimed by the instanced plan) has nothing to submit here.
            primitiveCacheHit = instancedPlan === null ? cacheEnabled : false;
            primitives = EMPTY_PRIMITIVES;
            primitiveLookup = EMPTY_PRIMITIVE_LOOKUP;
        } else if (cacheEnabled) {
            const cached = this._primitiveCache.resolve({
                rendererPassId: params.renderPass.rendererPassId,
                renderPass: params.renderPass,
                renderItems,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
                materialRevision: params.materialRevision!,
                meshRevision: params.meshRevision!,
                shaderRevision: params.shaderRevision ?? 0,
                build: (out, lookup) => this._buildPrimitives(params, renderItems, out, lookup),
                update: (primitives, items) => this._refreshPrimitiveMatrices(primitives, items),
            });
            primitives = cached.primitives;
            primitiveLookup = cached.lookup;
            primitiveCacheHit = cached.hit;
        } else {
            // No registry revisions supplied — caching would be unsound, so
            // rebuild exactly as before.
            const built: RenderPrimitiveInstance[] = [];
            const lookup = new Map<string, SceneRenderItem>();
            this._buildPrimitives(params, renderItems, built, lookup);
            primitives = built;
            primitiveLookup = lookup;
        }

        const framebufferPlan =
            params.frame === this._framebufferFrame
                ? SCENE_FRAMEBUFFER_EMPTY_PLAN
                : planSceneFramebufferPasses(params.enabledMaterialPassIds);
        if (framebufferPlan.length > 0) {
            this._ensureFramebufferRuntime().beginFrame(
                params.viewportWidth,
                params.viewportHeight
            );
        }

        const activeExecution: ActiveExecutionState = {
            drawContext: params.drawContext,
            frameState: params.frameState,
            primitiveLookup,
            instancedPlan,
            instancedDrawParams,
            instancedDrawCalls: 0,
            framebufferPlan,
            framebufferStats: null,
            framebufferResolved: false,
        };
        this._activeExecution = activeExecution;

        try {
            const result = this._pipeline.renderImmediate({
                frame: params.frame,
                deltaTime: params.deltaSeconds,
                viewport: {
                    width: params.viewportWidth,
                    height: params.viewportHeight,
                },
                camera,
                primitives,
                lights,
            });

            const meshTransparentCount = result.statistics.transparentCount;
            const warnings = [...result.warnings];
            const spriteStats =
                this._capabilities.sprites && this._options.spriteBatchRuntime && params.actors
                    ? this._options.spriteBatchRuntime.render({
                          actors: params.actors,
                          cameraFrame: params.cameraFrame,
                          renderPass: params.renderPass,
                          frameState: params.frameState,
                          viewportWidth: params.viewportWidth,
                          viewportHeight: params.viewportHeight,
                          ...(this._options.planning?.maxTransparentPrimitives !== undefined
                              ? {
                                    transparentBudget: {
                                        total: this._options.planning.maxTransparentPrimitives,
                                        remaining: Math.max(
                                            0,
                                            this._options.planning.maxTransparentPrimitives -
                                                meshTransparentCount
                                        ),
                                    },
                                }
                              : {}),
                      })
                    : null;

            if (spriteStats) {
                pushUniqueWarnings(warnings, spriteStats.warnings);
            }

            if (this._capabilities.particles && this._options.particleBatchRuntime && params.actors) {
                this._options.particleBatchRuntime.render({
                    actors: params.actors,
                    cameraFrame: params.cameraFrame,
                    frameState: params.frameState,
                    viewportWidth: params.viewportWidth,
                    viewportHeight: params.viewportHeight,
                });
            }

            if (this._capabilities.lines && this._options.lineBatchRuntime && params.actors) {
                this._options.lineBatchRuntime.render({
                    actors: params.actors,
                    cameraFrame: params.cameraFrame,
                    frameState: params.frameState,
                });
            }

            if (this._capabilities.billboards && this._options.billboardBatchRuntime && params.actors) {
                this._options.billboardBatchRuntime.render({
                    actors: params.actors,
                    cameraFrame: params.cameraFrame,
                    frameState: params.frameState,
                });
            }

            return Object.freeze({
                passCount: result.statistics.passCount,
                opaqueCount: result.statistics.opaqueCount + (instancedPlan?.instanceCount ?? 0),
                transparentCount: meshTransparentCount + (spriteStats?.drawnSpriteCount ?? 0),
                meshTransparentCount,
                spriteTransparentCount: spriteStats?.drawnSpriteCount ?? 0,
                spriteBatchCount: spriteStats?.spriteBatchCount ?? 0,
                skippedSpriteCount: spriteStats?.skippedSpriteCount ?? 0,
                ...(cacheEnabled ? { primitiveCacheHit } : {}),
                ...(instancedPlan !== null
                    ? {
                          instancing: 'auto' as const,
                          instancedGroupCount: instancedPlan.groupCount,
                          instancedInstanceCount: instancedPlan.instanceCount,
                          instancedDrawCalls: activeExecution.instancedDrawCalls,
                          instancedPlanReused: instancedPlan.reused,
                      }
                    : {}),
                refractionCopyCount: activeExecution.framebufferStats?.refractionCopyCount ?? 0,
                sssBlurCount: activeExecution.framebufferStats?.sssBlurCount ?? 0,
                ...(spriteStats ? { spriteBatchCacheHit: spriteStats.cacheHit === true } : {}),
                warnings: Object.freeze(warnings),
            });
        } finally {
            // Cached primitive lookups stay owned by the per-pass cache entry;
            // only the active execution reference is dropped here.
            this._activeExecution = null;
        }
    }

    private _buildPrimitives(
        params: SceneRenderPipelineParams,
        renderItems: readonly SceneRenderItem[],
        primitives: RenderPrimitiveInstance[],
        lookup: Map<string, SceneRenderItem>
    ): void {
        for (let index = 0; index < renderItems.length; index += 1) {
            const item = renderItems[index]!;
            const primitiveId = `scene-primitive:${item.renderer.id}`;
            const material = createMaterialSnapshot(item, params.resolveMaterial(item.renderer));

            const primitive: ScenePrimitiveWithItem = {
                id: primitiveId,
                meshId: item.renderer.meshId ?? `scene-mesh:${item.renderer.id}`,
                material,
                worldMatrix: item.transform.worldMatrix,
                bounds: toRenderBounds(params.resolveBounds(item.renderer)),
                sortBias: item.renderer.renderOrder,
                visible: item.renderer.visible,
                receivesLighting: item.renderer.receiveLighting,
            };
            primitive[PRIMITIVE_RENDER_ITEM] = item;
            primitives.push(primitive);
            lookup.set(primitiveId, item);
        }
    }

    /**
     * Refreshes only the world-matrix references of retained primitives.
     *
     * The transform keeps the same matrix instance across updates, but forcing
     * the getter also recomputes it if the transform moved this frame so the
     * primitive never holds stale data. Everything else (ids, material
     * snapshots, bounds, flags) is unchanged by a transform-only update.
     */
    private _refreshPrimitiveMatrices(
        primitives: readonly RenderPrimitiveInstance[],
        renderItems: readonly SceneRenderItem[]
    ): void {
        const count = Math.min(primitives.length, renderItems.length);
        for (let index = 0; index < count; index += 1) {
            (primitives[index] as MutablePrimitiveMatrices).worldMatrix =
                renderItems[index]!.transform.worldMatrix;
        }
    }

    private _disposeFramebufferRuntime(): void {
        this._framebufferRuntime?.dispose();
        this._framebufferRuntime = null;
        this._framebufferFrame = -1;
    }

    reset(): void {
        this._activeExecution = null;
        this._primitiveCache.clear();
        this._options.spriteBatchRuntime?.clear();
        this._options.particleBatchRuntime?.clear();
        this._options.lineBatchRuntime?.clear();
        this._options.billboardBatchRuntime?.clear();
        this._pipeline.dispose();
        this._backend.dispose();
        this._backend = this._createBackend();
        this._pipeline = this._createPipeline();
        this._disposeFramebufferRuntime();
    }

    /**
     * Recovers from a lost-and-restored WebGL context: forgets every cached
     * GPU handle without issuing GL delete calls (the objects are already
     * invalid) and rebuilds the backend so resources are recreated lazily on
     * the next frame.
     */
    invalidateContextResources(): void {
        this._activeExecution = null;
        this._primitiveCache.clear();
        // Batch runtimes drop their GL objects; delete calls are no-ops on a
        // lost context, so clear() is safe and resets their lazy creation.
        this._options.spriteBatchRuntime?.clear();
        this._options.particleBatchRuntime?.clear();
        this._options.lineBatchRuntime?.clear();
        this._options.billboardBatchRuntime?.clear();
        this._backend.invalidateContextResources();
        this._pipeline.dispose();
        this._pipeline = this._createPipeline();
        this._framebufferRuntime?.invalidateContextResources();
        this._framebufferFrame = -1;
    }

    dispose(): void {
        this._pipeline.dispose();
        this._backend.dispose();
        this._options.spriteBatchRuntime?.clear();
        this._options.particleBatchRuntime?.clear();
        this._options.lineBatchRuntime?.clear();
        this._options.billboardBatchRuntime?.clear();
        this._activeExecution = null;
        this._primitiveCache.clear();
        this._disposeFramebufferRuntime();
    }
}

export { DEFAULT_SCENE_RENDER_PLANNING_STATS };
