export type { ScopeDisposer } from './singleton-core';
export * from './singleton-core';

export { SingletonImpl } from './singleton-impl';
export { AsyncSingletonImpl } from './async-singleton-impl';
export { ScopedSingletonImpl } from './scoped-singleton-impl';
export { SingletonScopeImpl, createRootScope } from './singleton-scope';
export {
    SingletonRegistryImpl,
    getGlobalRegistry,
    resetGlobalRegistry,
    resetGlobalRegistryAsync,
} from './singleton-registry';

export { SingletonError, SingletonErrorCode } from './singleton-errors';

export {
    create,
    createAsync,
    createScoped,
    createLazy,
    createLazyAsync,
    fromValue,
    fromPromise,
    createRegistered,
    createRegisteredAsync,
    isSingleton,
    isAsyncSingleton,
    isScopedSingleton,
    isAnySingleton,
    resolve,
    tryResolve,
    map,
    mapAsync,
    combine,
    combineAsync,
} from './singleton-utils';
