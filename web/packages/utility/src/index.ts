export type { Primitive, TypedArray, TypedArrayConstructor, Builtin, BuiltinObject } from './types';

export type {
    CompareResult,
    Comparable,
    OrderKey,
    Comparer,
    EqualityComparer,
    Equatable,
    KeySelector,
    PropertyPath,
    ExtractPropertyType,
    ComparerOptions,
    EqualityComparerOptions,
    DeepPartial,
    KeysOfType,
} from './comparer/comparer';

export {
    DefaultComparer,
    DefaultEqualityComparer,
    ReverseComparer,
    CompositeComparer,
    KeyComparer,
    StringComparer,
    NumberComparer,
    DateComparer,
    DeepEqualityComparer,
    ComparerError,
    InvalidOperationError,
    comparer,
    equality,
    createOrderKey,
    createPropertyAccessor,
    sorted,
    min,
    max,
    isEquatable,
    isComparer,
    isEqualityComparer,
} from './comparer/comparer';

export { Queue, PriorityQueue } from './memory/containers/queue';
export type {
    QueueOptions,
    Comparator,
    HeapIndex,
    QueueSize,
    Capacity,
    ReadonlyQueueNode,
    QueueNode,
    PriorityQueueOptions,
    PriorityQueueCore,
    OptionalOperations,
    QueryOperations,
    CapacityOperations,
} from './memory/containers/queue';

export type {
    PoolableObject,
    PoolObjectStatus,
    PoolExpansionStrategy,
    PoolAllocationStrategy,
    PoolEvictionPolicy,
    MemoryPoolOptions,
    PoolPerformanceMetrics,
    MemoryPoolOperations,
    AsyncMemoryPoolOperations,
} from './memory/pool/mempool';

export type { ICloneable } from './clone/cloner';

export * from './memory/buffering';
export * from './memory/pool/index';

export type {
    SingletonKey,
    SingletonState,
    SingletonLifecycle,
    ISingleton,
    IAsyncSingleton,
    IScopedSingleton,
    ISingletonScope,
    ISingletonRegistry,
    ISingletonMetadata,
    IAsyncSingletonMetadata,
    IScopedSingletonMetadata,
    SingletonOptions,
    AsyncSingletonOptions,
    SingletonDisposer,
    ScopeDisposer,
    ExtractSingletonType,
    Constructor,
    AbstractConstructor,
} from './singleton';

export {
    SingletonImpl,
    AsyncSingletonImpl,
    ScopedSingletonImpl,
    SingletonScopeImpl,
    SingletonRegistryImpl,
    SingletonError,
    SingletonErrorCode,
    createRootScope,
    getGlobalRegistry,
    resetGlobalRegistry,
    resetGlobalRegistryAsync,
    create as createSingleton,
    createAsync as createAsyncSingleton,
    createScoped as createScopedSingleton,
    createLazy as createLazySingleton,
    createLazyAsync as createLazyAsyncSingleton,
    fromValue as singletonFromValue,
    fromPromise as singletonFromPromise,
    createRegistered as createRegisteredSingleton,
    createRegisteredAsync as createRegisteredAsyncSingleton,
    isSingleton,
    isAsyncSingleton,
    isScopedSingleton,
    isAnySingleton,
    resolve as resolveSingleton,
    tryResolve as tryResolveSingleton,
    map as mapSingleton,
    mapAsync as mapAsyncSingleton,
    combine as combineSingletons,
    combineAsync as combineAsyncSingletons,
} from './singleton';
