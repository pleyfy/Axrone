import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import { Interpolation } from '../interpolation';
import { TypedArrayConstructor } from 'packages/utility/src/types';

export class ObjectTween<T extends object> extends TweenCore<T> {
    protected _valuesStartRepeat: DeepPartial<T> | null = null;
    protected _objectProps = new Set<string>();
    protected _propPathCache: Map<string, string[]> = new Map();

    constructor(object: T, config?: TweenConfig<T>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        this._collectProps(this._valuesEnd, '', this._objectProps);
        this._collectProps(this._valuesStart, '', this._objectProps);

        for (const prop of this._objectProps) {
            const propValue = this._getPropValue(this._object, prop);
            const endValue = this._getPropValue(this._valuesEnd, prop);

            if (this._getPropValue(this._valuesStart, prop) === undefined) {
                const startValue =
                    propValue !== undefined ? propValue : this._getDefaultValue(endValue);
                this._setPropValue(this._valuesStart, prop, startValue);
            }

            if (this._getPropValue(this._valuesEnd, prop) === undefined) {
                this._setPropValue(this._valuesEnd, prop, propValue);
            }

            if (propValue === undefined) {
                const startValue = this._getPropValue(this._valuesStart, prop);
                this._setPropValue(this._object, prop, startValue);
            }
        }

        this._valuesStartRepeat = this._deepClone(this._valuesStart);
    }

    protected _getDefaultValue(endValue: any): any {
        if (typeof endValue === 'number') {
            return 0;
        } else if (Array.isArray(endValue)) {
            return endValue.map(() => 0);
        } else if (ArrayBuffer.isView(endValue)) {
            const typedArray = endValue as any;
            return new (typedArray.constructor as TypedArrayConstructor)(typedArray.length);
        }
        return 0;
    }

