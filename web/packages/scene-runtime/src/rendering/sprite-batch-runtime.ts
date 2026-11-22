import { Transform, type Actor } from '@axrone/ecs-runtime';
import { Rect } from '@axrone/numeric';
import { transformPoint2D } from '@axrone/render-core';
import {
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    Render2DSpriteBatchBuilder,
    isRender2DSpriteUniformNames,
    type Render2DRectLike,
    type Render2DSpriteMask,
    type Render2DSpriteBatchBuildResult,
    type Render2DSpriteBatchRange,
    type Render2DSpriteSource,
    type Render2DSpriteSubmission,
} from '@axrone/render-2d';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { SpriteMask } from '../components/sprite-mask';
import { SpriteRenderer } from '../components/sprite-renderer';
import { SceneMeshError } from '../errors';
import { resolveSceneMaterialPass, resolveSceneSpriteMaterialBinding } from '../material-registry';
import { SceneDirectGlPassGuard } from './internal/render-state-guard';
import type { SceneMaterialTextureUniformSetter } from '../material-texture-binder';
import { createRenderCacheCameraKey } from './render-cache-key';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import { SceneShaderFactory } from '../scene-shader-factory';
import type { SceneShaderResource } from '../shader-registry';
import { createSprite2DShaderDefinition } from '../sprite-2d-shader';
import { SceneSpriteRenderItemCollector } from './sprite-render-item-collector';
import { SpriteInstancedRenderer } from './sprite-instanced-renderer';
import { SpriteInstanceBufferRenderer } from './sprite-instance-buffer-renderer';
import { SceneSpriteInstanceRegistry } from './sprite-instance-registry';
import type { SceneUniformWriteTarget } from '../uniform-writer';

const MIN_CLIP_W = 1e-6;

/**
 * The general sprite batch builder splits at 2048 quads per batch. Below that
 * actor count the cached batch path is already a single draw, so the derived
 * instance registry only engages once a pass would otherwise split batches or
 * where per-frame submission churn dominates. Small scenes keep their existing
 * behaviour (and draw statistics) untouched.
 */
const DIRECT_INSTANCE_MIN_ACTORS = 2048;
const EMPTY_WARNINGS: readonly string[] = Object.freeze([]);

const projectWorldPoint = (
    matrix: ArrayLike<number>,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportWidth: number,
    viewportHeight: number,
    out: Float32Array
): Float32Array => {
    const clipX =
        (matrix[0] ?? 0) * worldX +
        (matrix[1] ?? 0) * worldY +
        (matrix[2] ?? 0) * worldZ +
        (matrix[3] ?? 0);
    const clipY =
        (matrix[4] ?? 0) * worldX +
        (matrix[5] ?? 0) * worldY +
        (matrix[6] ?? 0) * worldZ +
        (matrix[7] ?? 0);
    const clipW =
        (matrix[12] ?? 0) * worldX +
        (matrix[13] ?? 0) * worldY +
        (matrix[14] ?? 0) * worldZ +
        (matrix[15] ?? 0);

    if (!Number.isFinite(clipW) || Math.abs(clipW) <= MIN_CLIP_W) {
        out[0] = NaN;
        out[1] = NaN;
        return out;
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    out[0] = (ndcX * 0.5 + 0.5) * viewportWidth;
    out[1] = (ndcY * 0.5 + 0.5) * viewportHeight;
    return out;
};

interface SceneResolvedSpriteMaskState {
    readonly clipRect: Render2DRectLike | null;
    readonly mask: Render2DSpriteMask | null;
}

/**
 * Snapshot of a built sprite pass. The builder reuses its result object and
 * scratch buffers across calls, so a cache entry must own its batch ranges
 * and never retain the builder's `Render2DSpriteBatchBuildResult`.
 */
interface SceneSpriteMaskCacheSignature {
    readonly actor: Actor;
    readonly mask: SpriteMask;
    readonly transform: Transform;
    readonly actorRevision: number;
    readonly transformRevision: number;
    readonly maskRevision: number;
}

interface SceneSpriteBatchCacheEntry {
    readonly actors: readonly Actor[];
    readonly actorRevisions: Uint32Array;
    readonly transformRevisions: Uint32Array;
    readonly rendererRevisions: Uint32Array;
    /**
     * Index-aligned component references. `actor.revision` changes whenever the
     * component set changes, so a matched actor revision guarantees these refs
     * are still attached to the same actor.
     */
    readonly transformRefs: (Transform | null)[];
    readonly rendererRefs: (SpriteRenderer | null)[];
    readonly actorCount: number;
    readonly cameraKey: string;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly budgetTotal: number;
    readonly budgetRemaining: number;
    readonly renderableActorCount: number;
    readonly maskSignatures: readonly SceneSpriteMaskCacheSignature[];
    readonly batches: Render2DSpriteBatchRange[];
    readonly indexType: number;
    readonly rendererIds: string[];
    readonly stats: SceneSpriteBatchRuntimeRenderStats;
    readonly hitStats: SceneSpriteBatchRuntimeRenderStats;
    /** False when mask state could not be captured for safe replay. */
    readonly safe: boolean;
}

export interface SceneSpriteBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<
        SceneRenderStateApplier,
        'apply' | 'reset' | 'resolvePrimitiveMode' | 'resolvePrimitiveTopology'
    >;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly materialTextureBinder: Pick<
        import('../material-texture-binder').SceneMaterialTextureBinder,
        'bind' | 'unbind'
    >;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
    /**
     * Replays unchanged sprite passes from a cached build instead of
     * re-collecting, re-building and re-uploading every frame. Defaults to
     * enabled; disabled passes fall back to the full rebuild path.
     */
    readonly enableBatchCache?: boolean;
}

export interface SceneSpriteBatchRuntimeRenderParams {
    readonly actors: readonly Actor[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly renderPass: SceneRenderPassResource;
    readonly frameState: SceneRenderFrameState;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly transparentBudget?: SceneSpriteBatchRuntimeTransparentBudget;
}

export interface SceneSpriteBatchRuntimeTransparentBudget {
    readonly total: number;
    readonly remaining: number;
}

export interface SceneSpriteBatchRuntimeRenderStats {
    readonly drawnSpriteCount: number;
    readonly spriteBatchCount: number;
    readonly skippedSpriteCount: number;
    readonly warnings: readonly string[];
    /** True when the draw was replayed from the cached batch build. */
    readonly cacheHit?: boolean;
}

export class SceneSpriteBatchRuntime {
    private static readonly _EMPTY_STATS: SceneSpriteBatchRuntimeRenderStats = Object.freeze({
        drawnSpriteCount: 0,
        spriteBatchCount: 0,
        skippedSpriteCount: 0,
        warnings: Object.freeze([]) as readonly string[],
        cacheHit: false,
    });

