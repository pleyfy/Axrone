import {
    ComparerError,
    InvalidOperationError,
    hashObject,
    isEquatable,
    type Comparer,
    type ComparerOptions,
    type CompareResult,
    type ExtractPropertyType,
    type KeySelector,
    type OrderKey,
    type PropertyPath,
} from './shared';
import {
    DeepEqualityComparer,
    DefaultEqualityComparer,
    equality,
} from './equality';

export {
    ComparerError,
    InvalidOperationError,
    isComparer,
    isEqualityComparer,
    isEquatable,
    type Comparable,
    type Comparer,
    type ComparerOptions,
    type CompareResult,
    type DeepPartial,
    type EqualityComparer,
    type EqualityComparerOptions,
    type Equatable,
    type ExtractPropertyType,
    type KeySelector,
    type KeysOfType,
    type OrderKey,
    type PropertyPath,
} from './shared';

export {
    DeepEqualityComparer,
    DefaultEqualityComparer,
    equality,
} from './equality';

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
