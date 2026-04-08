import type { Mat4, Vec3, Vec4 } from '@axrone/numeric';

declare const renderResourceNameBrand: unique symbol;
declare const renderPassNameBrand: unique symbol;

export type RenderResourceName<TNamespace extends string = string> = `${TNamespace}:${string}` & {
    readonly [renderResourceNameBrand]: true;
};

export type RenderPassName<TName extends string = string> = TName & {
    readonly [renderPassNameBrand]: true;
};

export const RENDER_TONEMAPPING_MODES = [
    'none',
    'reinhard',
    'aces',
    'aces-fitted',
    'filmic',
    'agx',
    'neutral',
] as const;

export type RenderTonemappingMode = (typeof RENDER_TONEMAPPING_MODES)[number];

export const RENDER_TEXTURE_FORMATS = [
    'r11g11b10f',
    'rgba8',
    'rgba16f',
    'rgba32f',
    'rg16f',
    'rg32f',
    'r16f',
    'r32f',
    'depth24',
    'depth32f',
    'depth24-stencil8',
] as const;

export type RenderTextureFormat = (typeof RENDER_TEXTURE_FORMATS)[number];

export const RENDER_RESOURCE_LIFETIMES = ['transient', 'history', 'persistent'] as const;

export type RenderResourceLifetime = (typeof RENDER_RESOURCE_LIFETIMES)[number];

export const RENDER_RESOURCE_USAGES = [
    'color-attachment',
    'depth-attachment',
    'sampled',
    'storage',
    'present',
    'shadow',
    'history',
] as const;

export type RenderResourceUsage = (typeof RENDER_RESOURCE_USAGES)[number];

export const RENDER_POST_PROCESS_PHASES = ['before-tonemap', 'after-tonemap'] as const;

export type RenderPostProcessPhase = (typeof RENDER_POST_PROCESS_PHASES)[number];

export const RENDER_POST_PROCESS_QUALITIES = ['low', 'medium', 'high', 'ultra'] as const;

export type RenderPostProcessQuality = (typeof RENDER_POST_PROCESS_QUALITIES)[number];

export const RENDER_SHADOW_FILTERS = ['hard', 'pcf', 'pcss', 'esm', 'vsm'] as const;

export type RenderShadowFilter = (typeof RENDER_SHADOW_FILTERS)[number];

export const RENDER_GI_MODES = ['disabled', 'baked', 'ssgi', 'ddgi', 'hybrid'] as const;

export type RenderGlobalIlluminationMode = (typeof RENDER_GI_MODES)[number];

export const RENDER_OUTPUT_COLOR_SPACES = ['srgb', 'display-p3', 'rec2020'] as const;

export type RenderOutputColorSpace = (typeof RENDER_OUTPUT_COLOR_SPACES)[number];

export const RENDER_DEGRADE_STRATEGIES = ['none', 'balanced', 'aggressive'] as const;

export type RenderDegradeStrategy = (typeof RENDER_DEGRADE_STRATEGIES)[number];

export const RENDER_BAKE_TASK_STATES = [
    'queued',
    'scheduled',
    'running',
    'completed',
    'failed',
] as const;

export type RenderBakeTaskState = (typeof RENDER_BAKE_TASK_STATES)[number];

export const BUILTIN_POST_PROCESS_EFFECTS = [
    'bloom',
    'color-grading',
    'chromatic-aberration',
    'depth-of-field',
    'film-grain',
    'fxaa',
    'ssao',
    'taa',
    'vignette',
] as const;

export type BuiltinPostProcessEffectName = (typeof BUILTIN_POST_PROCESS_EFFECTS)[number];

export type RenderVector3Like = Vec3 | readonly [number, number, number];
export type RenderVector4Like = Vec4 | readonly [number, number, number, number];

export interface RenderViewport {
    readonly width: number;
    readonly height: number;
    readonly pixelRatio?: number;
}

export interface RenderBounds {
    readonly center: RenderVector3Like;
    readonly extents: RenderVector3Like;
}

