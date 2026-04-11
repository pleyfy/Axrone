import {
    RenderExecutionError,
    RenderPipelineError,
    RenderValidationError,
} from './errors';
import { RenderTextureRegistry } from './graph';
import { MutableObjectArena, ReusableList } from './memory';
import { PostProcessStack } from './post-process';
import {
    RenderBakeTaskScheduler,
    type ScheduledRenderBakeTask,
    sumRenderBakeTaskCost,
} from './render-bake-task-scheduler';
import {
    degradeRenderFrame,
    estimateRenderFrameCost,
    estimateRenderFrameCostTotals,
    getRenderPostEffectCost,
} from './render-frame-budget-manager';
import { RenderFrameClassifier } from './render-frame-classifier';
import {
    type ReadonlyRenderList,
    type RenderDegradeStrategy,
    type RenderExecutionContext,
    type RenderFrameInput,
    type RenderFrameResult,
    type RenderFrameStatistics,
    type RenderGlobalIlluminationSettings,
    type RenderHdrSettings,
    type RenderLight,
    type RenderLightBakeTask,
    type RenderLightBakingSettings,
    type RenderPassMetadata,
    type RenderPassSummary,
    type RenderPipelineOptions,
    type RenderPrimitiveInstance,
    type RenderReflectionProbe,
    type RenderShadowSettings,
    type RenderTonemappingSettings,
    type RenderVolumetricSettings,
    type ResolvedRenderPass,
} from './types';
import type { IDisposable } from './disposable';
import { RenderPassPlanner } from './render-pass-planner';

interface NormalizedHdrSettings extends RenderHdrSettings {
    readonly enabled: boolean;
    readonly colorFormat: 'r11g11b10f' | 'rgba16f' | 'rgba32f';
    readonly whitePoint: number;
    readonly outputColorSpace: 'srgb' | 'display-p3' | 'rec2020';
    readonly exposure: RenderHdrSettings['exposure'];
}

interface NormalizedTonemappingSettings extends RenderTonemappingSettings {
    readonly gamma: number;
    readonly contrast: number;
    readonly saturation: number;
    readonly shoulderStrength: number;
    readonly toeStrength: number;
}

interface NormalizedShadowSettings extends RenderShadowSettings {
    readonly enabled: boolean;
    readonly atlasSize: number;
    readonly cascadeCount: 1 | 2 | 4;
    readonly cascadeSplitLambda: number;
    readonly maxShadowedLights: number;
    readonly maxDistance: number;
    readonly depthBias: number;
    readonly normalBias: number;
    readonly filter: 'hard' | 'pcf' | 'pcss' | 'esm' | 'vsm';
}

interface NormalizedVolumetricSettings extends RenderVolumetricSettings {
    readonly enabled: boolean;
    readonly froxelResolution: readonly [number, number, number];
    readonly temporalReprojection: boolean;
    readonly historyWeight: number;
    readonly fogDensity: number;
    readonly heightFogFalloff: number;
    readonly anisotropy: number;
    readonly ambientContribution: number;
    readonly localLightBudget: number;
}

interface NormalizedLightBakingSettings extends RenderLightBakingSettings {
    readonly enabled: boolean;
    readonly maxTasksPerFrame: number;
    readonly budgetMs: number;
    readonly maxRetries: number;
    readonly throttleFrames: number;
}

interface NormalizedOptions<TNative> {
    readonly name: string;
    readonly locale: string;
    readonly hdr: NormalizedHdrSettings;
    readonly tonemapping: NormalizedTonemappingSettings;
    readonly shadows: NormalizedShadowSettings;
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetrics: NormalizedVolumetricSettings;
    readonly lightBaking: NormalizedLightBakingSettings;
    readonly frameBudgetMs: number;
    readonly degradeStrategy: RenderDegradeStrategy;
    readonly maxActiveReflectionProbes: number;
    readonly maxActiveLocalLights: number;
    readonly maxTransparentPrimitives: number;
    readonly maxPostProcessPasses: number;
    readonly enableDepthPrepass: boolean | 'auto';
    readonly backend: RenderPipelineOptions<TNative>['backend'];
    readonly resourcePoolCapacity: number;
    readonly resourceAllocator: RenderPipelineOptions<TNative>['resourceAllocator'];
}

