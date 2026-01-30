import type {
    ISingleton,
    IAsyncSingleton,
    IScopedSingleton,
    ISingletonScope,
    SingletonKey,
    SingletonOptions,
    AsyncSingletonOptions,
    SingletonLifecycle,
} from './singleton-core';
import {
    __singleton_brand,
    __async_singleton_brand,
    __scoped_singleton_brand,
} from './singleton-core';
import { SingletonImpl } from './singleton-impl';
import { AsyncSingletonImpl } from './async-singleton-impl';
import { ScopedSingletonImpl } from './scoped-singleton-impl';
import { getGlobalRegistry } from './singleton-registry';

export function create<T>(factory: () => T, options?: SingletonOptions<T>): ISingleton<T> {
    return new SingletonImpl(factory, options);
}

export function createAsync<T>(
    factory: () => Promise<T>,
    options?: AsyncSingletonOptions<T>
): IAsyncSingleton<T> {
    return new AsyncSingletonImpl(factory, options);
}

export function createScoped<T>(
    factory: (scope: ISingletonScope) => T,
    key?: SingletonKey,
    lifecycle?: SingletonLifecycle
): IScopedSingleton<T> {
    return new ScopedSingletonImpl(factory, key, lifecycle);
}

export function createLazy<T>(factory: () => T, options?: Omit<SingletonOptions<T>, 'lazy'>): ISingleton<T> {
    return new SingletonImpl(factory, { ...options, lazy: true });
}

export function createLazyAsync<T>(
    factory: () => Promise<T>,
    options?: Omit<AsyncSingletonOptions<T>, 'lazy'>
): IAsyncSingleton<T> {
    return new AsyncSingletonImpl(factory, { ...options, lazy: true });
}

export function fromValue<T>(value: T, key?: SingletonKey): ISingleton<T> {
    const singleton = new SingletonImpl(() => value, { key, lazy: false });
    return singleton;
}

export function fromPromise<T>(promise: Promise<T>, key?: SingletonKey): IAsyncSingleton<T> {
    return new AsyncSingletonImpl(() => promise, { key, lazy: false });
}

export function createRegistered<T>(
    key: SingletonKey,
    factory: () => T,
    options?: Omit<SingletonOptions<T>, 'key'>
): ISingleton<T> {
    const singleton = new SingletonImpl(factory, { ...options, key });
    getGlobalRegistry().register(key, singleton);
    return singleton;
}

export function createRegisteredAsync<T>(
    key: SingletonKey,
    factory: () => Promise<T>,
    options?: Omit<AsyncSingletonOptions<T>, 'key'>
): IAsyncSingleton<T> {
    const singleton = new AsyncSingletonImpl(factory, { ...options, key });
    getGlobalRegistry().register(key, singleton);
    return singleton;
}

export function isSingleton<T = unknown>(value: unknown): value is ISingleton<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        __singleton_brand in value &&
        value[__singleton_brand] === true
    );
}

export function isAsyncSingleton<T = unknown>(value: unknown): value is IAsyncSingleton<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        __async_singleton_brand in value &&
        value[__async_singleton_brand] === true
    );
}

export function isScopedSingleton<T = unknown>(value: unknown): value is IScopedSingleton<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        __scoped_singleton_brand in value &&
        value[__scoped_singleton_brand] === true
    );
}

export function isAnySingleton<T = unknown>(
    value: unknown
): value is ISingleton<T> | IAsyncSingleton<T> | IScopedSingleton<T> {
    return isSingleton(value) || isAsyncSingleton(value) || isScopedSingleton(value);
}

export function resolve<T>(singleton: ISingleton<T>): T;
export function resolve<T>(singleton: IAsyncSingleton<T>): Promise<T>;
export function resolve<T>(singleton: ISingleton<T> | IAsyncSingleton<T>): T | Promise<T> {
    if (isSingleton(singleton)) {
        return singleton.getInstance();
    }
    return singleton.getInstance();
}

export function tryResolve<T>(singleton: ISingleton<T>): T | null;
export function tryResolve<T>(singleton: IAsyncSingleton<T>): Promise<T | null>;
export function tryResolve<T>(
    singleton: ISingleton<T> | IAsyncSingleton<T>
): T | null | Promise<T | null> {
    if (isSingleton(singleton)) {
        return singleton.tryGetInstance();
    }
    return singleton.tryGetInstance();
}

export function map<T, U>(
    singleton: ISingleton<T>,
    mapper: (value: T) => U,
    options?: SingletonOptions<U>
): ISingleton<U> {
    return new SingletonImpl(() => mapper(singleton.getInstance()), { ...options, lazy: true });
}

export function mapAsync<T, U>(
    singleton: IAsyncSingleton<T>,
    mapper: (value: T) => U | Promise<U>,
    options?: AsyncSingletonOptions<U>
): IAsyncSingleton<U> {
    return new AsyncSingletonImpl(
        async () => {
            const value = await singleton.getInstance();
            return mapper(value);
        },
        { ...options, lazy: true }
    );
}

export function combine<T extends readonly unknown[]>(
    ...singletons: { [K in keyof T]: ISingleton<T[K]> }
): ISingleton<T> {
    return new SingletonImpl(
        () => singletons.map(s => s.getInstance()) as unknown as T,
        { lazy: true }
    );
}

export function combineAsync<T extends readonly unknown[]>(
    ...singletons: { [K in keyof T]: IAsyncSingleton<T[K]> }
): IAsyncSingleton<T> {
    return new AsyncSingletonImpl(
        async () => {
            const results = await Promise.all(singletons.map(s => s.getInstance()));
            return results as unknown as T;
        },
        { lazy: true }
    );
}
