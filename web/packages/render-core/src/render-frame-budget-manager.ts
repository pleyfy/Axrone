import { ReusableList } from './memory';
import { sumRenderBakeTaskCost, type ScheduledRenderBakeTask } from './render-bake-task-scheduler';
import type {
    RenderDegradeStrategy,
    RenderGlobalIlluminationSettings,
    ResolvedPostProcessEffect,
} from './types';

const MAX_BUDGET_WARNINGS = 16;

export interface RenderFrameBudgetEstimateInput {
    readonly deltaTime: number;
    readonly opaqueCount: number;
    readonly transparentCount: number;
    readonly activeLightCount: number;
    readonly shadowLightCount: number;
    readonly shadowCasterCount: number;
    readonly postEffects: readonly ResolvedPostProcessEffect[];
    readonly probeUpdates: number;
    readonly bakeTasks: readonly ScheduledRenderBakeTask[];
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetricsEnabled: boolean;
    readonly shadowEnabled: boolean;
}

export interface RenderFrameBudgetCostTotals {
    readonly deltaTime: number;
    readonly opaqueCount: number;
    readonly transparentCount: number;
    readonly activeLightCount: number;
    readonly shadowLightCount: number;
    readonly shadowCasterCount: number;
    readonly postProcessCost: number;
    readonly probeUpdates: number;
    readonly bakeTaskCost: number;
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetricsEnabled: boolean;
    readonly shadowEnabled: boolean;
}

export interface RenderFrameBudgetSettings {
    readonly frameBudgetMs: number;
    readonly degradeStrategy: RenderDegradeStrategy;
}

export interface RenderFrameBudgetDegradeInput<TVolumetrics extends { readonly enabled: boolean }> {
    readonly estimatedCost: number;
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetrics: TVolumetrics;
    readonly shadowEnabled: boolean;
    readonly probeUpdates: number;
    readonly postEffects: readonly ResolvedPostProcessEffect[];
    readonly bakeTasks: readonly ScheduledRenderBakeTask[];
    readonly warnings: ReusableList<string>;
}

export interface RenderFrameBudgetDegradeResult<TVolumetrics extends { readonly enabled: boolean }> {
    readonly gi: RenderGlobalIlluminationSettings;
    readonly volumetrics: TVolumetrics;
    readonly shadowEnabled: boolean;
    readonly probeUpdates: number;
    readonly postEffects: readonly ResolvedPostProcessEffect[];
    readonly bakeTasks: readonly ScheduledRenderBakeTask[];
    readonly degraded: boolean;
}

export const getRenderPostEffectCost = (effect: ResolvedPostProcessEffect): number => {
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

export const sumRenderPostEffectCost = (
    effects: readonly ResolvedPostProcessEffect[]
): number => effects.reduce((sum, effect) => sum + getRenderPostEffectCost(effect), 0);

export const estimateRenderFrameCostTotals = (input: RenderFrameBudgetCostTotals): number => {
    let cost =
        0.5 +
        input.opaqueCount * 0.003 +
        input.transparentCount * 0.004 +
        input.activeLightCount * 0.06 +
        Math.min(input.deltaTime, 0.05) * 0.35;

    if (input.shadowEnabled) {
        cost += input.shadowLightCount * 0.24 + input.shadowCasterCount * 0.0015;
    }

    if (input.gi.mode === 'ssgi') {
        cost += 0.55;
    } else if (input.gi.mode === 'ddgi') {
        cost += 0.4;
    } else if (input.gi.mode === 'hybrid') {
        cost += 0.6;
    }

    if (input.volumetricsEnabled) {
        cost += 0.6;
    }

    cost += input.postProcessCost;
    cost += input.probeUpdates * 0.32;
    cost += input.bakeTaskCost;
    return cost;
};

export const estimateRenderFrameCost = (input: RenderFrameBudgetEstimateInput): number =>
    estimateRenderFrameCostTotals({
        deltaTime: input.deltaTime,
        opaqueCount: input.opaqueCount,
        transparentCount: input.transparentCount,
        activeLightCount: input.activeLightCount,
        shadowLightCount: input.shadowLightCount,
        shadowCasterCount: input.shadowCasterCount,
        postProcessCost: sumRenderPostEffectCost(input.postEffects),
        probeUpdates: input.probeUpdates,
        bakeTaskCost: sumRenderBakeTaskCost(input.bakeTasks),
        gi: input.gi,
        volumetricsEnabled: input.volumetricsEnabled,
        shadowEnabled: input.shadowEnabled,
    });

export const degradeRenderFrame = <TVolumetrics extends { readonly enabled: boolean }>(
    settings: RenderFrameBudgetSettings,
    input: RenderFrameBudgetDegradeInput<TVolumetrics>
): RenderFrameBudgetDegradeResult<TVolumetrics> => {
    if (settings.degradeStrategy === 'none') {
        return {
            gi: input.gi,
            volumetrics: input.volumetrics,
            shadowEnabled: input.shadowEnabled,
            probeUpdates: input.probeUpdates,
            postEffects: input.postEffects,
            bakeTasks: input.bakeTasks,
            degraded: false,
        };
    }

    let degraded = false;
    let nextGi = input.gi;
    let nextVolumetrics = input.volumetrics;
    let nextShadowEnabled = input.shadowEnabled;
    let nextProbeUpdates = input.probeUpdates;
    let nextPostEffects = input.postEffects;
    let nextBakeTasks = input.bakeTasks;
    let currentCost = input.estimatedCost;

    const mark = (warning: string, delta: number): void => {
        degraded = true;
        currentCost = Math.max(0, currentCost - delta);
        if (input.warnings.length < MAX_BUDGET_WARNINGS) {
            input.warnings.push(warning);
        }
    };

    if (currentCost > settings.frameBudgetMs && nextBakeTasks.length > 0) {
        mark(
            'light baking deferred due to frame budget pressure',
            sumRenderBakeTaskCost(nextBakeTasks)
        );
        nextBakeTasks = Object.freeze([]);
    }

    if (currentCost > settings.frameBudgetMs && nextProbeUpdates > 1) {
        const target = settings.degradeStrategy === 'aggressive' ? 0 : 1;
        mark('reflection probe updates throttled', (nextProbeUpdates - target) * 0.32);
        nextProbeUpdates = target;
    }

    if (currentCost > settings.frameBudgetMs && nextVolumetrics.enabled) {
        mark('volumetric effects disabled for frame budget stability', 0.6);
        nextVolumetrics = {
            ...nextVolumetrics,
            enabled: false,
        } as TVolumetrics;
    }

    if (
        currentCost > settings.frameBudgetMs &&
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
        currentCost > settings.frameBudgetMs &&
        nextShadowEnabled &&
        settings.degradeStrategy === 'aggressive'
    ) {
        mark('shadow pass skipped under aggressive degradation', 0.35);
        nextShadowEnabled = false;
    }

    if (currentCost > settings.frameBudgetMs && nextPostEffects.length > 0) {
        const keep =
            settings.degradeStrategy === 'aggressive'
                ? Math.min(2, nextPostEffects.length)
                : Math.min(4, nextPostEffects.length);
        if (keep < nextPostEffects.length) {
            mark(
                'post-process stack truncated to fit budget',
                sumRenderPostEffectCost(nextPostEffects.slice(keep))
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
};