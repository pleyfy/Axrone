import { TweenCore } from '../core';
import { TweenConfig } from '../types';

export class PrimitiveTween extends TweenCore<number> {
    protected _valuesStart = 0;
    protected _valuesEnd = 0;
    protected _valuesStartRepeat = 0;

    constructor(object: number, config?: TweenConfig<number>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        if (this._valuesStart === undefined) {
            this._valuesStart = this._object;
        }

        if (this._valuesEnd === undefined) {
            this._valuesEnd = this._object;
        }

        this._valuesStartRepeat = this._valuesStart;
    }

    protected _updateProperties(progress: number): void {
        this._object = this._valuesStart + (this._valuesEnd - this._valuesStart) * progress;
    }

    protected _reset(): void {
        if (this._yoyo) {
            const tmp = this._valuesStart;
            this._valuesStart = this._valuesEnd;
            this._valuesEnd = tmp;
            this._reversed = !this._reversed;
        } else {
            this._valuesStart = this._valuesStartRepeat;
        }
    }

    protected _deepClone<U>(source: U): U {
        return source;
    }
}