interface FrameBuild<TNative> {
    readonly result: RenderFrameResult<TNative>;
    readonly context: RenderExecutionContext<TNative>;
    readonly livePasses: readonly ResolvedRenderPass[];
}

const DEFAULT_HDR_SETTINGS: NormalizedHdrSettings = Object.freeze({
    enabled: true,
    colorFormat: 'rgba16f',
    whitePoint: 11.2,
    outputColorSpace: 'srgb',
    exposure: {
        mode: 'automatic' as const,
        keyValue: 0.18,
        minExposure: -6,
        maxExposure: 6,
        adaptationRate: 1.5,
    },
});

const DEFAULT_TONEMAPPING: NormalizedTonemappingSettings = Object.freeze({
    mode: 'aces-fitted',
    gamma: 2.2,
    contrast: 1,
    saturation: 1,
    shoulderStrength: 0.22,
    toeStrength: 0.3,
});

const DEFAULT_SHADOWS: NormalizedShadowSettings = Object.freeze({
    enabled: true,
    atlasSize: 4096,
    cascadeCount: 4,
    cascadeSplitLambda: 0.7,
    maxShadowedLights: 3,
    maxDistance: 150,
    depthBias: 0.0015,
    normalBias: 0.25,
    filter: 'pcf',
});

const DEFAULT_VOLUMETRICS: NormalizedVolumetricSettings = Object.freeze({
    enabled: false,
    froxelResolution: [160, 90, 64] as const,
    temporalReprojection: true,
    historyWeight: 0.9,
    fogDensity: 0.02,
    heightFogFalloff: 0.1,
    anisotropy: 0.2,
    ambientContribution: 0.5,
    localLightBudget: 8,
});

const DEFAULT_LIGHT_BAKING: NormalizedLightBakingSettings = Object.freeze({
    enabled: false,
    maxTasksPerFrame: 1,
    budgetMs: 4,
    maxRetries: 2,
    throttleFrames: 4,
});

const DEFAULT_GI: RenderGlobalIlluminationSettings = Object.freeze({
    mode: 'disabled',
});

const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

const ensureFinite = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;

const normalizeHdr = (value: RenderPipelineOptions<unknown>['hdr']): NormalizedHdrSettings => {
    if (value === false) {
        return Object.freeze({
            ...DEFAULT_HDR_SETTINGS,
            enabled: false,
        });
    }

    if (value === true || value === undefined) {
        return DEFAULT_HDR_SETTINGS;
    }

    return Object.freeze({
        enabled: value.enabled ?? DEFAULT_HDR_SETTINGS.enabled,
        colorFormat: value.colorFormat ?? DEFAULT_HDR_SETTINGS.colorFormat,
        whitePoint: ensureFinite(value.whitePoint ?? DEFAULT_HDR_SETTINGS.whitePoint, 11.2),
        outputColorSpace: value.outputColorSpace ?? DEFAULT_HDR_SETTINGS.outputColorSpace,
        exposure: value.exposure ?? DEFAULT_HDR_SETTINGS.exposure,
    });
};

const normalizeTonemapping = (
    value: RenderPipelineOptions<unknown>['tonemapping']
): NormalizedTonemappingSettings =>
    Object.freeze({
        mode: value?.mode ?? DEFAULT_TONEMAPPING.mode,
        gamma: ensureFinite(value?.gamma ?? DEFAULT_TONEMAPPING.gamma, DEFAULT_TONEMAPPING.gamma),
        contrast: ensureFinite(
            value?.contrast ?? DEFAULT_TONEMAPPING.contrast,
            DEFAULT_TONEMAPPING.contrast
        ),
        saturation: ensureFinite(
            value?.saturation ?? DEFAULT_TONEMAPPING.saturation,
            DEFAULT_TONEMAPPING.saturation
        ),
        shoulderStrength: ensureFinite(
            value?.shoulderStrength ?? DEFAULT_TONEMAPPING.shoulderStrength,
            DEFAULT_TONEMAPPING.shoulderStrength
        ),
        toeStrength: ensureFinite(
            value?.toeStrength ?? DEFAULT_TONEMAPPING.toeStrength,
            DEFAULT_TONEMAPPING.toeStrength
        ),
    });

