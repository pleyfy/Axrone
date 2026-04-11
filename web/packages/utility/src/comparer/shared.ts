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

export const FNV_PRIME = 16777619;
export const FNV_OFFSET_BASIS = 2166136261;

const fnvHash = (data: string): number => {
    let hash = FNV_OFFSET_BASIS;

    for (let i = 0; i < data.length; i++) {
        hash ^= data.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }

    return hash >>> 0;
};

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

export const hashString = (str: string): number => fnvHash(str);

export function hashObject(obj: unknown): number {
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