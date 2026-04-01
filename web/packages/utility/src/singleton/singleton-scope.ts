import type { ISingletonScope, SingletonKey, ScopeDisposer } from './singleton-core';
import { SingletonError } from './singleton-errors';

let scopeIdCounter = 0;

function generateScopeId(): string {
    return `scope_${++scopeIdCounter}_${Date.now().toString(36)}`;
}

export class SingletonScopeImpl implements ISingletonScope {
    readonly id: string;
    readonly name: string;
    readonly parent: ISingletonScope | null;

    private readonly instances = new Map<SingletonKey, unknown>();
    private readonly children = new Set<SingletonScopeImpl>();
    private readonly disposers = new Map<SingletonKey, () => void | Promise<void>>();
    private disposed = false;

    constructor(name?: string, parent?: ISingletonScope) {
        this.id = generateScopeId();
        this.name = name ?? this.id;
        this.parent = parent ?? null;

        if (parent instanceof SingletonScopeImpl) {
            parent.children.add(this);
        }
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    createChild(name?: string): ISingletonScope {
        this.ensureNotDisposed();
        return new SingletonScopeImpl(name, this);
    }

    get<T>(key: SingletonKey): T | undefined {
        this.ensureNotDisposed();

        const value = this.instances.get(key);
        if (value !== undefined) {
            return value as T;
        }

        return this.parent?.get<T>(key);
    }

    set<T>(key: SingletonKey, value: T, disposer?: ScopeDisposer): void {
        this.ensureNotDisposed();
        this.instances.set(key, value);

        if (disposer) {
            this.disposers.set(key, disposer);
        }
    }

    has(key: SingletonKey): boolean {
        this.ensureNotDisposed();
        return this.instances.has(key) || (this.parent?.has(key) ?? false);
    }

    delete(key: SingletonKey): boolean {
        this.ensureNotDisposed();
        this.disposers.delete(key);
        return this.instances.delete(key);
    }

    clear(): void {
        this.ensureNotDisposed();
        this.instances.clear();
        this.disposers.clear();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        for (const child of this.children) {
            child.dispose();
        }
        this.children.clear();

        for (const [key, disposer] of this.disposers) {
            try {
                const result = disposer();
                if (result instanceof Promise) {
                    throw SingletonError.invalidOperation(
                        `Disposer for key '${String(key)}' returned a Promise. Use disposeAsync() instead.`
                    );
                }
            } catch (error) {
                if (error instanceof SingletonError) {
                    throw error;
                }
            }
        }

        this.instances.clear();
        this.disposers.clear();

        if (this.parent instanceof SingletonScopeImpl) {
            this.parent.children.delete(this);
        }
    }

    async disposeAsync(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        const errors: Error[] = [];

        const childDisposePromises = Array.from(this.children).map((child) =>
            child.disposeAsync().catch((e) => errors.push(e))
        );
        await Promise.all(childDisposePromises);
        this.children.clear();

        const disposerEntries = Array.from(this.disposers.entries()).reverse();
        for (const [key, disposer] of disposerEntries) {
            try {
                await disposer();
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
        }

        this.instances.clear();
        this.disposers.clear();

        if (this.parent instanceof SingletonScopeImpl) {
            this.parent.children.delete(this);
        }

        if (errors.length > 0) {
            throw new AggregateError(errors, `Failed to dispose scope '${this.name}'`);
        }
    }

    private ensureNotDisposed(): void {
        if (this.disposed) {
            throw SingletonError.scopeDisposed(this.id);
        }
    }
}

export function createRootScope(name?: string): ISingletonScope {
    return new SingletonScopeImpl(name ?? 'root');
}
