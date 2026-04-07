import type { TypedArray } from '@axrone/utility';

export type TweenTypedArrayConstructor = new (
    source: number | ArrayLike<number>
) => TypedArray;

export const isTweenTypedArray = (value: unknown): value is TypedArray =>
    ArrayBuffer.isView(value) && !(value instanceof DataView);

export const cloneTweenArrayLike = <T extends ArrayLike<number>>(array: T): T => {
    if (isTweenTypedArray(array)) {
        const constructor = array.constructor as TweenTypedArrayConstructor;
        return new constructor(array as ArrayLike<number>) as T;
    }

    if (Array.isArray(array)) {
        return [...array] as T;
    }

    const result: number[] = [];
    for (let index = 0; index < array.length; index += 1) {
        result[index] = array[index] ?? 0;
    }
    return result as T;
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

    const result = Object.create(null) as Record<string, unknown>;
    for (const key in source as Record<string, unknown>) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            result[key] = deepCloneTweenValue((source as Record<string, unknown>)[key]);
        }
    }

    return result as T;
};