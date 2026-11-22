import { DeepPartial } from '@axrone/utility';
import { TweenCore } from '../core';
import { TweenConfig } from '../types';
import {
    getOrCreateTweenPropertyAccessor,
    TweenPropertyAccessor,
} from '../property-accessor';
import {
    BlendPair,
    collectTweenLeafPaths,
    createBlendPair,
    isTweenTypedArray,
    type TweenTypedArrayConstructor,
} from '../runtime-utils';
import { createObjectTweenTrack, ObjectTweenTrack } from '../object-tracks';

export class ObjectTween<T extends object> extends TweenCore<T> {
    protected _objectProps = new Set<string>();
    protected _propertyAccessors = new Map<string, TweenPropertyAccessor>();
    protected _propertyEntries: TweenPropertyAccessor[] = [];
    protected _tracks: ObjectTweenTrack[] = [];
    protected _twoValueBuffer: BlendPair = createBlendPair();

    constructor(object: T, config?: TweenConfig<T>) {
        super(object, config);
    }

    protected _initStartEndValues(): void {
        this._objectProps.clear();
        this._propertyEntries = [];

        this._collectProps(this._valuesEnd, this._objectProps);
        this._collectProps(this._valuesStart, this._objectProps);

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

        this._freezeStartArrays(this._valuesStart);
        this._compileTracks();
    }

    /**
     * Detach start-snapshot arrays from live objects once at init. The
     * `to()` path otherwise aliases the target's arrays, so cycle resets
     * would read back mutated values. One setup-time copy buys allocation-free
     * repeat cycles for the lifetime of the tween.
     */
    protected _freezeStartArrays(obj: unknown): void {
        if (!obj || typeof obj !== 'object') {
            return;
        }

        if (Array.isArray(obj) || isTweenTypedArray(obj)) {
            return;
        }

        const record = obj as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            const value = record[key];

            if (Array.isArray(value) || isTweenTypedArray(value)) {
                record[key] = this._deepClone(value);
            } else if (value !== null && typeof value === 'object') {
                this._freezeStartArrays(value);
            }
        }
    }

    protected _getDefaultValue(endValue: unknown): unknown {
        if (typeof endValue === 'number') {
            return 0;
        }

        if (Array.isArray(endValue)) {
            return endValue.map(() => 0);
        }

        if (isTweenTypedArray(endValue)) {
            // Guarded above, so `.constructor` is a numeric typed-array ctor.
            const typedArray = endValue as unknown as {
                readonly length: number;
                readonly constructor: TweenTypedArrayConstructor;
            };
            return new typedArray.constructor(typedArray.length);
        }

        return 0;
    }

    protected _collectProps(obj: unknown, props: Set<string>): void {
        for (const path of collectTweenLeafPaths(obj, false)) {
            props.add(path);
            getOrCreateTweenPropertyAccessor(this._propertyAccessors, path);
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

        // Non-yoyo cycles reuse the untouched start snapshot: tracks still
        // reference the same values, so only the live object is rewound.
        // No clone, no recompile — zero steady-state allocation per cycle.
        for (const track of this._tracks) {
            track.reset(this._object);
        }
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
