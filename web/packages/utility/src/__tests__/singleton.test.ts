import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
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
} from '../singleton';
import type { ISingleton, IAsyncSingleton, ISingletonScope } from '../singleton';

describe('SingletonImpl', () => {
    let singleton: ISingleton<number>;

    beforeEach(() => {
        singleton = new SingletonImpl(() => 42);
    });

    afterEach(() => {
        if (!singleton.isDisposed) {
            singleton.dispose();
        }
    });

    describe('initialization', () => {
        it('should eagerly initialize by default', () => {
            expect(singleton.isCreated).toBe(true);
            expect(singleton.instance).toBe(42);
        });

        it('should lazily initialize when lazy option is true', () => {
            const lazySingleton = new SingletonImpl(() => 100, { lazy: true });
            expect(lazySingleton.isCreated).toBe(false);
            expect(lazySingleton.getInstance()).toBe(100);
            expect(lazySingleton.isCreated).toBe(true);
            lazySingleton.dispose();
        });

        it('should only call factory once', () => {
            const factory = vi.fn(() => 'value');
            const s = new SingletonImpl(factory, { lazy: true });

            s.getInstance();
            s.getInstance();
            s.getInstance();

            expect(factory).toHaveBeenCalledTimes(1);
            s.dispose();
        });

        it('should handle factory errors', () => {
            const error = new Error('Factory failed');
            const s = new SingletonImpl(
                () => {
                    throw error;
                },
                { lazy: true }
            );

            expect(() => s.getInstance()).toThrow(SingletonError);
            expect(s.isFaulted).toBe(true);
        });
    });

    describe('getInstance', () => {
        it('should return the same instance', () => {
            const obj = { value: 1 };
            const s = new SingletonImpl(() => obj);

            expect(s.getInstance()).toBe(obj);
            expect(s.getInstance()).toBe(obj);
            s.dispose();
        });

        it('should throw when disposed', () => {
            singleton.dispose();

            expect(() => singleton.getInstance()).toThrow(SingletonError);
            expect(() => singleton.getInstance()).toThrow(/disposed/i);
        });

        it('should increment access count', () => {
            const s = new SingletonImpl(() => 1, { lazy: true });

            expect(s.metadata.accessCount).toBe(0);
            s.getInstance();
            expect(s.metadata.accessCount).toBe(1);
            s.getInstance();
            expect(s.metadata.accessCount).toBe(2);
            s.dispose();
        });
    });

    describe('tryGetInstance', () => {
        it('should return instance without throwing', () => {
            expect(singleton.tryGetInstance()).toBe(42);
        });

        it('should return null when disposed', () => {
            singleton.dispose();
            expect(singleton.tryGetInstance()).toBeNull();
        });

        it('should return null when faulted', () => {
            const s = new SingletonImpl(
                () => {
                    throw new Error('fail');
                },
                { lazy: true }
            );

            expect(s.tryGetInstance()).toBeNull();
            expect(s.isFaulted).toBe(true);
        });
    });

    describe('reset', () => {
        it('should reset to uninitialized state', () => {
            expect(singleton.isCreated).toBe(true);
            singleton.reset();
            expect(singleton.isCreated).toBe(false);
        });

        it('should allow reinitialization after reset', () => {
            let counter = 0;
            const s = new SingletonImpl(() => ++counter, { lazy: true });

            expect(s.getInstance()).toBe(1);
            s.reset();
            expect(s.getInstance()).toBe(2);
            s.dispose();
        });

        it('should throw when disposed', () => {
            singleton.dispose();
            expect(() => singleton.reset()).toThrow(SingletonError);
        });
    });

    describe('dispose', () => {
        it('should call disposer function', () => {
            const disposer = vi.fn();
            const s = new SingletonImpl(() => ({ data: 'test' }), { disposer });

            s.dispose();

            expect(disposer).toHaveBeenCalledTimes(1);
            expect(disposer).toHaveBeenCalledWith({ data: 'test' });
        });

        it('should be idempotent', () => {
            const disposer = vi.fn();
            const s = new SingletonImpl(() => 1, { disposer });

            s.dispose();
            s.dispose();
            s.dispose();

            expect(disposer).toHaveBeenCalledTimes(1);
        });

        it('should set isDisposed to true', () => {
            expect(singleton.isDisposed).toBe(false);
            singleton.dispose();
            expect(singleton.isDisposed).toBe(true);
        });
    });

    describe('disposeAsync', () => {
        it('should support async disposer', async () => {
            const disposer = vi.fn().mockResolvedValue(undefined);
            const s = new SingletonImpl(() => 'value', { disposer });

            await s.disposeAsync();

            expect(disposer).toHaveBeenCalledTimes(1);
            expect(s.isDisposed).toBe(true);
        });
    });

    describe('metadata', () => {
        it('should track creation time', () => {
            expect(singleton.metadata.createdAt).toBeGreaterThan(0);
        });

        it('should track disposal time', () => {
            expect(singleton.metadata.disposedAt).toBeNull();
            singleton.dispose();
            expect(singleton.metadata.disposedAt).toBeGreaterThan(0);
        });
    });
});

