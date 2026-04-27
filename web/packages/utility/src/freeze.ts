import type { DeepReadonly } from './types';

const isArrayBufferLike = (value: object): value is ArrayBuffer | SharedArrayBuffer =>
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer);

export const deepFreeze = <TValue>(
    value: TValue,
    seen = new WeakSet<object>()
): DeepReadonly<TValue> => {
    if (value === null || typeof value !== 'object') {
        return value as DeepReadonly<TValue>;
    }

    const target = value as object;
    if (isArrayBufferLike(target) || ArrayBuffer.isView(target)) {
        return value as DeepReadonly<TValue>;
    }

    if (seen.has(target)) {
        return value as DeepReadonly<TValue>;
    }
    seen.add(target);

    for (const key of Reflect.ownKeys(target)) {
        deepFreeze((target as Record<PropertyKey, unknown>)[key], seen);
    }

    return Object.freeze(value) as DeepReadonly<TValue>;
};