export interface RenderClearState {
    readonly color?: RenderVector4Like | null;
    readonly depth?: number | null;
    readonly stencil?: number | null;
}

export interface RenderTextureDescriptor {
    readonly width: number;
    readonly height: number;
    readonly depth?: number;
    readonly format: RenderTextureFormat;
    readonly mipLevels?: number;
    readonly samples?: 1 | 2 | 4 | 8;
    readonly usage: readonly RenderResourceUsage[];
    readonly cube?: boolean;
    readonly arrayLayers?: number;
}

export interface RenderTextureResourceSnapshot<TNative = unknown> {
    readonly id: RenderResourceName;
    readonly descriptor: Readonly<RenderTextureDescriptor>;
    readonly lifetime: RenderResourceLifetime;
    readonly native: TNative | null;
    readonly version: number;
    readonly reused: boolean;
    readonly lastFrameUsed: number;
}

export interface RenderResourceAllocator<TNative = unknown> {
    createTexture(
        descriptor: Readonly<RenderTextureDescriptor>,
        previous?: TNative | null
    ): TNative;
    destroyTexture?(native: TNative, descriptor: Readonly<RenderTextureDescriptor>): void;
}

export interface ReadonlyRenderResourceRegistry<TNative = unknown> {
    hasTexture(id: RenderResourceName): boolean;
    getTexture(id: RenderResourceName): RenderTextureResourceSnapshot<TNative> | null;
    listTextures(): readonly RenderTextureResourceSnapshot<TNative>[];
}

export interface ReadonlyRenderList<T> extends Iterable<T> {
    readonly length: number;
    at(index: number): T;
    toArray(): readonly T[];
}

export type RenderMaterialValue =
    | number
    | boolean
    | readonly number[]
    | Float32Array
    | Int32Array
    | Uint32Array
    | Vec3
    | Vec4
    | Mat4
    | null;

export type RenderMaterialModel = 'pbr' | 'unlit' | 'custom';

export interface RenderMaterialSnapshot {
    readonly id: string;
    readonly model: RenderMaterialModel;
    readonly renderQueue?: number;
    readonly transparent?: boolean;
    readonly alphaClipped?: boolean;
    readonly doubleSided?: boolean;
    readonly castsShadows?: boolean;
    readonly receivesShadows?: boolean;
    readonly receivesGi?: boolean;
    readonly receivesReflections?: boolean;
    readonly shaderTag?: string;
    readonly keywords?: readonly string[];
    readonly parameters?: Readonly<Record<string, RenderMaterialValue>>;
    readonly textures?: Readonly<Record<string, string>>;
}

export interface RenderPrimitiveInstance {
    readonly id: string;
    readonly meshId: string;
    readonly material: RenderMaterialSnapshot;
    readonly worldMatrix: Mat4;
    readonly bounds?: RenderBounds;
    readonly layerMask?: number;
    readonly sortBias?: number;
    readonly static?: boolean;
    readonly visible?: boolean;
    readonly receivesLighting?: boolean;
}

export interface RenderCameraState {
    readonly id: string;
    readonly viewMatrix: Mat4;
    readonly projectionMatrix: Mat4;
    readonly viewProjectionMatrix?: Mat4;
    readonly position: RenderVector3Like;
    readonly near: number;
    readonly far: number;
    readonly clearState?: RenderClearState;
    readonly layerMask?: number;
    readonly jitter?: readonly [number, number];
    readonly exposureCompensation?: number;
}

export interface RenderDirectionalLight {
    readonly type: 'directional';
    readonly id: string;
    readonly direction: RenderVector3Like;
    readonly color: RenderVector3Like;
    readonly intensity: number;
    readonly castsShadows?: boolean;
    readonly shadowResolution?: number;
    readonly angularDiameter?: number;
}

export interface RenderPointLight {
    readonly type: 'point';
    readonly id: string;
    readonly position: RenderVector3Like;
    readonly color: RenderVector3Like;
    readonly intensity: number;
    readonly range: number;
    readonly castsShadows?: boolean;
    readonly shadowResolution?: number;
}

