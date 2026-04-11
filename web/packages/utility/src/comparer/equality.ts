import {
    FNV_OFFSET_BASIS,
    hashObject,
    hashString,
    isEquatable,
    type EqualityComparer,
    type EqualityComparerOptions,
} from './shared';

export class DefaultEqualityComparer<T> implements EqualityComparer<T> {
    private static readonly HASH_CACHE = new WeakMap<object, number>();

    equals(a: T, b: T): boolean {
        if (a === b) return true;
        if (a === null || a === undefined || b === null || b === undefined) return false;

        if (isEquatable(a)) {
            return a.equals(b);
        }

        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.equals(a[i] as unknown as T, b[i] as unknown as T)) return false;
            }
            return true;
        }

        return false;
    }

    hash(obj: T): number {
        if (obj === null || obj === undefined) return 0;

        if (typeof obj !== 'object') {
            if (typeof obj === 'number') return obj | 0;
            if (typeof obj === 'boolean') return obj ? 1 : 0;
            if (typeof obj === 'string') return hashString(obj);
            return 0;
        }

        if (DefaultEqualityComparer.HASH_CACHE.has(obj as object)) {
            return DefaultEqualityComparer.HASH_CACHE.get(obj as object)!;
        }

        let hash: number;

        if (isEquatable(obj)) {
            hash = obj.getHashCode();
        } else if (obj instanceof Date) {
            hash = obj.getTime() | 0;
        } else {
            hash = hashObject(obj);
        }

        DefaultEqualityComparer.HASH_CACHE.set(obj as object, hash);
        return hash;
    }
}

export class DeepEqualityComparer<T> implements EqualityComparer<T> {
    private readonly options: Readonly<EqualityComparerOptions>;
    private static readonly HASH_CACHE = new WeakMap<object, number>();
    private static readonly DEFAULT_INSTANCE = new DeepEqualityComparer();

    static readonly default = DeepEqualityComparer.DEFAULT_INSTANCE;

    constructor(options?: Readonly<EqualityComparerOptions>) {
        this.options = options ?? {};
    }

    equals(a: T, b: T): boolean {
        return this.deepEquals(a, b, new Set());
    }

    private deepEquals(a: unknown, b: unknown, visited: Set<unknown>): boolean {
        if (a === b) return true;
        if (a === null || a === undefined || b === null || b === undefined) return false;

        if (this.options.customizer) {
            const result = this.options.customizer(a, b);
            if (result !== undefined) return result;
        }

        if (typeof a !== typeof b) return false;

        if (typeof a === 'function') return a === b;

        if (typeof a !== 'object') {
            if (typeof a === 'number') {
                if (Number.isNaN(a) && Number.isNaN(b as number)) return true;
            }
            if (this.options.ignoreCase && typeof a === 'string' && typeof b === 'string') {
                return a.toLowerCase() === b.toLowerCase();
            }
            return a === b;
        }

        const aObj = a as object;
        const bObj = b as object;

        if (visited.has(aObj) && visited.has(bObj)) return true;
        if (visited.has(aObj) || visited.has(bObj)) return false;

        visited.add(aObj);
        visited.add(bObj);

        if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
        if (a instanceof RegExp && b instanceof RegExp) return a.toString() === b.toString();
        if (a instanceof Set && b instanceof Set) {
            if (a.size !== b.size) return false;
            for (const item of a) {
                let found = false;
                for (const bItem of b) {
                    if (this.deepEquals(item, bItem, visited)) {
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
            }
            return true;
        }

        if (a instanceof Map && b instanceof Map) {
            if (a.size !== b.size) return false;
            for (const [key, value] of a.entries()) {
                let found = false;
                for (const [bKey, bValue] of b.entries()) {
                    if (
                        this.deepEquals(key, bKey, visited) &&
                        this.deepEquals(value, bValue, visited)
                    ) {
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
            }
            return true;
        }

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEquals(a[i], b[i], visited)) return false;
            }
            return true;
        }

        const aKeys = Object.keys(a as object);
        const bKeys = Object.keys(b as object);

        if (aKeys.length !== bKeys.length) return false;

        if (this.options.strict) {
            const aKeysSet = new Set(aKeys);
            const bKeysSet = new Set(bKeys);
            if (aKeysSet.size !== bKeysSet.size) return false;
            for (const key of aKeysSet) {
                if (!bKeysSet.has(key)) return false;
            }
        }

        return aKeys.every((key) => {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return !this.options.strict;
            return this.deepEquals(
                (a as Record<string, unknown>)[key],
                (b as Record<string, unknown>)[key],
                visited
            );
        });
    }

    hash(obj: T): number {
        if (obj === null || obj === undefined) return 0;

        if (typeof obj !== 'object') {
            return hashObject(obj);
        }

        if (DeepEqualityComparer.HASH_CACHE.has(obj as object)) {
            return DeepEqualityComparer.HASH_CACHE.get(obj as object)!;
        }

        const hash = this.deepHash(obj, new Set());
        DeepEqualityComparer.HASH_CACHE.set(obj as object, hash);
        return hash;
    }

    private deepHash(obj: unknown, visited: Set<unknown>): number {
        if (obj === null || obj === undefined) return 0;

        if (typeof obj !== 'object') {
            return hashObject(obj);
        }

        const objRef = obj as object;

        if (visited.has(objRef)) return 0;
        visited.add(objRef);

        if (isEquatable(obj)) {
            return obj.getHashCode();
        }

        if (obj instanceof Date) return obj.getTime() | 0;
        if (obj instanceof RegExp) return hashString(obj.toString());

        if (obj instanceof Set) {
            return [...obj].reduce((hash, item) => {
                return hash ^ this.deepHash(item, visited);
            }, FNV_OFFSET_BASIS);
        }

        if (obj instanceof Map) {
            return [...obj.entries()].reduce((hash, [key, value]) => {
                return hash ^ (this.deepHash(key, visited) + this.deepHash(value, visited));
            }, FNV_OFFSET_BASIS);
        }

        if (Array.isArray(obj)) {
            return obj.reduce((hash, item, index) => {
                return hash ^ (this.deepHash(item, visited) + index);
            }, FNV_OFFSET_BASIS);
        }

        return Object.entries(obj).reduce((hash, [key, value]) => {
            return hash ^ (hashString(key) + this.deepHash(value, visited));
        }, FNV_OFFSET_BASIS);
    }
}

export const equality = Object.freeze({
    default<T>(): EqualityComparer<T> {
        return new DefaultEqualityComparer<T>();
    },

    deep<T>(options?: EqualityComparerOptions): EqualityComparer<T> {
        if (!options) return DeepEqualityComparer.default;
        return new DeepEqualityComparer<T>(options);
    },
});