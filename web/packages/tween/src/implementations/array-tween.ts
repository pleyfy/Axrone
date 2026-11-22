import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import { Interpolation } from '../interpolation';
import {
    BlendPair,
    cloneTweenArrayLike,
    createBlendPair,
    isTweenTypedArray,
    type TweenTypedArrayConstructor,
} from '../runtime-utils';

type MutableSequence = ArrayLike<number> & Record<number, number>;

// DeepPartial erases indexability, so snapshot/object views re-widen here.
// Every cast below targets MutableSequence or a TypedArray guard — never any.

export class ArrayTween<T extends ArrayLike<number>> extends TweenCore<T> {
    protected _twoValueBuffer: BlendPair = createBlendPair();
    private _deltas: ArrayLike<number> | null = null;

    constructor(object: T, config?: TweenConfig<T>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        const startLen = this._valuesStart.length ?? 0;
        const endLen = this._valuesEnd.length ?? 0;
        const objLen = this._object.length;

        if (startLen === 0) {
            this._valuesStart = this._cloneArray(this._object as unknown as MutableSequence) as unknown as DeepPartial<T>;
        }

        if (endLen === 0) {
            this._valuesEnd = this._cloneArray(this._object as unknown as MutableSequence) as unknown as DeepPartial<T>;
        }

        this._normalizeArrays();

        this._computeDeltas();
    }

    private _computeDeltas(): void {
        const start = this._valuesStart as unknown as ArrayLike<number>;
        const end = this._valuesEnd as unknown as ArrayLike<number>;
        const startLen = start?.length ?? 0;
        const endLen = end?.length ?? 0;
        const len = Math.min(startLen, endLen);

        if (len <= 0) {
            this._deltas = null;
            return;
        }

        if (isTweenTypedArray(start)) {
            const constructor = (start as unknown as { constructor: TweenTypedArrayConstructor }).constructor;
            const deltas = new constructor(len);
            for (let i = 0; i < len; i++) {
                deltas[i] = (end[i] ?? 0) - (start[i] ?? 0);
            }
            this._deltas = deltas;
            return;
        }

        const deltas = new Array<number>(len);
        for (let i = 0; i < len; i++) {
            deltas[i] = (end[i] ?? 0) - (start[i] ?? 0);
        }
        this._deltas = deltas;
    }

    protected _normalizeArrays(): void {
        const startArray = this._valuesStart as unknown as MutableSequence;
        const endArray = this._valuesEnd as unknown as MutableSequence;

        if (!startArray.length || !endArray.length) return;

        if (startArray.length !== endArray.length) {
            const maxLen = Math.max(startArray.length, endArray.length);

            if (startArray.length < maxLen) {
                this._valuesStart = this._extendArray(startArray, maxLen) as unknown as DeepPartial<T>;
            }

            if (endArray.length < maxLen) {
                this._valuesEnd = this._extendArray(endArray, maxLen) as unknown as DeepPartial<T>;
            }
        }
    }

    protected _extendArray(array: MutableSequence, newLength: number): MutableSequence {
        const lastValue = array.length > 0 ? array[array.length - 1] : 0;

        if (isTweenTypedArray(array)) {
            const constructor = array.constructor as TweenTypedArrayConstructor;
            const newArray = new constructor(newLength);

            newArray.set(array);

            for (let i = array.length; i < newLength; i++) {
                newArray[i] = lastValue;
            }

            return newArray;
        } else {
            const currentLen = array.length;
            for (let i = currentLen; i < newLength; i++) {
                array[i] = lastValue;
            }
            return array;
        }
    }

    protected _cloneArray(array: MutableSequence): MutableSequence {
        return cloneTweenArrayLike(array as ArrayLike<number>);
    }

    protected _updateProperties(progress: number): void {
        const start = this._valuesStart as unknown as MutableSequence;
        const end = this._valuesEnd as unknown as MutableSequence;
        const object = this._object as unknown as MutableSequence;
        const deltas = this._deltas as unknown as MutableSequence;

        if (isTweenTypedArray(object)) {
            const typedArray = object as unknown as MutableSequence;
            const len = Math.min(typedArray.length, start.length, end.length);
            if (deltas && deltas.length >= len) {
                for (let i = 0; i < len; i++) {
                    typedArray[i] = start[i] + deltas[i] * progress;
                }
            } else {
                for (let i = 0; i < len; i++) {
                    typedArray[i] = start[i] + (end[i] - start[i]) * progress;
                }
            }
        } else if (Array.isArray(object)) {
            if (
                this._interpolationFunction &&
                this._interpolationFunction !== Interpolation.Linear &&
                start.length > 1
            ) {
                const buf = this._twoValueBuffer;
                for (let i = 0; i < object.length; i++) {
                    if (i < start.length && i < end.length) {
                        buf[0] = start[i];
                        buf[1] = end[i];
                        object[i] = this._interpolationFunction(buf, progress);
                    }
                }
            } else {
                const len = Math.min(object.length, start.length, end.length);
                if (deltas && deltas.length >= len) {
                    for (let i = 0; i < len; i++) {
                        object[i] = start[i] + deltas[i] * progress;
                    }
                } else {
                    for (let i = 0; i < len; i++) {
                        object[i] = start[i] + (end[i] - start[i]) * progress;
                    }
                }
            }
        } else if (this._interpolationFunction && start.length > 1) {
            object[0] = this._interpolationFunction(end, progress);
        }
    }

    protected _reset(): void {
        if (this._yoyo) {
            const tmp = this._valuesStart;
            this._valuesStart = this._valuesEnd;
            this._valuesEnd = tmp;
            this._reversed = !this._reversed;
            this._computeDeltas();
            return;
        }

        // Non-yoyo cycles reuse the untouched start snapshot: rewind the
        // live object without cloning. Zero steady-state allocation.
        const startArray = this._valuesStart as unknown as MutableSequence;
        const object = this._object as unknown as MutableSequence;

        if (ArrayBuffer.isView(object)) {
            const typedArray = object as unknown as MutableSequence;
            for (let i = 0; i < typedArray.length && i < startArray.length; i++) {
                typedArray[i] = startArray[i];
            }
        } else if (Array.isArray(object)) {
            for (let i = 0; i < object.length && i < startArray.length; i++) {
                object[i] = startArray[i];
            }
        }
    }
}