const normalizeShadows = (
    value: RenderPipelineOptions<unknown>['shadows']
): NormalizedShadowSettings => {
    if (value === false) {
        return Object.freeze({
            ...DEFAULT_SHADOWS,
            enabled: false,
        });
    }

    if (value === true || value === undefined) {
        return DEFAULT_SHADOWS;
    }

    return Object.freeze({
        enabled: value.enabled ?? DEFAULT_SHADOWS.enabled,
        atlasSize: Math.max(512, Math.floor(value.atlasSize ?? DEFAULT_SHADOWS.atlasSize)),
        cascadeCount: value.cascadeCount ?? DEFAULT_SHADOWS.cascadeCount,
        cascadeSplitLambda: clamp(
            value.cascadeSplitLambda ?? DEFAULT_SHADOWS.cascadeSplitLambda,
            0,
            1
        ),
        maxShadowedLights: Math.max(
            1,
            Math.floor(value.maxShadowedLights ?? DEFAULT_SHADOWS.maxShadowedLights)
        ),
        maxDistance: Math.max(1, value.maxDistance ?? DEFAULT_SHADOWS.maxDistance),
        depthBias: Math.max(0, value.depthBias ?? DEFAULT_SHADOWS.depthBias),
        normalBias: Math.max(0, value.normalBias ?? DEFAULT_SHADOWS.normalBias),
        filter: value.filter ?? DEFAULT_SHADOWS.filter,
    });
};

const normalizeVolumetrics = (
    value: RenderPipelineOptions<unknown>['volumetrics']
): NormalizedVolumetricSettings => {
    if (value === false || value === undefined) {
        return DEFAULT_VOLUMETRICS;
    }

    if (value === true) {
        return Object.freeze({
            ...DEFAULT_VOLUMETRICS,
            enabled: true,
        });
    }

    return Object.freeze({
        enabled: value.enabled ?? DEFAULT_VOLUMETRICS.enabled,
        froxelResolution: value.froxelResolution ?? DEFAULT_VOLUMETRICS.froxelResolution,
        temporalReprojection:
            value.temporalReprojection ?? DEFAULT_VOLUMETRICS.temporalReprojection,
        historyWeight: clamp(
            value.historyWeight ?? DEFAULT_VOLUMETRICS.historyWeight,
            0,
            0.99
        ),
        fogDensity: Math.max(0, value.fogDensity ?? DEFAULT_VOLUMETRICS.fogDensity),
        heightFogFalloff: Math.max(
            0,
            value.heightFogFalloff ?? DEFAULT_VOLUMETRICS.heightFogFalloff
        ),
        anisotropy: clamp(value.anisotropy ?? DEFAULT_VOLUMETRICS.anisotropy, -0.95, 0.95),
        ambientContribution: clamp(
            value.ambientContribution ?? DEFAULT_VOLUMETRICS.ambientContribution,
            0,
            1
        ),
        localLightBudget: Math.max(
            0,
            Math.floor(value.localLightBudget ?? DEFAULT_VOLUMETRICS.localLightBudget)
        ),
    });
};

const normalizeLightBaking = (
    value: RenderPipelineOptions<unknown>['lightBaking']
): NormalizedLightBakingSettings => {
    if (value === false || value === undefined) {
        return DEFAULT_LIGHT_BAKING;
    }

    if (value === true) {
        return Object.freeze({
            ...DEFAULT_LIGHT_BAKING,
            enabled: true,
        });
    }

    return Object.freeze({
        enabled: value.enabled ?? DEFAULT_LIGHT_BAKING.enabled,
        maxTasksPerFrame: Math.max(
            0,
            Math.floor(value.maxTasksPerFrame ?? DEFAULT_LIGHT_BAKING.maxTasksPerFrame)
        ),
        budgetMs: Math.max(0, value.budgetMs ?? DEFAULT_LIGHT_BAKING.budgetMs),
        maxRetries: Math.max(0, Math.floor(value.maxRetries ?? DEFAULT_LIGHT_BAKING.maxRetries)),
        throttleFrames: Math.max(
            0,
            Math.floor(value.throttleFrames ?? DEFAULT_LIGHT_BAKING.throttleFrames)
        ),
    });
};