export interface RenderSpotLight {
    readonly type: 'spot';
    readonly id: string;
    readonly position: RenderVector3Like;
    readonly direction: RenderVector3Like;
    readonly color: RenderVector3Like;
    readonly intensity: number;
    readonly range: number;
    readonly innerConeRadians: number;
    readonly outerConeRadians: number;
    readonly castsShadows?: boolean;
    readonly shadowResolution?: number;
}

export type RenderLight = RenderDirectionalLight | RenderPointLight | RenderSpotLight;

export interface RenderSkyboxState {
    readonly textureId?: string;
    readonly intensity?: number;
    readonly lod?: number;
    readonly rotationRadians?: number;
    readonly tint?: RenderVector3Like;
}

export interface RenderImageBasedLightingState {
    readonly enabled?: boolean;
    readonly irradianceTextureId?: string;
    readonly specularTextureId?: string;
    readonly brdfLutTextureId?: string;
    readonly diffuseIntensity?: number;
    readonly specularIntensity?: number;
    readonly maxReflectionLod?: number;
}

export type RenderReflectionProbeMode = 'baked' | 'realtime' | 'mixed';
export type RenderReflectionProbeShape = 'sphere' | 'box';

export interface RenderReflectionProbe {
    readonly id: string;
    readonly mode?: RenderReflectionProbeMode;
    readonly shape?: RenderReflectionProbeShape;
    readonly position: RenderVector3Like;
    readonly radius?: number;
    readonly extents?: RenderVector3Like;
    readonly priority?: number;
    readonly intensity?: number;
    readonly boxProjection?: boolean;
    readonly blendDistance?: number;
    readonly dirty?: boolean;
    readonly updateInterval?: number;
    readonly lastUpdatedFrame?: number;
    readonly environmentTextureId?: string;
}

export interface RenderManualExposureSettings {
    readonly mode: 'manual';
    readonly exposure: number;
}

export interface RenderAutomaticExposureSettings {
    readonly mode: 'automatic';
    readonly keyValue?: number;
    readonly minExposure?: number;
    readonly maxExposure?: number;
    readonly adaptationRate?: number;
}

export type RenderExposureSettings =
    | RenderManualExposureSettings
    | RenderAutomaticExposureSettings;

export interface RenderHdrSettings {
    readonly enabled: boolean;
    readonly colorFormat?: Extract<
        RenderTextureFormat,
        'r11g11b10f' | 'rgba16f' | 'rgba32f'
    >;
    readonly whitePoint?: number;
    readonly outputColorSpace?: RenderOutputColorSpace;
    readonly exposure?: RenderExposureSettings;
}

export interface RenderTonemappingSettings {
    readonly mode: RenderTonemappingMode;
    readonly gamma?: number;
    readonly contrast?: number;
    readonly saturation?: number;
    readonly shoulderStrength?: number;
    readonly toeStrength?: number;
}

export interface RenderShadowSettings {
    readonly enabled: boolean;
    readonly atlasSize?: number;
    readonly cascadeCount?: 1 | 2 | 4;
    readonly cascadeSplitLambda?: number;
    readonly maxShadowedLights?: number;
    readonly maxDistance?: number;
    readonly depthBias?: number;
    readonly normalBias?: number;
    readonly filter?: RenderShadowFilter;
}

export interface RenderVolumetricSettings {
    readonly enabled: boolean;
    readonly froxelResolution?: readonly [number, number, number];
    readonly temporalReprojection?: boolean;
    readonly historyWeight?: number;
    readonly fogDensity?: number;
    readonly heightFogFalloff?: number;
    readonly anisotropy?: number;
    readonly ambientContribution?: number;
    readonly localLightBudget?: number;
}

export interface RenderBakedGiSettings {
    readonly mode: 'baked';
    readonly intensity?: number;
    readonly directionality?: boolean;
    readonly lightmapTextureIds?: readonly string[];
}

