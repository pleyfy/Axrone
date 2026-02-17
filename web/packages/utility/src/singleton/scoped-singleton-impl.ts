import type {
    IScopedSingleton,
    ISingletonScope,
    SingletonKey,
    SingletonLifecycle,
} from './singleton-core';
import { __scoped_singleton_brand, __singleton_state_brand } from './singleton-core';
import { SingletonError } from './singleton-errors';
import { SingletonScopeImpl } from './singleton-scope';

let keyCounter = 0;

function generateKey(): SingletonKey {
    return Symbol(`scoped_singleton_${++keyCounter}`);
}

export class ScopedSingletonImpl<T> implements IScopedSingleton<T> {
    readonly [__scoped_singleton_brand] = true as const;
    readonly [__singleton_state_brand]!: 'ScopedSingletonCore';

    readonly key: SingletonKey;
    readonly lifecycle: SingletonLifecycle;
    readonly factory: (scope: ISingletonScope) => T;

    private readonly instances = new WeakMap<ISingletonScope, T>();

    constructor(
        factory: (scope: ISingletonScope) => T,
        key?: SingletonKey,
        lifecycle: SingletonLifecycle = 'scoped'
    ) {
        this.key = key ?? generateKey();
        this.factory = factory;
        this.lifecycle = lifecycle;
    }

    getInstance(scope: ISingletonScope): T {
        if (scope.isDisposed) {
            throw SingletonError.scopeDisposed(scope.id);
        }

        if (this.lifecycle === 'transient') {
            return this.factory(scope);
        }

        let instance = this.instances.get(scope);

        if (instance === undefined) {
            instance = this.factory(scope);
            this.instances.set(scope, instance);

            if (scope instanceof SingletonScopeImpl) {
                const disposer = this.createDisposer(instance);
                if (disposer) {
                    scope.set(this.key, instance, disposer);
                } else {
                    scope.set(this.key, instance);
                }
            }
        }

        return instance;
    }

    hasInstance(scope: ISingletonScope): boolean {
        if (scope.isDisposed) {
            return false;
        }
        return this.instances.has(scope);
    }

    clearInstance(scope: ISingletonScope): boolean {
        return this.instances.delete(scope);
    }

    private createDisposer(instance: T): (() => void | Promise<void>) | undefined {
        if (instance === null || instance === undefined) {
            return undefined;
        }

        if (typeof instance === 'object' && 'dispose' in instance) {
            const disposable = instance as { dispose(): void | Promise<void> };
            if (typeof disposable.dispose === 'function') {
                return () => disposable.dispose();
            }
        }

        return undefined;
    }
}
