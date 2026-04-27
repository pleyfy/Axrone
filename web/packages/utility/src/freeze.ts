import type { DeepReadonly } from './types';

export const deepFreeze = <TValue>(
    value: TValue,
    seen = new WeakSet<object>()
): DeepReadonly<TValue> => {
    if (value === null || typeof value !== 'object') {
        return value as DeepReadonly<TValue>;
    }

    const target = value as object;
    if (seen.has(target)) {
        return value as DeepReadonly<TValue>;
    }
    seen.add(target);

    for (const key of Reflect.ownKeys(target)) {
        deepFreeze((target as Record<PropertyKey, unknown>)[key], seen);
    }

    return Object.freeze(value) as DeepReadonly<TValue>;
};
