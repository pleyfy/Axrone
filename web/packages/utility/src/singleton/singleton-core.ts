export const __singleton_brand: unique symbol = Symbol('__singleton_brand');
export const __async_singleton_brand: unique symbol = Symbol('__async_singleton_brand');
export const __scoped_singleton_brand: unique symbol = Symbol('__scoped_singleton_brand');
export const __singleton_state_brand: unique symbol = Symbol('__singleton_state_brand');

export type Nominal<T, K> = T & { readonly [__singleton_state_brand]: K };

export type SingletonState = 'uninitialized' | 'initializing' | 'resolved' | 'disposing' | 'disposed' | 'faulted';

export type SingletonLifecycle = 'application' | 'scoped' | 'transient';

export type SingletonKey = string | symbol;

export interface ISingletonMetadata<T> {
    readonly state: SingletonState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    readonly createdAt: number | null;
    readonly disposedAt: number | null;
    readonly accessCount: number;
    value: T;
    factory: (() => T) | null;
}

export interface IAsyncSingletonMetadata<T> {
    readonly state: SingletonState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    readonly createdAt: number | null;
    readonly disposedAt: number | null;
    readonly accessCount: number;
    value: T;
    factory: (() => Promise<T>) | null;
    promise: Promise<T> | null;
}

export interface IScopedSingletonMetadata<T> {
    readonly lifecycle: SingletonLifecycle;
    readonly factory: (scope: ISingletonScope) => T;
}

export type SingletonCore<T> = Nominal<ISingletonMetadata<T>, 'SingletonCore'>;
export type AsyncSingletonCore<T> = Nominal<IAsyncSingletonMetadata<T>, 'AsyncSingletonCore'>;
export type ScopedSingletonCore<T> = Nominal<IScopedSingletonMetadata<T>, 'ScopedSingletonCore'>;

export interface ISingleton<T> extends SingletonCore<T> {
    readonly [__singleton_brand]: true;
    readonly key: SingletonKey;
    readonly instance: T;
    readonly isCreated: boolean;
    readonly isFaulted: boolean;
    readonly isDisposed: boolean;
    readonly metadata: Readonly<ISingletonMetadata<T>>;

    getInstance(): T;
    tryGetInstance(): T | null;
    reset(): void;
    dispose(): void;
    disposeAsync(): Promise<void>;
}

export interface IAsyncSingleton<T> {
    readonly [__async_singleton_brand]: true;
    readonly [__singleton_state_brand]: 'AsyncSingletonCore';
    readonly key: SingletonKey;
    readonly state: SingletonState;
    readonly hasValue: boolean;
    readonly exception: Error | null;
    readonly createdAt: number | null;
    readonly disposedAt: number | null;
    readonly accessCount: number;
    value: T;
    factory: (() => Promise<T>) | null;
    promise: Promise<T> | null;

    readonly isCreated: boolean;
    readonly isFaulted: boolean;
    readonly isDisposed: boolean;
    readonly metadata: Readonly<IAsyncSingletonMetadata<T>>;

    getInstance(): Promise<T>;
    tryGetInstance(): Promise<T | null>;
    reset(): void;
    dispose(): void;
    disposeAsync(): Promise<void>;
}

export interface IScopedSingleton<T> {
    readonly [__scoped_singleton_brand]: true;
    readonly [__singleton_state_brand]: 'ScopedSingletonCore';
    readonly key: SingletonKey;
    readonly lifecycle: SingletonLifecycle;
    readonly factory: (scope: ISingletonScope) => T;

    getInstance(scope: ISingletonScope): T;
    hasInstance(scope: ISingletonScope): boolean;
    clearInstance(scope: ISingletonScope): boolean;
}

export type ScopeDisposer = () => void | Promise<void>;

export interface ISingletonScope {
    readonly id: string;
    readonly name: string;
    readonly parent: ISingletonScope | null;
    readonly isDisposed: boolean;

    createChild(name?: string): ISingletonScope;
    get<T>(key: SingletonKey): T | undefined;
    set<T>(key: SingletonKey, value: T, disposer?: ScopeDisposer): void;
    has(key: SingletonKey): boolean;
    delete(key: SingletonKey): boolean;
    clear(): void;
    dispose(): void;
    disposeAsync(): Promise<void>;
}

export interface ISingletonRegistry {
    readonly size: number;
    readonly keys: IterableIterator<SingletonKey>;

    register<T>(key: SingletonKey, singleton: ISingleton<T> | IAsyncSingleton<T>): void;
    unregister(key: SingletonKey): boolean;
    get<T>(key: SingletonKey): ISingleton<T> | IAsyncSingleton<T> | undefined;
    has(key: SingletonKey): boolean;
    clear(): void;
    clearAsync(): Promise<void>;
    dispose(key: SingletonKey): void;
    disposeAsync(key: SingletonKey): Promise<void>;
    disposeAll(): void;
    disposeAllAsync(): Promise<void>;
}

export type SingletonDisposer<T> = (instance: T) => void | Promise<void>;

export interface SingletonOptions<T> {
    readonly key?: SingletonKey;
    readonly lazy?: boolean;
    readonly disposer?: SingletonDisposer<T>;
    readonly lifecycle?: SingletonLifecycle;
}

export interface AsyncSingletonOptions<T> extends SingletonOptions<T> {
    readonly timeout?: number;
    readonly retryCount?: number;
    readonly retryDelay?: number;
}

export type ExtractSingletonType<T> = T extends ISingleton<infer U>
    ? U
    : T extends IAsyncSingleton<infer V>
      ? V
      : T extends IScopedSingleton<infer W>
        ? W
        : never;

export type IsSingletonType<T> = T extends ISingleton<unknown> ? true : false;
export type IsAsyncSingletonType<T> = T extends IAsyncSingleton<unknown> ? true : false;
export type IsScopedSingletonType<T> = T extends IScopedSingleton<unknown> ? true : false;

export type Constructor<T = unknown> = new (...args: any[]) => T;
export type AbstractConstructor<T = unknown> = abstract new (...args: any[]) => T;
