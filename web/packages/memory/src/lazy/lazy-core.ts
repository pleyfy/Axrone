export const __lazy_brand: unique symbol = Symbol('__lazy_brand');
export const __async_brand: unique symbol = Symbol('__async_brand');
export const __factory_brand: unique symbol = Symbol('__factory_brand');
export const __state_brand: unique symbol = Symbol('__state_brand');
export const __value_brand: unique symbol = Symbol('__value_brand');

export type Nominal<T, K> = T & { readonly [__state_brand]: K };

export type LazyState = 'uninitialized' | 'computing' | 'resolved' | 'faulted';

export interface ILazyMetadata<T> {
    readonly state: LazyState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    value: T;
    factory: (() => T) | null;
}

export interface ILazyAsyncMetadata<T> {
    readonly state: LazyState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    value: T;
    factory: (() => Promise<T>) | null;
    promise: Promise<T> | null;
}

export interface ILazyFactoryMetadata<TArgs extends readonly unknown[], TResult> {
    readonly factory: (...args: TArgs) => TResult;
    readonly cache: Map<string, TResult>;
    readonly keySelector: (...args: TArgs) => string;
    readonly maxCacheSize: number;
    readonly accessOrder: string[];
}

export type LazyCore<T> = Nominal<ILazyMetadata<T>, 'LazyCore'>;
export type LazyAsyncCore<T> = Nominal<ILazyAsyncMetadata<T>, 'LazyAsyncCore'>;
export type LazyFactoryCore<TArgs extends readonly unknown[], TResult> = Nominal<
    ILazyFactoryMetadata<TArgs, TResult>,
    'LazyFactoryCore'
>;

export interface ILazy<T> extends LazyCore<T> {
    readonly [__lazy_brand]: true;
    readonly value: T;
    readonly isValueCreated: boolean;
    readonly isValueFaulted: boolean;

    readonly Value: T;
    readonly IsValueCreated: boolean;
    readonly IsValueFaulted: boolean;

    map<U>(selector: (value: T) => U): ILazy<U>;
    flatMap<U>(selector: (value: T) => ILazy<U>): ILazy<U>;
    filter<U extends T>(predicate: (value: T) => value is U): ILazy<U>;
    filter(predicate: (value: T) => boolean): ILazy<T>;
    orElse(fallback: () => T): ILazy<T>;
    catch<U = T>(handler: (error: Error) => U): ILazy<T | U>;
    tap(effect: (value: T) => void): ILazy<T>;
    force(): T;
    reset(): ILazy<T>;
    toAsync(): ILazyAsync<T>;
}

export interface ILazyAsync<T> {
    readonly [__async_brand]: true;
    readonly [__state_brand]: 'LazyAsyncCore';
    readonly state: LazyState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    value: T;
    factory: (() => Promise<T>) | null;
    promise: Promise<T> | null;

    readonly isValueCreated: boolean;
    readonly isValueFaulted: boolean;

    readonly Value: Promise<T>;
    readonly IsValueCreated: boolean;
    readonly IsValueFaulted: boolean;

    map<U>(selector: (value: T) => U): ILazyAsync<U>;
    mapAsync<U>(selector: (value: T) => Promise<U>): ILazyAsync<U>;
    flatMap<U>(selector: (value: T) => ILazyAsync<U>): ILazyAsync<U>;
    filter<U extends T>(predicate: (value: T) => value is U): ILazyAsync<U>;
    filter(predicate: (value: T) => boolean): ILazyAsync<T>;
    orElse(fallback: () => Promise<T>): ILazyAsync<T>;
    catch<U = T>(handler: (error: Error) => U): ILazyAsync<T | U>;
    catchAsync<U = T>(handler: (error: Error) => Promise<U>): ILazyAsync<T | U>;
    tap(effect: (value: T) => void): ILazyAsync<T>;
    tapAsync(effect: (value: T) => Promise<void>): ILazyAsync<T>;
    timeout(milliseconds: number): ILazyAsync<T>;
    retry(maxAttempts: number, delay?: number): ILazyAsync<T>;
    force(): Promise<T>;
    reset(): ILazyAsync<T>;
    toLazy(): ILazy<Promise<T>>;
}

export interface ILazyFactory<TArgs extends readonly unknown[], TResult>
    extends LazyFactoryCore<TArgs, TResult> {
    readonly [__factory_brand]: true;
    readonly cacheSize: number;

    create(...args: TArgs): ILazy<TResult>;
    createAsync(...args: TArgs): ILazyAsync<TResult>;
    getOrAdd(...args: TArgs): TResult;
    tryGetValue(...args: TArgs): [boolean, TResult | undefined];
    invalidate(...args: TArgs): boolean;
    clear(): void;
}

export type ExtractLazyType<T> = T extends ILazy<infer U> ? U : never;
export type ExtractLazyAsyncType<T> = T extends ILazyAsync<infer U> ? U : never;
export type LazyMap<T> = T extends ILazy<infer U> ? U : T extends ILazyAsync<infer V> ? V : T;
export type UnwrapLazyDeep<T> =
    T extends ILazy<infer U>
        ? UnwrapLazyDeep<U>
        : T extends ILazyAsync<infer V>
          ? UnwrapLazyDeep<V>
          : T;
export type LazyAll<T extends readonly unknown[]> = {
    readonly [K in keyof T]: ILazy<LazyMap<T[K]>>;
};
export type AsyncAll<T extends readonly unknown[]> = {
    readonly [K in keyof T]: ILazyAsync<LazyMap<T[K]>>;
};
export type UnwrapAll<T extends readonly unknown[]> = { readonly [K in keyof T]: LazyMap<T[K]> };
export type IsLazyType<T> = T extends ILazy<unknown> ? true : false;
export type IsAsyncType<T> = T extends ILazyAsync<unknown> ? true : false;
export type FilterLazyTypes<T extends readonly unknown[]> = {
    [K in keyof T]: T[K] extends ILazy<unknown> ? T[K] : never;
}[number];
export type LazyComputation<T, F> = F extends (...args: any[]) => infer R
    ? T extends ILazy<infer U>
        ? ILazy<R>
        : never
    : never;
