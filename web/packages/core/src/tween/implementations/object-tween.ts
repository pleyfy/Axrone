import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import { Interpolation } from '../interpolation';
import {
    allocateSequenceLike,
    deepCloneTweenValue,
    isTweenTypedArray,
    type TweenTypedArrayConstructor,
} from '../runtime-utils';

interface ObjectTweenPropertyEntry {
    readonly path: string;
    readonly parts: readonly string[];
}

export class ObjectTween<T extends object> extends TweenCore<T> {
    protected _valuesStartRepeat: DeepPartial<T> | null = null;
    protected _objectProps = new Set<string>();
    protected _propPathCache: Map<string, readonly string[]> = new Map();
    protected _propertyEntries: ObjectTweenPropertyEntry[] = [];
    protected _twoValueBuffer: [number, number] = [0, 0];

    constructor(object: T, config?: TweenConfig<T>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        this._objectProps.clear();
        this._propertyEntries = [];

        this._collectProps(this._valuesEnd, '', this._objectProps);
        this._collectProps(this._valuesStart, '', this._objectProps);

        for (const path of this._objectProps) {
            const parts = this._propPathCache.get(path) ?? path.split('.');
            this._propPathCache.set(path, parts);
            this._propertyEntries.push({ path, parts });
        }

        for (const entry of this._propertyEntries) {
            const propValue = this._getPropValue(this._object, entry.parts);
            const endValue = this._getPropValue(this._valuesEnd, entry.parts);

            if (this._getPropValue(this._valuesStart, entry.parts) === undefined) {
                const startValue =
                    propValue !== undefined ? propValue : this._getDefaultValue(endValue);
                this._setPropValue(this._valuesStart, entry.parts, startValue);
            }

            if (this._getPropValue(this._valuesEnd, entry.parts) === undefined) {
                this._setPropValue(this._valuesEnd, entry.parts, propValue);
            }

            if (propValue === undefined) {
                const startValue = this._getPropValue(this._valuesStart, entry.parts);
                this._setPropValue(this._object, entry.parts, startValue);
            }
        }

        this._valuesStartRepeat = deepCloneTweenValue(this._valuesStart);
    }

    protected _getDefaultValue(endValue: any): any {
        if (typeof endValue === 'number') {
            return 0;
        }

        if (Array.isArray(endValue)) {
            return endValue.map(() => 0);
        }

        if (isTweenTypedArray(endValue)) {
            const typedArray = endValue as any;
            return new (typedArray.constructor as TweenTypedArrayConstructor)(typedArray.length);
        }

        return 0;
    }

    protected _collectProps(obj: any, prefix: string, props: Set<string>): void {
        if (!obj || typeof obj !== 'object') {
            return;
        }

        for (const key in obj) {
            const value = obj[key];
            const propPath = prefix ? `${prefix}.${key}` : key;

            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                !isTweenTypedArray(value)
            ) {
                this._collectProps(value, propPath, props);
                continue;
            }

            props.add(propPath);
            if (!this._propPathCache.has(propPath)) {
                this._propPathCache.set(propPath, propPath.split('.'));
            }
        }
    }

    protected _getPropValue(obj: any, parts: readonly string[]): any {
        if (!obj) {
            return undefined;
        }

        let current = obj;

        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            if (current === undefined || current === null) {
                return undefined;
            }

            current = current[part];
        }

        return current;
    }

    protected _setPropValue(obj: any, parts: readonly string[], value: any): void {
        if (!obj) {
            return;
        }

        let current = obj;

        for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];

            if (current[part] === undefined) {
                current[part] = this._isNumericPathPart(parts[index + 1]) ? [] : {};
            }

            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        const existing = current[lastPart];

        if (
            isTweenTypedArray(existing) &&
            isTweenTypedArray(value) &&
            existing.length === value.length
        ) {
            (existing as any).set(value as any);
            return;
        }

        current[lastPart] = value;
    }

    protected _updateProperties(progress: number): void {
        for (const entry of this._propertyEntries) {
            const start = this._getPropValue(this._valuesStart, entry.parts);
            const end = this._getPropValue(this._valuesEnd, entry.parts);

            if (start === undefined || end === undefined) {
                continue;
            }

            if (
                (Array.isArray(end) && Array.isArray(start)) ||
                (isTweenTypedArray(end) && isTweenTypedArray(start))
            ) {
                const length = (end as ArrayLike<number>).length;
                const existing = this._getPropValue(this._object, entry.parts);
                const result = this._resolveSequenceTarget(
                    existing,
                    end as unknown as ArrayLike<number>,
                    length,
                    entry.parts
                ) as any;

                if (
                    this._interpolationFunction &&
                    this._interpolationFunction !== Interpolation.Linear &&
                    length > 1
                ) {
                    const buffer = this._twoValueBuffer;

                    for (let index = 0; index < length; index += 1) {
                        const startValue = index < start.length ? start[index] : 0;
                        buffer[0] = startValue;
                        buffer[1] = end[index] ?? 0;
                        result[index] = this._interpolationFunction(buffer, progress);
                    }

                    continue;
                }

                for (let index = 0; index < length; index += 1) {
                    const startValue = index < start.length ? start[index] : 0;
                    const endValue = end[index] ?? 0;
                    result[index] = startValue + (endValue - startValue) * progress;
                }

                continue;
            }

            if (typeof end === 'number') {
                const startValue = typeof start === 'number' ? start : 0;
                this._setPropValue(
                    this._object,
                    entry.parts,
                    startValue + (end - startValue) * progress
                );
            }
        }
    }

    protected _reset(): void {
        if (this._yoyo) {
            const previousStart = this._valuesStart;
            this._valuesStart = this._valuesEnd;
            this._valuesEnd = previousStart;
            this._reversed = !this._reversed;
            return;
        }

        if (!this._valuesStartRepeat) {
            return;
        }

        this._valuesStart = deepCloneTweenValue(this._valuesStartRepeat);

        for (const entry of this._propertyEntries) {
            const startValue = this._getPropValue(this._valuesStart, entry.parts);
            if (startValue === undefined) {
                continue;
            }

            const existing = this._getPropValue(this._object, entry.parts);

            if (
                isTweenTypedArray(existing) &&
                isTweenTypedArray(startValue) &&
                existing.length === startValue.length
            ) {
                (existing as any).set(startValue as any);
                continue;
            }

            if (Array.isArray(existing) && Array.isArray(startValue) && existing.length === startValue.length) {
                for (let index = 0; index < startValue.length; index += 1) {
                    existing[index] = startValue[index] ?? 0;
                }
                continue;
            }

            this._setPropValue(this._object, entry.parts, startValue);
        }
    }

    protected _resolveSequenceTarget(
        existing: unknown,
        template: ArrayLike<number>,
        length: number,
        parts: readonly string[]
    ): ArrayLike<number> {
        if (isTweenTypedArray(existing) && isTweenTypedArray(template) && existing.length === length) {
            return existing as unknown as ArrayLike<number>;
        }

        if (Array.isArray(existing) && Array.isArray(template) && existing.length === length) {
            return existing;
        }

        const created = allocateSequenceLike(template, length);
        this._setPropValue(this._object, parts, created);
        return created;
    }

    protected _deepClone<U>(source: U): U {
        return deepCloneTweenValue(source);
    }

    protected _isNumericPathPart(value: string | undefined): boolean {
        return typeof value === 'string' && /^\d+$/.test(value);
    }
}