describe('AsyncSingletonImpl', () => {
    let singleton: IAsyncSingleton<number>;

    beforeEach(() => {
        singleton = new AsyncSingletonImpl(async () => 42, { lazy: true });
    });

    afterEach(async () => {
        if (!singleton.isDisposed) {
            await singleton.disposeAsync();
        }
    });

    describe('initialization', () => {
        it('should resolve async factory', async () => {
            const result = await singleton.getInstance();
            expect(result).toBe(42);
            expect(singleton.isCreated).toBe(true);
        });

        it('should only call factory once', async () => {
            const factory = vi.fn().mockResolvedValue('value');
            const s = new AsyncSingletonImpl(factory, { lazy: true });

            await Promise.all([s.getInstance(), s.getInstance(), s.getInstance()]);

            expect(factory).toHaveBeenCalledTimes(1);
            await s.disposeAsync();
        });

        it('should handle factory errors', async () => {
            const s = new AsyncSingletonImpl(
                async () => {
                    throw new Error('Async failure');
                },
                { lazy: true }
            );

            await expect(s.getInstance()).rejects.toThrow(SingletonError);
            expect(s.isFaulted).toBe(true);
        });
    });

    describe('timeout', () => {
        it('should timeout long running factory', async () => {
            const s = new AsyncSingletonImpl(
                () => new Promise((resolve) => setTimeout(() => resolve('late'), 1000)),
                { lazy: true, timeout: 50 }
            );

            await expect(s.getInstance()).rejects.toThrow(SingletonError);
            expect(s.isFaulted).toBe(true);
        });
    });

    describe('retry', () => {
        it('should retry on failure', async () => {
            let attempts = 0;
            const s = new AsyncSingletonImpl(
                async () => {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error('Not yet');
                    }
                    return 'success';
                },
                { lazy: true, retryCount: 3, retryDelay: 10 }
            );

            const result = await s.getInstance();
            expect(result).toBe('success');
            expect(attempts).toBe(3);
            await s.disposeAsync();
        });

        it('should fail after max retries', async () => {
            const s = new AsyncSingletonImpl(
                async () => {
                    throw new Error('Always fails');
                },
                { lazy: true, retryCount: 2, retryDelay: 10 }
            );

            await expect(s.getInstance()).rejects.toThrow(SingletonError);
            expect(s.isFaulted).toBe(true);
        });
    });
});

describe('ScopedSingletonImpl', () => {
    let scope: ISingletonScope;

    beforeEach(() => {
        scope = createRootScope('test');
    });

    afterEach(async () => {
        await scope.disposeAsync();
    });

    it('should create instance per scope', () => {
        let counter = 0;
        const scoped = new ScopedSingletonImpl(() => ++counter);

        const instance1 = scoped.getInstance(scope);
        const instance2 = scoped.getInstance(scope);

        expect(instance1).toBe(instance2);
        expect(counter).toBe(1);
    });

    it('should create different instances for different scopes', () => {
        let counter = 0;
        const scoped = new ScopedSingletonImpl(() => ++counter);

        const childScope = scope.createChild('child');

        const instance1 = scoped.getInstance(scope);
        const instance2 = scoped.getInstance(childScope);

        expect(instance1).not.toBe(instance2);
        expect(counter).toBe(2);
    });

    it('should create new instance each time for transient lifecycle', () => {
        let counter = 0;
        const scoped = new ScopedSingletonImpl(() => ++counter, undefined, 'transient');

        const instance1 = scoped.getInstance(scope);
        const instance2 = scoped.getInstance(scope);

        expect(instance1).not.toBe(instance2);
        expect(counter).toBe(2);
    });

    it('should throw when scope is disposed', async () => {
        const scoped = new ScopedSingletonImpl(() => 'value');
        await scope.disposeAsync();

        expect(() => scoped.getInstance(scope)).toThrow(SingletonError);
    });
});

