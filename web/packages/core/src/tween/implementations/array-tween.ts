import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import { Interpolation } from '../interpolation';
import { TypedArrayConstructor } from 'packages/utility/src/types';

export class ArrayTween<T extends ArrayLike<number>> extends TweenCore<T> {
    protected _valuesStartRepeat: T | null = null;
    protected _twoValueBuffer: [number, number] = [0, 0];

    constructor(object: T, config?: TweenConfig<T>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        const startLen = this._valuesStart.length ?? 0;
        const endLen = this._valuesEnd.length ?? 0;
        const objLen = this._object.length;

        if (startLen === 0) {
            this._valuesStart = this._cloneArray(this._object);
        }

        if (endLen === 0) {
            this._valuesEnd = this._cloneArray(this._object);
        }

        this._normalizeArrays();

        this._valuesStartRepeat = this._cloneArray(this._valuesStart);
    }

    protected _normalizeArrays(): void {
        const startArray = this._valuesStart as any;
        const endArray = this._valuesEnd as any;

        if (!startArray.length || !endArray.length) return;

        if (startArray.length !== endArray.length) {
            const maxLen = Math.max(startArray.length, endArray.length);

            if (startArray.length < maxLen) {
                this._valuesStart = this._extendArray(startArray, maxLen);
            }

            if (endArray.length < maxLen) {
                this._valuesEnd = this._extendArray(endArray, maxLen);
            }
        }
    }

    protected _extendArray(array: any[], newLength: number): any {
        const lastValue = array.length > 0 ? array[array.length - 1] : 0;

        if (ArrayBuffer.isView(array)) {
            const constructor = array.constructor as TypedArrayConstructor;
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

    protected _cloneArray(array: any): any {
        if (ArrayBuffer.isView(array)) {
            const constructor = array.constructor as TypedArrayConstructor;
            return new constructor(array as any);
        } else if (Array.isArray(array)) {
            return [...array];
        } else {
            const result: number[] = [];
            for (let i = 0; i < array.length; i++) {
                result[i] = array[i];
            }
            return result;
        }
    }

    protected _updateProperties(progress: number): void {
        const start = this._valuesStart as any;
        const end = this._valuesEnd as any;
        const object = this._object as any;

        if (ArrayBuffer.isView(object)) {
            const typedArray = object as any;
            for (let i = 0; i < typedArray.length; i++) {
                if (i < start.length && i < end.length) {
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
                for (let i = 0; i < object.length; i++) {
                    if (i < start.length && i < end.length) {
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
        } else if (this._valuesStartRepeat) {
            this._valuesStart = this._cloneArray(this._valuesStartRepeat);

            const startArray = this._valuesStart as any;
            const object = this._object as any;

            if (ArrayBuffer.isView(object)) {
                const typedArray = object as any;
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

    protected _deepClone<U>(source: U): U {
        if (Array.isArray(source) || ArrayBuffer.isView(source)) {
            return this._cloneArray(source) as unknown as U;
        }
        return source;
    }
}
