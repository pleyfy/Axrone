export type CompareResult = -1 | 0 | 1;

export type Comparable<T extends string> = number & { readonly __brand: T };
export type OrderKey = Comparable<'OrderKey'>;

export interface Comparer<T> {
    compare(a: T, b: T): CompareResult;
}

export interface EqualityComparer<T> {
    equals(a: T, b: T): boolean;
    hash(obj: T): number;
}

export interface Equatable {
    equals(other: unknown): boolean;
    getHashCode(): number;
}

export type KeySelector<T, K> = (item: T) => K;
export type PropertyPath<T> = (keyof T & string) | readonly (keyof T & string)[];

export type ExtractPropertyType<T, P extends PropertyPath<T>> = P extends readonly []
    ? T
    : P extends readonly [infer F, ...infer R]
      ? F extends keyof T
          ? R extends PropertyPath<T[F]>
              ? ExtractPropertyType<T[F], R>
              : never
          : never
      : P extends keyof T
        ? T[P]
        : never;

export type DeepPartial<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

export type KeysOfType<T, V> = {
    [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

export type ComparerOptions = Readonly<{
    nullFirst?: boolean;
    descending?: boolean;
    ignoreCase?: boolean;
    locale?: string;
    precision?: number;
    timezone?: string;
}>;

export type EqualityComparerOptions = Readonly<{
    ignoreCase?: boolean;
    deep?: boolean;
    strict?: boolean;
    customizer?: (objValue: unknown, otherValue: unknown) => boolean;
}>;

export class ComparerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CompareError';
        Object.setPrototypeOf(this, ComparerError.prototype);
    }
}

export class InvalidOperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidOperationError';
        Object.setPrototypeOf(this, InvalidOperationError.prototype);
    }
}

// Hash Calculation
const FNV_PRIME = 16777619;
const FNV_OFFSET_BASIS = 2166136261;

function fnvHash(data: string): number {
    let hash = FNV_OFFSET_BASIS;

    for (let i = 0; i < data.length; i++) {
        hash ^= data.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }

    return hash >>> 0;
}

export function isEquatable(obj: unknown): obj is Equatable {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        'equals' in obj &&
        typeof (obj as any).equals === 'function' &&
        'getHashCode' in obj &&
        typeof (obj as any).getHashCode === 'function'
    );
}

export function isComparer<T>(value: unknown): value is Comparer<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        'compare' in value &&
        typeof (value as any).compare === 'function'
    );
}

export function isEqualityComparer<T>(value: unknown): value is EqualityComparer<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        'equals' in value &&
        typeof (value as any).equals === 'function' &&
        'hash' in value &&
        typeof (value as any).hash === 'function'
    );
}

function hashString(str: string): number {
    return fnvHash(str);
}

function hashObject(obj: unknown): number {
    if (obj === null || obj === undefined) return 0;

    if (isEquatable(obj)) {
        return obj.getHashCode();
    }

    if (typeof obj === 'number') return obj | 0;
    if (typeof obj === 'boolean') return obj ? 1 : 0;
    if (typeof obj === 'string') return hashString(obj);
    if (obj instanceof Date) return obj.getTime() | 0;

    if (Array.isArray(obj)) {
        return obj.reduce((hash, item, index) => {
            return hash ^ (hashObject(item) + ((hash << 6) + (hash >> 2) + index));
        }, FNV_OFFSET_BASIS);
    }

    const entries = Object.entries(obj as Record<string, unknown>);
    return entries.reduce((hash, [key, value]) => {
        const keyHash = hashString(key);
        const valueHash = hashObject(value);
        return hash ^ ((keyHash + ((hash << 6) + (hash >> 2))) ^ valueHash);
    }, FNV_OFFSET_BASIS);
}

export class DefaultComparer<T> implements Comparer<T> {
    compare(a: T, b: T): CompareResult {
        if (a === b) return 0;
        if (a === null || a === undefined) return -1;
        if (b === null || b === undefined) return 1;

        if (typeof a === 'string' && typeof b === 'string') {
            return a < b ? -1 : 1;
        }

        if (typeof a === 'number' && typeof b === 'number') {
            if (Number.isNaN(a) && Number.isNaN(b)) return 0;
            if (Number.isNaN(a)) return -1;
            if (Number.isNaN(b)) return 1;
            return a < b ? -1 : 1;
        }

        if (typeof a === 'boolean' && typeof b === 'boolean') {
            return a === b ? 0 : a ? 1 : -1;
        }

        if (a instanceof Date && b instanceof Date) {
            const aTime = a.getTime();
            const bTime = b.getTime();
            return aTime === bTime ? 0 : aTime < bTime ? -1 : 1;
        }

        if (isEquatable(a) && isEquatable(b)) {
            return a.equals(b) ? 0 : -1;
        }

        const aStr = String(a);
        const bStr = String(b);
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    }
}

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

