import { assertNever } from './errors';
import { isFiniteNumber, spreadIfFinite } from './internal';
import { tuple2 } from '@axrone/utility';
import type { AnimationMotionMatchDatabase } from './motion-matching';
import type { AnimationBlendTreeDefinition, AnimationMotionDefinition } from './types';

export interface AnimationBlendGraphDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly path: string;
}

export interface AnimationBlendGraphValidationOptions {
    readonly knownClipIds?: readonly string[];
    readonly knownParameters?: readonly string[];
}

export interface AnimationMotionBuilder {
    build(): AnimationMotionDefinition;
}

type AnimationMotionInput = AnimationMotionDefinition | AnimationMotionBuilder;

// ─── Recursive deep-freeze with optional-field normalization ────────
// Single normalization point: builders produce raw data (undefined for
// optional fields), this function produces the final frozen shape —
// stripping non-finite optionals, freezing children recursively.

const freezeMotionDefinition = (motion: AnimationMotionDefinition): AnimationMotionDefinition => {
    switch (motion.kind) {
        case 'clip':
            return Object.freeze({
                kind: 'clip',
                clipId: motion.clipId,
                ...spreadIfFinite('timeScale', motion.timeScale),
                ...spreadIfFinite('cycleOffset', motion.cycleOffset),
            });
        case 'blend1d':
            return Object.freeze({
                kind: 'blend1d',
                parameter: motion.parameter,
                children: Object.freeze(
                    motion.children.map((child) =>
                        Object.freeze({
                            threshold: child.threshold,
                            motion: freezeMotionDefinition(child.motion),
                        })
                    )
                ),
            });
        case 'blend2d':
            return Object.freeze({
                kind: 'blend2d',
                parameterX: motion.parameterX,
                parameterY: motion.parameterY,
                mode: motion.mode,
                children: Object.freeze(
                    motion.children.map((child) =>
                        Object.freeze({
                            position: tuple2(child.position[0], child.position[1]),
                            motion: freezeMotionDefinition(child.motion),
                        })
                    )
                ),
            });
        case 'direct':
            return Object.freeze({
                kind: 'direct',
                children: Object.freeze(
                    motion.children.map((child) =>
                        Object.freeze({
                            motion: freezeMotionDefinition(child.motion),
                            ...spreadIfFinite('weight', child.weight),
                            ...(typeof child.parameter === 'string'
                                ? { parameter: child.parameter }
                                : {}),
                        })
                    )
                ),
            });
        case 'additive':
            return Object.freeze({
                kind: 'additive',
                base: freezeMotionDefinition(motion.base),
                additive: freezeMotionDefinition(motion.additive),
                ...spreadIfFinite('weight', motion.weight),
                ...(typeof motion.parameter === 'string' ? { parameter: motion.parameter } : {}),
            });
        case 'motionMatching':
            return Object.freeze({
                kind: 'motionMatching',
                database: motion.database,
                trajectoryXParameter: motion.trajectoryXParameter,
                trajectoryZParameter: motion.trajectoryZParameter,
                facingXParameter: motion.facingXParameter,
                facingZParameter: motion.facingZParameter,
                ...spreadIfFinite('reselectIntervalSeconds', motion.reselectIntervalSeconds),
                ...spreadIfFinite('continuityBias', motion.continuityBias),
            });
        default:
            return assertNever(motion, 'Unsupported motion kind');
    }
};

const toMotionDefinition = (motion: AnimationMotionInput): AnimationMotionDefinition =>
    isBuilder(motion)
        ? motion.build()
        : freezeMotionDefinition(motion);

const isBuilder = (motion: AnimationMotionInput): motion is AnimationMotionBuilder =>
    typeof (motion as AnimationMotionBuilder).build === 'function';

// ─── Builders ───────────────────────────────────────────────────────
// Builders produce raw data — undefined for optional fields, no spreading,
// no freezing. freezeMotionDefinition handles normalization at the boundary.

export class AnimationClipMotionBuilder implements AnimationMotionBuilder {
    constructor(
        private readonly _clipId: string,
        private readonly _timeScale?: number,
        private readonly _cycleOffset?: number
    ) {}

