import {
    BUILTIN_POST_PROCESS_EFFECTS,
    type AnyPostProcessEffect,
    type BuiltinPostProcessEffectName,
    type BuiltinPostProcessSettingsMap,
    type RenderPostProcessPhase,
    type RenderPostProcessQuality,
    type ResolvedPostProcessEffect,
} from './types';
import { RenderValidationError } from './errors';

type InternalEffect =
    | {
          readonly category: 'builtin';
          readonly name: BuiltinPostProcessEffectName;
          enabled: boolean;
          phase: RenderPostProcessPhase;
          quality: RenderPostProcessQuality;
          order: number;
          settings: BuiltinPostProcessSettingsMap[BuiltinPostProcessEffectName];
      }
    | {
          readonly category: 'custom';
          readonly name: string;
          enabled: boolean;
          phase: RenderPostProcessPhase;
          quality: RenderPostProcessQuality;
          order: number;
          settings: Record<string, unknown>;
      };

const BUILTIN_DEFAULT_PHASE: Readonly<Record<BuiltinPostProcessEffectName, RenderPostProcessPhase>> =
    Object.freeze({
        bloom: 'before-tonemap',
        'color-grading': 'after-tonemap',
        'chromatic-aberration': 'after-tonemap',
        'depth-of-field': 'before-tonemap',
        'film-grain': 'after-tonemap',
        fxaa: 'after-tonemap',
        ssao: 'before-tonemap',
        taa: 'before-tonemap',
        vignette: 'after-tonemap',
    });

const BUILTIN_DEFAULT_SETTINGS: Readonly<BuiltinPostProcessSettingsMap> = Object.freeze({
    bloom: Object.freeze({
        threshold: 1,
        knee: 0.5,
        intensity: 0.65,
        radius: 0.9,
    }),
    'color-grading': Object.freeze({
        temperature: 0,
        tint: 0,
        contrast: 1,
        saturation: 1,
        lift: [1, 1, 1] as const,
        gamma: [1, 1, 1] as const,
        gain: [1, 1, 1] as const,
    }),
    'chromatic-aberration': Object.freeze({
        intensity: 0.03,
    }),
    'depth-of-field': Object.freeze({
        focusDistance: 10,
        aperture: 5.6,
        focalLength: 50,
        maxCoC: 12,
    }),
    'film-grain': Object.freeze({
        intensity: 0.12,
        response: 0.85,
    }),
    fxaa: Object.freeze({
        subpixel: 0.75,
        edgeThreshold: 0.166,
        edgeThresholdMin: 0.0833,
    }),
    ssao: Object.freeze({
        radius: 0.35,
        intensity: 1,
        bias: 0.025,
        sampleCount: 16,
    }),
    taa: Object.freeze({
        blendFactor: 0.92,
        sharpen: 0.1,
        jitterScale: 1,
    }),
    vignette: Object.freeze({
        intensity: 0.2,
        smoothness: 0.55,
        roundness: 1,
        color: [0, 0, 0] as const,
    }),
});

const cloneSettings = <T extends object>(value: T): T => ({ ...value });

const isBuiltin = (name: string): name is BuiltinPostProcessEffectName =>
    (BUILTIN_POST_PROCESS_EFFECTS as readonly string[]).includes(name);

const compareEffects = (a: InternalEffect, b: InternalEffect): number => {
    if (a.phase !== b.phase) {
        return a.phase === 'before-tonemap' ? -1 : 1;
    }

    if (a.order !== b.order) {
        return a.order - b.order;
    }

    return a.name.localeCompare(b.name);
};

export class PostProcessStack {
    private readonly _effects = new Map<string, InternalEffect>();
    private _dirty = true;
    private _cacheLimit = -1;
    private _resolvedCache: readonly ResolvedPostProcessEffect[] = Object.freeze([]);

    constructor(effects: readonly AnyPostProcessEffect[] = []) {
        for (const effect of effects) {
            this.add(effect);
        }
    }

    get size(): number {
        return this._effects.size;
    }

    add(effect: AnyPostProcessEffect): this {
        if (effect.category === 'builtin') {
            return this.upsertBuiltin(effect.name, effect.settings, {
                enabled: effect.enabled,
                phase: effect.phase,
                quality: effect.quality,
                order: effect.order,
            });
        }

        return this.upsertCustom(effect.name, effect.settings, {
            enabled: effect.enabled,
            phase: effect.phase,
            quality: effect.quality,
            order: effect.order,
        });
    }

    upsertBuiltin<K extends BuiltinPostProcessEffectName>(
        name: K,
        settings?: Partial<BuiltinPostProcessSettingsMap[K]>,
        options: {
            readonly enabled?: boolean;
            readonly phase?: RenderPostProcessPhase;
            readonly quality?: RenderPostProcessQuality;
            readonly order?: number;
        } = {}
    ): this {
        if (!isBuiltin(name)) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', { name });
        }

