import type { Mat4 } from '@axrone/numeric';
import type { IDisposable } from '../../../types';
import {
    RenderBakeTaskError,
    RenderExecutionError,
    RenderPipelineError,
    RenderValidationError,
} from './errors';
import { RenderTextureRegistry } from './graph';
import { MutableObjectArena, ReusableList, SortableRenderList, StringKeyCache } from './memory';
import { PostProcessStack } from './post-process';
import {
    createRenderPassName,
    createRenderResourceName,
    type ReadonlyRenderList,
    type RenderBakeTaskState,
    type RenderCameraState,
    type RenderClearState,
    type RenderDegradeStrategy,
    type RenderExecutionContext,
    type RenderFrameInput,
    type RenderFrameResult,
    type RenderFrameStatistics,
    type RenderGlobalIlluminationMode,
    type RenderGlobalIlluminationSettings,
    type RenderHdrSettings,
    type RenderLight,
    type RenderLightBakeTask,
    type RenderLightBakingSettings,
    type RenderEnvironmentState,
    type RenderPassKind,
    type RenderPassMetadata,
    type RenderPassName,
    type RenderPassQueue,
    type RenderPassSummary,
    type RenderPipelineOptions,
    type RenderPrimitiveInstance,
    type RenderReflectionProbe,
    type RenderResourceLifetime,
    type RenderResourceName,
    type RenderShadowSettings,
    type RenderTextureDescriptor,
    type RenderTonemappingSettings,
    type RenderViewport,
    type RenderVolumetricSettings,
    type ResolvedPostProcessEffect,
    type ResolvedRenderPass,
} from './types';

interface MutablePassRecord {
    kind: RenderPassKind;
    name: RenderPassName;
    order: number;
    queue: RenderPassQueue;
    enabled: boolean;
    estimatedCost: number;
    target: RenderResourceName | null;
    inputs: RenderResourceName[];
    items?: ReadonlyRenderList<RenderPrimitiveInstance>;
    lights?: ReadonlyRenderList<RenderLight>;
    probes?: ReadonlyRenderList<RenderReflectionProbe>;
    clearState?: RenderClearState | null;
    metadata: RenderPassMetadata;
}

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

interface InternalBakeTask<TPayload = unknown> extends RenderLightBakeTask<TPayload> {
    state: RenderBakeTaskState;
    priority: number;
    retries: number;
    maxRetries: number;
    createdAt: number;
    scheduledAt: number;
    lastError: string | null;
}

interface FrameBuild<TNative> {
    readonly result: RenderFrameResult<TNative>;
    readonly context: RenderExecutionContext<TNative>;
    readonly livePasses: readonly ResolvedRenderPass[];
}

const BAKE_TASK_COST: Readonly<Record<InternalBakeTask['type'], number>> = Object.freeze({
    lightmap: 0.28,
    probe: 0.18,
    'irradiance-cache': 0.22,
});

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

const OPAQUE_SORT: readonly [1, 1, 1] = [1, 1, 1] as const;
const TRANSPARENT_SORT: readonly [1, -1, 1] = [1, -1, 1] as const;
const IMPORTANCE_SORT: readonly [-1, 1, 1] = [-1, 1, 1] as const;

const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

const ensureFinite = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;

type RenderVec3Ref = RenderCameraState['position'] | RenderReflectionProbe['position'];
type ObjectVec3Ref = Exclude<RenderVec3Ref, readonly [number, number, number]>;

const asObjectVec3 = (value: RenderVec3Ref): ObjectVec3Ref => value as ObjectVec3Ref;

const getX = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[0] : asObjectVec3(value).x);
const getY = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[1] : asObjectVec3(value).y);
const getZ = (value: RenderVec3Ref): number => (Array.isArray(value) ? value[2] : asObjectVec3(value).z);

const getTranslationX = (matrix: Mat4): number => matrix.data[12];
const getTranslationY = (matrix: Mat4): number => matrix.data[13];
const getTranslationZ = (matrix: Mat4): number => matrix.data[14];

const layerVisible = (cameraMask: number, primitiveMask: number | undefined): boolean =>
    primitiveMask === undefined || primitiveMask === 0 || (cameraMask & primitiveMask) !== 0;

const localLightImportance = (light: RenderLight, camera: RenderCameraState): number => {
    const cx = getX(camera.position);
    const cy = getY(camera.position);
    const cz = getZ(camera.position);
    let px = 0;
    let py = 0;
    let pz = 0;
    let range = 1;

    if (light.type === 'point' || light.type === 'spot') {
        px = getX(light.position);
        py = getY(light.position);
        pz = getZ(light.position);
        range = Math.max(0.001, light.range);
    }

    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    return (light.intensity * range * range) / Math.max(distanceSq, 1);
};

const primitiveDistanceSq = (primitive: RenderPrimitiveInstance, camera: RenderCameraState): number => {
    const cx = getX(camera.position);
    const cy = getY(camera.position);
    const cz = getZ(camera.position);
    const px = primitive.bounds ? getX(primitive.bounds.center) : getTranslationX(primitive.worldMatrix);
    const py = primitive.bounds ? getY(primitive.bounds.center) : getTranslationY(primitive.worldMatrix);
    const pz = primitive.bounds ? getZ(primitive.bounds.center) : getTranslationZ(primitive.worldMatrix);
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    return dx * dx + dy * dy + dz * dz;
};

