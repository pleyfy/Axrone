import type {
    IAsyncSingleton,
    IAsyncSingletonMetadata,
    SingletonKey,
    SingletonState,
    AsyncSingletonOptions,
    SingletonDisposer,
} from './singleton-core';
import { __async_singleton_brand, __singleton_state_brand } from './singleton-core';
import { SingletonError } from './singleton-errors';

const UNINITIALIZED: SingletonState = 'uninitialized';
const INITIALIZING: SingletonState = 'initializing';
const RESOLVED: SingletonState = 'resolved';
const DISPOSING: SingletonState = 'disposing';
const DISPOSED: SingletonState = 'disposed';
const FAULTED: SingletonState = 'faulted';

let keyCounter = 0;

function generateKey(): SingletonKey {
    return Symbol(`async_singleton_${++keyCounter}`);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, key: SingletonKey): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(SingletonError.timeout(key, ms));
        }, ms);

        promise
            .then(value => {
                clearTimeout(timeoutId);
                resolve(value);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

export class AsyncSingletonImpl<T> implements IAsyncSingleton<T> {
    readonly [__async_singleton_brand] = true as const;
    readonly [__singleton_state_brand]!: 'AsyncSingletonCore';

    readonly key: SingletonKey;

    state: SingletonState = UNINITIALIZED;
    hasValue = false;
    exception: Error | null = null;
    createdAt: number | null = null;
    disposedAt: number | null = null;
    accessCount = 0;
    value!: T;
    factory: (() => Promise<T>) | null;
    promise: Promise<T> | null = null;

    private readonly originalFactory: () => Promise<T>;
    private readonly disposer: SingletonDisposer<T> | null;
    private readonly timeout: number | null;
    private readonly retryCount: number;
    private readonly retryDelay: number;
    private disposePromise: Promise<void> | null = null;

    constructor(factory: () => Promise<T>, options: AsyncSingletonOptions<T> = {}) {
        this.key = options.key ?? generateKey();
        this.factory = factory;
        this.originalFactory = factory;
        this.disposer = options.disposer ?? null;
        this.timeout = options.timeout ?? null;
        this.retryCount = options.retryCount ?? 0;
        this.retryDelay = options.retryDelay ?? 1000;

        if (options.lazy !== true) {
            this.promise = this.initialize();
        }
    }

    get isCreated(): boolean {
        return this.hasValue;
    }

    get isFaulted(): boolean {
        return this.state === FAULTED;
    }

    get isDisposed(): boolean {
        return this.state === DISPOSED;
    }

    get metadata(): Readonly<IAsyncSingletonMetadata<T>> {
        return {
            state: this.state,
            hasValue: this.hasValue,
            exception: this.exception,
            createdAt: this.createdAt,
            disposedAt: this.disposedAt,
            accessCount: this.accessCount,
            value: this.value,
            factory: this.factory,
            promise: this.promise,
        };
    }

    async getInstance(): Promise<T> {
        if (this.state === DISPOSED) {
            throw SingletonError.disposed(this.key);
        }

        if (this.state === FAULTED) {
            throw this.exception ?? SingletonError.initializationFailed(this.key);
        }

        if (this.hasValue) {
            this.accessCount++;
            return this.value;
        }

        if (this.promise) {
            const result = await this.promise;
            this.accessCount++;
            return result;
        }

        this.promise = this.initialize();
        const result = await this.promise;
        this.accessCount++;
        return result;
    }

    async tryGetInstance(): Promise<T | null> {
        if (this.state === DISPOSED || this.state === FAULTED) {
            return null;
        }

        try {
            return await this.getInstance();
        } catch {
            return null;
        }
    }

    reset(): void {
        if (this.state === DISPOSED) {
            throw SingletonError.disposed(this.key);
        }

        if (this.state === DISPOSING) {
            throw SingletonError.invalidOperation('Cannot reset while disposing', this.key);
        }

        if (this.state === INITIALIZING) {
            throw SingletonError.invalidOperation('Cannot reset while initializing', this.key);
        }

        this.value = undefined as T;
        this.hasValue = false;
        this.exception = null;
        this.createdAt = null;
        this.accessCount = 0;
        this.state = UNINITIALIZED;
        this.factory = this.originalFactory;
        this.promise = null;
    }

    dispose(): void {
        if (this.state === DISPOSED) {
            return;
        }

        if (this.state === DISPOSING) {
            return;
        }

        if (this.state === INITIALIZING) {
            throw SingletonError.invalidOperation('Cannot dispose while initializing', this.key);
        }

        this.state = DISPOSING;

        if (this.hasValue && this.disposer) {
            const result = this.disposer(this.value);
            if (result instanceof Promise) {
                throw SingletonError.invalidOperation(
                    'Disposer returned a Promise. Use disposeAsync() instead.',
                    this.key
                );
            }
        }

        this.finalizeDispose();
    }

    async disposeAsync(): Promise<void> {
        if (this.state === DISPOSED) {
            return;
        }

        if (this.disposePromise) {
            return this.disposePromise;
        }

        if (this.state === DISPOSING) {
            return;
        }

        if (this.state === INITIALIZING && this.promise) {
            try {
                await this.promise;
            } catch {
                // Ignore initialization errors during dispose
            }
        }

        this.state = DISPOSING;

        this.disposePromise = this.performAsyncDispose();
        return this.disposePromise;
    }

    private async performAsyncDispose(): Promise<void> {
        try {
            if (this.hasValue && this.disposer) {
                await this.disposer(this.value);
            }
        } catch (error) {
            this.state = RESOLVED;
            this.disposePromise = null;
            throw SingletonError.disposeFailed(
                this.key,
                error instanceof Error ? error : new Error(String(error))
            );
        }

        this.finalizeDispose();
        this.disposePromise = null;
    }

    private finalizeDispose(): void {
        this.value = undefined as T;
        this.hasValue = false;
        this.factory = null;
        this.promise = null;
        this.state = DISPOSED;
        this.disposedAt = Date.now();
    }

    private async initialize(): Promise<T> {
        if (this.hasValue) {
            return this.value;
        }

        if (this.state === DISPOSED) {
            throw SingletonError.disposed(this.key);
        }

        this.state = INITIALIZING;

        let lastError: Error | null = null;
        const maxAttempts = this.retryCount + 1;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                let valuePromise = this.factory!();

                if (this.timeout !== null) {
                    valuePromise = withTimeout(valuePromise, this.timeout, this.key);
                }

                this.value = await valuePromise;
                this.hasValue = true;
                this.createdAt = Date.now();
                this.state = RESOLVED;
                this.factory = null;
                return this.value;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < maxAttempts - 1) {
                    await delay(this.retryDelay * Math.pow(2, attempt));
                }
            }
        }

        this.exception = lastError;
        this.state = FAULTED;
        this.promise = null;

        if (this.retryCount > 0) {
            throw SingletonError.maxRetriesExceeded(this.key, this.retryCount, lastError!);
        }

        throw SingletonError.initializationFailed(this.key, lastError!);
    }
}
