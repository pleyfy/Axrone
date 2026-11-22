import { Interpolation } from './interpolation';
import {
    assignTweenPropertyValue,
    TweenPropertyAccessor,
} from './property-accessor';
import {
    allocateSequenceLike,
    BlendPair,
    cloneTweenArrayLike,
    isTweenTypedArray,
} from './runtime-utils';

type TweenInterpolationFunction = (v: ArrayLike<number>, k: number) => number;

/** Writable numeric sequence: arrays, typed arrays and array-likes alike. */
type MutableSequence = ArrayLike<number> & Record<number, number>;

export interface ObjectTweenTrack {
    readonly path: string;
    apply(
        target: object,
        progress: number,
        interpolation: TweenInterpolationFunction,
        twoValueBuffer: BlendPair
    ): void;
    reset(target: object): void;
}

/**
 * Walk `accessor.parts` to the parent holder once. The hot path then performs
 * a single keyed store per channel instead of a per-frame path traversal.
 */
function resolveHolder(
    accessor: TweenPropertyAccessor,
    target: object
): { holder: Record<string | number, number>; key: string } | null {
    const parts = accessor.parts;
    let current: unknown = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
        if (current === undefined || current === null || typeof current !== 'object') {
            return null;
        }
        current = (current as Record<string, unknown>)[parts[index]!];
    }
    if (current === undefined || current === null || typeof current !== 'object') {
        return null;
    }
    return { holder: current as Record<string | number, number>, key: parts[parts.length - 1]! };
}

class NumberTweenTrack implements ObjectTweenTrack {
    readonly path: string;
    private _accessor: TweenPropertyAccessor;
    private _startValue: number;
    private _delta: number;
    private _holder: Record<string | number, number> | null = null;
    private _key = '';
    private _boundTarget: object | null = null;

    constructor(accessor: TweenPropertyAccessor, startValue: number, endValue: number) {
        this.path = accessor.path;
        this._accessor = accessor;
        this._startValue = startValue;
        this._delta = endValue - startValue;
    }

    apply(
        target: object,
        progress: number,
        _interpolation: TweenInterpolationFunction,
        _twoValueBuffer: BlendPair
    ): void {
        const resolved = this._holderFor(target);
        if (resolved === null) {
            this._accessor.set(target, this._startValue + this._delta * progress);
            return;
        }
        resolved.holder[resolved.key] = this._startValue + this._delta * progress;
    }

    reset(target: object): void {
        const resolved = this._holderFor(target);
        if (resolved === null) {
            this._accessor.set(target, this._startValue);
            return;
        }
        resolved.holder[resolved.key] = this._startValue;
    }

    private _holderFor(target: object): { holder: Record<string | number, number>; key: string } | null {
        if (this._holder === null || this._boundTarget !== target) {
            const resolved = resolveHolder(this._accessor, target);
            if (resolved === null) {
                return null;
            }
            this._holder = resolved.holder;
            this._key = resolved.key;
            this._boundTarget = target;
        }
        return { holder: this._holder, key: this._key };
    }
}

class SequenceTweenTrack implements ObjectTweenTrack {
    readonly path: string;
    private _accessor: TweenPropertyAccessor;
    private _startValues: ArrayLike<number>;
    private _endValues: ArrayLike<number>;
    private _length: number;
    private _resolved: ArrayLike<number> | null = null;
    private _boundTarget: object | null = null;

    constructor(
        accessor: TweenPropertyAccessor,
        startValues: ArrayLike<number>,
        endValues: ArrayLike<number>
    ) {
        this.path = accessor.path;
        this._accessor = accessor;
        this._startValues = startValues;
        this._endValues = endValues;
        this._length = endValues.length;
    }

    apply(
        target: object,
        progress: number,
        interpolation: TweenInterpolationFunction,
        twoValueBuffer: BlendPair
    ): void {
        const result = this._targetFor(target) as MutableSequence;

        if (interpolation !== Interpolation.Linear && this._length > 1) {
            for (let index = 0; index < this._length; index += 1) {
                const startValue = index < this._startValues.length ? this._startValues[index] : 0;
                twoValueBuffer[0] = startValue;
                twoValueBuffer[1] = this._endValues[index] ?? 0;
                result[index] = interpolation(twoValueBuffer, progress);
            }

            return;
        }

        for (let index = 0; index < this._length; index += 1) {
            const startValue = index < this._startValues.length ? this._startValues[index] : 0;
            const endValue = this._endValues[index] ?? 0;
            result[index] = startValue + (endValue - startValue) * progress;
        }
    }

    reset(target: object): void {
        const existing = this._accessor.get(target);

        if (assignTweenPropertyValue(existing, this._startValues)) {
            this._resolved = null;
            this._boundTarget = null;
            return;
        }

        this._accessor.set(target, cloneTweenArrayLike(this._startValues));
        this._resolved = null;
        this._boundTarget = null;
    }

    private _targetFor(target: object): ArrayLike<number> {
        if (this._resolved !== null && this._boundTarget === target) {
            return this._resolved;
        }
        const resolved = this._resolveTarget(target);
        this._resolved = resolved;
        this._boundTarget = target;
        return resolved;
    }

    private _resolveTarget(target: object): ArrayLike<number> {
        const existing = this._accessor.get(target);

        if (
            isTweenTypedArray(existing) &&
            isTweenTypedArray(this._endValues) &&
            existing.length === this._length
        ) {
            return existing as ArrayLike<number>;
        }

        if (
            Array.isArray(existing) &&
            Array.isArray(this._endValues) &&
            existing.length === this._length
        ) {
            return existing;
        }

        const created = allocateSequenceLike(this._endValues, this._length);
        this._accessor.set(target, created);
        return (this._accessor.get(target) as ArrayLike<number> | undefined) ?? created;
    }
}

export const createObjectTweenTrack = (
    accessor: TweenPropertyAccessor,
    start: unknown,
    end: unknown
): ObjectTweenTrack | null => {
    if (typeof end === 'number') {
        const startValue = typeof start === 'number' ? start : 0;
        return new NumberTweenTrack(accessor, startValue, end);
    }

    if (
        (Array.isArray(end) && Array.isArray(start)) ||
        (isTweenTypedArray(end) && isTweenTypedArray(start))
    ) {
        return new SequenceTweenTrack(
            accessor,
            start as ArrayLike<number>,
            end as ArrayLike<number>
        );
    }

    return null;
};