describe('SingletonScopeImpl', () => {
    let scope: SingletonScopeImpl;

    beforeEach(() => {
        scope = new SingletonScopeImpl('test');
    });

    afterEach(async () => {
        if (!scope.isDisposed) {
            await scope.disposeAsync();
        }
    });

    describe('hierarchy', () => {
        it('should create child scopes', () => {
            const child = scope.createChild('child');

            expect(child.parent).toBe(scope);
            expect(child.name).toBe('child');
        });

        it('should inherit values from parent', () => {
            scope.set('key', 'parent-value');
            const child = scope.createChild();

            expect(child.get('key')).toBe('parent-value');
        });

        it('should shadow parent values', () => {
            scope.set('key', 'parent-value');
            const child = scope.createChild();
            child.set('key', 'child-value');

            expect(child.get('key')).toBe('child-value');
            expect(scope.get('key')).toBe('parent-value');
        });
    });

    describe('disposal', () => {
        it('should dispose children first', async () => {
            const order: string[] = [];

            const child1 = scope.createChild('child1');
            const child2 = scope.createChild('child2');

            scope.set('key1', 'value1', () => {
                order.push('parent');
            });
            child1.set('key2', 'value2', () => {
                order.push('child1');
            });
            child2.set('key3', 'value3', () => {
                order.push('child2');
            });

            await scope.disposeAsync();

            expect(child1.isDisposed).toBe(true);
            expect(child2.isDisposed).toBe(true);
            expect(order).toContain('child1');
            expect(order).toContain('child2');
            expect(order).toContain('parent');
        });

        it('should throw when accessing disposed scope', async () => {
            await scope.disposeAsync();

            expect(() => scope.get('key')).toThrow(SingletonError);
            expect(() => scope.set('key', 'value')).toThrow(SingletonError);
        });
    });
});

describe('SingletonRegistryImpl', () => {
    let registry: SingletonRegistryImpl;

    beforeEach(() => {
        registry = new SingletonRegistryImpl();
    });

    afterEach(async () => {
        await registry.clearAsync();
    });

    it('should register and retrieve singletons', () => {
        const singleton = new SingletonImpl(() => 'test', { key: 'test-key' });
        registry.register('test-key', singleton);

        expect(registry.has('test-key')).toBe(true);
        expect(registry.get('test-key')).toBe(singleton);
    });

    it('should throw when registering duplicate key', () => {
        const singleton1 = new SingletonImpl(() => 1, { key: 'dup' });
        const singleton2 = new SingletonImpl(() => 2, { key: 'dup' });

        registry.register('dup', singleton1);

        expect(() => registry.register('dup', singleton2)).toThrow(SingletonError);
    });

    it('should unregister singletons', () => {
        const singleton = new SingletonImpl(() => 'test', { key: 'test-key' });
        registry.register('test-key', singleton);

        expect(registry.unregister('test-key')).toBe(true);
        expect(registry.has('test-key')).toBe(false);
    });

    it('should dispose all singletons in reverse order', async () => {
        const order: number[] = [];

        const s1 = new SingletonImpl(() => 1, {
            key: 's1',
            disposer: () => {
                order.push(1);
            },
        });
        const s2 = new SingletonImpl(() => 2, {
            key: 's2',
            disposer: () => {
                order.push(2);
            },
        });
        const s3 = new SingletonImpl(() => 3, {
            key: 's3',
            disposer: () => {
                order.push(3);
            },
        });

        registry.register('s1', s1);
        registry.register('s2', s2);
        registry.register('s3', s3);

        await registry.clearAsync();

        expect(order).toEqual([3, 2, 1]);
    });
});

describe('Global Registry', () => {
    afterEach(async () => {
        await resetGlobalRegistryAsync();
    });

    it('should provide global registry instance', () => {
        const registry1 = getGlobalRegistry();
        const registry2 = getGlobalRegistry();

        expect(registry1).toBe(registry2);
    });

    it('should reset global registry', async () => {
        const registry = getGlobalRegistry();
        const singleton = new SingletonImpl(() => 'test', { key: 'global-test' });
        registry.register('global-test', singleton);

        await resetGlobalRegistryAsync();

        const newRegistry = getGlobalRegistry();
        expect(newRegistry).not.toBe(registry);
        expect(newRegistry.has('global-test')).toBe(false);
    });
});