const mergeVolumetrics = (
    base: NormalizedVolumetricSettings,
    override?: RenderVolumetricSettings
): NormalizedVolumetricSettings => {
    if (!override) {
        return base;
    }

    return Object.freeze({
        enabled: override.enabled ?? true,
        froxelResolution: override.froxelResolution ?? base.froxelResolution,
        temporalReprojection: override.temporalReprojection ?? base.temporalReprojection,
        historyWeight: clamp(override.historyWeight ?? base.historyWeight, 0, 0.99),
        fogDensity: Math.max(0, override.fogDensity ?? base.fogDensity),
        heightFogFalloff: Math.max(0, override.heightFogFalloff ?? base.heightFogFalloff),
        anisotropy: clamp(override.anisotropy ?? base.anisotropy, -0.95, 0.95),
        ambientContribution: clamp(
            override.ambientContribution ?? base.ambientContribution,
            0,
            1
        ),
        localLightBudget: Math.max(0, Math.floor(override.localLightBudget ?? base.localLightBudget)),
    });
};

const normalizeOptions = <TNative>(
    options: RenderPipelineOptions<TNative>
): NormalizedOptions<TNative> => ({
    name: options.name ?? 'RenderPipeline',
    locale: options.locale ?? 'en',
    hdr: normalizeHdr(options.hdr) as NormalizedHdrSettings,
    tonemapping: normalizeTonemapping(options.tonemapping) as NormalizedTonemappingSettings,
    shadows: normalizeShadows(options.shadows) as NormalizedShadowSettings,
    gi: options.gi ?? DEFAULT_GI,
    volumetrics: normalizeVolumetrics(options.volumetrics) as NormalizedVolumetricSettings,
    lightBaking: normalizeLightBaking(options.lightBaking) as NormalizedLightBakingSettings,
    frameBudgetMs: Math.max(0, options.frameBudgetMs ?? 16.6),
    degradeStrategy: options.degradeStrategy ?? 'balanced',
    maxActiveReflectionProbes: Math.max(0, Math.floor(options.maxActiveReflectionProbes ?? 4)),
    maxActiveLocalLights: Math.max(0, Math.floor(options.maxActiveLocalLights ?? 32)),
    maxTransparentPrimitives: Math.max(
        0,
        Math.floor(options.maxTransparentPrimitives ?? 16384)
    ),
    maxPostProcessPasses: Math.max(0, Math.floor(options.maxPostProcessPasses ?? 8)),
    enableDepthPrepass: options.enableDepthPrepass ?? 'auto',
    backend: options.backend,
    resourcePoolCapacity: Math.max(16, Math.floor(options.resourcePoolCapacity ?? 256)),
    resourceAllocator: options.resourceAllocator,
});

export class RenderPipeline<TNative = unknown> implements IDisposable {
    private readonly _options: NormalizedOptions<TNative>;
    private readonly _graph: RenderTextureRegistry<TNative>;
    private readonly _postProcess: PostProcessStack;
    private readonly _classifier: RenderFrameClassifier;
    private readonly _warnings = new ReusableList<string>(16);
    private readonly _planner: RenderPassPlanner<TNative>;
    private readonly _bakeTasks: RenderBakeTaskScheduler;
    private _frame = 0;
    private _disposed = false;

