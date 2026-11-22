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

export const deepCloneTweenValue = <T>(source: T): T => {    if (source === null || source === undefined || typeof source !== 'object') {
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

/**
 * Per-property blend scratch over a resolved `[start, end]` pair.
 * Each tween owns one instance buffer (see `createBlendPair`); sharing it
 * across tweens would break re-entrant updates.
 */
export type BlendPair = [number, number];

export const createBlendPair = (): BlendPair => [0, 0];

/**
 * Collect dotted leaf paths over own enumerable properties.
 *
 * Shared by the object tween and the spring so their traversal semantics
 * cannot drift apart. With `expandSequences`, arrays and typed arrays fan
 * out to indexed leaves (`pos.0`); otherwise a sequence counts as one leaf.
 */
export const collectTweenLeafPaths = (root: unknown, expandSequences: boolean): string[] => {
    const paths: string[] = [];

    const visit = (node: unknown, prefix: string): void => {
        if (node === null || typeof node !== 'object') {
            return;
        }

        if (Array.isArray(node) || isTweenTypedArray(node)) {
            if (!expandSequences) {
                if (prefix !== '') {
                    paths.push(prefix);
                }
                return;
            }
            const length = (node as ArrayLike<unknown>).length;
            for (let index = 0; index < length; index += 1) {
                paths.push(prefix === '' ? `${index}` : `${prefix}.${index}`);
            }
            return;
        }

        for (const key of Object.keys(node)) {
            const value = (node as Record<string, unknown>)[key];
            const path = prefix === '' ? key : `${prefix}.${key}`;

            if (value !== null && typeof value === 'object') {
                visit(value, path);
            } else {
                paths.push(path);
            }
        }
    };

    visit(root, '');
    return paths;
};