export class ReverseComparer<T> implements Comparer<T> {
    private readonly baseComparer: Comparer<T>;

    constructor(baseComparer: Comparer<T>) {
        this.baseComparer = baseComparer;
    }

    compare(a: T, b: T): CompareResult {
        const result = this.baseComparer.compare(a, b);
        return (result === 0 ? 0 : -result) as CompareResult;
    }
}

export class CompositeComparer<T> implements Comparer<T> {
    private readonly comparers: ReadonlyArray<Comparer<T>>;

    constructor(comparers: ReadonlyArray<Comparer<T>>) {
        if (!comparers.length) {
            throw new InvalidOperationError('At least one comparer must be provided');
        }
        this.comparers = [...comparers];
    }

    compare(a: T, b: T): CompareResult {
        for (const comparer of this.comparers) {
            const result = comparer.compare(a, b);
            if (result !== 0) return result;
        }
        return 0;
    }
}

export class KeyComparer<T, K> implements Comparer<T> {
    private readonly keySelector: KeySelector<T, K>;
    private readonly comparer: Comparer<K>;

    constructor(keySelector: KeySelector<T, K>, comparer?: Comparer<K>) {
        this.keySelector = keySelector;
        this.comparer = comparer || new DefaultComparer<K>();
    }

    compare(a: T, b: T): CompareResult {
        const keyA = this.keySelector(a);
        const keyB = this.keySelector(b);
        return this.comparer.compare(keyA, keyB);
    }
}

export class StringComparer implements Comparer<string> {
    private static readonly DEFAULT_INSTANCE = new StringComparer();
    private static readonly IGNORE_CASE_INSTANCE = new StringComparer({ ignoreCase: true });

    private readonly ignoreCase: boolean;
    private readonly locale: string | undefined;
    private readonly collator: Intl.Collator | undefined;

    static readonly default = StringComparer.DEFAULT_INSTANCE;
    static readonly ignoreCase = StringComparer.IGNORE_CASE_INSTANCE;

    constructor(options?: Readonly<Pick<ComparerOptions, 'ignoreCase' | 'locale'>>) {
        this.ignoreCase = options?.ignoreCase ?? false;
        this.locale = options?.locale;

        if (this.locale) {
            this.collator = new Intl.Collator(this.locale, {
                sensitivity: this.ignoreCase ? 'accent' : 'variant',
                usage: 'sort',
            });
        }
    }

    compare(a: string, b: string): CompareResult {
        if (a === b) return 0;
        if (a === null || a === undefined) return -1;
        if (b === null || b === undefined) return 1;

        if (this.collator) {
            const result = this.collator.compare(a, b);
            return result < 0 ? -1 : result > 0 ? 1 : 0;
        }

        if (this.ignoreCase) {
            a = a.toLowerCase();
            b = b.toLowerCase();
        }

        return a < b ? -1 : a > b ? 1 : 0;
    }
}

export class NumberComparer implements Comparer<number> {
    private static readonly DEFAULT_INSTANCE = new NumberComparer();

    private readonly precision: number | undefined;
    private readonly factor: number;

    static readonly default = NumberComparer.DEFAULT_INSTANCE;

    constructor(options?: Readonly<Pick<ComparerOptions, 'precision'>>) {
        this.precision = options?.precision;
        this.factor = this.precision !== undefined ? Math.pow(10, this.precision) : 1;
    }

    compare(a: number, b: number): CompareResult {
        if (Number.isNaN(a) && Number.isNaN(b)) return 0;
        if (Number.isNaN(a)) return -1;
        if (Number.isNaN(b)) return 1;

        if (this.precision !== undefined) {
            a = Math.round(a * this.factor) / this.factor;
            b = Math.round(b * this.factor) / this.factor;
        }

        if (a === b) return 0;
        return a < b ? -1 : 1;
    }
}

