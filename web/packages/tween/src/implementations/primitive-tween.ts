import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';

export class PrimitiveTween extends TweenCore<number> {
    protected _valuesStart = 0;
    protected _valuesEnd = 0;
    protected _valuesStartRepeat = 0;
    private _startExplicit = false;
    private _endExplicit = false;

    constructor(object: number, config?: TweenConfig<number>) {
        super(object, config);
    }

    override from(properties: DeepPartial<number>): this {
        this._startExplicit = true;
        return super.from(properties);
    }

    override to(properties: DeepPartial<number>, duration?: number): this {
        this._endExplicit = true;
        return super.to(properties, duration);
    }

    getValue(): number {
        return this._object;
    }

    protected _initStartEndValues(): void {
        if (!this._startExplicit) {
            this._valuesStart = this._object;
        }

        if (!this._endExplicit) {
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
}
