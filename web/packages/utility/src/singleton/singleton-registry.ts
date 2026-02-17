import type {
    ISingletonRegistry,
    ISingleton,
    IAsyncSingleton,
    SingletonKey,
} from './singleton-core';
import { SingletonError } from './singleton-errors';

export class SingletonRegistryImpl implements ISingletonRegistry {
    private readonly singletons = new Map<SingletonKey, ISingleton<unknown> | IAsyncSingleton<unknown>>();
    private readonly registrationOrder: SingletonKey[] = [];

    get size(): number {
        return this.singletons.size;
    }

    get keys(): IterableIterator<SingletonKey> {
        return this.singletons.keys();
    }

    register<T>(key: SingletonKey, singleton: ISingleton<T> | IAsyncSingleton<T>): void {
        if (this.singletons.has(key)) {
            throw SingletonError.alreadyRegistered(key);
        }
        this.singletons.set(key, singleton as ISingleton<unknown> | IAsyncSingleton<unknown>);
        this.registrationOrder.push(key);
    }

    unregister(key: SingletonKey): boolean {
        const removed = this.singletons.delete(key);
        if (removed) {
            const index = this.registrationOrder.indexOf(key);
            if (index !== -1) {
                this.registrationOrder.splice(index, 1);
            }
        }
        return removed;
    }

    get<T>(key: SingletonKey): ISingleton<T> | IAsyncSingleton<T> | undefined {
        return this.singletons.get(key) as ISingleton<T> | IAsyncSingleton<T> | undefined;
    }

    has(key: SingletonKey): boolean {
        return this.singletons.has(key);
    }

    clear(): void {
        for (let i = this.registrationOrder.length - 1; i >= 0; i--) {
            const key = this.registrationOrder[i]!;
            const singleton = this.singletons.get(key);
            if (singleton && !singleton.isDisposed) {
                singleton.dispose();
            }
        }
        this.singletons.clear();
        this.registrationOrder.length = 0;
    }

    async clearAsync(): Promise<void> {
        const errors: Error[] = [];

        for (let i = this.registrationOrder.length - 1; i >= 0; i--) {
            const key = this.registrationOrder[i]!;
            const singleton = this.singletons.get(key);
            if (singleton && !singleton.isDisposed) {
                try {
                    await singleton.disposeAsync();
                } catch (error) {
                    errors.push(error instanceof Error ? error : new Error(String(error)));
                }
            }
        }

        this.singletons.clear();
        this.registrationOrder.length = 0;

        if (errors.length > 0) {
            throw new AggregateError(errors, 'Failed to dispose some singletons');
        }
    }

    dispose(key: SingletonKey): void {
        const singleton = this.singletons.get(key);
        if (!singleton) {
            throw SingletonError.notFound(key);
        }
        singleton.dispose();
        this.unregister(key);
    }

    async disposeAsync(key: SingletonKey): Promise<void> {
        const singleton = this.singletons.get(key);
        if (!singleton) {
            throw SingletonError.notFound(key);
        }
        await singleton.disposeAsync();
        this.unregister(key);
    }

    disposeAll(): void {
        this.clear();
    }

    async disposeAllAsync(): Promise<void> {
        await this.clearAsync();
    }
}

let globalRegistry: SingletonRegistryImpl | null = null;

export function getGlobalRegistry(): ISingletonRegistry {
    if (!globalRegistry) {
        globalRegistry = new SingletonRegistryImpl();
    }
    return globalRegistry;
}

export function resetGlobalRegistry(): void {
    if (globalRegistry) {
        globalRegistry.clear();
        globalRegistry = null;
    }
}

export async function resetGlobalRegistryAsync(): Promise<void> {
    if (globalRegistry) {
        await globalRegistry.clearAsync();
        globalRegistry = null;
    }
}
