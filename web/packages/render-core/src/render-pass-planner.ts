import { RenderTextureRegistry } from './graph';
import { MutableObjectArena, ReusableList } from './memory';
import { getRenderPostEffectCost } from './render-frame-budget-manager';
import { sumRenderBakeTaskCost, type ScheduledRenderBakeTask } from './render-bake-task-scheduler';
import {
    createRenderPassName,
    createRenderResourceName,
    type ReadonlyRenderList,
    type RenderCameraState,
    type RenderClearState,
    type RenderEnvironmentState,
    type RenderGlobalIlluminationMode,
    type RenderGlobalIlluminationSettings,
    type RenderHdrSettings,
    type RenderLight,
    type RenderOutputColorSpace,
    type RenderPassKind,
    type RenderPassMetadata,
    type RenderPassName,
    type RenderPassQueue,
    type RenderPrimitiveInstance,
    type RenderReflectionProbe,
    type RenderResourceLifetime,
    type RenderResourceName,
    type ResolvedPostProcessEffect,
    type ResolvedRenderPass,
    type RenderShadowFilter,
    type RenderTextureDescriptor,
    type RenderTextureFormat,
    type RenderTonemappingMode,
    type RenderViewport,
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

interface RenderPassPlannerShadowSettings {
    readonly atlasSize: number;
    readonly cascadeCount: 1 | 2 | 4;
    readonly cascadeSplitLambda: number;
    readonly maxDistance: number;
    readonly filter: RenderShadowFilter;
}

interface RenderPassPlannerTonemappingSettings {
    readonly mode: RenderTonemappingMode;
}

interface RenderPassPlannerLightBakingSettings {
    readonly budgetMs: number;
}

interface RenderPassPlannerSettings {
    readonly shadows: RenderPassPlannerShadowSettings;
    readonly tonemapping: RenderPassPlannerTonemappingSettings;
    readonly lightBaking: RenderPassPlannerLightBakingSettings;
    readonly enableDepthPrepass: boolean | 'auto';
}

interface RenderPassPlannerHdrSettings {
    readonly enabled: boolean;
    readonly colorFormat: Extract<RenderTextureFormat, 'r11g11b10f' | 'rgba16f' | 'rgba32f'>;
    readonly outputColorSpace: RenderOutputColorSpace;
    readonly exposure: RenderHdrSettings['exposure'];
}

interface RenderPassPlannerVolumetricSettings {
    readonly enabled: boolean;
    readonly froxelResolution: readonly [number, number, number];
    readonly temporalReprojection: boolean;
}

interface RenderPassPlanningInput {
    readonly frame: number;
    readonly viewport: RenderViewport;
    readonly camera: RenderCameraState;
    readonly environment: RenderEnvironmentState | undefined;
    readonly hdr: RenderPassPlannerHdrSettings;
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetrics: RenderPassPlannerVolumetricSettings;
    readonly shadowEnabled: boolean;
    readonly probeUpdateCount: number;
    readonly postEffects: readonly ResolvedPostProcessEffect[];
    readonly bakeTasks: readonly ScheduledRenderBakeTask[];
    readonly opaque: ReadonlyRenderList<RenderPrimitiveInstance>;
    readonly transparent: ReadonlyRenderList<RenderPrimitiveInstance>;
    readonly shadowCasters: ReadonlyRenderList<RenderPrimitiveInstance>;
    readonly activeLights: ReadonlyRenderList<RenderLight>;
    readonly shadowLights: ReadonlyRenderList<RenderLight>;
    readonly activeProbes: ReadonlyRenderList<RenderReflectionProbe>;
    readonly probeUpdates: ReadonlyRenderList<RenderReflectionProbe>;
}

const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

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

const giModeOf = (settings: RenderGlobalIlluminationSettings): RenderGlobalIlluminationMode =>
    settings.mode;

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

export class RenderPassPlanner<TNative = unknown> {
    private readonly _passArena = new MutableObjectArena<MutablePassRecord>(mutablePassFactory);
    private readonly _probeViewScratch = new ReusableList<RenderReflectionProbe>(4);
    private readonly _effectsBefore = new ReusableList<ResolvedPostProcessEffect>(4);
    private readonly _effectsAfter = new ReusableList<ResolvedPostProcessEffect>(4);

    constructor(
        private readonly _graph: RenderTextureRegistry<TNative>,
        private readonly _settings: RenderPassPlannerSettings
    ) {}

    clear(): void {
        this._probeViewScratch.clear();
        this._effectsBefore.clear();
        this._effectsAfter.clear();
        this._passArena.reset();
    }

    plan(input: RenderPassPlanningInput): readonly ResolvedRenderPass[] {
        this._passArena.reset();
        this._probeViewScratch.reset();
        this._effectsBefore.reset();
        this._effectsAfter.reset();
        this._partitionPostEffects(input.postEffects);

        let order = 0;
        const width = Math.max(1, Math.floor(input.viewport.width * (input.viewport.pixelRatio ?? 1)));
        const height = Math.max(1, Math.floor(input.viewport.height * (input.viewport.pixelRatio ?? 1)));

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
                format: input.hdr.enabled ? input.hdr.colorFormat : 'rgba8',
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
            input.hdr.enabled && input.hdr.exposure?.mode === 'automatic'
                ? (this._acquireTexture(
                      createRenderResourceName('history', 'exposure'),
                      exposureHistoryDescriptor(),
                      'history'
                  ).id as RenderResourceName<'history'>)
                : null;

        const useDepthPrepass =
            this._settings.enableDepthPrepass === true ||
            (this._settings.enableDepthPrepass === 'auto' &&
                (input.opaque.length > 48 ||
                    input.shadowLights.length > 0 ||
                    this._containsAlphaClippedOpaque(input.opaque)));

        if (useDepthPrepass && input.opaque.length > 0) {
            order = this._pushPass(order, {
                kind: 'depth-prepass',
                name: createRenderPassName('depth-prepass'),
                queue: 'prepass',
                target: sceneDepth,
                inputs: [sceneDepth],
                items: input.opaque,
                clearState: input.camera.clearState ?? { depth: 1 },
                estimatedCost: input.opaque.length * 0.0015,
                metadata: {
                    depth: sceneDepth,
                },
            });
        }

        if (input.shadowEnabled) {
            const cascades = computeCascadeSplits(
                input.camera.near,
                input.camera.far,
                this._settings.shadows.cascadeCount,
                this._settings.shadows.cascadeSplitLambda,
                this._settings.shadows.maxDistance
            );
            const shadowAtlas = this._acquireTexture(
                createRenderResourceName('shadow', 'atlas'),
                {
                    width: this._settings.shadows.atlasSize,
                    height: this._settings.shadows.atlasSize,
                    format: 'depth32f',
                    usage: ['shadow', 'depth-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'shadow'>;
            const lightIds = new Array<string>(input.shadowLights.length);
            for (let i = 0; i < input.shadowLights.length; i++) {
                lightIds[i] = input.shadowLights.at(i).id;
            }

            order = this._pushPass(order, {
                kind: 'shadow',
                name: createRenderPassName('shadow'),
                queue: 'shadow',
                target: shadowAtlas,
                inputs: [shadowAtlas],
                items: input.shadowCasters,
                lights: input.shadowLights,
                estimatedCost:
                    input.shadowLights.length * 0.24 + input.shadowCasters.length * 0.0015,
                metadata: {
                    atlas: shadowAtlas,
                    cascadeCount: this._settings.shadows.cascadeCount,
                    filter: this._settings.shadows.filter,
                    maxDistance: this._settings.shadows.maxDistance,
                    cascades,
                    lightIds: Object.freeze(lightIds),
                },
            });
        }

        if (input.probeUpdateCount > 0) {
            const probeTarget = this._acquireTexture(
                createRenderResourceName('probe', 'update-target'),
                {
                    width: 1024,
                    height: 1024,
                    format: input.hdr.colorFormat,
                    usage: ['color-attachment', 'sampled'],
                    cube: true,
                },
                'transient'
            ).id as RenderResourceName<'probe'>;

            order = this._pushPass(order, {
                kind: 'reflection-probe',
                name: createRenderPassName('reflection-probe'),
                queue: 'environment',
                target: probeTarget,
                inputs: [probeTarget],
                probes: this._limitedProbeView(input.probeUpdateCount, input.probeUpdates),
                estimatedCost: input.probeUpdateCount * 0.32,
                metadata: {
                    target: probeTarget,
                    updateCount: input.probeUpdateCount,
                },
            });
        }

        if (input.gi.mode !== 'disabled') {
            const giTarget = this._acquireTexture(
                createRenderResourceName('gi', 'indirect'),
                {
                    width,
                    height,
                    format: input.hdr.colorFormat,
                    usage: ['color-attachment', 'sampled', 'history'],
                },
                input.gi.mode === 'baked' ? 'persistent' : 'transient'
            ).id as RenderResourceName<'gi'>;

            const giHistory =
                input.gi.mode === 'ssgi' || input.gi.mode === 'hybrid'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', 'gi'),
                          {
                              width,
                              height,
                              format: input.hdr.colorFormat,
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
                    input.gi.mode === 'ddgi' ? 0.4 : input.gi.mode === 'hybrid' ? 0.6 : 0.55,
                metadata: {
                    mode: input.gi.mode,
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
            items: input.opaque,
            lights: input.activeLights,
            probes: input.activeProbes,
            clearState: input.camera.clearState ?? {
                color: [0, 0, 0, 1],
                depth: 1,
            },
            estimatedCost:
                0.15 + input.opaque.length * 0.003 + input.activeLights.length * 0.04 + input.activeProbes.length * 0.02,
            metadata: {
                color: sceneColor,
                depth: sceneDepth,
                hdr: input.hdr.enabled,
                giMode: giModeOf(input.gi),
                ibl: input.activeProbes.length > 0,
            },
        });

        const hasSkyLighting =
            !!input.environment?.skybox ||
            !!input.environment?.ibl?.enabled ||
            input.activeProbes.length > 0;

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
                    useIbl: input.activeProbes.length > 0,
                },
            });
        }

        if (input.volumetrics.enabled) {
            const froxel = this._acquireTexture(
                createRenderResourceName('volumetric', 'froxel'),
                {
                    width: input.volumetrics.froxelResolution[0],
                    height: input.volumetrics.froxelResolution[1],
                    depth: input.volumetrics.froxelResolution[2],
                    format: 'rgba16f',
                    usage: ['storage', 'sampled', 'history'],
                },
                'transient'
            ).id as RenderResourceName<'volumetric'>;

            const history = input.volumetrics.temporalReprojection
                ? (this._acquireTexture(
                      createRenderResourceName('history', 'volumetric'),
                      {
                          width: input.volumetrics.froxelResolution[0],
                          height: input.volumetrics.froxelResolution[1],
                          depth: input.volumetrics.froxelResolution[2],
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
                lights: input.activeLights,
                estimatedCost: 0.6,
                metadata: {
                    froxelGrid: froxel,
                    history,
                },
            });
        }

        if (input.transparent.length > 0) {
            order = this._pushPass(order, {
                kind: 'transparent',
                name: createRenderPassName('transparent'),
                queue: 'transparency',
                target: currentColor,
                inputs: [currentColor, sceneDepth],
                items: input.transparent,
                lights: input.activeLights,
                probes: input.activeProbes,
                estimatedCost: input.transparent.length * 0.004 + input.activeLights.length * 0.03,
                metadata: {
                    color: currentColor as RenderResourceName<'frame' | 'post'>,
                    depth: sceneDepth,
                    hdr: input.hdr.enabled,
                },
            });
        }

        if (this._effectsBefore.length + this._effectsAfter.length > 0) {
            ping = this._acquireTexture(
                createRenderResourceName('post', 'ping'),
                {
                    width,
                    height,
                    format: input.hdr.enabled ? input.hdr.colorFormat : 'rgba8',
                    usage: ['color-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'post'>;
            pong = this._acquireTexture(
                createRenderResourceName('post', 'pong'),
                {
                    width,
                    height,
                    format: input.hdr.enabled ? input.hdr.colorFormat : 'rgba8',
                    usage: ['color-attachment', 'sampled'],
                },
                'transient'
            ).id as RenderResourceName<'post'>;
        }

        for (let i = 0; i < this._effectsBefore.length; i++) {
            const effect = this._effectsBefore.at(i);
            const taaTargetHistory =
                effect.category === 'builtin' && effect.name === 'taa'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', input.frame % 2 === 0 ? 'taa-b' : 'taa-a'),
                          {
                              width,
                              height,
                              format: input.hdr.enabled ? input.hdr.colorFormat : 'rgba8',
                              usage: ['color-attachment', 'sampled', 'history'],
                          },
                          'history'
                      ).id as RenderResourceName<'history'>)
                    : null;
            const taaSourceHistory =
                effect.category === 'builtin' && effect.name === 'taa'
                    ? (this._acquireTexture(
                          createRenderResourceName('history', input.frame % 2 === 0 ? 'taa-a' : 'taa-b'),
                          {
                              width,
                              height,
                              format: input.hdr.enabled ? input.hdr.colorFormat : 'rgba8',
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
            const inputs = taaSourceHistory ? [currentColor, taaSourceHistory] : [currentColor];
            order = this._pushPass(order, {
                kind: 'post-process',
                name: createRenderPassName(`post-process:${effect.name}`),
                queue: 'post-process',
                target,
                inputs,
                estimatedCost: getRenderPostEffectCost(effect),
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
            input.hdr.enabled || this._settings.tonemapping.mode !== 'none'
                ? ((this._effectsAfter.length > 0
                      ? this._effectsBefore.length % 2 === 0
                            ? (ping as RenderResourceName<'post'>)
                            : (pong as RenderResourceName<'post'>)
                      : sceneColor) as RenderResourceName<'post' | 'frame'>)
                : (currentColor as RenderResourceName<'post' | 'frame'>);

        if (input.hdr.enabled || this._settings.tonemapping.mode !== 'none') {
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
                    mode: this._settings.tonemapping.mode,
                    hdr: input.hdr.enabled,
                    colorSpace: input.hdr.outputColorSpace,
                    exposure: input.hdr.exposure ?? null,
                    exposureHistory,
                },
            });
            currentColor = tonemapTarget;
        }

        for (let i = 0; i < this._effectsAfter.length; i++) {
            const effect = this._effectsAfter.at(i);
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
                estimatedCost: getRenderPostEffectCost(effect),
                metadata: {
                    source: currentColor,
                    target,
                    phase: 'after-tonemap',
                    effect,
                },
            });
            currentColor = target;
        }

        if (input.bakeTasks.length > 0) {
            order = this._pushPass(order, {
                kind: 'light-bake',
                name: createRenderPassName('light-bake'),
                queue: 'async',
                target: null,
                inputs: [],
                estimatedCost: sumRenderBakeTaskCost(input.bakeTasks),
                metadata: {
                    taskIds: Object.freeze(input.bakeTasks.map((task) => task.id)),
                    budgetMs: input.environment?.lightBaking?.budgetMs ?? this._settings.lightBaking.budgetMs,
                },
            });
        }

        this._pushPass(order, {
            kind: 'present',
            name: createRenderPassName('present'),
            queue: 'present',
            target: backBuffer,
            inputs: [currentColor],
            estimatedCost: 0.05,
            metadata: {
                source: currentColor,
                destination: backBuffer,
                colorSpace: input.hdr.outputColorSpace,
            },
        });

        return this._passArena.values() as readonly ResolvedRenderPass[];
    }

    private _partitionPostEffects(effects: readonly ResolvedPostProcessEffect[]): void {
        for (let i = 0; i < effects.length; i++) {
            const effect = effects[i]!;
            if (effect.phase === 'before-tonemap') {
                this._effectsBefore.push(effect);
            } else {
                this._effectsAfter.push(effect);
            }
        }
    }

    private _containsAlphaClippedOpaque(opaque: ReadonlyRenderList<RenderPrimitiveInstance>): boolean {
        for (let i = 0; i < opaque.length; i++) {
            if (opaque.at(i).material.alphaClipped) {
                return true;
            }
        }
        return false;
    }

    private _limitedProbeView(
        limit: number,
        probes: ReadonlyRenderList<RenderReflectionProbe>
    ): ReadonlyRenderList<RenderReflectionProbe> {
        if (limit >= probes.length) {
            return probes;
        }

        this._probeViewScratch.reset();
        for (let i = 0; i < limit; i++) {
            this._probeViewScratch.push(probes.at(i));
        }
        return this._probeViewScratch;
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
}