export interface RenderSsgiSettings {
    readonly mode: 'ssgi';
    readonly radius?: number;
    readonly sampleCount?: number;
    readonly historyWeight?: number;
    readonly denoise?: boolean;
}

export interface RenderDdgiSettings {
    readonly mode: 'ddgi';
    readonly probeCount?: readonly [number, number, number];
    readonly probeSpacing?: RenderVector3Like;
    readonly hysteresis?: number;
    readonly raysPerProbe?: number;
    readonly irradianceTextureId?: string;
    readonly distanceTextureId?: string;
}

export interface RenderHybridGiSettings {
    readonly mode: 'hybrid';
    readonly indirectIntensity?: number;
    readonly baked?: RenderBakedGiSettings;
    readonly realtime?: RenderSsgiSettings | RenderDdgiSettings;
}

export interface RenderDisabledGiSettings {
    readonly mode: 'disabled';
}

export type RenderGlobalIlluminationSettings =
    | RenderDisabledGiSettings
    | RenderBakedGiSettings
    | RenderSsgiSettings
    | RenderDdgiSettings
    | RenderHybridGiSettings;

export interface RenderLightBakingSettings {
    readonly enabled: boolean;
    readonly maxTasksPerFrame?: number;
    readonly budgetMs?: number;
    readonly maxRetries?: number;
    readonly throttleFrames?: number;
}

export interface RenderLightBakeTask<TPayload = unknown> {
    readonly id: string;
    readonly type: 'lightmap' | 'probe' | 'irradiance-cache';
    readonly priority?: number;
    readonly payload?: TPayload;
    readonly state?: RenderBakeTaskState;
    readonly retries?: number;
    readonly maxRetries?: number;
    readonly createdAt?: number;
    readonly scheduledAt?: number;
    readonly lastError?: string | null;
}

export interface BloomSettings {
    readonly threshold?: number;
    readonly knee?: number;
    readonly intensity?: number;
    readonly radius?: number;
}

export interface ColorGradingSettings {
    readonly temperature?: number;
    readonly tint?: number;
    readonly contrast?: number;
    readonly saturation?: number;
    readonly lift?: readonly [number, number, number];
    readonly gamma?: readonly [number, number, number];
    readonly gain?: readonly [number, number, number];
}

export interface ChromaticAberrationSettings {
    readonly intensity?: number;
}

export interface DepthOfFieldSettings {
    readonly focusDistance?: number;
    readonly aperture?: number;
    readonly focalLength?: number;
    readonly maxCoC?: number;
}

export interface FilmGrainSettings {
    readonly intensity?: number;
    readonly response?: number;
}

export interface FxaaSettings {
    readonly subpixel?: number;
    readonly edgeThreshold?: number;
    readonly edgeThresholdMin?: number;
}

export interface SsaoSettings {
    readonly radius?: number;
    readonly intensity?: number;
    readonly bias?: number;
    readonly sampleCount?: number;
}

export interface TaaSettings {
    readonly blendFactor?: number;
    readonly sharpen?: number;
    readonly jitterScale?: number;
}

export interface VignetteSettings {
    readonly intensity?: number;
    readonly smoothness?: number;
    readonly roundness?: number;
    readonly color?: readonly [number, number, number];
}

export interface BuiltinPostProcessSettingsMap {
    readonly bloom: BloomSettings;
    readonly 'color-grading': ColorGradingSettings;
    readonly 'chromatic-aberration': ChromaticAberrationSettings;
    readonly 'depth-of-field': DepthOfFieldSettings;
    readonly 'film-grain': FilmGrainSettings;
    readonly fxaa: FxaaSettings;
    readonly ssao: SsaoSettings;
    readonly taa: TaaSettings;
    readonly vignette: VignetteSettings;
}

export interface BuiltinPostProcessEffect<K extends BuiltinPostProcessEffectName> {
    readonly category: 'builtin';
    readonly name: K;
    readonly enabled?: boolean;
    readonly phase?: RenderPostProcessPhase;
    readonly quality?: RenderPostProcessQuality;
    readonly order?: number;
    readonly settings?: Partial<BuiltinPostProcessSettingsMap[K]>;
}