const probeUpdateUrgency = (probe: RenderReflectionProbe, frame: number): number => {
    const interval = Math.max(1, probe.updateInterval ?? 30);
    const age =
        probe.lastUpdatedFrame === undefined ? interval : Math.max(0, frame - probe.lastUpdatedFrame);
    const dirtyBoost = probe.dirty === true ? interval * 2 : 0;
    const priority = probe.priority ?? 0;
    return priority * 100 + dirtyBoost + age;
};

const computeCascadeSplits = (
    near: number,
    far: number,
    cascadeCount: 1 | 2 | 4,
    lambda: number,
    maxDistance: number
): readonly {
    readonly index: number;
    readonly near: number;
    readonly far: number;
    readonly splitDepth: number;
}[] => {
    const count = cascadeCount;
    const clampedNear = Math.max(0.001, near);
    const clampedFar = Math.max(clampedNear + 0.001, Math.min(far, maxDistance));
    const ranges: Array<{
        index: number;
        near: number;
        far: number;
        splitDepth: number;
    }> = [];
    let previous = clampedNear;

    for (let i = 1; i <= count; i++) {
        const ratio = i / count;
        const logarithmic = clampedNear * Math.pow(clampedFar / clampedNear, ratio);
        const uniform = clampedNear + (clampedFar - clampedNear) * ratio;
        const splitDepth = uniform + (logarithmic - uniform) * lambda;
        const currentFar = i === count ? clampedFar : clamp(splitDepth, previous, clampedFar);

        ranges.push(
            Object.freeze({
                index: i - 1,
                near: previous,
                far: currentFar,
                splitDepth: currentFar,
            })
        );
        previous = currentFar;
    }

    return Object.freeze(ranges);
};

const exposureHistoryDescriptor = (): RenderTextureDescriptor => ({
    width: 1,
    height: 1,
    format: 'r16f',
    usage: ['sampled', 'history'],
});

const postEffectCost = (effect: ResolvedPostProcessEffect): number => {
    if (effect.category === 'custom') {
        return 0.16;
    }

    switch (effect.name) {
        case 'taa':
            return 0.2;
        case 'depth-of-field':
            return 0.22;
        case 'bloom':
            return 0.18;
        case 'ssao':
            return 0.19;
        case 'fxaa':
            return 0.09;
        default:
            return 0.12;
    }
};

const reflectionProbeDistanceSq = (probe: RenderReflectionProbe, camera: RenderCameraState): number => {
    const dx = getX(probe.position) - getX(camera.position);
    const dy = getY(probe.position) - getY(camera.position);
    const dz = getZ(probe.position) - getZ(camera.position);
    return dx * dx + dy * dy + dz * dz;
};

const isTransparentMaterial = (primitive: RenderPrimitiveInstance): boolean =>
    primitive.material.transparent === true;

const castsShadows = (primitive: RenderPrimitiveInstance): boolean =>
    primitive.material.castsShadows !== false;

const renderQueueFor = (primitive: RenderPrimitiveInstance): number => {
    if (primitive.material.renderQueue !== undefined) {
        return primitive.material.renderQueue;
    }
    if (primitive.material.transparent) {
        return 3000;
    }
    if (primitive.material.alphaClipped) {
        return 2450;
    }
    return 2000;
};

const giModeOf = (settings: RenderGlobalIlluminationSettings): RenderGlobalIlluminationMode =>
    settings.mode;

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

const mutablePassFactory = (): MutablePassRecord => ({
    kind: 'opaque',
    name: createRenderPassName('opaque'),
    order: 0,
    queue: 'geometry',
    enabled: true,
    estimatedCost: 0,
    target: null,
    inputs: [],
    metadata: {
        color: createRenderResourceName('frame', 'scene-color'),
        depth: createRenderResourceName('frame', 'depth'),
        hdr: true,
        giMode: 'disabled',
        ibl: false,
    },
});

export class RenderPipeline<TNative = unknown> implements IDisposable {
    private readonly _options: NormalizedOptions<TNative>;
    private readonly _graph: RenderTextureRegistry<TNative>;
    private readonly _postProcess: PostProcessStack;
    private readonly _strings = new StringKeyCache();
    private readonly _opaque = new SortableRenderList<RenderPrimitiveInstance>(256);
    private readonly _transparent = new SortableRenderList<RenderPrimitiveInstance>(128);
    private readonly _shadowCasters = new SortableRenderList<RenderPrimitiveInstance>(256);
    private readonly _localLightCandidates = new SortableRenderList<RenderLight>(64);
    private readonly _probeCandidates = new SortableRenderList<RenderReflectionProbe>(32);
    private readonly _activeLights = new ReusableList<RenderLight>(32);
    private readonly _shadowLights = new ReusableList<RenderLight>(8);
    private readonly _activeProbes = new ReusableList<RenderReflectionProbe>(8);
    private readonly _probeUpdates = new ReusableList<RenderReflectionProbe>(4);
    private readonly _warnings = new ReusableList<string>(16);
    private readonly _passArena = new MutableObjectArena<MutablePassRecord>(mutablePassFactory);
    private readonly _bakeTasks = new Map<string, InternalBakeTask>();
    private _frame = 0;
    private _disposed = false;