    withTimeScale(timeScale: number): AnimationClipMotionBuilder {
        return new AnimationClipMotionBuilder(this._clipId, timeScale, this._cycleOffset);
    }

    withCycleOffset(cycleOffset: number): AnimationClipMotionBuilder {
        return new AnimationClipMotionBuilder(this._clipId, this._timeScale, cycleOffset);
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'clip',
            clipId: this._clipId,
            timeScale: this._timeScale,
            cycleOffset: this._cycleOffset,
        };
    }
}

export class AnimationMotionMatchingMotionBuilder implements AnimationMotionBuilder {
    constructor(
        private readonly _database: AnimationMotionMatchDatabase,
        private readonly _trajectoryXParameter: string,
        private readonly _trajectoryZParameter: string,
        private readonly _facingXParameter: string,
        private readonly _facingZParameter: string,
        private readonly _reselectIntervalSeconds?: number,
        private readonly _continuityBias?: number
    ) {}

    withReselectInterval(seconds: number): AnimationMotionMatchingMotionBuilder {
        return new AnimationMotionMatchingMotionBuilder(
            this._database,
            this._trajectoryXParameter,
            this._trajectoryZParameter,
            this._facingXParameter,
            this._facingZParameter,
            seconds,
            this._continuityBias
        );
    }

    withContinuityBias(bias: number): AnimationMotionMatchingMotionBuilder {
        return new AnimationMotionMatchingMotionBuilder(
            this._database,
            this._trajectoryXParameter,
            this._trajectoryZParameter,
            this._facingXParameter,
            this._facingZParameter,
            this._reselectIntervalSeconds,
            bias
        );
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'motionMatching',
            database: this._database,
            trajectoryXParameter: this._trajectoryXParameter,
            trajectoryZParameter: this._trajectoryZParameter,
            facingXParameter: this._facingXParameter,
            facingZParameter: this._facingZParameter,
            reselectIntervalSeconds: this._reselectIntervalSeconds,
            continuityBias: this._continuityBias,
        };
    }
}

export class AnimationBlend1DGraphBuilder implements AnimationMotionBuilder {
    private readonly _children: { threshold: number; motion: AnimationMotionInput }[] = [];

    constructor(private readonly _parameter: string) {}

    addChild(threshold: number, motion: AnimationMotionInput): this {
        this._children.push({ threshold, motion });
        return this;
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'blend1d',
            parameter: this._parameter,
            children: [...this._children]
                .sort((left, right) => left.threshold - right.threshold)
                .map((child) => ({
                    threshold: child.threshold,
                    motion: toMotionDefinition(child.motion),
                })),
        };
    }
}

export class AnimationBlend2DGraphBuilder implements AnimationMotionBuilder {
    private readonly _children: { x: number; y: number; motion: AnimationMotionInput }[] = [];

    constructor(
        private readonly _parameterX: string,
        private readonly _parameterY: string,
        private readonly _mode: 'inverse-distance' | 'freeform' = 'inverse-distance'
    ) {}

    addChild(x: number, y: number, motion: AnimationMotionInput): this {
        this._children.push({ x, y, motion });
        return this;
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'blend2d',
            parameterX: this._parameterX,
            parameterY: this._parameterY,
            mode: this._mode,
            children: this._children.map((child) => ({
                position: tuple2(child.x, child.y),
                motion: toMotionDefinition(child.motion),
            })),
        };
    }
}

export class AnimationDirectBlendGraphBuilder implements AnimationMotionBuilder {
    private readonly _children: {
        motion: AnimationMotionInput;
        parameter?: string;
        weight?: number;
    }[] = [];

    addChild(
        motion: AnimationMotionInput,
        options: { parameter?: string; weight?: number } = {}
    ): this {
        this._children.push({ motion, parameter: options.parameter, weight: options.weight });
        return this;
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'direct',
            children: this._children.map((child) => ({
                motion: toMotionDefinition(child.motion),
                parameter: child.parameter,
                weight: child.weight,
            })),
        };
    }
}

export class AnimationAdditiveBlendGraphBuilder implements AnimationMotionBuilder {
    private _parameter?: string;
    private _weight?: number;