export interface CustomPostProcessEffect<
    TName extends string = string,
    TSettings extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly category: 'custom';
    readonly name: TName;
    readonly enabled?: boolean;
    readonly phase?: RenderPostProcessPhase;
    readonly quality?: RenderPostProcessQuality;
    readonly order?: number;
    readonly settings: Readonly<TSettings>;
}

export type AnyPostProcessEffect =
    | {
          readonly [K in BuiltinPostProcessEffectName]: BuiltinPostProcessEffect<K>;
      }[BuiltinPostProcessEffectName]
    | CustomPostProcessEffect;

export interface ResolvedBuiltinPostProcessEffect<K extends BuiltinPostProcessEffectName> {
    readonly category: 'builtin';
    readonly name: K;
    readonly phase: RenderPostProcessPhase;
    readonly quality: RenderPostProcessQuality;
    readonly order: number;
    readonly settings: Readonly<BuiltinPostProcessSettingsMap[K]>;
}

export interface ResolvedCustomPostProcessEffect<
    TName extends string = string,
    TSettings extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly category: 'custom';
    readonly name: TName;
    readonly phase: RenderPostProcessPhase;
    readonly quality: RenderPostProcessQuality;
    readonly order: number;
    readonly settings: Readonly<TSettings>;
}

export type ResolvedPostProcessEffect =
    | {
          readonly [K in BuiltinPostProcessEffectName]: ResolvedBuiltinPostProcessEffect<K>;
      }[BuiltinPostProcessEffectName]
    | ResolvedCustomPostProcessEffect;

export interface RenderEnvironmentState {
    readonly skybox?: RenderSkyboxState | null;
    readonly ibl?: RenderImageBasedLightingState | null;
    readonly reflectionProbes?: readonly RenderReflectionProbe[];
    readonly gi?: RenderGlobalIlluminationSettings;
    readonly volumetrics?: RenderVolumetricSettings;
    readonly lightBaking?: RenderLightBakingSettings;
}

export interface RenderFrameInput {
    readonly frame?: number;
    readonly deltaTime?: number;
    readonly camera: RenderCameraState;
    readonly primitives: readonly RenderPrimitiveInstance[];
    readonly lights?: readonly RenderLight[];
    readonly environment?: RenderEnvironmentState;
    readonly viewport: RenderViewport;
    readonly tags?: Readonly<Record<string, string | number | boolean>>;
}

export type RenderPassQueue =
    | 'prepass'
    | 'shadow'
    | 'geometry'
    | 'environment'
    | 'lighting'
    | 'transparency'
    | 'post-process'
    | 'present'
    | 'async';

export type RenderPassKind =
    | 'depth-prepass'
    | 'shadow'
    | 'opaque'
    | 'reflection-probe'
    | 'global-illumination'
    | 'volumetric'
    | 'skybox'
    | 'transparent'
    | 'post-process'
    | 'tonemap'
    | 'present'
    | 'light-bake';

export interface RenderDepthPassMetadata {
    readonly depth: RenderResourceName<'frame'>;
}

export interface RenderShadowPassMetadata {
    readonly atlas: RenderResourceName<'shadow'>;
    readonly cascadeCount: 1 | 2 | 4;
    readonly filter: RenderShadowFilter;
    readonly maxDistance: number;
}

export interface RenderOpaquePassMetadata {
    readonly color: RenderResourceName<'frame' | 'post'>;
    readonly depth: RenderResourceName<'frame'>;
    readonly hdr: boolean;
    readonly giMode: RenderGlobalIlluminationMode;
    readonly ibl: boolean;
}

export interface RenderReflectionProbePassMetadata {
    readonly target: RenderResourceName<'probe'>;
    readonly updateCount: number;
}

