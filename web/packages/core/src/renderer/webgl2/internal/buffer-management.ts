import type { IDisposable } from '../../../types';
import type {
    ErrorCode,
    GLBufferUsage,
    IBuffer,
    IBufferPool,
} from '../buffer';

interface PooledBuffer {
    buffer: IBuffer;
    size: number;
    lastUsed: number;
    inUse: boolean;
}

interface BufferPoolOptions {
    readonly defaultUsage: GLBufferUsage;
    readonly createBuffer: (size: number, usage: GLBufferUsage) => IBuffer;
    readonly createError: (message: string, code: ErrorCode) => Error;
}

export class BufferPool<T extends BufferSource> implements IBufferPool<T> {
    readonly #buffers: PooledBuffer[] = [];
    #isDisposed = false;

    readonly #config = {
        releaseThreshold: 30000,
        cleanupInterval: 60000,
    };

    #cleanupTimer?: ReturnType<typeof setInterval>;

    constructor(private readonly _options: BufferPoolOptions) {
        this.#startCleanupTimer();
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    public allocate = (
        size: number,
        usage: GLBufferUsage = this._options.defaultUsage
    ): IBuffer => {
        this.#throwIfDisposed();

        if (size <= 0) {
            throw this._options.createError('Buffer size must be positive', 'INVALID_VALUE');
        }

        const match = this.#findAvailableBuffer(size);
        if (match) {
            match.inUse = true;
            match.lastUsed = Date.now();
            return match.buffer;
        }

        const buffer = this._options.createBuffer(size, usage);

        this.#buffers.push({
            buffer,
            size,
            lastUsed: Date.now(),
            inUse: true,
        });

        return buffer;
    };

    public release = (buffer: IBuffer): void => {
        this.#throwIfDisposed();

        const index = this.#buffers.findIndex((item) => item.buffer === buffer);
        if (index >= 0) {
            this.#buffers[index].inUse = false;
            this.#buffers[index].lastUsed = Date.now();
        }
    };

    public acquire = (data: T, usage: GLBufferUsage = this._options.defaultUsage): IBuffer => {
        this.#throwIfDisposed();

        const dataSize =
            data instanceof ArrayBuffer || data instanceof SharedArrayBuffer
                ? data.byteLength
                : data.byteLength;

        const buffer = this.allocate(dataSize, usage);
        buffer.update(data);

        return buffer;
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        if (this.#cleanupTimer !== undefined) {
            clearInterval(this.#cleanupTimer);
            this.#cleanupTimer = undefined;
        }

        for (const item of this.#buffers) {
            if (!item.buffer.isDisposed) {
                item.buffer.dispose();
            }
        }

        this.#buffers.length = 0;
        this.#isDisposed = true;
    };

    #findAvailableBuffer = (minSize: number): PooledBuffer | undefined => {
        const exactMatch = this.#buffers.find((item) => !item.inUse && item.size === minSize);

        if (exactMatch) {
            return exactMatch;
        }

        let bestFit: PooledBuffer | undefined;
        let bestFitSize = Number.MAX_SAFE_INTEGER;

        for (const item of this.#buffers) {
            if (!item.inUse && item.size >= minSize && item.size < bestFitSize) {
                bestFit = item;
                bestFitSize = item.size;
            }
        }

        return bestFit;
    };

    #cleanupUnusedBuffers = (): void => {
        if (this.#isDisposed) return;

        const threshold = Date.now() - this.#config.releaseThreshold;
        const indicesToRemove: number[] = [];

        for (let i = 0; i < this.#buffers.length; i++) {
            const item = this.#buffers[i];

            if (item.buffer.isDisposed || (!item.inUse && item.lastUsed < threshold)) {
                if (!item.buffer.isDisposed) {
                    item.buffer.dispose();
                }
                indicesToRemove.push(i);
            }
        }

        for (let i = indicesToRemove.length - 1; i >= 0; i--) {
            this.#buffers.splice(indicesToRemove[i], 1);
        }
    };

    #startCleanupTimer = (): void => {
        this.#cleanupTimer = setInterval(
            () => this.#cleanupUnusedBuffers(),
            this.#config.cleanupInterval
        );
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw this._options.createError(
                'BufferPool has been disposed',
                'BUFFER_ALREADY_DISPOSED'
            );
        }
    };
}

export class ResourceTracker {
    readonly #resources: Set<IDisposable> = new Set();
    #isDisposed = false;

    constructor(
        private readonly _createError: (message: string, code: ErrorCode) => Error
    ) {}

    public track = <T extends IDisposable>(resource: T): T => {
        if (this.#isDisposed) {
            throw this._createError('ResourceTracker has been disposed', 'INVALID_OPERATION');
        }

        this.#resources.add(resource);
        return resource;
    };

    public untrack = <T extends IDisposable>(resource: T): T => {
        this.#resources.delete(resource);
        return resource;
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        for (const resource of this.#resources) {
            if (!resource.isDisposed) {
                try {
                    resource.dispose();
                } catch {
                    // Ignore errors during disposal so the remaining resources can still be released.
                }
            }
        }

        this.#resources.clear();
        this.#isDisposed = true;
    };
}