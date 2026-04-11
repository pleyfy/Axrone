import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import {
    getOrCreateTweenPropertyAccessor,
    TweenPropertyAccessor,
} from '../property-accessor';
import {
    deepCloneTweenValue,
    isTweenTypedArray,
    type TweenTypedArrayConstructor,
} from '../runtime-utils';
import { createObjectTweenTrack, ObjectTweenTrack } from '../object-tracks';

export class ObjectTween<T extends object> extends TweenCore<T> {
    protected _valuesStartRepeat: DeepPartial<T> | null = null;
    protected _objectProps = new Set<string>();
    protected _propertyAccessors = new Map<string, TweenPropertyAccessor>();
    protected _propertyEntries: TweenPropertyAccessor[] = [];
    protected _tracks: ObjectTweenTrack[] = [];
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
            this._propertyEntries.push(getOrCreateTweenPropertyAccessor(this._propertyAccessors, path));
        }

        for (const accessor of this._propertyEntries) {
            const propValue = accessor.get(this._object);
            const endValue = accessor.get(this._valuesEnd);

            if (accessor.get(this._valuesStart) === undefined) {
                const startValue =
                    propValue !== undefined ? propValue : this._getDefaultValue(endValue);
                accessor.set(this._valuesStart, startValue);
            }

            if (accessor.get(this._valuesEnd) === undefined) {
                accessor.set(this._valuesEnd, propValue);
            }

            if (propValue === undefined) {
                const startValue = accessor.get(this._valuesStart);
                accessor.set(this._object, startValue);
            }
        }

        this._valuesStartRepeat = deepCloneTweenValue(this._valuesStart);
        this._compileTracks();
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
            getOrCreateTweenPropertyAccessor(this._propertyAccessors, propPath);
        }
    }

    protected _updateProperties(progress: number): void {
        for (const track of this._tracks) {
            track.apply(this._object, progress, this._interpolationFunction, this._twoValueBuffer);
        }
    }

    protected _reset(): void {
        if (this._yoyo) {
            const previousStart = this._valuesStart;
            this._valuesStart = this._valuesEnd;
            this._valuesEnd = previousStart;
            this._reversed = !this._reversed;
            this._compileTracks();
            return;
        }

        if (!this._valuesStartRepeat) {
            return;
        }

        this._valuesStart = deepCloneTweenValue(this._valuesStartRepeat);
        this._compileTracks();

        for (const track of this._tracks) {
            track.reset(this._object);
        }
    }

    protected _deepClone<U>(source: U): U {
        return deepCloneTweenValue(source);
    }

    protected _compileTracks(): void {
        this._tracks = [];

        for (const accessor of this._propertyEntries) {
            const track = createObjectTweenTrack(
                accessor,
                accessor.get(this._valuesStart),
                accessor.get(this._valuesEnd)
            );

            if (track) {
                this._tracks.push(track);
            }
        }
    }
}