export interface RenderGlobalIlluminationPassMetadata {
    readonly mode: Exclude<RenderGlobalIlluminationMode, 'disabled'>;
    readonly target: RenderResourceName<'gi'>;
    readonly history: RenderResourceName<'history'> | null;
}

export interface RenderVolumetricPassMetadata {
    readonly froxelGrid: RenderResourceName<'volumetric'>;
    readonly history: RenderResourceName<'history'> | null;
}

export interface RenderSkyboxPassMetadata {
    readonly color: RenderResourceName<'frame' | 'post'>;
    readonly depth: RenderResourceName<'frame'> | null;
    readonly useIbl: boolean;
}

export interface RenderTransparentPassMetadata {
    readonly color: RenderResourceName<'frame' | 'post'>;
    readonly depth: RenderResourceName<'frame'>;
    readonly hdr: boolean;
}

export interface RenderPostProcessPassMetadata {
    readonly source: RenderResourceName;
    readonly target: RenderResourceName<'post' | 'frame'>;
    readonly phase: RenderPostProcessPhase;
    readonly effect: ResolvedPostProcessEffect;
}

export interface RenderTonemapPassMetadata {
    readonly source: RenderResourceName;
    readonly target: RenderResourceName<'post' | 'frame'>;
    readonly mode: RenderTonemappingMode;
}

export interface RenderPresentPassMetadata {
    readonly source: RenderResourceName;
    readonly destination: RenderResourceName<'swap'>;
    readonly colorSpace: RenderOutputColorSpace;
}

export interface RenderLightBakePassMetadata {
    readonly taskIds: readonly string[];
}

export type RenderPassMetadata =
    | RenderDepthPassMetadata
    | RenderShadowPassMetadata
    | RenderOpaquePassMetadata
    | RenderReflectionProbePassMetadata
    | RenderGlobalIlluminationPassMetadata
    | RenderVolumetricPassMetadata
    | RenderSkyboxPassMetadata
    | RenderTransparentPassMetadata
    | RenderPostProcessPassMetadata
    | RenderTonemapPassMetadata
    | RenderPresentPassMetadata
    | RenderLightBakePassMetadata;

export interface ResolvedRenderPassBase<
    K extends RenderPassKind = RenderPassKind,
    TMetadata extends RenderPassMetadata = RenderPassMetadata,
> {
    readonly kind: K;
    readonly name: RenderPassName;
    readonly order: number;
    readonly queue: RenderPassQueue;
    readonly enabled: boolean;
    readonly estimatedCost: number;
    readonly target: RenderResourceName | null;
    readonly inputs: readonly RenderResourceName[];
    readonly items?: ReadonlyRenderList<RenderPrimitiveInstance>;
    readonly lights?: ReadonlyRenderList<RenderLight>;
    readonly probes?: ReadonlyRenderList<RenderReflectionProbe>;
    readonly clearState?: RenderClearState | null;
    readonly metadata: Readonly<TMetadata>;
}

export type ResolvedRenderPass =
    | ResolvedRenderPassBase<'depth-prepass', RenderDepthPassMetadata>
    | ResolvedRenderPassBase<'shadow', RenderShadowPassMetadata>
    | ResolvedRenderPassBase<'opaque', RenderOpaquePassMetadata>
    | ResolvedRenderPassBase<'reflection-probe', RenderReflectionProbePassMetadata>
    | ResolvedRenderPassBase<'global-illumination', RenderGlobalIlluminationPassMetadata>
    | ResolvedRenderPassBase<'volumetric', RenderVolumetricPassMetadata>
    | ResolvedRenderPassBase<'skybox', RenderSkyboxPassMetadata>
    | ResolvedRenderPassBase<'transparent', RenderTransparentPassMetadata>
    | ResolvedRenderPassBase<'post-process', RenderPostProcessPassMetadata>
    | ResolvedRenderPassBase<'tonemap', RenderTonemapPassMetadata>
    | ResolvedRenderPassBase<'present', RenderPresentPassMetadata>
    | ResolvedRenderPassBase<'light-bake', RenderLightBakePassMetadata>;