        const resolvedSettings = {
            ...BUILTIN_DEFAULT_SETTINGS[name],
            ...(settings ?? {}),
        } as BuiltinPostProcessSettingsMap[K];

        const effect: InternalEffect = {
            category: 'builtin',
            name,
            enabled: options.enabled ?? true,
            phase: options.phase ?? BUILTIN_DEFAULT_PHASE[name],
            quality: options.quality ?? 'high',
            order: options.order ?? this._effects.size,
            settings: resolvedSettings as BuiltinPostProcessSettingsMap[BuiltinPostProcessEffectName],
        };

        this._effects.set(name, effect);
        this._dirty = true;
        return this;
    }

    upsertCustom<TName extends string, TSettings extends Record<string, unknown>>(
        name: TName,
        settings: Readonly<TSettings>,
        options: {
            readonly enabled?: boolean;
            readonly phase?: RenderPostProcessPhase;
            readonly quality?: RenderPostProcessQuality;
            readonly order?: number;
        } = {}
    ): this {
        if (!name || name.trim().length === 0) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', { name });
        }

        const effect: InternalEffect = {
            category: 'custom',
            name,
            enabled: options.enabled ?? true,
            phase: options.phase ?? 'after-tonemap',
            quality: options.quality ?? 'high',
            order: options.order ?? this._effects.size,
            settings: cloneSettings(settings),
        };

        this._effects.set(name, effect);
        this._dirty = true;
        return this;
    }

    enable(name: string): this {
        const effect = this._effects.get(name);
        if (effect) {
            effect.enabled = true;
            this._dirty = true;
        }
        return this;
    }

    disable(name: string): this {
        const effect = this._effects.get(name);
        if (effect) {
            effect.enabled = false;
            this._dirty = true;
        }
        return this;
    }

    move(name: string, order: number): this {
        const effect = this._effects.get(name);
        if (effect) {
            effect.order = order;
            this._dirty = true;
        }
        return this;
    }

    remove(name: string): boolean {
        const removed = this._effects.delete(name);
        if (removed) {
            this._dirty = true;
        }
        return removed;
    }

    clear(): void {
        if (this._effects.size === 0) {
            return;
        }

        this._effects.clear();
        this._dirty = true;
    }

    hasPhase(phase: RenderPostProcessPhase): boolean {
        for (const effect of this._effects.values()) {
            if (effect.enabled && effect.phase === phase) {
                return true;
            }
        }

        return false;
    }

    resolve(maxPasses: number = Number.POSITIVE_INFINITY): readonly ResolvedPostProcessEffect[] {
        if (!this._dirty && this._cacheLimit === maxPasses) {
            return this._resolvedCache;
        }

        const resolved: ResolvedPostProcessEffect[] = [];
        const values = Array.from(this._effects.values()).sort(compareEffects);
        for (const effect of values) {
            if (!effect.enabled) {
                continue;
            }

            if (resolved.length >= maxPasses) {
                break;
            }

            if (effect.category === 'builtin') {
                resolved.push({
                    category: 'builtin',
                    name: effect.name,
                    phase: effect.phase,
                    quality: effect.quality,
                    order: effect.order,
                    settings: Object.freeze({
                        ...BUILTIN_DEFAULT_SETTINGS[effect.name],
                        ...effect.settings,
                    }),
                } as ResolvedPostProcessEffect);
            } else {
                resolved.push({
                    category: 'custom',
                    name: effect.name,
                    phase: effect.phase,
                    quality: effect.quality,
                    order: effect.order,
                    settings: Object.freeze(cloneSettings(effect.settings)),
                });
            }
        }

        this._resolvedCache = Object.freeze(resolved);
        this._cacheLimit = maxPasses;
        this._dirty = false;
        return this._resolvedCache;
    }

    serialize(): readonly AnyPostProcessEffect[] {
        const effects: AnyPostProcessEffect[] = [];
        for (const effect of this._effects.values()) {
            if (effect.category === 'builtin') {
                effects.push({
                    category: 'builtin',
                    name: effect.name,
                    enabled: effect.enabled,
                    phase: effect.phase,
                    quality: effect.quality,
                    order: effect.order,
                    settings: cloneSettings(effect.settings),
                } as AnyPostProcessEffect);
            } else {
                effects.push({
                    category: 'custom',
                    name: effect.name,
                    enabled: effect.enabled,
                    phase: effect.phase,
                    quality: effect.quality,
                    order: effect.order,
                    settings: cloneSettings(effect.settings),
                } as AnyPostProcessEffect);
            }
        }

        return Object.freeze(effects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    }
}

export const createPostProcessStack = (
    effects: readonly AnyPostProcessEffect[] = []
): PostProcessStack => new PostProcessStack(effects);