    private readonly _collector = new SceneSpriteRenderItemCollector();
    private readonly _builder = new Render2DSpriteBatchBuilder();
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _guard: SceneDirectGlPassGuard;
    private readonly _submissions: Render2DSpriteSubmission[] = [];
    private readonly _submissionRendererIds: string[] = [];
    private readonly _batchCache = new Map<string, SceneSpriteBatchCacheEntry>();
    private readonly _missStreak = new Map<string, number>();
    private _instancedRenderer: SpriteInstancedRenderer | null = null;
    private _instancedUnavailable = false;
    private _instanceBufferRenderer: SpriteInstanceBufferRenderer | null = null;
    private _directInstanceUnavailable = false;
    private _textureSlotBudget = -1;
    private readonly _instanceRegistries = new Map<string, SceneSpriteInstanceRegistry>();
    private readonly _replayWarnings: string[] = [];
    private readonly _cacheEnabled: boolean;
    private readonly _worldPointScratch = new Float32Array(3);
    private readonly _screenPointScratch = new Float32Array(2);
    private _cachedBufferOwner: SceneSpriteBatchCacheEntry | null = null;
    private _defaultShader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _vertexBufferSize = 0;
    private _indexBuffer: WebGLBuffer | null = null;
    private _indexBufferSize = 0;
    private _attributesConfigured = false;
    private _scissorEnabled = false;
    private _activeClipRect: Render2DRectLike | null = null;
    private _activeMask: Render2DSpriteMask | null = null;

    constructor(private readonly _options: SceneSpriteBatchRuntimeOptions) {
        this._cacheEnabled = _options.enableBatchCache !== false;
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
        this._guard = new SceneDirectGlPassGuard({
            gl: _options.gl,
            renderStateApplier: _options.renderStateApplier,
            stateCache: _options.stateCache,
            label: 'sprite-batch',
        });
    }

    render(params: SceneSpriteBatchRuntimeRenderParams): SceneSpriteBatchRuntimeRenderStats {
        if (this._guard.isDisabled) {
            return SceneSpriteBatchRuntime._EMPTY_STATS;
        }

        const passId = params.renderPass.rendererPassId;

        // Derived fast path: homogeneous passes with a stable actor/component
        // graph stream straight into persistent instance buffers and skip the
        // per-frame collect/sort/submission work entirely.
        const direct = this._tryRenderDirectInstances(params, passId);
        if (direct) {
            return direct;
        }

        let cameraKey = '';
        let budgetTotal = -1;
        let budgetRemaining = -1;

        if (this._cacheEnabled) {
            cameraKey = createRenderCacheCameraKey(params.cameraFrame, {
                width: params.viewportWidth,
                height: params.viewportHeight,
            });
            if (params.transparentBudget) {
                budgetTotal = params.transparentBudget.total;
                budgetRemaining = params.transparentBudget.remaining;
            }

            const cached = this._batchCache.get(passId);
            if (
                cached &&
                this._canReplayCache(
                    cached,
                    params,
                    passId,
                    cameraKey,
                    budgetTotal,
                    budgetRemaining
                )
            ) {
                this._missStreak.delete(passId);
                return this._replayCache(cached, params, passId);
            }
        }

        const missStreak = (this._missStreak.get(passId) ?? 0) + 1;
        this._missStreak.set(passId, missStreak);
        const useInstanced = !this._cacheEnabled || missStreak >= 3;

        const items = this._collector.collect(params.actors, passId, {
            cameraFrustum: params.cameraFrame.camera3D.frustum,
        });
        if (items.length === 0) {
            this._dropCacheEntry(passId);
            return SceneSpriteBatchRuntime._EMPTY_STATS;
        }

        this._submissions.length = 0;
        this._submissionRendererIds.length = 0;
        const warnings: string[] = [];
        let skippedSpriteCount = 0;
        let maskCacheSafe = true;
        for (const item of items) {
            const source = this._resolveSource(item.renderer);
            if (!source) {
                skippedSpriteCount += 1;
                warnings.push(
                    `sprite '${item.renderer.id}' skipped: missing material and texture source`
                );
                continue;
            }

            const maskState = this._resolveMaskState(
                item.actor,
                params.cameraFrame,
                params.viewportWidth,
                params.viewportHeight
            );
            if (maskState === null) {
                maskCacheSafe = false;
                skippedSpriteCount += 1;
                warnings.push(`sprite '${item.renderer.id}' skipped: unresolved mask state`);
                continue;
            }

            params.frameState.markActiveRenderer(item.renderer.id);
            const renderSize = item.renderer.getRenderSize();
            const renderSourceSize = item.renderer.getRenderSourceSize();
            const sliceBorder = item.renderer.getRenderSliceBorder();
            this._submissions.push({
                source,
                worldMatrix: item.transform.worldMatrix.data,
                size: {
                    width: renderSize.x,
                    height: renderSize.y,
                },
                anchor: item.renderer.getRenderAnchor(),
                uvRect: item.renderer.getRenderUvRect(),
                color: item.renderer.getRenderColor(),
                clipRect: maskState.clipRect ?? undefined,
                mask: maskState.mask ?? undefined,
                slice: sliceBorder
                    ? {
                          sourceSize: {
                              width: renderSourceSize.x,
                              height: renderSourceSize.y,
                          },
                          border: sliceBorder,
                      }
                    : undefined,
                visible: item.renderer.visible,
                flipX: item.renderer.flipX,
                flipY: item.renderer.flipY,
            });
            this._submissionRendererIds.push(item.renderer.id);
        }

        if (this._submissions.length === 0) {
            this._dropCacheEntry(passId);
            return Object.freeze({
                drawnSpriteCount: 0,
                spriteBatchCount: 0,
                skippedSpriteCount,
                warnings: Object.freeze(warnings),
                cacheHit: false,
            });
        }

        let allowedSpriteCount = this._submissions.length;

        if (params.transparentBudget && allowedSpriteCount > params.transparentBudget.remaining) {
            allowedSpriteCount = Math.max(0, Math.floor(params.transparentBudget.remaining));
            const budgetSkipped = this._submissions.length - allowedSpriteCount;
            skippedSpriteCount += budgetSkipped;
            if (budgetSkipped > 0) {
                warnings.push(
                    `transparent primitive budget exceeded at ${params.transparentBudget.total}; skipped ${budgetSkipped} sprite submissions`
                );
            }
        }

        if (allowedSpriteCount === 0) {
            this._dropCacheEntry(passId);
            return Object.freeze({
                drawnSpriteCount: 0,
                spriteBatchCount: 0,
                skippedSpriteCount,
                warnings: Object.freeze(warnings),
                cacheHit: false,
            });
        }

        if (useInstanced && allowedSpriteCount > 0) {
            const instancedCount = this._tryDrawInstanced(
                this._submissions,
                allowedSpriteCount,
                params,
                warnings
            );
            if (instancedCount !== null) {
                return Object.freeze({
                    drawnSpriteCount: instancedCount,
                    spriteBatchCount: 1,
                    skippedSpriteCount,
                    warnings: Object.freeze(warnings),
                    cacheHit: false,
                });
            }
        }

        const failureStats = Object.freeze({
            drawnSpriteCount: 0,
            spriteBatchCount: 0,
            skippedSpriteCount,
            // Copy: the guard body still appends draw warnings to `warnings`.
            warnings: Object.freeze([...warnings]) as readonly string[],
            cacheHit: false,
        });

        return this._guard.run(failureStats, () => {
            this._ensureResources();

            for (let index = 0; index < allowedSpriteCount; index += 1) {
                params.frameState.markActiveRenderer(this._submissionRendererIds[index]!);
            }

            const submissions =
                allowedSpriteCount === this._submissions.length
                    ? this._submissions
                    : this._submissions.slice(0, allowedSpriteCount);

            const buildResult = this._builder.build(submissions);
            if (buildResult.indexCount === 0) {
                this._dropCacheEntry(passId);
                return Object.freeze({
                    drawnSpriteCount: buildResult.spriteCount,
                    spriteBatchCount: buildResult.batches.length,
                    skippedSpriteCount,
                    warnings: Object.freeze(warnings),
                    cacheHit: false,
                });
            }

            const indexType =
                buildResult.indexData instanceof Uint32Array
                    ? this._options.gl.UNSIGNED_INT
                    : this._options.gl.UNSIGNED_SHORT;

            this._upload(buildResult);
            // Fresh data now owns the shared vertex/index buffers.
            this._cachedBufferOwner = null;

            this._options.gl.bindVertexArray(this._vertexArray);
            let drawnBatchCount = 0;
            let failedSpriteCount = 0;
            for (const batch of buildResult.batches) {
                this._applyClipRect(
                    batch.key.clipRect,
                    params.viewportWidth,
                    params.viewportHeight
                );
                const completed = this._drawBatch(batch, indexType, params, warnings);
                if (completed) {
                    drawnBatchCount += 1;
                } else {
                    failedSpriteCount += batch.spriteCount;
                }
            }
            this._options.gl.bindVertexArray(null);
            this._resetClipRect();
            this._resetMaskState();

            const stats = Object.freeze({
                drawnSpriteCount: buildResult.spriteCount - failedSpriteCount,
                spriteBatchCount: drawnBatchCount,
                skippedSpriteCount: skippedSpriteCount + failedSpriteCount,
                warnings: Object.freeze(warnings),
                cacheHit: false,
            });

            // Mask/clip state is captured as component revisions. Failed batches
            // mean a resource vanished mid-draw; those stay on the rebuild path.
            if (this._cacheEnabled && maskCacheSafe && failedSpriteCount === 0) {
                this._storeCacheEntry(
                    passId,
                    params,
                    cameraKey,
                    budgetTotal,
                    budgetRemaining,
                    buildResult,
                    indexType,
                    stats
                );
            } else {
                // Drop stale signatures/component refs for this pass.
                this._dropCacheEntry(passId);
            }

            return stats;
        });
    }