    constructor(options: RenderPipelineOptions<TNative> = {}) {
        this._options = normalizeOptions(options);
        this._graph = new RenderTextureRegistry<TNative>({
            allocator: this._options.resourceAllocator,
            resourcePoolCapacity: this._options.resourcePoolCapacity,
        });
        this._postProcess = new PostProcessStack(options.postProcess ?? []);
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get postProcess(): PostProcessStack {
        return this._postProcess;
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
        const now = Date.now();
        this._bakeTasks.set(task.id, {
            ...task,
            state: task.state ?? 'queued',
            priority: task.priority ?? 0,
            retries: task.retries ?? 0,
            maxRetries: task.maxRetries ?? this._options.lightBaking.maxRetries,
            createdAt: task.createdAt ?? now,
            scheduledAt: task.scheduledAt ?? 0,
            lastError: task.lastError ?? null,
        });
        return this;
    }

    listBakeTasks(): readonly RenderLightBakeTask[] {
        return Object.freeze(Array.from(this._bakeTasks.values()).map((task) => ({ ...task })));
    }

    getBakeTask(id: string): RenderLightBakeTask | null {
        const task = this._bakeTasks.get(id);
        return task ? { ...task } : null;
    }

    completeBakeTask(id: string): void {
        const task = this._bakeTasks.get(id);
        if (!task) {
            throw new RenderBakeTaskError(this._options.locale, { id });
        }
        task.state = 'completed';
        task.lastError = null;
    }

    failBakeTask(id: string, error: string): void {
        const task = this._bakeTasks.get(id);
        if (!task) {
            throw new RenderBakeTaskError(this._options.locale, { id });
        }
        task.retries += 1;
        task.lastError = error;
        task.state = task.retries > task.maxRetries ? 'failed' : 'queued';
    }

    removeBakeTask(id: string): boolean {
        return this._bakeTasks.delete(id);
    }

    clearBakeTasks(): void {
        this._bakeTasks.clear();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

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

        this._classifyPrimitives(input);
        this._classifyLights(input);
        this._classifyProbes(input, frame);

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

        const baseEstimatedCost = this._estimateBaseCost(
            deltaTime,
            postEffects.reduce((sum, effect) => sum + postEffectCost(effect), 0),
            probeUpdates,
            bakeTasks.reduce((sum, task) => sum + BAKE_TASK_COST[task.type], 0),
            gi,
            volumetrics,
            shadowEnabled
        );
        let degraded = false;

        if (this._options.frameBudgetMs > 0 && baseEstimatedCost > this._options.frameBudgetMs) {
            const degradedState = this._applyDegradeStrategy(
                baseEstimatedCost,
                gi,
                volumetrics,
                shadowEnabled,
                probeUpdates,
                postEffects,
                bakeTasks
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
            deltaTime,
            input.viewport,
            input.camera,
            input.environment,
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
        this._opaque.reset();
        this._transparent.reset();
        this._shadowCasters.reset();
        this._localLightCandidates.reset();
        this._probeCandidates.reset();
        this._activeLights.reset();
        this._shadowLights.reset();
        this._activeProbes.reset();
        this._probeUpdates.reset();
        this._warnings.reset();
        this._passArena.reset();
    }

    private _classifyPrimitives(input: RenderFrameInput): void {
        const cameraMask = input.camera.layerMask ?? -1;
        for (const primitive of input.primitives) {
            if (primitive.visible === false) {
                continue;
            }

            if (!layerVisible(cameraMask, primitive.layerMask)) {
                continue;
            }

            const queue = renderQueueFor(primitive);
            const materialKey = this._strings.get(primitive.material.id);
            const meshKey = this._strings.get(primitive.meshId);
            const distanceSq = primitiveDistanceSq(primitive, input.camera);

            if (isTransparentMaterial(primitive)) {
                if (this._transparent.length >= this._options.maxTransparentPrimitives) {
                    if (this._warnings.length < 16) {
                        this._warnings.push(
                            `transparent primitive budget exceeded at ${this._options.maxTransparentPrimitives}`
                        );
                    }
                    continue;
                }

                this._transparent.push(
                    primitive,
                    queue,
                    distanceSq,
                    materialKey + (primitive.sortBias ?? 0)
                );
            } else {
                this._opaque.push(primitive, queue, materialKey, meshKey);
            }

            if (castsShadows(primitive)) {
                this._shadowCasters.push(primitive, queue, materialKey, distanceSq);
            }
        }

        this._opaque.sort(OPAQUE_SORT);
        this._transparent.sort(TRANSPARENT_SORT);
        this._shadowCasters.sort(OPAQUE_SORT);
    }

    private _classifyLights(input: RenderFrameInput): void {
        for (const light of input.lights ?? []) {
            if (light.type === 'directional') {
                this._activeLights.push(light);
                if (
                    light.castsShadows &&
                    this._shadowLights.length < this._options.shadows.maxShadowedLights
                ) {
                    this._shadowLights.push(light);
                }
                continue;
            }

            this._localLightCandidates.push(
                light,
                localLightImportance(light, input.camera),
                light.intensity,
                light.type === 'spot' ? 1 : 0
            );
        }

        this._localLightCandidates.sort(IMPORTANCE_SORT);
        const count = Math.min(
            this._localLightCandidates.length,
            this._options.maxActiveLocalLights
        );
        for (let i = 0; i < count; i++) {
            const light = this._localLightCandidates.at(i);
            this._activeLights.push(light);
            if (
                light.castsShadows &&
                this._shadowLights.length < this._options.shadows.maxShadowedLights
            ) {
                this._shadowLights.push(light);
            }
        }
    }

    private _classifyProbes(input: RenderFrameInput, frame: number): void {
        for (const probe of input.environment?.reflectionProbes ?? []) {
            const priority = probeUpdateUrgency(probe, frame);
            const distanceSq = reflectionProbeDistanceSq(probe, input.camera);
            this._probeCandidates.push(probe, priority, distanceSq, probe.intensity ?? 1);
        }

        this._probeCandidates.sort(IMPORTANCE_SORT);
        const activeCount = Math.min(
            this._probeCandidates.length,
            this._options.maxActiveReflectionProbes
        );
        for (let i = 0; i < activeCount; i++) {
            const probe = this._probeCandidates.at(i);
            this._activeProbes.push(probe);
            const mode = probe.mode ?? 'baked';
            const interval = Math.max(1, probe.updateInterval ?? 30);
            const shouldUpdate =
                mode !== 'baked' &&
                (probe.dirty === true ||
                    probe.lastUpdatedFrame === undefined ||
                    frame - probe.lastUpdatedFrame >= interval);
            if (shouldUpdate) {
                this._probeUpdates.push(probe);
            }
        }
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
    ): readonly InternalBakeTask[] {
        const settings = override ?? this._options.lightBaking;
        if (!settings.enabled || this._bakeTasks.size === 0) {
            return Object.freeze([]);
        }

        const limit = settings.maxTasksPerFrame ?? this._options.lightBaking.maxTasksPerFrame;
        const throttleFrames = settings.throttleFrames ?? this._options.lightBaking.throttleFrames;
        const budgetMs = Math.max(0, settings.budgetMs ?? this._options.lightBaking.budgetMs);
        const candidates = Array.from(this._bakeTasks.values())
            .filter((task) => {
                if (task.state === 'completed' || task.state === 'failed') {
                    return false;
                }
                if (task.scheduledAt > 0 && frame - task.scheduledAt < throttleFrames) {
                    return false;
                }
                return true;
            })
            .sort(
                (a, b) =>
                    b.priority - a.priority ||
                    a.retries - b.retries ||
                    a.createdAt - b.createdAt
            );
        const selected: InternalBakeTask[] = [];
        let spentBudget = 0;

        for (let i = 0; i < candidates.length && selected.length < limit; i++) {
            const task = candidates[i];
            const taskCost = BAKE_TASK_COST[task.type];
            if (budgetMs > 0 && selected.length > 0 && spentBudget + taskCost > budgetMs) {
                continue;
            }

            spentBudget += taskCost;
            task.state = 'running';
            task.scheduledAt = frame;
            selected.push(task);
        }

        return Object.freeze(selected);
    }

    private _estimateBaseCost(
        deltaTime: number,
        postProcessCost: number,
        probeUpdates: number,
        bakeTaskCost: number,
        gi: RenderGlobalIlluminationSettings,
        volumetrics: NormalizedVolumetricSettings,
        shadowEnabled: boolean
    ): number {
        let cost =
            0.5 +
            this._opaque.length * 0.003 +
            this._transparent.length * 0.004 +
            this._activeLights.length * 0.06 +
            Math.min(deltaTime, 0.05) * 0.35;

        if (shadowEnabled) {
            cost += this._shadowLights.length * 0.24 + this._shadowCasters.length * 0.0015;
        }

        if (gi.mode === 'ssgi') {
            cost += 0.55;
        } else if (gi.mode === 'ddgi') {
            cost += 0.4;
        } else if (gi.mode === 'hybrid') {
            cost += 0.6;
        }

        if (volumetrics.enabled) {
            cost += 0.6;
        }

        cost += postProcessCost;
        cost += probeUpdates * 0.32;
        cost += bakeTaskCost;
        return cost;
    }

    private _applyDegradeStrategy(
        estimatedCost: number,
        gi: RenderGlobalIlluminationSettings,
        volumetrics: NormalizedVolumetricSettings,
        shadowEnabled: boolean,
        probeUpdates: number,
        postEffects: readonly ResolvedPostProcessEffect[],
        bakeTasks: readonly InternalBakeTask[]
    ): {
        readonly gi: RenderGlobalIlluminationSettings;
        readonly volumetrics: NormalizedVolumetricSettings;
        readonly shadowEnabled: boolean;
        readonly probeUpdates: number;
        readonly postEffects: readonly ResolvedPostProcessEffect[];
        readonly bakeTasks: readonly InternalBakeTask[];
        readonly degraded: boolean;
    } {
        if (this._options.degradeStrategy === 'none') {
            return {
                gi,
                volumetrics,
                shadowEnabled,
                probeUpdates,
                postEffects,
                bakeTasks,
                degraded: false,
            };
        }

        let degraded = false;
        let nextGi = gi;
        let nextVolumetrics = volumetrics;
        let nextShadowEnabled = shadowEnabled;
        let nextProbeUpdates = probeUpdates;
        let nextPostEffects = postEffects;
        let nextBakeTasks = bakeTasks;
        let currentCost = estimatedCost;

        const mark = (warning: string, delta: number): void => {
            degraded = true;
            currentCost = Math.max(0, currentCost - delta);
            if (this._warnings.length < 16) {
                this._warnings.push(warning);
            }
        };

        if (currentCost > this._options.frameBudgetMs && nextBakeTasks.length > 0) {
            mark(
                'light baking deferred due to frame budget pressure',
                nextBakeTasks.reduce((sum, task) => sum + BAKE_TASK_COST[task.type], 0)
            );
            nextBakeTasks = Object.freeze([]);
        }

        if (currentCost > this._options.frameBudgetMs && nextProbeUpdates > 1) {
            const target = this._options.degradeStrategy === 'aggressive' ? 0 : 1;
            mark('reflection probe updates throttled', (nextProbeUpdates - target) * 0.32);
            nextProbeUpdates = target;
        }

        if (currentCost > this._options.frameBudgetMs && nextVolumetrics.enabled) {
            mark('volumetric effects disabled for frame budget stability', 0.6);
            nextVolumetrics = {
                ...nextVolumetrics,
                enabled: false,
            };
        }

        if (
            currentCost > this._options.frameBudgetMs &&
            nextGi.mode !== 'disabled' &&
            (nextGi.mode === 'ssgi' || nextGi.mode === 'hybrid')
        ) {
            mark(
                'realtime GI quality reduced under load',
                nextGi.mode === 'hybrid' ? 0.45 : 0.55
            );
            nextGi = nextGi.mode === 'hybrid' ? nextGi.baked ?? { mode: 'disabled' } : { mode: 'disabled' };
        }

        if (
            currentCost > this._options.frameBudgetMs &&
            nextShadowEnabled &&
            this._options.degradeStrategy === 'aggressive'
        ) {
            mark('shadow pass skipped under aggressive degradation', 0.35);
            nextShadowEnabled = false;
        }

        if (currentCost > this._options.frameBudgetMs && nextPostEffects.length > 0) {
            const keep =
                this._options.degradeStrategy === 'aggressive'
                    ? Math.min(2, nextPostEffects.length)
                    : Math.min(4, nextPostEffects.length);
            if (keep < nextPostEffects.length) {
                mark(
                    'post-process stack truncated to fit budget',
                    nextPostEffects
                        .slice(keep)
                        .reduce((sum, effect) => sum + postEffectCost(effect), 0)
                );
                nextPostEffects = Object.freeze(nextPostEffects.slice(0, keep));
            }
        }

        return {
            gi: nextGi,
            volumetrics: nextVolumetrics,
            shadowEnabled: nextShadowEnabled,
            probeUpdates: nextProbeUpdates,
            postEffects: nextPostEffects,
            bakeTasks: nextBakeTasks,
            degraded,
        };
    }

    private _planPasses(
        frame: number,
        deltaTime: number,
        viewport: RenderViewport,
        camera: RenderCameraState,
        environment: RenderEnvironmentState | undefined,
        hdr: NormalizedHdrSettings,
        gi: RenderGlobalIlluminationSettings,
        volumetrics: NormalizedVolumetricSettings,
        shadowEnabled: boolean,
        probeUpdateCount: number,
        postEffects: readonly ResolvedPostProcessEffect[],
        bakeTasks: readonly InternalBakeTask[]
    ): readonly ResolvedRenderPass[] {
        let order = 0;
        const width = Math.max(1, Math.floor(viewport.width * (viewport.pixelRatio ?? 1)));
        const height = Math.max(1, Math.floor(viewport.height * (viewport.pixelRatio ?? 1)));

        const sceneDepth = this._acquireTexture(
            createRenderResourceName('frame', 'depth'),
            {
                width,
                height,
                format: 'depth24',
                usage: ['depth-attachment', 'sampled'],
            },
            'transient'
        ).id as RenderResourceName<'frame'>;

        const sceneColor = this._acquireTexture(
            createRenderResourceName('frame', 'scene-color'),
            {
                width,
                height,
                format: hdr.enabled ? hdr.colorFormat : 'rgba8',
                usage: ['color-attachment', 'sampled'],
            },
            'transient'
        ).id as RenderResourceName<'frame'>;

        const backBuffer = this._acquireTexture(
            createRenderResourceName('swap', 'back-buffer'),
            {
                width,
                height,
                format: 'rgba8',
                usage: ['present'],
            },
            'persistent'
        ).id as RenderResourceName<'swap'>;

        let currentColor: RenderResourceName = sceneColor;
        let ping: RenderResourceName<'post'> | null = null;
        let pong: RenderResourceName<'post'> | null = null;
        const exposureHistory =
            hdr.enabled && hdr.exposure?.mode === 'automatic'
                ? (this._acquireTexture(
                      createRenderResourceName('history', 'exposure'),
                      exposureHistoryDescriptor(),
                      'history'
                  ).id as RenderResourceName<'history'>)
                : null;

        const useDepthPrepass =
            this._options.enableDepthPrepass === true ||
            (this._options.enableDepthPrepass === 'auto' &&
                (this._opaque.length > 48 ||
                    this._shadowLights.length > 0 ||
                    this._containsAlphaClippedOpaque()));

        if (useDepthPrepass && this._opaque.length > 0) {
            order = this._pushPass(order, {
                kind: 'depth-prepass',
                name: createRenderPassName('depth-prepass'),
                queue: 'prepass',
                target: sceneDepth,
                inputs: [sceneDepth],
                items: this._opaque,
                clearState: camera.clearState ?? { depth: 1 },
                estimatedCost: this._opaque.length * 0.0015,
                metadata: {
                    depth: sceneDepth,
                },
            });
        }

        if (shadowEnabled) {
            const cascades = computeCascadeSplits(
                camera.near,
                camera.far,
                this._options.shadows.cascadeCount,
                this._options.shadows.cascadeSplitLambda,
                this._options.shadows.maxDistance
            );
            const shadowAtlas = this._acquireTexture(
                createRenderResourceName('shadow', 'atlas'),
                {
                    width: this._options.shadows.atlasSize,
                    height: this._options.shadows.atlasSize,
                    format: 'depth32f',
                    usage: ['shadow', 'depth-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'shadow'>;

            order = this._pushPass(order, {
                kind: 'shadow',
                name: createRenderPassName('shadow'),
                queue: 'shadow',
                target: shadowAtlas,
                inputs: [shadowAtlas],
                items: this._shadowCasters,
                lights: this._shadowLights,
                estimatedCost:
                    this._shadowLights.length * 0.24 + this._shadowCasters.length * 0.0015,
                metadata: {
                    atlas: shadowAtlas,
                    cascadeCount: this._options.shadows.cascadeCount,
                    filter: this._options.shadows.filter,
                    maxDistance: this._options.shadows.maxDistance,
                    cascades,
                    lightIds: Object.freeze(this._shadowLights.toArray().map((light) => light.id)),
                },
            });
        }

        if (probeUpdateCount > 0) {
            const probeTarget = this._acquireTexture(
                createRenderResourceName('probe', 'update-target'),
                {
                    width: 1024,
                    height: 1024,
                    format: hdr.colorFormat,
                    usage: ['color-attachment', 'sampled'],
                    cube: true,
                },
                'transient'
            ).id as RenderResourceName<'probe'>;

            const probeView = this._limitedProbeView(probeUpdateCount);
            order = this._pushPass(order, {
                kind: 'reflection-probe',
                name: createRenderPassName('reflection-probe'),
                queue: 'environment',
                target: probeTarget,
                inputs: [probeTarget],
                probes: probeView,
                estimatedCost: probeUpdateCount * 0.32,
                metadata: {
                    target: probeTarget,
                    updateCount: probeUpdateCount,
                },
            });
        }

        if (gi.mode !== 'disabled') {
            const giTarget = this._acquireTexture(
                createRenderResourceName('gi', 'indirect'),
                {
                    width,
                    height,
                    format: hdr.colorFormat,
                    usage: ['color-attachment', 'sampled', 'history'],
                },
                gi.mode === 'baked' ? 'persistent' : 'transient'
            ).id as RenderResourceName<'gi'>;

            const giHistory =
                gi.mode === 'ssgi' || gi.mode === 'hybrid'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', 'gi'),
                          {
                              width,
                              height,
                              format: hdr.colorFormat,
                              usage: ['sampled', 'history'],
                          },
                          'history'
                      ).id as RenderResourceName<'history'>)
                    : null;

            order = this._pushPass(order, {
                kind: 'global-illumination',
                name: createRenderPassName('global-illumination'),
                queue: 'lighting',
                target: giTarget,
                inputs: giHistory ? [giTarget, giHistory] : [giTarget],
                estimatedCost:
                    gi.mode === 'ddgi' ? 0.4 : gi.mode === 'hybrid' ? 0.6 : 0.55,
                metadata: {
                    mode: gi.mode,
                    target: giTarget,
                    history: giHistory,
                },
            });
        }

        order = this._pushPass(order, {
            kind: 'opaque',
            name: createRenderPassName('opaque'),
            queue: 'geometry',
            target: sceneColor,
            inputs: [sceneColor, sceneDepth],
            items: this._opaque,
            lights: this._activeLights,
            probes: this._activeProbes,
            clearState: camera.clearState ?? {
                color: [0, 0, 0, 1],
                depth: 1,
            },
            estimatedCost:
                0.15 +
                this._opaque.length * 0.003 +
                this._activeLights.length * 0.04 +
                this._activeProbes.length * 0.02,
            metadata: {
                color: sceneColor,
                depth: sceneDepth,
                hdr: hdr.enabled,
                giMode: giModeOf(gi),
                ibl: this._activeProbes.length > 0,
            },
        });

        const hasSkyLighting =
            !!environment?.skybox ||
            !!environment?.ibl?.enabled ||
            this._activeProbes.length > 0;

        if (hasSkyLighting) {
            order = this._pushPass(order, {
                kind: 'skybox',
                name: createRenderPassName('skybox'),
                queue: 'environment',
                target: currentColor,
                inputs: [currentColor, sceneDepth],
                estimatedCost: 0.08,
                metadata: {
                    color: currentColor as RenderResourceName<'frame' | 'post'>,
                    depth: sceneDepth,
                    useIbl: this._activeProbes.length > 0,
                },
            });
        }

        if (volumetrics.enabled) {
            const froxel = this._acquireTexture(
                createRenderResourceName('volumetric', 'froxel'),
                {
                    width: volumetrics.froxelResolution[0],
                    height: volumetrics.froxelResolution[1],
                    depth: volumetrics.froxelResolution[2],
                    format: 'rgba16f',
                    usage: ['storage', 'sampled', 'history'],
                },
                'transient'
            ).id as RenderResourceName<'volumetric'>;

            const history = volumetrics.temporalReprojection
                ? (this._acquireTexture(
                      createRenderResourceName('history', 'volumetric'),
                      {
                          width: volumetrics.froxelResolution[0],
                          height: volumetrics.froxelResolution[1],
                          depth: volumetrics.froxelResolution[2],
                          format: 'rgba16f',
                          usage: ['sampled', 'history'],
                      },
                      'history'
                  ).id as RenderResourceName<'history'>)
                : null;

            order = this._pushPass(order, {
                kind: 'volumetric',
                name: createRenderPassName('volumetric'),
                queue: 'lighting',
                target: froxel,
                inputs: history ? [froxel, history] : [froxel],
                lights: this._activeLights,
                estimatedCost: 0.6,
                metadata: {
                    froxelGrid: froxel,
                    history,
                },
            });
        }

        if (this._transparent.length > 0) {
            order = this._pushPass(order, {
                kind: 'transparent',
                name: createRenderPassName('transparent'),
                queue: 'transparency',
                target: currentColor,
                inputs: [currentColor, sceneDepth],
                items: this._transparent,
                lights: this._activeLights,
                probes: this._activeProbes,
                estimatedCost:
                    this._transparent.length * 0.004 +
                    this._activeLights.length * 0.03,
                metadata: {
                    color: currentColor as RenderResourceName<'frame' | 'post'>,
                    depth: sceneDepth,
                    hdr: hdr.enabled,
                },
            });
        }

        const effectsBefore = postEffects.filter((effect) => effect.phase === 'before-tonemap');
        const effectsAfter = postEffects.filter((effect) => effect.phase === 'after-tonemap');

        if (effectsBefore.length + effectsAfter.length > 0) {
            ping = this._acquireTexture(
                createRenderResourceName('post', 'ping'),
                {
                    width,
                    height,
                    format: hdr.enabled ? hdr.colorFormat : 'rgba8',
                    usage: ['color-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'post'>;
            pong = this._acquireTexture(
                createRenderResourceName('post', 'pong'),
                {
                    width,
                    height,
                    format: hdr.enabled ? hdr.colorFormat : 'rgba8',
                    usage: ['color-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'post'>;
        }

        for (let i = 0; i < effectsBefore.length; i++) {
            const effect = effectsBefore[i];
            const taaTargetHistory =
                effect.category === 'builtin' && effect.name === 'taa'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', frame % 2 === 0 ? 'taa-b' : 'taa-a'),
                          {
                              width,
                              height,
                              format: hdr.enabled ? hdr.colorFormat : 'rgba8',
                              usage: ['color-attachment', 'sampled', 'history'],
                          },
                          'history'
                      ).id as RenderResourceName<'history'>)
                    : null;
            const taaSourceHistory =
                effect.category === 'builtin' && effect.name === 'taa'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', frame % 2 === 0 ? 'taa-a' : 'taa-b'),
                          {
                              width,
                              height,
                              format: hdr.enabled ? hdr.colorFormat : 'rgba8',
                              usage: ['sampled', 'history'],
                          },
                          'history'
                      ).id as RenderResourceName<'history'>)
                    : null;
            const target =
                taaTargetHistory
                    ? taaTargetHistory
                    : i % 2 === 0
                      ? (ping as RenderResourceName<'post'>)
                      : (pong as RenderResourceName<'post'>);
            const inputs =
                taaSourceHistory
                    ? Object.freeze([currentColor, taaSourceHistory])
                    : Object.freeze([currentColor]);
            order = this._pushPass(order, {
                kind: 'post-process',
                name: createRenderPassName(`post-process:${effect.name}`),
                queue: 'post-process',
                target,
                inputs,
                estimatedCost: postEffectCost(effect),
                metadata: {
                    source: currentColor,
                    target: target as RenderResourceName<'post' | 'frame' | 'history'>,
                    phase: 'before-tonemap',
                    effect,
                },
            });
            currentColor = target;
        }

        const tonemapTarget: RenderResourceName<'post' | 'frame'> =
            hdr.enabled || this._options.tonemapping.mode !== 'none'
                ? ((effectsAfter.length > 0
                      ? effectsBefore.length % 2 === 0
                            ? (ping as RenderResourceName<'post'>)
                            : (pong as RenderResourceName<'post'>)
                      : sceneColor) as RenderResourceName<'post' | 'frame'>)
                : (currentColor as RenderResourceName<'post' | 'frame'>);

        if (hdr.enabled || this._options.tonemapping.mode !== 'none') {
            order = this._pushPass(order, {
                kind: 'tonemap',
                name: createRenderPassName('tonemap'),
                queue: 'post-process',
                target: tonemapTarget,
                inputs: exposureHistory ? [currentColor, exposureHistory] : [currentColor],
                estimatedCost: 0.12,
                metadata: {
                    source: currentColor,
                    target: tonemapTarget,
                    mode: this._options.tonemapping.mode,
                    hdr: hdr.enabled,
                    colorSpace: hdr.outputColorSpace,
                    exposure: hdr.exposure ?? null,
                    exposureHistory,
                },
            });
            currentColor = tonemapTarget;
        }

        for (let i = 0; i < effectsAfter.length; i++) {
            const effect = effectsAfter[i];
            const target =
                i % 2 === 0
                    ? (pong as RenderResourceName<'post'>)
                    : (ping as RenderResourceName<'post'>);
            order = this._pushPass(order, {
                kind: 'post-process',
                name: createRenderPassName(`post-process:${effect.name}`),
                queue: 'post-process',
                target,
                inputs: [currentColor],
                estimatedCost: postEffectCost(effect),
                metadata: {
                    source: currentColor,
                    target,
                    phase: 'after-tonemap',
                    effect,
                },
            });
            currentColor = target;
        }

        if (bakeTasks.length > 0) {
            order = this._pushPass(order, {
                kind: 'light-bake',
                name: createRenderPassName('light-bake'),
                queue: 'async',
                target: null,
                inputs: [],
                estimatedCost: bakeTasks.reduce((sum, task) => sum + BAKE_TASK_COST[task.type], 0),
                metadata: {
                    taskIds: Object.freeze(bakeTasks.map((task) => task.id)),
                    budgetMs:
                        environment?.lightBaking?.budgetMs ??
                        this._options.lightBaking.budgetMs,
                },
            });
        }

        order = this._pushPass(order, {
            kind: 'present',
            name: createRenderPassName('present'),
            queue: 'present',
            target: backBuffer,
            inputs: [currentColor],
            estimatedCost: 0.05,
            metadata: {
                source: currentColor,
                destination: backBuffer,
                colorSpace: hdr.outputColorSpace,
            },
        });

        return this._passArena.values() as readonly ResolvedRenderPass[];
    }

    private _containsAlphaClippedOpaque(): boolean {
        for (let i = 0; i < this._opaque.length; i++) {
            if (this._opaque.at(i).material.alphaClipped) {
                return true;
            }
        }
        return false;
    }

    private _limitedProbeView(limit: number): ReadonlyRenderList<RenderReflectionProbe> {
        if (limit >= this._probeUpdates.length) {
            return this._probeUpdates;
        }

        const view = new ReusableList<RenderReflectionProbe>(limit);
        for (let i = 0; i < limit; i++) {
            view.push(this._probeUpdates.at(i));
        }
        return view;
    }

    private _pushPass(
        order: number,
        config: Omit<MutablePassRecord, 'order' | 'enabled' | 'inputs'> & {
            readonly inputs: readonly RenderResourceName[];
        }
    ): number {
        const pass = this._passArena.acquire();
        pass.kind = config.kind;
        pass.name = config.name;
        pass.order = order;
        pass.queue = config.queue;
        pass.enabled = true;
        pass.estimatedCost = config.estimatedCost;
        pass.target = config.target;
        pass.inputs.length = 0;
        for (let i = 0; i < config.inputs.length; i++) {
            pass.inputs[i] = config.inputs[i];
        }
        pass.items = config.items;
        pass.lights = config.lights;
        pass.probes = config.probes;
        pass.clearState = config.clearState;
        pass.metadata = config.metadata;
        return order + 1;
    }

    private _acquireTexture(
        id: RenderResourceName,
        descriptor: RenderTextureDescriptor,
        lifetime: RenderResourceLifetime
    ) {
        return this._graph.acquireTexture(id, descriptor, lifetime);
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
        for (const resource of resources) {
            if (resource.lifetime === 'transient') {
                transientResources += 1;
            } else {
                persistentResources += 1;
            }
        }

        return {
            frame,
            deltaTime,
            passCount: passes.length,
            postProcessPassCount: passes.filter((pass) => pass.kind === 'post-process').length,
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
            estimatedCost: this._estimateBaseCost(
                deltaTime,
                passes
                    .filter((pass) => pass.kind === 'post-process')
                    .reduce((sum, pass) => sum + pass.estimatedCost, 0),
                probeUpdates,
                passes
                    .filter((pass) => pass.kind === 'light-bake')
                    .reduce((sum, pass) => sum + pass.estimatedCost, 0),
                gi,
                volumetrics,
                shadowEnabled
            ),
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