export class DateComparer implements Comparer<Date> {
    private static readonly DEFAULT_INSTANCE = new DateComparer();

    private readonly timezone: string | undefined;

    static readonly default = DateComparer.DEFAULT_INSTANCE;

    constructor(options?: Readonly<Pick<ComparerOptions, 'timezone'>>) {
        this.timezone = options?.timezone;
    }

    compare(a: Date, b: Date): CompareResult {
        if (!(a instanceof Date)) throw new ComparerError('First argument must be a Date');
        if (!(b instanceof Date)) throw new ComparerError('Second argument must be a Date');

        const aTime = a.getTime();
        const bTime = b.getTime();

        if (aTime === bTime) return 0;
        return aTime < bTime ? -1 : 1;
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

export const comparer = Object.freeze({
    default<T>(): Comparer<T> {
        return new DefaultComparer<T>();
    },

    reverse<T>(comparer: Comparer<T>): Comparer<T> {
        return new ReverseComparer<T>(comparer);
    },

    forKey<T, K>(keySelector: KeySelector<T, K>, comparer?: Comparer<K>): Comparer<T> {
        return new KeyComparer<T, K>(keySelector, comparer);
    },

    forPath<T, P extends PropertyPath<T>>(
        path: P,
        valueComparer?: Comparer<ExtractPropertyType<T, P>>
    ): Comparer<T> {
        return new KeyComparer<T, ExtractPropertyType<T, P>>(
            createPropertyAccessor(path),
            valueComparer
        );
    },

    composite<T>(...comparers: Comparer<T>[]): Comparer<T> {
        return new CompositeComparer<T>(comparers);
    },

    string(options?: Pick<ComparerOptions, 'ignoreCase' | 'locale'>): Comparer<string> {
        if (!options) return StringComparer.default;
        if (options.ignoreCase && !options.locale) return StringComparer.ignoreCase;
        return new StringComparer(options);
    },

    number(options?: Pick<ComparerOptions, 'precision'>): Comparer<number> {
        if (!options) return NumberComparer.default;
        return new NumberComparer(options);
    },

    date(options?: Pick<ComparerOptions, 'timezone'>): Comparer<Date> {
        if (!options) return DateComparer.default;
        return new DateComparer(options);
    },
});

export const equality = Object.freeze({
    default<T>(): EqualityComparer<T> {
        return new DefaultEqualityComparer<T>();
    },

    deep<T>(options?: EqualityComparerOptions): EqualityComparer<T> {
        if (!options) return DeepEqualityComparer.default;
        return new DeepEqualityComparer<T>(options);
    },
});

export function createOrderKey<T>(
    value: T,
    comparer: Comparer<T> = new DefaultComparer<T>()
): OrderKey {
    return hashObject(value) as OrderKey;
}

export function createPropertyAccessor<T, P extends PropertyPath<T>>(
    path: P
): KeySelector<T, ExtractPropertyType<T, P>> {
    if (typeof path === 'string') {
        return (obj: T) => obj[path as keyof T] as ExtractPropertyType<T, P>;
    }

    return (obj: T) => {
        let current: any = obj;

        for (const key of path) {
            if (current == null) return undefined as any;
            current = current[key];
        }

        return current as ExtractPropertyType<T, P>;
    };
}

export function sorted<T>(items: readonly T[], compareFn?: (a: T, b: T) => number): readonly T[] {
    if (!compareFn) {
        const defaultComparer = new DefaultComparer<T>();
        compareFn = (a, b) => defaultComparer.compare(a, b);
    }

    return [...items].sort(compareFn);
}

export function min<T>(items: readonly T[], comparer?: Comparer<T>): T | undefined {
    if (items.length === 0) return undefined;
    if (items.length === 1) return items[0];

    const cmp = comparer || new DefaultComparer<T>();
    let minItem = items[0];

    for (let i = 1; i < items.length; i++) {
        if (cmp.compare(items[i], minItem) < 0) {
            minItem = items[i];
        }
    }

    return minItem;
}

export function max<T>(items: readonly T[], comparer?: Comparer<T>): T | undefined {
    if (items.length === 0) return undefined;
    if (items.length === 1) return items[0];

    const cmp = comparer || new DefaultComparer<T>();
    let maxItem = items[0];

    for (let i = 1; i < items.length; i++) {
        if (cmp.compare(items[i], maxItem) > 0) {
            maxItem = items[i];
        }
    }

    return maxItem;
}