    clear(): void {
        this._instancedRenderer?.clear();
        this._instancedRenderer = null;
        this._instancedUnavailable = false;

        this._instanceBufferRenderer?.clear();
        this._instanceBufferRenderer = null;
        this._directInstanceUnavailable = false;
        this._instanceRegistries.clear();

        if (this._defaultShader) {
            this._shaderFactory.delete(this._defaultShader);
            this._defaultShader = null;
        }

        if (this._vertexArray) {
            this._options.gl.deleteVertexArray(this._vertexArray);
            this._vertexArray = null;
        }

        if (this._vertexBuffer) {
            this._options.gl.deleteBuffer(this._vertexBuffer);
            this._vertexBuffer = null;
        }

        if (this._indexBuffer) {
            this._options.gl.deleteBuffer(this._indexBuffer);
            this._indexBuffer = null;
        }

        this._attributesConfigured = false;
        this._submissions.length = 0;
        this._submissionRendererIds.length = 0;
        this._batchCache.clear();
        this._missStreak.clear();
        this._cachedBufferOwner = null;
        this._replayWarnings.length = 0;
        this._resetClipRect();
        this._resetMaskState();
    }

    private _canReplayCache(
        entry: SceneSpriteBatchCacheEntry,
        params: SceneSpriteBatchRuntimeRenderParams,
        passId: string,
        cameraKey: string,
        budgetTotal: number,
        budgetRemaining: number
    ): boolean {
        return (
            entry.safe &&
            entry.actors === params.actors &&
            entry.cameraKey === cameraKey &&
            entry.viewportWidth === params.viewportWidth &&
            entry.viewportHeight === params.viewportHeight &&
            entry.budgetTotal === budgetTotal &&
            entry.budgetRemaining === budgetRemaining &&
            // Another pass uploaded into the shared buffers since this entry
            // was stored, so the cached batch ranges no longer match the GPU data.
            this._cachedBufferOwner === entry &&
            this._matchesActorSignatures(entry, params.actors, passId) &&
            this._matchesMaskSignatures(entry)
        );
    }

    private _matchesMaskSignatures(entry: SceneSpriteBatchCacheEntry): boolean {
        for (let index = 0; index < entry.maskSignatures.length; index += 1) {
            const signature = entry.maskSignatures[index]!;
            if (
                !signature.actor.active ||
                signature.actor.revision !== signature.actorRevision ||
                signature.transform.revision !== signature.transformRevision ||
                signature.mask.revision !== signature.maskRevision
            ) {
                return false;
            }
        }
        return true;
    }

