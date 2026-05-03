import { ILazy, ILazyAsync, ILazyFactory, __factory_brand, __state_brand } from './lazy-core';
import { LazyImpl, LazyAsyncImpl } from './lazy-impl';

export class LazyFactoryImpl<TArgs extends readonly unknown[], TResult>
    implements ILazyFactory<TArgs, TResult>
{
    readonly [__factory_brand] = true as const;
    readonly [__state_brand]!: 'LazyFactoryCore';

    readonly factory: (...args: TArgs) => TResult;
    readonly cache = new Map<string, TResult>();
    readonly keySelector: (...args: TArgs) => string;
    readonly maxCacheSize: number;
    readonly accessOrder: string[] = [];

    constructor(
        factory: (...args: TArgs) => TResult,
        keySelector: (...args: TArgs) => string = (...args) => JSON.stringify(args),
        maxCacheSize = Infinity
    ) {
        this.factory = factory;
        this.keySelector = keySelector;
        this.maxCacheSize = maxCacheSize;
    }

    get cacheSize(): number {
        return this.cache.size;
    }

    create(...args: TArgs): ILazy<TResult> {
        return new LazyImpl(() => this.getOrAdd(...args));
    }

    createAsync(...args: TArgs): ILazyAsync<TResult> {
        return new LazyAsyncImpl(() => Promise.resolve(this.getOrAdd(...args)));
    }

    getOrAdd(...args: TArgs): TResult {
        const key = this.keySelector(...args);

        if (this.cache.has(key)) {
            this.updateAccessOrder(key);
            return this.cache.get(key)!;
        }

        const result = this.factory(...args);

        if (this.cache.size >= this.maxCacheSize) {
            this.evictLeastRecentlyUsed();
        }

        this.cache.set(key, result);
        this.accessOrder.push(key);

        return result;
    }

    tryGetValue(...args: TArgs): [boolean, TResult | undefined] {
        const key = this.keySelector(...args);

        if (this.cache.has(key)) {
            this.updateAccessOrder(key);
            return [true, this.cache.get(key)!];
        }

        return [false, undefined];
    }

    invalidate(...args: TArgs): boolean {
        const key = this.keySelector(...args);
        const existed = this.cache.delete(key);

        if (existed) {
            const index = this.accessOrder.indexOf(key);
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
        }

        return existed;
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder.length = 0;
    }

    private updateAccessOrder(key: string): void {
        const index = this.accessOrder.indexOf(key);
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(key);
    }

    private evictLeastRecentlyUsed(): void {
        if (this.accessOrder.length > 0) {
            const oldestKey = this.accessOrder.shift()!;
            this.cache.delete(oldestKey);
        }
    }
}