    protected _collectProps(obj: any, prefix: string, props: Set<string>): void {
        if (!obj || typeof obj !== 'object') return;

        for (const key in obj) {
            const value = obj[key];
            const propPath = prefix ? `${prefix}.${key}` : key;

            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                !ArrayBuffer.isView(value)
            ) {
                this._collectProps(value, propPath, props);
            } else {
                props.add(propPath);
                if (!this._propPathCache.has(propPath)) {
                    this._propPathCache.set(propPath, propPath.split('.'));
                }
            }
        }
    }

    protected _getPropValue(obj: any, path: string): any {
        if (!obj) return undefined;
        const parts = this._propPathCache.get(path) ?? path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }

        return current;
    }

    protected _setPropValue(obj: any, path: string, value: any): void {
        if (!obj) return;

        const parts = this._propPathCache.get(path) ?? path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];

            if (current[part] === undefined) {
                current[part] = {};
            }

            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        const existing = current[lastPart];
        if (
            ArrayBuffer.isView(existing) &&
            ArrayBuffer.isView(value) &&
            (existing as any).length === (value as any).length
        ) {
            (existing as any).set(value as any);
        } else {
            current[lastPart] = value;
        }
    }

    protected _updateProperties(progress: number): void {
        for (const prop of this._objectProps) {
            const start = this._getPropValue(this._valuesStart, prop);
            const end = this._getPropValue(this._valuesEnd, prop);

            if (start === undefined || end === undefined) continue;

            if (
                (Array.isArray(end) && Array.isArray(start)) ||
                (ArrayBuffer.isView(end) && ArrayBuffer.isView(start))
            ) {
                const len = (end as any).length as number;

                const existing = this._getPropValue(this._object, prop);

                if (
                    this._interpolationFunction &&
                    this._interpolationFunction !== Interpolation.Linear &&
                    len > 1
                ) {
                    const buf: [number, number] = [0, 0];

                    if (
                        ArrayBuffer.isView(end) &&
                        ArrayBuffer.isView(start) &&
                        ArrayBuffer.isView(existing) &&
                        (existing as any).length === len
                    ) {
                        const typedExisting = existing as any;
                        for (let i = 0; i < len; i++) {
                            const s = i < (start as any).length ? (start as any)[i] : 0;
                            buf[0] = s;
                            buf[1] = (end as any)[i];
                            typedExisting[i] = this._interpolationFunction(buf as any, progress);
                        }
                        this._setPropValue(this._object, prop, typedExisting);
                    } else {
                        const result: number[] = new Array(len);
                        for (let i = 0; i < len; i++) {
                            const s = i < (start as any).length ? (start as any)[i] : 0;
                            buf[0] = s;
                            buf[1] = (end as any)[i];
                            result[i] = this._interpolationFunction(buf as any, progress);
                        }

                        if (ArrayBuffer.isView(end)) {
                            const constructor = (end as any).constructor as TypedArrayConstructor;
                            const typedResult = new constructor(result as any);
                            this._setPropValue(this._object, prop, typedResult);
                        } else {
                            this._setPropValue(this._object, prop, result);
                        }
                    }
                } else {
                    if (
                        ArrayBuffer.isView(end) &&
                        ArrayBuffer.isView(start) &&
                        ArrayBuffer.isView(existing) &&
                        (existing as any).length === len
                    ) {
                        const typedExisting = existing as any;
                        for (let i = 0; i < len; i++) {
                            const s = i < (start as any).length ? (start as any)[i] : 0;
                            const e = (end as any)[i];
                            typedExisting[i] = s + (e - s) * progress;
                        }
                        this._setPropValue(this._object, prop, typedExisting);
                    } else {
                        const result: number[] = new Array(len);
                        for (let i = 0; i < len; i++) {
                            const s = i < (start as any).length ? (start as any)[i] : 0;
                            const e = (end as any)[i];
                            result[i] = s + (e - s) * progress;
                        }

                        if (ArrayBuffer.isView(end)) {
                            const constructor = (end as any).constructor as TypedArrayConstructor;
                            const typedResult = new constructor(result as any);
                            this._setPropValue(this._object, prop, typedResult);
                        } else {
                            this._setPropValue(this._object, prop, result);
                        }
                    }
                }
            } else if (typeof end === 'number') {
                const startVal = typeof start === 'number' ? start : 0;
                const value = startVal + (end - startVal) * progress;
                this._setPropValue(this._object, prop, value);
            }
        }
    }

    protected _reset(): void {
        if (this._yoyo) {
            const tmp = this._valuesStart;
            this._valuesStart = this._valuesEnd;
            this._valuesEnd = tmp;
            this._reversed = !this._reversed;
        } else if (this._valuesStartRepeat) {
            this._valuesStart = this._deepClone(this._valuesStartRepeat);

            for (const prop of this._objectProps) {
                const startValue = this._getPropValue(this._valuesStart, prop);
                if (startValue !== undefined) {
                    const existing = this._getPropValue(this._object, prop);
                    if (
                        ArrayBuffer.isView(existing) &&
                        ArrayBuffer.isView(startValue) &&
                        (existing as any).length === (startValue as any).length
                    ) {
                        (existing as any).set(startValue as any);
                    } else {
                        this._setPropValue(this._object, prop, startValue);
                    }
                }
            }
        }
    }

    protected _deepClone<U>(source: U): U {
        if (source === null || source === undefined || typeof source !== 'object') {
            return source;
        }

        if (Array.isArray(source)) {
            return source.map((item) => this._deepClone(item)) as unknown as U;
        }

        if (ArrayBuffer.isView(source)) {
            const constructor = source.constructor as TypedArrayConstructor;
            return new constructor(source as any) as unknown as U;
        }

        if (source instanceof Date) {
            return new Date(source.getTime()) as unknown as U;
        }

        if (source instanceof Map) {
            const result = new Map();
            source.forEach((value, key) => {
                result.set(key, this._deepClone(value));
            });
            return result as unknown as U;
        }

        if (source instanceof Set) {
            const result = new Set();
            for (const value of source) {
                result.add(this._deepClone(value));
            }
            return result as unknown as U;
        }

        const result = Object.create(null);
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                result[key] = this._deepClone((source as any)[key]);
            }
        }

        return result as U;
    }
}
