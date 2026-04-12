import type {
    AnimationBlendTreeAdditiveDefinition,
    AnimationBlendTreeDefinition,
    AnimationMotionClipDefinition,
    AnimationMotionDefinition,
} from './types';

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

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const freezeMotionDefinition = (motion: AnimationMotionDefinition): AnimationMotionDefinition => {
    switch (motion.kind) {
        case 'clip':
            return Object.freeze({
                kind: 'clip',
                clipId: motion.clipId,
                ...(isFiniteNumber(motion.timeScale) ? { timeScale: motion.timeScale } : {}),
                ...(isFiniteNumber(motion.cycleOffset) ? { cycleOffset: motion.cycleOffset } : {}),
            } satisfies AnimationMotionClipDefinition);
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
                children: Object.freeze(
                    motion.children.map((child) =>
                        Object.freeze({
                            position: Object.freeze([child.position[0], child.position[1]]) as readonly [number, number],
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
                            ...(typeof child.parameter === 'string' ? { parameter: child.parameter } : {}),
                            ...(isFiniteNumber(child.weight) ? { weight: child.weight } : {}),
                        })
                    )
                ),
            });
        case 'additive':
            return Object.freeze({
                kind: 'additive',
                base: freezeMotionDefinition(motion.base),
                additive: freezeMotionDefinition(motion.additive),
                ...(typeof motion.parameter === 'string' ? { parameter: motion.parameter } : {}),
                ...(isFiniteNumber(motion.weight) ? { weight: motion.weight } : {}),
            } satisfies AnimationBlendTreeAdditiveDefinition);
        default:
            return motion;
    }
};

const toMotionDefinition = (motion: AnimationMotionInput): AnimationMotionDefinition =>
    typeof (motion as AnimationMotionBuilder).build === 'function'
        ? (motion as AnimationMotionBuilder).build()
        : freezeMotionDefinition(motion as AnimationMotionDefinition);

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
        return freezeMotionDefinition({
            kind: 'clip',
            clipId: this._clipId,
            ...(isFiniteNumber(this._timeScale) ? { timeScale: this._timeScale } : {}),
            ...(isFiniteNumber(this._cycleOffset) ? { cycleOffset: this._cycleOffset } : {}),
        });
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
        return freezeMotionDefinition({
            kind: 'blend1d',
            parameter: this._parameter,
            children: Object.freeze(
                [...this._children]
                    .sort((left, right) => left.threshold - right.threshold)
                    .map((child) =>
                        Object.freeze({
                            threshold: child.threshold,
                            motion: toMotionDefinition(child.motion),
                        })
                    )
            ),
        });
    }
}

export class AnimationBlend2DGraphBuilder implements AnimationMotionBuilder {
    private readonly _children: { x: number; y: number; motion: AnimationMotionInput }[] = [];

    constructor(
        private readonly _parameterX: string,
        private readonly _parameterY: string
    ) {}

    addChild(x: number, y: number, motion: AnimationMotionInput): this {
        this._children.push({ x, y, motion });
        return this;
    }

    build(): AnimationMotionDefinition {
        return freezeMotionDefinition({
            kind: 'blend2d',
            parameterX: this._parameterX,
            parameterY: this._parameterY,
            children: Object.freeze(
                this._children.map((child) =>
                    Object.freeze({
                        position: Object.freeze([child.x, child.y]) as readonly [number, number],
                        motion: toMotionDefinition(child.motion),
                    })
                )
            ),
        });
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
        return freezeMotionDefinition({
            kind: 'direct',
            children: Object.freeze(
                this._children.map((child) =>
                    Object.freeze({
                        motion: toMotionDefinition(child.motion),
                        ...(typeof child.parameter === 'string' ? { parameter: child.parameter } : {}),
                        ...(isFiniteNumber(child.weight) ? { weight: child.weight } : {}),
                    })
                )
            ),
        });
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
        return freezeMotionDefinition({
            kind: 'additive',
            base: toMotionDefinition(this._base),
            additive: toMotionDefinition(this._additive),
            ...(typeof this._parameter === 'string' ? { parameter: this._parameter } : {}),
            ...(isFiniteNumber(this._weight) ? { weight: this._weight } : {}),
        });
    }
}

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

export const buildAnimationMotionDefinition = (motion: AnimationMotionInput): AnimationMotionDefinition =>
    toMotionDefinition(motion);

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
    build: buildAnimationMotionDefinition,
    validate: validateAnimationMotionDefinition,
});