    constructor(
        private readonly _base: AnimationMotionInput,
        private readonly _additive: AnimationMotionInput
    ) {}

    withParameter(parameter: string): this {
        this._parameter = parameter;
        return this;
    }

    withWeight(weight: number): this {
        this._weight = weight;
        return this;
    }

    build(): AnimationMotionDefinition {
        return {
            kind: 'additive',
            base: toMotionDefinition(this._base),
            additive: toMotionDefinition(this._additive),
            parameter: this._parameter,
            weight: this._weight,
        };
    }
}

// ─── Factory functions ──────────────────────────────────────────────

export const createAnimationClipMotion = (
    clipId: string,
    options: { timeScale?: number; cycleOffset?: number } = {}
): AnimationClipMotionBuilder =>
    new AnimationClipMotionBuilder(clipId, options.timeScale, options.cycleOffset);

export const createAnimationBlend1DGraph = (parameter: string): AnimationBlend1DGraphBuilder =>
    new AnimationBlend1DGraphBuilder(parameter);

export const createAnimationBlend2DGraph = (
    parameterX: string,
    parameterY: string
): AnimationBlend2DGraphBuilder => new AnimationBlend2DGraphBuilder(parameterX, parameterY);

export const createAnimationDirectBlendGraph = (): AnimationDirectBlendGraphBuilder =>
    new AnimationDirectBlendGraphBuilder();

export const createAnimationAdditiveBlendGraph = (
    base: AnimationMotionInput,
    additive: AnimationMotionInput
): AnimationAdditiveBlendGraphBuilder => new AnimationAdditiveBlendGraphBuilder(base, additive);

export const createAnimationMotionMatchingMotion = (
    database: AnimationMotionMatchDatabase,
    trajectoryXParameter: string,
    trajectoryZParameter: string,
    facingXParameter: string,
    facingZParameter: string
): AnimationMotionMatchingMotionBuilder =>
    new AnimationMotionMatchingMotionBuilder(
        database,
        trajectoryXParameter,
        trajectoryZParameter,
        facingXParameter,
        facingZParameter
    );

export const buildAnimationMotionDefinition = (motion: AnimationMotionInput): AnimationMotionDefinition =>
    toMotionDefinition(motion);

// ─── Validation ─────────────────────────────────────────────────────

const pushDiagnostic = (
    diagnostics: AnimationBlendGraphDiagnostic[],
    code: string,
    message: string,
    path: string
): void => {
    diagnostics.push(Object.freeze({ code, message, path }));
};

