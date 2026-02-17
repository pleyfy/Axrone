import {
    ILazy,
    ILazyAsync,
    ILazyFactory,
    ExtractLazyAsyncType,
    UnwrapAll,
    __lazy_brand,
    __async_brand,
    __factory_brand,
} from './lazy-core';
import { LazyImpl, LazyAsyncImpl } from './lazy-impl';
import { LazyFactoryImpl } from './lazy-factory';

export const create = <T>(valueFactory: () => T): ILazy<T> =>
    new LazyImpl(valueFactory, valueFactory);

export const createAsync = <T>(promiseFactory: () => Promise<T>): ILazyAsync<T> =>
    new LazyAsyncImpl(promiseFactory);

export const fromValue = <T>(value: T): ILazy<T> =>
    new LazyImpl(
        () => value,
        () => value
    );

export const fromPromise = <T>(promise: Promise<T>): ILazyAsync<T> =>
    new LazyAsyncImpl(() => promise);

export const createFactory = <TArgs extends readonly unknown[], TResult>(
    factory: (...args: TArgs) => TResult,
    keySelector?: (...args: TArgs) => string,
    maxCacheSize?: number
): ILazyFactory<TArgs, TResult> => new LazyFactoryImpl(factory, keySelector, maxCacheSize);

export const isLazy = <T>(value: unknown): value is ILazy<T> =>
    typeof value === 'object' && value !== null && __lazy_brand in value;

export const isLazyAsync = <T>(value: unknown): value is ILazyAsync<T> =>
    typeof value === 'object' && value !== null && __async_brand in value;

export const isLazyFactory = <TArgs extends readonly unknown[], TResult>(
    value: unknown
): value is ILazyFactory<TArgs, TResult> =>
    typeof value === 'object' && value !== null && __factory_brand in value;

export const combine = <T extends readonly ILazy<unknown>[]>(...lazies: T): ILazy<UnwrapAll<T>> => {
    const factory = () => lazies.map((lazy) => lazy.force()) as UnwrapAll<T>;
    return new LazyImpl(factory, factory);
};

export const combineAsync = <T extends readonly ILazyAsync<unknown>[]>(
    ...lazies: T
): ILazyAsync<UnwrapAll<T>> =>
    new LazyAsyncImpl(
        () => Promise.all(lazies.map((lazy) => lazy.force())) as Promise<UnwrapAll<T>>
    );

export const sequence = <T extends readonly ILazy<unknown>[]>(lazies: T): ILazy<UnwrapAll<T>> =>
    combine(...lazies) as ILazy<UnwrapAll<T>>;

export const sequenceAsync = <T extends readonly ILazyAsync<unknown>[]>(
    lazies: T
): ILazyAsync<UnwrapAll<T>> => combineAsync(...lazies) as ILazyAsync<UnwrapAll<T>>;

export const traverseSync = <T, U>(
    items: readonly T[],
    selector: (item: T, index: number) => ILazy<U>
): ILazy<readonly U[]> => {
    const factory = () => items.map((item, index) => selector(item, index).force());
    return new LazyImpl(factory, factory);
};

export const traverseAsync = <T, U>(
    items: readonly T[],
    selector: (item: T, index: number) => ILazyAsync<U>
): ILazyAsync<readonly U[]> =>
    new LazyAsyncImpl(() => Promise.all(items.map((item, index) => selector(item, index).force())));

export const race = <T extends readonly ILazyAsync<unknown>[]>(
    ...lazies: T
): ILazyAsync<ExtractLazyAsyncType<T[number]>> =>
    new LazyAsyncImpl(() => Promise.race(lazies.map((lazy) => lazy.force()))) as any;

export const all = <T extends readonly ILazyAsync<unknown>[]>(
    lazies: T
): ILazyAsync<UnwrapAll<T>> => sequenceAsync(lazies);

export const allSettled = <T extends readonly ILazyAsync<unknown>[]>(
    lazies: T
): ILazyAsync<PromiseSettledResult<ExtractLazyAsyncType<T[number]>>[]> =>
    new LazyAsyncImpl(() => Promise.allSettled(lazies.map((lazy) => lazy.force()))) as any;

export const when = <T>(condition: boolean, lazyValue: ILazy<T>): ILazy<T | undefined> => {
    const factory = () => (condition ? lazyValue.force() : undefined);
    return new LazyImpl(factory, factory);
};

export const unless = <T>(condition: boolean, lazyValue: ILazy<T>): ILazy<T | undefined> =>
    when(!condition, lazyValue);

export const tryLazy = <T>(valueFactory: () => T): ILazy<T | Error> => {
    const factory = () => {
        try {
            return valueFactory();
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    };
    return new LazyImpl(factory, factory);
};

export const tryAsync = <T>(promiseFactory: () => Promise<T>): ILazyAsync<T | Error> =>
    new LazyAsyncImpl(async () => {
        try {
            return await promiseFactory();
        } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
    });

export const memoize = <TArgs extends readonly unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
    keySelector?: (...args: TArgs) => string,
    maxCacheSize?: number
): ((...args: TArgs) => TResult) => {
    const factory = createFactory(fn, keySelector, maxCacheSize);
    return (...args: TArgs) => factory.getOrAdd(...args);
};

export const memoizeAsync = <TArgs extends readonly unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    keySelector?: (...args: TArgs) => string,
    maxCacheSize = Infinity
): ((...args: TArgs) => Promise<TResult>) => {
    const cache = new Map<string, Promise<TResult>>();
    const accessOrder: string[] = [];
    const getKey = keySelector ?? ((...args) => JSON.stringify(args));

    const evictLRU = () => {
        if (accessOrder.length > 0) {
            const oldest = accessOrder.shift()!;
            cache.delete(oldest);
        }
    };

    const updateAccess = (key: string) => {
        const index = accessOrder.indexOf(key);
        if (index !== -1) accessOrder.splice(index, 1);
        accessOrder.push(key);
    };

    return (...args: TArgs): Promise<TResult> => {
        const key = getKey(...args);

        if (cache.has(key)) {
            updateAccess(key);
            return cache.get(key)!;
        }

        if (cache.size >= maxCacheSize) evictLRU();

        const promise = fn(...args);
        cache.set(key, promise);
        accessOrder.push(key);

        return promise;
    };
};

export const delay = <T>(lazyValue: ILazy<T>, milliseconds: number): ILazyAsync<T> =>
    new LazyAsyncImpl(
        () => new Promise((resolve) => setTimeout(() => resolve(lazyValue.force()), milliseconds))
    );

export const delayAsync = <T>(lazyAsync: ILazyAsync<T>, milliseconds: number): ILazyAsync<T> =>
    new LazyAsyncImpl(
        () =>
            new Promise<T>((resolve) => {
                setTimeout(async () => {
                    resolve(await lazyAsync.force());
                }, milliseconds);
            })
    );

export const withTimeout = <T>(lazyAsync: ILazyAsync<T>, milliseconds: number): ILazyAsync<T> =>
    lazyAsync.timeout(milliseconds);

export const withRetry = <T>(
    lazyAsync: ILazyAsync<T>,
    maxAttempts: number,
    delay?: number
): ILazyAsync<T> => lazyAsync.retry(maxAttempts, delay);

export const empty = <T = never>(): ILazy<T[]> => fromValue([]);

export const emptyAsync = <T = never>(): ILazyAsync<T[]> => fromPromise(Promise.resolve([]));

export const never = <T = never>(): ILazyAsync<T> =>
    new LazyAsyncImpl(() => new Promise<T>(() => {}));