export interface RenderPassSummary<
    K extends RenderPassKind = RenderPassKind,
    TMetadata extends RenderPassMetadata = RenderPassMetadata,
> {
    readonly kind: K;
    readonly name: RenderPassName;
    readonly order: number;
    readonly queue: RenderPassQueue;
    readonly target: RenderResourceName | null;
    readonly inputs: readonly RenderResourceName[];
    readonly estimatedCost: number;
    readonly itemCount: number;
    readonly lightCount: number;
    readonly probeCount: number;
    readonly metadata: Readonly<TMetadata>;
}

export interface RenderFrameStatistics {
    readonly frame: number;
    readonly deltaTime: number;
    readonly passCount: number;
    readonly opaqueCount: number;
    readonly transparentCount: number;
    readonly shadowCasterCount: number;
    readonly lightCount: number;
    readonly activeLocalLightCount: number;
    readonly activeReflectionProbeCount: number;
    readonly bakeTaskCount: number;
    readonly transientResourceCount: number;
    readonly persistentResourceCount: number;
    readonly resourceReuseCount: number;
    readonly estimatedCost: number;
}

export interface RenderFrameResult<TNative = unknown> {
    readonly frame: number;
    readonly viewport: Readonly<RenderViewport>;
    readonly passes: readonly RenderPassSummary[];
    readonly resources: readonly RenderTextureResourceSnapshot<TNative>[];
    readonly statistics: RenderFrameStatistics;
    readonly degraded: boolean;
    readonly warnings: readonly string[];
}

export interface RenderExecutionContext<TNative = unknown> {
    readonly frame: number;
    readonly viewport: Readonly<RenderViewport>;
    readonly camera: RenderCameraState;
    readonly graph: ReadonlyRenderResourceRegistry<TNative>;
    readonly statistics: RenderFrameStatistics;
}

export interface RenderPipelineBackend<TNative = unknown> {
    beginFrame?(context: RenderExecutionContext<TNative>): void | Promise<void>;
    executePass?(
        pass: ResolvedRenderPass,
        context: RenderExecutionContext<TNative>
    ): void | Promise<void>;
    endFrame?(
        result: RenderFrameResult<TNative>,
        context: RenderExecutionContext<TNative>
    ): void | Promise<void>;
}

export interface RenderPipelineOptions<TNative = unknown> {
    readonly name?: string;
    readonly locale?: string;
    readonly hdr?: boolean | Partial<RenderHdrSettings>;
    readonly tonemapping?: Partial<RenderTonemappingSettings>;
    readonly shadows?: boolean | Partial<RenderShadowSettings>;
    readonly gi?: RenderGlobalIlluminationSettings;
    readonly volumetrics?: boolean | Partial<RenderVolumetricSettings>;
    readonly lightBaking?: boolean | Partial<RenderLightBakingSettings>;
    readonly postProcess?: readonly AnyPostProcessEffect[];
    readonly frameBudgetMs?: number;
    readonly degradeStrategy?: RenderDegradeStrategy;
    readonly maxActiveReflectionProbes?: number;
    readonly maxActiveLocalLights?: number;
    readonly maxTransparentPrimitives?: number;
    readonly maxPostProcessPasses?: number;
    readonly enableDepthPrepass?: boolean | 'auto';
    readonly resourcePoolCapacity?: number;
    readonly backend?: RenderPipelineBackend<TNative>;
    readonly resourceAllocator?: RenderResourceAllocator<TNative>;
}

export type BuiltinEffectSettings<TName extends BuiltinPostProcessEffectName> =
    BuiltinPostProcessSettingsMap[TName];

export const createRenderResourceName = <TNamespace extends string>(
    namespace: TNamespace,
    name: string
): RenderResourceName<TNamespace> => `${namespace}:${name}` as RenderResourceName<TNamespace>;

export const createRenderPassName = <TName extends string>(name: TName): RenderPassName<TName> =>
    name as RenderPassName<TName>;