const validateMotion = (
    motion: AnimationMotionDefinition,
    diagnostics: AnimationBlendGraphDiagnostic[],
    options: AnimationBlendGraphValidationOptions,
    path: string
): void => {
    switch (motion.kind) {
        case 'clip':
            if (options.knownClipIds && options.knownClipIds.includes(String(motion.clipId)) === false) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.clip.unknown', `Unknown clip '${motion.clipId}'`, path);
            }
            break;
        case 'blend1d':
            if (motion.children.length === 0) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.children.empty', '1D blend graphs require at least one child', path);
            }
            if (options.knownParameters && options.knownParameters.includes(String(motion.parameter)) === false) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.parameter.unknown', `Unknown parameter '${motion.parameter}'`, `${path}.parameter`);
            }
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                if (!isFiniteNumber(child.threshold)) {
                    pushDiagnostic(diagnostics, 'animation.blendGraph.threshold.invalid', '1D child threshold must be finite', `${path}.children[${index}]`);
                }
                validateMotion(child.motion, diagnostics, options, `${path}.children[${index}].motion`);
            }
            break;
        case 'blend2d':
            if (motion.children.length === 0) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.children.empty', '2D blend graphs require at least one child', path);
            }
            if (options.knownParameters && options.knownParameters.includes(String(motion.parameterX)) === false) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.parameter.unknown', `Unknown parameter '${motion.parameterX}'`, `${path}.parameterX`);
            }
            if (options.knownParameters && options.knownParameters.includes(String(motion.parameterY)) === false) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.parameter.unknown', `Unknown parameter '${motion.parameterY}'`, `${path}.parameterY`);
            }
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                if (!isFiniteNumber(child.position[0]) || !isFiniteNumber(child.position[1])) {
                    pushDiagnostic(diagnostics, 'animation.blendGraph.position.invalid', '2D child position must be finite', `${path}.children[${index}]`);
                }
                validateMotion(child.motion, diagnostics, options, `${path}.children[${index}].motion`);
            }
            break;
        case 'direct':
            if (motion.children.length === 0) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.children.empty', 'Direct blend graphs require at least one child', path);
            }
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                if (
                    typeof child.parameter === 'string' &&
                    options.knownParameters &&
                    options.knownParameters.includes(child.parameter) === false
                ) {
                    pushDiagnostic(diagnostics, 'animation.blendGraph.parameter.unknown', `Unknown parameter '${child.parameter}'`, `${path}.children[${index}].parameter`);
                }
                if (child.weight !== undefined && !isFiniteNumber(child.weight)) {
                    pushDiagnostic(diagnostics, 'animation.blendGraph.weight.invalid', 'Direct child weight must be finite', `${path}.children[${index}].weight`);
                }
                validateMotion(child.motion, diagnostics, options, `${path}.children[${index}].motion`);
            }
            break;
        case 'additive':
            if (
                typeof motion.parameter === 'string' &&
                options.knownParameters &&
                options.knownParameters.includes(motion.parameter) === false
            ) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.parameter.unknown', `Unknown parameter '${motion.parameter}'`, `${path}.parameter`);
            }
            if (motion.weight !== undefined && !isFiniteNumber(motion.weight)) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.weight.invalid', 'Additive weight must be finite', `${path}.weight`);
            }
            validateMotion(motion.base, diagnostics, options, `${path}.base`);
            validateMotion(motion.additive, diagnostics, options, `${path}.additive`);
            break;
        case 'motionMatching': {
            const parameters: readonly [string, string][] = [
                ['trajectoryXParameter', String(motion.trajectoryXParameter)],
                ['trajectoryZParameter', String(motion.trajectoryZParameter)],
                ['facingXParameter', String(motion.facingXParameter)],
                ['facingZParameter', String(motion.facingZParameter)],
            ];
            for (const [field, parameter] of parameters) {
                if (options.knownParameters && options.knownParameters.includes(parameter) === false) {
                    pushDiagnostic(
                        diagnostics,
                        'animation.blendGraph.parameter.unknown',
                        `Unknown parameter '${parameter}'`,
                        `${path}.${field}`
                    );
                }
            }
            if (motion.reselectIntervalSeconds !== undefined && !isFiniteNumber(motion.reselectIntervalSeconds)) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.weight.invalid', 'Motion-matching reselect interval must be finite', `${path}.reselectIntervalSeconds`);
            }
            if (motion.continuityBias !== undefined && !isFiniteNumber(motion.continuityBias)) {
                pushDiagnostic(diagnostics, 'animation.blendGraph.weight.invalid', 'Motion-matching continuity bias must be finite', `${path}.continuityBias`);
            }
            break;
        }
        default:
            pushDiagnostic(diagnostics, 'animation.blendGraph.kind.unsupported', `Unsupported motion kind '${String((motion as AnimationBlendTreeDefinition).kind)}'`, path);
            break;
    }
};

export const validateAnimationMotionDefinition = (
    motion: AnimationMotionInput,
    options: AnimationBlendGraphValidationOptions = {}
): readonly AnimationBlendGraphDiagnostic[] => {
    const diagnostics: AnimationBlendGraphDiagnostic[] = [];
    validateMotion(toMotionDefinition(motion), diagnostics, options, 'motion');
    return Object.freeze(diagnostics);
};

export const AnimationBlendGraph = Object.freeze({
    clip: createAnimationClipMotion,
    blend1d: createAnimationBlend1DGraph,
    blend2d: createAnimationBlend2DGraph,
    direct: createAnimationDirectBlendGraph,
    additive: createAnimationAdditiveBlendGraph,
    motionMatching: createAnimationMotionMatchingMotion,
    build: buildAnimationMotionDefinition,
    validate: validateAnimationMotionDefinition,
});