    private _collectMaskSignatures(
        actors: readonly Actor[]
    ): SceneSpriteMaskCacheSignature[] | null {
        const signatures: SceneSpriteMaskCacheSignature[] = [];
        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index]!;
            const mask = actor.getComponent(SpriteMask);
            if (!mask) {
                continue;
            }
            const transform = actor.getComponent(Transform);
            if (!transform) {
                return null;
            }
            signatures.push({
                actor,
                mask,
                transform,
                actorRevision: actor.revision,
                transformRevision: transform.revision,
                maskRevision: mask.revision,
            });
        }
        return signatures;
    }

    private _matchesActorSignatures(
        entry: SceneSpriteBatchCacheEntry,
        actors: readonly Actor[],
        passId: string
    ): boolean {
        if (entry.actorCount !== actors.length) {
            return false;
        }

        let renderableActorCount = 0;
        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index]!;
            if (actor.revision !== entry.actorRevisions[index]) {
                return false;
            }

            const transform = entry.transformRefs[index];
            if ((transform?.revision ?? 0) !== entry.transformRevisions[index]) {
                return false;
            }

            const renderer = entry.rendererRefs[index];
            if ((renderer?.revision ?? 0) !== entry.rendererRevisions[index]) {
                return false;
            }

            if (
                actor.active &&
                transform &&
                renderer &&
                renderer.enabled &&
                renderer.visible &&
                renderer.hasRenderableSource &&
                renderer.passId === passId
            ) {
                renderableActorCount += 1;
            }
        }

        // Guards against a renderable-set change that slipped past the
        // revision snapshot (e.g. a component swapped between frames).
        return renderableActorCount === entry.renderableActorCount;
    }

    private _replayCache(
        entry: SceneSpriteBatchCacheEntry,
        params: SceneSpriteBatchRuntimeRenderParams,
        passId: string
    ): SceneSpriteBatchRuntimeRenderStats {
        return this._guard.run(entry.stats, () => {
            this._ensureResources();

            for (let index = 0; index < entry.rendererIds.length; index += 1) {
                params.frameState.markActiveRenderer(entry.rendererIds[index]!);
            }

            this._replayWarnings.length = 0;
            this._options.gl.bindVertexArray(this._vertexArray);
            let drawnBatchCount = 0;
            let failedSpriteCount = 0;
            for (const batch of entry.batches) {
                this._applyClipRect(
                    batch.key.clipRect,
                    params.viewportWidth,
                    params.viewportHeight
                );
                if (this._drawBatch(batch, entry.indexType, params, this._replayWarnings)) {
                    drawnBatchCount += 1;
                } else {
                    failedSpriteCount += batch.spriteCount;
                }
            }
            this._options.gl.bindVertexArray(null);
            this._resetClipRect();
            this._resetMaskState();

            if (
                failedSpriteCount === 0 &&
                drawnBatchCount === entry.stats.spriteBatchCount &&
                this._replayWarnings.length === 0
            ) {
                return entry.hitStats;
            }

            // A material or texture disappeared since the entry was built.
            // Drop it so the next frame rebuilds, and report the degraded draw.
            this._dropCacheEntry(passId);
            return Object.freeze({
                drawnSpriteCount: Math.max(0, entry.stats.drawnSpriteCount - failedSpriteCount),
                spriteBatchCount: drawnBatchCount,
                skippedSpriteCount: entry.stats.skippedSpriteCount + failedSpriteCount,
                warnings:
                    this._replayWarnings.length > 0
                        ? Object.freeze([...entry.stats.warnings, ...this._replayWarnings])
                        : entry.stats.warnings,
                cacheHit: true,
            });
        });
    }

    private _dropCacheEntry(passId: string): void {
        const entry = this._batchCache.get(passId);
        if (!entry) {
            return;
        }

        this._batchCache.delete(passId);
        this._missStreak.delete(passId);
        if (this._cachedBufferOwner === entry) {
            this._cachedBufferOwner = null;
        }
    }

    private _storeCacheEntry(
        passId: string,
        params: SceneSpriteBatchRuntimeRenderParams,
        cameraKey: string,
        budgetTotal: number,
        budgetRemaining: number,
        buildResult: Render2DSpriteBatchBuildResult,
        indexType: number,
        stats: SceneSpriteBatchRuntimeRenderStats
    ): void {
        const previous = this._batchCache.get(passId);
        const actors = params.actors;
        const actorCount = actors.length;
        const structureChanged =
            !previous || previous.actors !== actors || previous.actorCount !== actorCount;

        let actorRevisions: Uint32Array;
        let transformRevisions: Uint32Array;
        let rendererRevisions: Uint32Array;
        if (
            previous &&
            previous.actorRevisions.length === actorCount &&
            previous.transformRevisions.length === actorCount &&
            previous.rendererRevisions.length === actorCount
        ) {
            actorRevisions = previous.actorRevisions;
            transformRevisions = previous.transformRevisions;
            rendererRevisions = previous.rendererRevisions;
        } else {
            actorRevisions = new Uint32Array(actorCount);
            transformRevisions = new Uint32Array(actorCount);
            rendererRevisions = new Uint32Array(actorCount);
        }

        let renderableActorCount = 0;
        let valuesChanged = false;
        let actorRevisionChanged = false;
        const transformRefs = previous ? previous.transformRefs : [];
        const rendererRefs = previous ? previous.rendererRefs : [];
        transformRefs.length = actorCount;
        rendererRefs.length = actorCount;

        for (let index = 0; index < actorCount; index += 1) {
            const actor = actors[index]!;
            const actorRevision = actor.revision;
            const previousActorRevision = previous?.actorRevisions[index];
            const previousTransformRevision = previous?.transformRevisions[index];
            const previousRendererRevision = previous?.rendererRevisions[index];

            // Only re-query components when the actor changed structurally.
            // Dynamic sprite scenes keep the same actor/component graph and
            // therefore avoid two component lookups per actor every frame.
            let transform = structureChanged ? null : (transformRefs[index] ?? null);
            let renderer = structureChanged ? null : (rendererRefs[index] ?? null);
            if (structureChanged || (previous && actorRevision !== previousActorRevision)) {
                transform = actor.getComponent(Transform) ?? null;
                renderer = actor.getComponent(SpriteRenderer) ?? null;
            }

            if (previous && !structureChanged && actorRevision !== previousActorRevision) {
                actorRevisionChanged = true;
            }

            const transformRevision = transform?.revision ?? 0;
            const rendererRevision = renderer?.revision ?? 0;
            actorRevisions[index] = actorRevision;
            transformRefs[index] = transform;
            rendererRefs[index] = renderer;
            transformRevisions[index] = transformRevision;
            rendererRevisions[index] = rendererRevision;

            if (
                previous &&
                !structureChanged &&
                (actorRevision !== previousActorRevision ||
                    transformRevision !== previousTransformRevision ||
                    rendererRevision !== previousRendererRevision)
            ) {
                valuesChanged = true;
            }

            if (
                actor.active &&
                transform &&
                renderer &&
                renderer.enabled &&
                renderer.visible &&
                renderer.hasRenderableSource &&
                renderer.passId === passId
            ) {
                renderableActorCount += 1;
            }
        }

        // Mask components only need a full scene scan when the actor/component
        // graph changed. Transform-only dynamic frames just refresh the cached
        // mask revisions, avoiding 50k SpriteMask lookups every frame.
        let maskSignatures: readonly SceneSpriteMaskCacheSignature[];
        if (previous && !structureChanged && !actorRevisionChanged) {
            maskSignatures = previous.maskSignatures.map((signature) => ({
                ...signature,
                actorRevision: signature.actor.revision,
                transformRevision: signature.transform.revision,
                maskRevision: signature.mask.revision,
            }));
        } else {
            const collected = this._collectMaskSignatures(actors);
            if (!collected) {
                this._dropCacheEntry(passId);
                return;
            }
            maskSignatures = collected;
        }

        // A dynamic scene changes every frame. Updating only the cheap
        // signature snapshot avoids copying 50k renderer IDs and batch ranges
        // on every miss; the payload is stored once the scene settles.
        if (valuesChanged && !structureChanged) {
            const entry: SceneSpriteBatchCacheEntry = {
                actors,
                actorRevisions,
                transformRevisions,
                rendererRevisions,
                transformRefs,
                rendererRefs,
                actorCount,
                cameraKey,
                viewportWidth: params.viewportWidth,
                viewportHeight: params.viewportHeight,
                budgetTotal,
                budgetRemaining,
                renderableActorCount,
                maskSignatures,
                batches: previous?.batches ?? [],
                indexType,
                rendererIds: previous?.rendererIds ?? [],
                stats,
                hitStats: Object.freeze({ ...stats, cacheHit: true }),
                safe: false,
            };
            this._batchCache.set(passId, entry);
            this._cachedBufferOwner = null;
            return;
        }

        // The builder reuses its result and scratch buffers, so copy the
        // batch ranges (keys are freshly cloned per build) into our own array.
        const batches = previous ? previous.batches : [];
        batches.length = buildResult.batches.length;
        for (let index = 0; index < buildResult.batches.length; index += 1) {
            const batch = buildResult.batches[index]!;
            batches[index] = {
                key: batch.key,
                spriteOffset: batch.spriteOffset,
                spriteCount: batch.spriteCount,
                quadCount: batch.quadCount,
                indexOffset: batch.indexOffset,
                indexCount: batch.indexCount,
            };
        }

        const rendererIds = previous ? previous.rendererIds : [];
        rendererIds.length = this._submissionRendererIds.length;
        for (let index = 0; index < this._submissionRendererIds.length; index += 1) {
            rendererIds[index] = this._submissionRendererIds[index]!;
        }

        const entry: SceneSpriteBatchCacheEntry = {
            actors,
            actorRevisions,
            transformRevisions,
            rendererRevisions,
            transformRefs,
            rendererRefs,
            actorCount,
            cameraKey,
            viewportWidth: params.viewportWidth,
            viewportHeight: params.viewportHeight,
            budgetTotal,
            budgetRemaining,
            renderableActorCount,
            maskSignatures,
            batches,
            indexType,
            rendererIds,
            stats,
            hitStats: Object.freeze({ ...stats, cacheHit: true }),
            safe: true,
        };

        this._batchCache.set(passId, entry);
        this._cachedBufferOwner = entry;
        this._missStreak.delete(passId);
    }

    private _resolveSource(renderer: SpriteRenderer): Render2DSpriteSource | null {
        if (renderer.materialId) {
            return {
                kind: 'material',
                materialId: renderer.materialId,
            };
        }

        if (renderer.textureId) {
            return {
                kind: 'texture',
                textureId: renderer.textureId,
            };
        }

        return null;
    }

    /**
     * Direct homogeneous instance path. Returns `null` when the pass is not
     * eligible so the caller can fall back to the general collect/build path.
     */
    private _tryRenderDirectInstances(
        params: SceneSpriteBatchRuntimeRenderParams,
        passId: string
    ): SceneSpriteBatchRuntimeRenderStats | null {
        if (this._directInstanceUnavailable) {
            return null;
        }

        const actors = params.actors;
        if (actors.length < DIRECT_INSTANCE_MIN_ACTORS) {
            return null;
        }

        const slotBudget = this._resolveTextureSlotBudget();

        let renderer = this._instanceBufferRenderer;
        if (!renderer) {
            try {
                renderer = new SpriteInstanceBufferRenderer({
                    gl: this._options.gl,
                    resources: this._options.resources,
                    renderStateApplier: this._options.renderStateApplier,
                    stateCache: this._options.stateCache,
                    textureSlotBudget: slotBudget,
                });
                this._instanceBufferRenderer = renderer;
            } catch {
                this._directInstanceUnavailable = true;
                return null;
            }
        }

        let registry = this._instanceRegistries.get(passId);
        if (!registry) {
            registry = new SceneSpriteInstanceRegistry(slotBudget);
            this._instanceRegistries.set(passId, registry);
        }

        let status = registry.sync(actors, passId);
        if (status === 'ineligible') {
            return null;
        }
        if (status === 'empty') {
            registry.commit();
            return this._createEmptyDirectStats();
        }

        if (!registry.refresh(params.cameraFrame)) {
            // A component set changed between the structural snapshot and this
            // frame; rebuild once and retry. If it still cannot settle, fall
            // back to the general path for this frame.
            status = registry.sync(actors, passId);
            if (status === 'ineligible') {
                return null;
            }
            if (status === 'empty') {
                registry.commit();
                return this._createEmptyDirectStats();
            }
            if (!registry.refresh(params.cameraFrame)) {
                return null;
            }
        }

        if (registry.rebuiltThisFrame) {
            this._dropCacheEntry(passId);
        }

        const streamCount = registry.drawCount;
        if (streamCount <= 0 || registry.groupCount <= 0) {
            registry.commit();
            return this._createEmptyDirectStats();
        }

        let drawCount = streamCount;
        if (
            params.transparentBudget &&
            drawCount > params.transparentBudget.remaining
        ) {
            drawCount = Math.max(0, Math.floor(params.transparentBudget.remaining));
        }
        if (drawCount <= 0) {
            registry.commit();
            return this._createEmptyDirectStats();
        }

        if (!registry.cacheHit) {
            // Upload the whole draw-ordered stream so a later frame with a
            // larger transparent budget can draw the tail without re-uploading.
            renderer.upload(
                registry.transformData,
                registry.staticData,
                registry.drawCount,
                registry.staticsDirty
            );
        }
        const cacheHit = registry.cacheHit;
        registry.commit();

        if (params.frameState.tracksActiveRenderers) {
            registry.markActive(params.frameState);
        }

        const drawn = renderer.draw(registry, drawCount, params);
        if (drawn <= 0) {
            return null;
        }

        const spriteBatchCount =
            drawCount === streamCount
                ? registry.groupCount
                : this._countDrawnGroups(registry, drawCount);

        return Object.freeze({
            drawnSpriteCount: drawn,
            spriteBatchCount,
            skippedSpriteCount: 0,
            warnings: EMPTY_WARNINGS,
            cacheHit,
        });
    }

    /** Number of texture groups the first `limit` ordered instances fall in. */
    private _countDrawnGroups(
        registry: SceneSpriteInstanceRegistry,
        limit: number
    ): number {
        const ranges = registry.groupRanges;
        let groups = 0;
        for (let group = 0; group < registry.groupCount; group += 1) {
            if (ranges[group * 2]! >= limit) {
                break;
            }
            groups += 1;
        }
        return groups;
    }

    /**
     * Fragment sampler units available for multi-texture sprite batches.
     * Clamped to [1, 32]; a context that cannot answer `getParameter` keeps
     * the degenerate one-texture-per-group budget (previous behaviour).
     */
    private _resolveTextureSlotBudget(): number {
        if (this._textureSlotBudget >= 0) {
            return this._textureSlotBudget;
        }
        let budget = 1;
        try {
            const units = this._options.gl.getParameter(this._options.gl.MAX_TEXTURE_IMAGE_UNITS);
            if (typeof units === 'number' && Number.isFinite(units)) {
                budget = Math.max(1, Math.min(32, Math.floor(units)));
            }
        } catch {
            budget = 1;
        }
        this._textureSlotBudget = budget;
        return budget;
    }

    private _createEmptyDirectStats(): SceneSpriteBatchRuntimeRenderStats {
        return Object.freeze({
            drawnSpriteCount: 0,
            spriteBatchCount: 0,
            skippedSpriteCount: 0,
            warnings: EMPTY_WARNINGS,
            cacheHit: true,
        });
    }

    private _tryDrawInstanced(
        submissions: readonly Render2DSpriteSubmission[],
        count: number,
        params: SceneSpriteBatchRuntimeRenderParams,
        warnings: string[]
    ): number | null {
        if (this._instancedUnavailable || count <= 0) {
            return null;
        }

        let textureId: string | null = null;
        for (let index = 0; index < count; index += 1) {
            const submission = submissions[index]!;
            if (
                submission.source.kind !== 'texture' ||
                submission.mask !== undefined ||
                submission.clipRect !== undefined ||
                submission.slice !== undefined
            ) {
                return null;
            }
            if (textureId === null) {
                textureId = submission.source.textureId;
            } else if (textureId !== submission.source.textureId) {
                return null;
            }
        }

        if (textureId === null || !this._options.resources.textures.get(textureId)) {
            return null;
        }

        let renderer = this._instancedRenderer;
        if (!renderer) {
            try {
                renderer = new SpriteInstancedRenderer({
                    gl: this._options.gl,
                    resources: this._options.resources,
                    renderStateApplier: this._options.renderStateApplier,
                    stateCache: this._options.stateCache,
                });
                this._instancedRenderer = renderer;
            } catch (error) {
                this._instancedUnavailable = true;
                warnings.push(
                    `sprite instanced path unavailable: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                return null;
            }
        }

        const drawn = renderer.draw(submissions, count, params, textureId);
        return drawn > 0 ? drawn : null;
    }

    private _ensureResources(): void {
        if (!this._defaultShader) {
            this._defaultShader = this._shaderFactory.create(
                createSprite2DShaderDefinition('__scene/runtime-sprite-2d')
            );
        }

        if (!this._vertexArray) {
            this._vertexArray = this._options.gl.createVertexArray();
            if (!this._vertexArray) {
                throw new SceneMeshError('Failed to create 2D sprite vertex array');
            }
        }

        if (!this._vertexBuffer) {
            this._vertexBuffer = this._options.gl.createBuffer();
            if (!this._vertexBuffer) {
                throw new SceneMeshError('Failed to create 2D sprite vertex buffer');
            }
        }

        if (!this._indexBuffer) {
            this._indexBuffer = this._options.gl.createBuffer();
            if (!this._indexBuffer) {
                throw new SceneMeshError('Failed to create 2D sprite index buffer');
            }
        }

        if (this._attributesConfigured) {
            return;
        }

        this._options.gl.bindVertexArray(this._vertexArray);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, this._vertexBuffer);
        this._options.gl.bindBuffer(this._options.gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);
        this._options.gl.enableVertexAttribArray(0);
        this._options.gl.vertexAttribPointer(
            0,
            3,
            this._options.gl.FLOAT,
            false,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            0
        );
        this._options.gl.enableVertexAttribArray(2);
        this._options.gl.vertexAttribPointer(
            2,
            2,
            this._options.gl.FLOAT,
            false,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            12
        );
        this._options.gl.enableVertexAttribArray(3);
        this._options.gl.vertexAttribPointer(
            3,
            4,
            this._options.gl.UNSIGNED_BYTE,
            true,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            20
        );
        this._options.gl.bindVertexArray(null);
        this._attributesConfigured = true;
    }

    private _upload(buildResult: Render2DSpriteBatchBuildResult): void {
        this._options.gl.bindVertexArray(this._vertexArray);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, this._vertexBuffer);

        const vertexByteLength = buildResult.vertexByteLength;
        if (this._vertexBufferSize === vertexByteLength) {
            this._options.gl.bufferSubData(
                this._options.gl.ARRAY_BUFFER,
                0,
                buildResult.vertexData
            );
        } else {
            this._options.gl.bufferData(
                this._options.gl.ARRAY_BUFFER,
                buildResult.vertexData,
                this._options.gl.DYNAMIC_DRAW
            );
            this._vertexBufferSize = vertexByteLength;
        }

        this._options.gl.bindBuffer(this._options.gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);

        const indexByteLength = buildResult.indexData.byteLength;
        if (this._indexBufferSize === indexByteLength) {
            this._options.gl.bufferSubData(
                this._options.gl.ELEMENT_ARRAY_BUFFER,
                0,
                buildResult.indexData
            );
        } else {
            this._options.gl.bufferData(
                this._options.gl.ELEMENT_ARRAY_BUFFER,
                buildResult.indexData,
                this._options.gl.DYNAMIC_DRAW
            );
            this._indexBufferSize = indexByteLength;
        }
    }

    private _drawBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams,
        warnings: string[]
    ): boolean {
        if (batch.key.source.kind === 'material') {
            return this._drawMaterialBatch(batch, indexType, params, warnings);
        }

        return this._drawTextureBatch(batch, indexType, params, warnings);
    }

    private _drawMaterialBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams,
        warnings: string[]
    ): boolean {
        if (batch.key.source.kind !== 'material') {
            return false;
        }

        const materialId = batch.key.source.materialId;
        const material = this._options.resources.materials.get(materialId);
        if (!material) {
            warnings.push(`sprite batch skipped: missing material '${materialId}'`);
            return false;
        }

        const materialPass = resolveSceneMaterialPass(material, params.renderPass.materialPassId);
        if (params.renderPass.materialPassId !== null && !materialPass) {
            warnings.push(
                `sprite batch skipped: missing pass '${params.renderPass.materialPassId}' for material '${materialId}'`
            );
            return false;
        }

        const shader = this._options.resources.shaders.get(material.shaderId);
        if (!shader) {
            warnings.push(
                `sprite batch skipped: missing shader '${material.shaderId}' for material '${materialId}'`
            );
            return false;
        }
        if (!this._isSpriteShader(shader)) {
            warnings.push(
                `sprite batch skipped: shader '${material.shaderId}' missing required sprite uniforms for material '${materialId}'`
            );
            return false;
        }

        let spriteTextureId: string;
        try {
            spriteTextureId = resolveSceneSpriteMaterialBinding(material).textureId;
        } catch {
            warnings.push(
                `sprite batch skipped: material '${materialId}' missing required texture binding 'u_MainTex'`
            );
            return false;
        }
        if (!this._options.resources.textures.get(spriteTextureId)) {
            warnings.push(
                `sprite batch skipped: missing texture '${spriteTextureId}' for material '${materialId}'`
            );
            return false;
        }

        this._options.renderStateApplier.apply(shader, params.renderPass, materialPass);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        this._applyMaskUniforms(shader, batch.key.mask);
        this._options.materialTextureBinder.bind(
            shader,
            material,
            this._options.resources,
            this._options.textureUniformSetter
        );

        for (const [name, value] of material.uniforms) {
            this._options.uniformWriter.write(shader, name, value);
        }

        this._options.gl.drawElements(
            this._options.renderStateApplier.resolvePrimitiveMode(
                this._options.gl.TRIANGLES,
                materialPass
            ),
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordDraw({
            topology: materialPass?.primitive
                ? this._options.renderStateApplier.resolvePrimitiveTopology(materialPass.primitive)
                : 'triangles',
            indexCount: batch.indexCount,
            vertexCount: 0,
        });
        this._options.materialTextureBinder.unbind();
        return true;
    }

    private _drawTextureBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams,
        warnings: string[]
    ): boolean {
        if (batch.key.source.kind !== 'texture') {
            return false;
        }

        const textureId = batch.key.source.textureId;
        const texture = this._options.resources.textures.get(textureId);
        const shader = this._defaultShader;
        if (!texture) {
            warnings.push(`sprite batch skipped: missing texture '${textureId}'`);
            return false;
        }
        if (!shader) {
            warnings.push(
                `sprite batch skipped: missing default sprite shader for texture '${textureId}'`
            );
            return false;
        }

        this._options.renderStateApplier.apply(shader, params.renderPass, null);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        this._applyMaskUniforms(shader, batch.key.mask);
        texture.texture.bind(0);
        this._options.resources.resolveSampler(texture.samplerId).bind(0);
        this._options.uniformWriter.write(shader, 'u_MainTex', 0);
        this._options.gl.drawElements(
            this._options.gl.TRIANGLES,
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordDraw({
            topology: 'triangles',
            indexCount: batch.indexCount,
            vertexCount: 0,
        });
        this._options.gl.bindSampler(0, null);
        this._options.gl.activeTexture(this._options.gl.TEXTURE0);
        this._options.gl.bindTexture(this._options.gl.TEXTURE_2D, null);
        return true;
    }

    private _resolveMaskState(
        actor: Actor,
        cameraFrame: SceneCameraFrameState,
        viewportWidth: number,
        viewportHeight: number
    ): SceneResolvedSpriteMaskState | null {
        let clipRect: Render2DRectLike | undefined;
        let shapeMask: Render2DSpriteMask | undefined;
        let current: Actor | undefined = actor;

        while (current) {
            const mask = current.getComponent(SpriteMask);
            if (mask?.enabled) {
                const transform = current.getComponent(Transform);
                if (!transform) {
                    return null;
                }

                const maskClipRect = this._projectMaskClipRect(
                    transform,
                    mask,
                    cameraFrame,
                    viewportWidth,
                    viewportHeight
                );
                if (!maskClipRect) {
                    return null;
                }

                const nextClipRect = clipRect
                    ? Rect.intersect(clipRect, maskClipRect)
                    : maskClipRect;
                if (!nextClipRect) {
                    return null;
                }

                clipRect = nextClipRect;

                if (!shapeMask && mask.shape !== 'rect') {
                    shapeMask = this._createMaskState(transform, mask);
                    if (!shapeMask) {
                        return null;
                    }
                }
            }

            current = current.parent;
        }

        return {
            clipRect: clipRect ?? null,
            mask: shapeMask ?? null,
        };
    }

    private _createMaskState(
        transform: Transform,
        mask: SpriteMask
    ): Render2DSpriteMask | undefined {
        if (mask.size.x <= 0 || mask.size.y <= 0) {
            return undefined;
        }

        const inverseWorldMatrix = transform.worldMatrix.clone().invert().data;

        return {
            shape: mask.shape === 'circle' ? 'circle' : 'rounded-rect',
            inverseWorldMatrix: Array.from(inverseWorldMatrix, (entry) => Number(entry ?? 0)),
            size: {
                width: mask.size.x,
                height: mask.size.y,
            },
            anchor: {
                x: mask.anchor.x,
                y: mask.anchor.y,
            },
            ...(mask.cornerRadius !== null && mask.cornerRadius !== undefined
                ? { cornerRadius: mask.cornerRadius }
                : {
                      cornerRadius:
                          mask.shape === 'rounded-rect'
                              ? Math.min(mask.size.x, mask.size.y) * 0.125
                              : undefined,
                  }),
        };
    }

    private _projectMaskClipRect(
        transform: Transform,
        mask: SpriteMask,
        cameraFrame: SceneCameraFrameState,
        viewportWidth: number,
        viewportHeight: number
    ): Render2DRectLike | null {
        if (mask.size.x <= 0 || mask.size.y <= 0) {
            return null;
        }

        const worldMatrix = transform.worldMatrix.data;
        const viewProjectionMatrix = cameraFrame.viewProjectionMatrix.data;
        const minX = -mask.anchor.x * mask.size.x;
        const minY = -mask.anchor.y * mask.size.y;
        const maxX = minX + mask.size.x;
        const maxY = minY + mask.size.y;

        let screenMinX = Number.POSITIVE_INFINITY;
        let screenMinY = Number.POSITIVE_INFINITY;
        let screenMaxX = Number.NEGATIVE_INFINITY;
        let screenMaxY = Number.NEGATIVE_INFINITY;

        const corners = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
        ] as const;

        for (let index = 0; index < corners.length; index += 1) {
            const corner = corners[index]!;
            const worldPoint = transformPoint2D(
                worldMatrix,
                corner[0],
                corner[1],
                this._worldPointScratch
            );
            const screenPoint = projectWorldPoint(
                viewProjectionMatrix,
                worldPoint[0]!,
                worldPoint[1]!,
                worldPoint[2]!,
                viewportWidth,
                viewportHeight,
                this._screenPointScratch
            );

            if (!Number.isFinite(screenPoint[0]) || !Number.isFinite(screenPoint[1])) {
                return null;
            }

            screenMinX = Math.min(screenMinX, screenPoint[0]!);
            screenMinY = Math.min(screenMinY, screenPoint[1]!);
            screenMaxX = Math.max(screenMaxX, screenPoint[0]!);
            screenMaxY = Math.max(screenMaxY, screenPoint[1]!);
        }

        const clipX = Math.max(0, Math.floor(screenMinX));
        const clipY = Math.max(0, Math.floor(screenMinY));
        const clipMaxX = Math.min(viewportWidth, Math.ceil(screenMaxX));
        const clipMaxY = Math.min(viewportHeight, Math.ceil(screenMaxY));
        const width = clipMaxX - clipX;
        const height = clipMaxY - clipY;

        if (width <= 0 || height <= 0) {
            return null;
        }

        return { x: clipX, y: clipY, width, height };
    }

    private _applyClipRect(
        clipRect: Render2DRectLike | null,
        viewportWidth: number,
        viewportHeight: number
    ): void {
        if (!clipRect) {
            if (this._scissorEnabled) {
                this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
                this._scissorEnabled = false;
                this._activeClipRect = null;
            }
            return;
        }

        if (!this._scissorEnabled) {
            this._options.gl.enable?.(this._options.gl.SCISSOR_TEST);
            this._scissorEnabled = true;
        }

        const clampedClipRect = {
            x: Math.max(0, Math.floor(clipRect.x)),
            y: Math.max(0, Math.floor(clipRect.y)),
            width: 0,
            height: 0,
        };
        const clipMaxX = Math.min(viewportWidth, Math.ceil(clipRect.x + clipRect.width));
        const clipMaxY = Math.min(viewportHeight, Math.ceil(clipRect.y + clipRect.height));
        clampedClipRect.width = Math.max(0, clipMaxX - clampedClipRect.x);
        clampedClipRect.height = Math.max(0, clipMaxY - clampedClipRect.y);

        if (clampedClipRect.width === 0 || clampedClipRect.height === 0) {
            if (this._scissorEnabled) {
                this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
                this._scissorEnabled = false;
            }
            this._activeClipRect = null;
            return;
        }

        if (this._activeClipRect && Rect.equals(this._activeClipRect, clampedClipRect)) {
            return;
        }

        this._options.gl.scissor?.(
            clampedClipRect.x,
            clampedClipRect.y,
            clampedClipRect.width,
            clampedClipRect.height
        );
        this._activeClipRect = clampedClipRect;
    }

    private _applyMaskUniforms(
        shader: SceneShaderResource,
        mask: Render2DSpriteMask | null | undefined
    ): void {
        if (!mask) {
            this._options.uniformWriter.write(shader, 'u_MaskShape', 0);
            this._activeMask = null;
            return;
        }

        this._options.uniformWriter.write(shader, 'u_MaskShape', mask.shape === 'circle' ? 1 : 2);
        this._options.uniformWriter.write(
            shader,
            'u_MaskWorldToLocal',
            Array.from(mask.inverseWorldMatrix, (entry) => Number(entry ?? 0))
        );
        this._options.uniformWriter.write(shader, 'u_MaskSize', [
            mask.size.width,
            mask.size.height,
        ]);
        this._options.uniformWriter.write(shader, 'u_MaskAnchor', [mask.anchor.x, mask.anchor.y]);
        this._options.uniformWriter.write(shader, 'u_MaskCornerRadius', mask.cornerRadius ?? 0);
        this._activeMask = mask;
    }

    private _resetClipRect(): void {
        if (this._scissorEnabled) {
            this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
            this._scissorEnabled = false;
        }

        this._activeClipRect = null;
    }

    private _resetMaskState(): void {
        this._activeMask = null;
    }

    private _isSpriteShader(shader: SceneShaderResource): boolean {
        return isRender2DSpriteUniformNames(shader.uniformNames);
    }

    private _resolveIndexByteSize(indexType: number): number {
        return indexType === this._options.gl.UNSIGNED_INT
            ? Uint32Array.BYTES_PER_ELEMENT
            : Uint16Array.BYTES_PER_ELEMENT;
    }
}
