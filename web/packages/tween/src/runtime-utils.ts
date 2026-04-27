import type { NumericTypedArray, NumericTypedArrayConstructor } from '@axrone/utility';

export type TweenTypedArray = NumericTypedArray;
export type TweenTypedArrayConstructor = NumericTypedArrayConstructor;

export const isTweenTypedArray = (value: unknown): value is TweenTypedArray =>
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    !(value instanceof BigInt64Array) &&
    !(value instanceof BigUint64Array);

export const cloneTweenArrayLike = <T extends ArrayLike<number>>(array: T): T => {
    if (isTweenTypedArray(array)) {
        const constructor = array.constructor as TweenTypedArrayConstructor;
        return new constructor(array as ArrayLike<number>) as unknown as T;
    }

    if (Array.isArray(array)) {
        return [...array] as unknown as T;
    }

    const result: number[] = [];
    for (let index = 0; index < array.length; index += 1) {
        result[index] = array[index] ?? 0;
    }
    return result as unknown as T;
};

export const allocateSequenceLike = (
    template: ArrayLike<number>,
    length: number
): ArrayLike<number> => {
    if (isTweenTypedArray(template)) {
        const constructor = template.constructor as TweenTypedArrayConstructor;
        return new constructor(length);
    }

    return new Array<number>(length);
};

export const deepCloneTweenValue = <T>(source: T): T => {
    if (source === null || source === undefined || typeof source !== 'object') {
        return source;
    }

    if (Array.isArray(source) || isTweenTypedArray(source)) {
        return cloneTweenArrayLike(source as ArrayLike<number>) as unknown as T;
    }

    if (source instanceof Date) {
        return new Date(source.getTime()) as unknown as T;
    }

    if (source instanceof Map) {
        const result = new Map();
        source.forEach((value, key) => {
            result.set(key, deepCloneTweenValue(value));
        });
        return result as unknown as T;
    }

    if (source instanceof Set) {
        const result = new Set();
        for (const value of source) {
            result.add(deepCloneTweenValue(value));
        }
        return result as unknown as T;
    }

    const typedSource = source as Record<PropertyKey, unknown>;
    const result = Object.create(Object.getPrototypeOf(source)) as Record<PropertyKey, unknown>;

    for (const key of Reflect.ownKeys(typedSource)) {
        if (Object.prototype.propertyIsEnumerable.call(typedSource, key)) {
            result[key] = deepCloneTweenValue(typedSource[key]);
        }
    }

    return result as T;
};