    constructor(options: RenderPipelineOptions<TNative> = {}) {
        this._options = normalizeOptions(options);
        this._graph = new RenderTextureRegistry<TNative>({
            allocator: this._options.resourceAllocator,
            resourcePoolCapacity: this._options.resourcePoolCapacity,
        });
        this._postProcess = new PostProcessStack(options.postProcess ?? []);
        this._classifier = new RenderFrameClassifier({
            maxTransparentPrimitives: this._options.maxTransparentPrimitives,
            maxActiveLocalLights: this._options.maxActiveLocalLights,
            maxActiveReflectionProbes: this._options.maxActiveReflectionProbes,
            maxShadowedLights: this._options.shadows.maxShadowedLights,
        });
        this._planner = new RenderPassPlanner(this._graph, {
            shadows: this._options.shadows,
            tonemapping: this._options.tonemapping,
            lightBaking: this._options.lightBaking,
            enableDepthPrepass: this._options.enableDepthPrepass,
        });
        this._bakeTasks = new RenderBakeTaskScheduler(this._options.lightBaking.maxRetries);
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get postProcess(): PostProcessStack {
        return this._postProcess;
    }

    private get _opaque(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._classifier.opaque;
    }

    private get _transparent(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._classifier.transparent;
    }

    private get _shadowCasters(): ReadonlyRenderList<RenderPrimitiveInstance> {
        return this._classifier.shadowCasters;
    }

    private get _activeLights(): ReadonlyRenderList<RenderLight> {
        return this._classifier.activeLights;
    }

    private get _shadowLights(): ReadonlyRenderList<RenderLight> {
        return this._classifier.shadowLights;
    }

    private get _activeProbes(): ReadonlyRenderList<RenderReflectionProbe> {
        return this._classifier.activeProbes;
    }

    private get _probeUpdates(): ReadonlyRenderList<RenderReflectionProbe> {
        return this._classifier.probeUpdates;
    }

    plan(input: RenderFrameInput): RenderFrameResult<TNative> {
        const built = this._buildFrame(input);
        this._graph.endFrame();
        return built.result;
    }

    async render(input: RenderFrameInput): Promise<RenderFrameResult<TNative>> {
        const built = this._buildFrame(input);
        const backend = this._options.backend;

        try {
            if (backend?.beginFrame) {
                await backend.beginFrame(built.context);
            }

            if (backend?.executePass) {
                for (const pass of built.livePasses) {
                    await backend.executePass(pass, built.context);
                }
            }

            if (backend?.endFrame) {
                await backend.endFrame(built.result, built.context);
            }

            return built.result;
        } catch (error) {
            throw new RenderExecutionError(
                'BACKEND_FAILED',
                this._options.locale,
                {
                    frame: built.result.frame,
                },
                error instanceof Error ? error : new Error(String(error))
            );
        } finally {
            this._graph.endFrame();
        }
    }

    enqueueBakeTask<TPayload = unknown>(task: RenderLightBakeTask<TPayload>): this {
        this._bakeTasks.enqueue(task);
        return this;
    }

    listBakeTasks(): readonly RenderLightBakeTask[] {
        return this._bakeTasks.list();
    }

    getBakeTask(id: string): RenderLightBakeTask | null {
        return this._bakeTasks.get(id);
    }

    completeBakeTask(id: string): void {
        this._bakeTasks.complete(id, this._options.locale);
    }

    failBakeTask(id: string, error: string): void {
        this._bakeTasks.fail(id, error, this._options.locale);
    }

    removeBakeTask(id: string): boolean {
        return this._bakeTasks.remove(id);
    }

    clearBakeTasks(): void {
        this._bakeTasks.clear();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._planner.clear();
        this._classifier.clear();
        this._warnings.clear();
        this._graph.dispose();
        this._bakeTasks.clear();
        this._disposed = true;
    }

    private _buildFrame(input: RenderFrameInput): FrameBuild<TNative> {
        if (this._disposed) {
            throw new RenderPipelineError('PIPELINE_DISPOSED', this._options.locale);
        }

        this._validateFrameInput(input);

        const frame = input.frame ?? ++this._frame;
        const deltaTime = Math.max(0, input.deltaTime ?? 1 / 60);
        this._frame = frame;

        this._resetScratch();
        this._graph.beginFrame(frame);

        this._classifier.classify(input, frame, this._warnings);

        const hdr = this._resolveHdr(input);
        let gi = input.environment?.gi ?? this._options.gi;
        let volumetrics = mergeVolumetrics(this._options.volumetrics, input.environment?.volumetrics);
        let shadowEnabled =
            this._options.shadows.enabled &&
            this._shadowLights.length > 0 &&
            this._shadowCasters.length > 0;
        let probeUpdates = this._probeUpdates.length;
        let bakeTasks = this._selectBakeTasks(frame, input.environment?.lightBaking);
        let postEffects = this._postProcess.resolve(this._options.maxPostProcessPasses);

        const baseEstimatedCost = estimateRenderFrameCost({
            deltaTime,
            opaqueCount: this._opaque.length,
            transparentCount: this._transparent.length,
            activeLightCount: this._activeLights.length,
            shadowLightCount: this._shadowLights.length,
            shadowCasterCount: this._shadowCasters.length,
            postEffects,
            probeUpdates,
            bakeTasks,
            gi,
            volumetricsEnabled: volumetrics.enabled,
            shadowEnabled,
        });
        let degraded = false;

        if (this._options.frameBudgetMs > 0 && baseEstimatedCost > this._options.frameBudgetMs) {
            const degradedState = degradeRenderFrame(
                {
                    frameBudgetMs: this._options.frameBudgetMs,
                    degradeStrategy: this._options.degradeStrategy,
                },
                {
                    estimatedCost: baseEstimatedCost,
                    warnings: this._warnings,
                    gi,
                    volumetrics,
                    shadowEnabled,
                    probeUpdates,
                    postEffects,
                    bakeTasks,
                }
            );
            gi = degradedState.gi;
            volumetrics = degradedState.volumetrics;
            shadowEnabled = degradedState.shadowEnabled;
            probeUpdates = degradedState.probeUpdates;
            postEffects = degradedState.postEffects;
            bakeTasks = degradedState.bakeTasks;
            degraded = degradedState.degraded;
        }

        const livePasses = this._planPasses(
            frame,
            input,
            hdr,
            gi,
            volumetrics,
            shadowEnabled,
            probeUpdates,
            postEffects,
            bakeTasks
        );

        const statistics = this._createStatistics(
            frame,
            deltaTime,
            livePasses,
            gi,
            shadowEnabled,
            bakeTasks.length,
            probeUpdates,
            volumetrics
        );
        const context: RenderExecutionContext<TNative> = {
            frame,
            viewport: Object.freeze({ ...input.viewport }),
            camera: input.camera,
            graph: this._graph,
            statistics,
        };
        const result: RenderFrameResult<TNative> = {
            frame,
            viewport: Object.freeze({ ...input.viewport }),
            passes: this._summarizePasses(livePasses),
            resources: this._graph.listTextures(),
            statistics,
            degraded,
            warnings: Object.freeze(this._warnings.toArray()),
        };

        return {
            result,
            context,
            livePasses,
        };
    }

    private _validateFrameInput(input: RenderFrameInput): void {
        if (
            !input.camera ||
            !(input.camera.viewMatrix instanceof Object) ||
            !(input.camera.projectionMatrix instanceof Object)
        ) {
            throw new RenderValidationError('INVALID_CAMERA', this._options.locale);
        }

        if (
            !Number.isFinite(input.viewport.width) ||
            !Number.isFinite(input.viewport.height) ||
            input.viewport.width <= 0 ||
            input.viewport.height <= 0
        ) {
            throw new RenderValidationError('INVALID_VIEWPORT', this._options.locale, {
                viewport: input.viewport,
            });
        }

        for (const primitive of input.primitives) {
            if (!primitive.id || !primitive.meshId || !(primitive.worldMatrix instanceof Object)) {
                throw new RenderValidationError('INVALID_PRIMITIVE', this._options.locale, {
                    primitiveId: primitive.id,
                });
            }
        }

        for (const light of input.lights ?? []) {
            if (!light.id || !Number.isFinite(light.intensity)) {
                throw new RenderValidationError('INVALID_LIGHT', this._options.locale, {
                    lightId: light.id,
                });
            }
        }
    }

    private _resetScratch(): void {
        this._classifier.reset();
        this._warnings.reset();
    }

    private _resolveHdr(input: RenderFrameInput): NormalizedHdrSettings {
        if (!this._options.hdr.enabled) {
            return Object.freeze({
                ...this._options.hdr,
                enabled: false,
            });
        }

        return Object.freeze({
            ...this._options.hdr,
            exposure:
                input.camera.exposureCompensation !== undefined
                    ? this._options.hdr.exposure?.mode === 'manual'
                        ? {
                              mode: 'manual' as const,
                              exposure:
                                  this._options.hdr.exposure.exposure +
                                  input.camera.exposureCompensation,
                          }
                        : this._options.hdr.exposure?.mode === 'automatic'
                          ? {
                                ...this._options.hdr.exposure,
                                keyValue:
                                    (this._options.hdr.exposure.keyValue ?? 0.18) *
                                    Math.pow(2, input.camera.exposureCompensation),
                            }
                          : this._options.hdr.exposure
                    : this._options.hdr.exposure,
        });
    }

    private _selectBakeTasks(
        frame: number,
        override?: RenderLightBakingSettings
    ): readonly ScheduledRenderBakeTask[] {
        const settings = override ?? this._options.lightBaking;
        return this._bakeTasks.select(frame, {
            enabled: settings.enabled ?? this._options.lightBaking.enabled,
            maxTasksPerFrame:
                settings.maxTasksPerFrame ?? this._options.lightBaking.maxTasksPerFrame,
            budgetMs: Math.max(0, settings.budgetMs ?? this._options.lightBaking.budgetMs),
            throttleFrames:
                settings.throttleFrames ?? this._options.lightBaking.throttleFrames,
        });
    }

    private _planPasses(
        frame: number,
        input: RenderFrameInput,
        hdr: NormalizedHdrSettings,
        gi: RenderGlobalIlluminationSettings,
        volumetrics: NormalizedVolumetricSettings,
        shadowEnabled: boolean,
        probeUpdateCount: number,
        postEffects: ReturnType<PostProcessStack['resolve']>,
        bakeTasks: readonly ScheduledRenderBakeTask[]
    ): readonly ResolvedRenderPass[] {
        return this._planner.plan({
            frame,
            viewport: input.viewport,
            camera: input.camera,
            environment: input.environment,
            hdr,
            gi,
            volumetrics,
            shadowEnabled,
            probeUpdateCount,
            postEffects,
            bakeTasks,
            opaque: this._opaque,
            transparent: this._transparent,
            shadowCasters: this._shadowCasters,
            activeLights: this._activeLights,
            shadowLights: this._shadowLights,
            activeProbes: this._activeProbes,
            probeUpdates: this._probeUpdates,
        });
    }

    private _createStatistics(
        frame: number,
        deltaTime: number,
        passes: readonly ResolvedRenderPass[],
        gi: RenderGlobalIlluminationSettings,
        shadowEnabled: boolean,
        bakeTaskCount: number,
        probeUpdates: number,
        volumetrics: NormalizedVolumetricSettings
    ): RenderFrameStatistics {
        const resources = this._graph.listTextures();
        let transientResources = 0;
        let persistentResources = 0;
        let postProcessPassCount = 0;
        let postProcessCost = 0;
        let bakeTaskCost = 0;

        for (const resource of resources) {
            if (resource.lifetime === 'transient') {
                transientResources += 1;
            } else {
                persistentResources += 1;
            }
        }

        for (let i = 0; i < passes.length; i++) {
            const pass = passes[i]!;
            if (pass.kind === 'post-process') {
                postProcessPassCount += 1;
                postProcessCost += pass.estimatedCost;
                continue;
            }

            if (pass.kind === 'light-bake') {
                bakeTaskCost += pass.estimatedCost;
            }
        }

        return {
            frame,
            deltaTime,
            passCount: passes.length,
            postProcessPassCount,
            opaqueCount: this._opaque.length,
            transparentCount: this._transparent.length,
            shadowCasterCount: shadowEnabled ? this._shadowCasters.length : 0,
            lightCount: this._activeLights.length,
            activeLocalLightCount: Math.max(0, this._activeLights.length - this._shadowLights.length),
            activeReflectionProbeCount: this._activeProbes.length,
            reflectionProbeUpdateCount: probeUpdates,
            bakeTaskCount,
            transientResourceCount: transientResources,
            persistentResourceCount: persistentResources,
            resourceReuseCount: this._graph.reuseCount,
            estimatedCost: estimateRenderFrameCostTotals({
                deltaTime,
                opaqueCount: this._opaque.length,
                transparentCount: this._transparent.length,
                activeLightCount: this._activeLights.length,
                shadowLightCount: this._shadowLights.length,
                shadowCasterCount: this._shadowCasters.length,
                postProcessCost,
                probeUpdates,
                bakeTaskCost,
                gi,
                volumetricsEnabled: volumetrics.enabled,
                shadowEnabled,
            }),
        };
    }

    private _summarizePasses(passes: readonly ResolvedRenderPass[]): readonly RenderPassSummary[] {
        const summaries: RenderPassSummary[] = new Array(passes.length);
        for (let i = 0; i < passes.length; i++) {
            const pass = passes[i];
            summaries[i] = {
                kind: pass.kind,
                name: pass.name,
                order: pass.order,
                queue: pass.queue,
                target: pass.target,
                inputs: Object.freeze([...pass.inputs]),
                estimatedCost: pass.estimatedCost,
                itemCount: pass.items?.length ?? 0,
                lightCount: pass.lights?.length ?? 0,
                probeCount: pass.probes?.length ?? 0,
                metadata: Object.freeze({
                    ...(pass.metadata as Record<string, unknown>),
                }) as unknown as RenderPassMetadata,
            };
        }
        return Object.freeze(summaries);
    }
}

export const createRenderPipeline = <TNative = unknown>(
    options: RenderPipelineOptions<TNative> = {}
): RenderPipeline<TNative> => new RenderPipeline<TNative>(options);
