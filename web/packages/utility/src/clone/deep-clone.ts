import type { TypedArray } from '../types';

const isPlainObject = (value: unknown): value is Record<PropertyKey, unknown> => {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

export const deepClone = <TValue>(value: TValue, seen = new WeakMap<object, unknown>()): TValue => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const source = value as object;
    const existing = seen.get(source);
    if (existing) {
        return existing as TValue;
    }

    if (Array.isArray(value)) {
        const clone: unknown[] = [];
        seen.set(source, clone);
        for (const entry of value) {
            clone.push(deepClone(entry, seen));
        }
        return clone as TValue;
    }

    if (value instanceof Date) {
        return new Date(value.getTime()) as TValue;
    }

    if (value instanceof Map) {
        const clone = new Map();
        seen.set(source, clone);
        for (const [key, entry] of value) {
            clone.set(deepClone(key, seen), deepClone(entry, seen));
        }
        return clone as TValue;
    }

    if (value instanceof Set) {
        const clone = new Set();
        seen.set(source, clone);
        for (const entry of value) {
            clone.add(deepClone(entry, seen));
        }
        return clone as TValue;
    }

    if (ArrayBuffer.isView(value)) {
        if (value instanceof DataView) {
            return new DataView(
                value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
            ) as TValue;
        }
        const typedArray = value as unknown as TypedArray;
        return typedArray.slice() as TValue;
    }

    if (value instanceof ArrayBuffer) {
        return value.slice(0) as TValue;
    }

    if (!isPlainObject(value)) {
        return value;
    }

    const clone: Record<PropertyKey, unknown> = {};
    seen.set(source, clone);

    for (const key of Reflect.ownKeys(value)) {
        clone[key] = deepClone((value as Record<PropertyKey, unknown>)[key], seen);
    }

    return clone as TValue;
};

export const cloneData = deepClone;
