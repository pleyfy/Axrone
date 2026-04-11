import { Interpolation } from './interpolation';
import {
    assignTweenPropertyValue,
    TweenPropertyAccessor,
} from './property-accessor';
import {
    allocateSequenceLike,
    cloneTweenArrayLike,
    isTweenTypedArray,
} from './runtime-utils';

type TweenInterpolationFunction = (v: ArrayLike<number>, k: number) => number;

export interface ObjectTweenTrack {
    readonly path: string;
    apply(
        target: object,
        progress: number,
        interpolation: TweenInterpolationFunction,
        twoValueBuffer: [number, number]
    ): void;
    reset(target: object): void;
}

class NumberTweenTrack implements ObjectTweenTrack {
    readonly path: string;
    private _accessor: TweenPropertyAccessor;
    private _startValue: number;
    private _delta: number;

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
        _twoValueBuffer: [number, number]
    ): void {
        this._accessor.set(target, this._startValue + this._delta * progress);
    }

    reset(target: object): void {
        this._accessor.set(target, this._startValue);
    }
}

class SequenceTweenTrack implements ObjectTweenTrack {
    readonly path: string;
    private _accessor: TweenPropertyAccessor;
    private _startValues: ArrayLike<number>;
    private _endValues: ArrayLike<number>;
    private _length: number;

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
        twoValueBuffer: [number, number]
    ): void {
        const result = this._resolveTarget(target) as any;

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
            return;
        }

        this._accessor.set(target, cloneTweenArrayLike(this._startValues));
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