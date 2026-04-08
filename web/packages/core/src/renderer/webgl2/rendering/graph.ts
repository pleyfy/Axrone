import type {
    ReadonlyRenderResourceRegistry,
    RenderResourceAllocator,
    RenderResourceLifetime,
    RenderResourceName,
    RenderResourceUsage,
    RenderTextureDescriptor,
    RenderTextureResourceSnapshot,
} from './types';
import { RenderResourceError, RenderValidationError } from './errors';

interface TextureRecord<TNative> {
    id: RenderResourceName;
    descriptor: Readonly<RenderTextureDescriptor>;
    lifetime: RenderResourceLifetime;
    native: TNative | null;
    version: number;
    reused: boolean;
    lastFrameUsed: number;
    signature: string;
}

const normalizeDescriptor = (
    descriptor: Readonly<RenderTextureDescriptor>
): Readonly<RenderTextureDescriptor> => {
    if (!Number.isFinite(descriptor.width) || descriptor.width <= 0) {
        throw new RenderValidationError('INVALID_ARGUMENT', 'en', {
            field: 'width',
            value: descriptor.width,
        });
    }

    if (!Number.isFinite(descriptor.height) || descriptor.height <= 0) {
        throw new RenderValidationError('INVALID_ARGUMENT', 'en', {
            field: 'height',
            value: descriptor.height,
        });
    }

    const usage: RenderResourceUsage[] =
        descriptor.usage.length > 0 ? [...descriptor.usage] : ['sampled'];

    return Object.freeze({
        width: Math.max(1, Math.floor(descriptor.width)),
        height: Math.max(1, Math.floor(descriptor.height)),
        depth: Math.max(1, Math.floor(descriptor.depth ?? 1)),
        format: descriptor.format,
        mipLevels: Math.max(1, Math.floor(descriptor.mipLevels ?? 1)),
        samples: descriptor.samples ?? 1,
        usage,
        cube: descriptor.cube ?? false,
        arrayLayers: Math.max(1, Math.floor(descriptor.arrayLayers ?? 1)),
    });
};

const descriptorSignature = (descriptor: Readonly<RenderTextureDescriptor>): string =>
    [
        descriptor.width,
        descriptor.height,
        descriptor.depth ?? 1,
        descriptor.format,
        descriptor.mipLevels ?? 1,
        descriptor.samples ?? 1,
        descriptor.cube ? 1 : 0,
        descriptor.arrayLayers ?? 1,
        descriptor.usage.join(','),
    ].join('|');

const snapshotRecord = <TNative>(
    record: Readonly<TextureRecord<TNative>>
): RenderTextureResourceSnapshot<TNative> => ({
    id: record.id,
    descriptor: record.descriptor,
    lifetime: record.lifetime,
    native: record.native,
    version: record.version,
    reused: record.reused,
    lastFrameUsed: record.lastFrameUsed,
});

export class RenderTextureRegistry<TNative = unknown>
    implements ReadonlyRenderResourceRegistry<TNative>
{
    private readonly _allocator: RenderResourceAllocator<TNative> | null;
    private readonly _active = new Map<RenderResourceName, TextureRecord<TNative>>();
    private readonly _persistent = new Map<RenderResourceName, TextureRecord<TNative>>();
    private readonly _freeTransient = new Map<string, TextureRecord<TNative>[]>();
    private readonly _frameResources: TextureRecord<TNative>[] = [];
    private readonly _resourcePoolCapacity: number;
    private _frame = 0;
    private _reuseCount = 0;
    private _disposed = false;

    constructor(options: {
        readonly allocator?: RenderResourceAllocator<TNative>;
        readonly resourcePoolCapacity?: number;
    } = {}) {
        this._allocator = options.allocator ?? null;
        this._resourcePoolCapacity = Math.max(16, options.resourcePoolCapacity ?? 256);
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get reuseCount(): number {
        return this._reuseCount;
    }

    beginFrame(frame: number): void {
        if (this._disposed) {
            throw new RenderValidationError('INVALID_ARGUMENT', 'en', {
                reason: 'registry-disposed',
            });
        }

        this._frame = frame;
        this._reuseCount = 0;
        this._frameResources.length = 0;
    }

    acquireTexture(
        id: RenderResourceName,
        descriptor: Readonly<RenderTextureDescriptor>,
        lifetime: RenderResourceLifetime
    ): RenderTextureResourceSnapshot<TNative> {
        if (this._disposed) {
            throw new RenderValidationError('INVALID_ARGUMENT', 'en', {
                reason: 'registry-disposed',
            });
        }

        const normalized = normalizeDescriptor(descriptor);
        const signature = descriptorSignature(normalized);

        if (lifetime === 'transient') {
            const current = this._active.get(id);
            if (current) {
                if (current.signature !== signature) {
                    throw new RenderResourceError('RESOURCE_CONFLICT', 'en', {
                        id,
                        existing: current.descriptor,
                        incoming: normalized,
                    });
                }
                current.lastFrameUsed = this._frame;
                this._frameResources.push(current);
                return snapshotRecord(current);
            }

            const freeBucket = this._freeTransient.get(signature);
            const reused = freeBucket?.pop() ?? null;
            const record = reused
                ? this._hydrateReusedRecord(id, reused, normalized)
                : this._createRecord(id, normalized, lifetime, false);
            this._active.set(id, record);
            this._frameResources.push(record);
            return snapshotRecord(record);
        }

        const persistent = this._persistent.get(id);
        if (!persistent) {
            const created = this._createRecord(id, normalized, lifetime, false);
            this._persistent.set(id, created);
            this._frameResources.push(created);
            return snapshotRecord(created);
        }

        if (persistent.signature !== signature) {
            persistent.descriptor = normalized;
            persistent.signature = signature;
            persistent.version += 1;
            persistent.reused = false;
            persistent.native = this._allocator
                ? this._allocator.createTexture(normalized, persistent.native)
                : persistent.native;
        } else {
            persistent.reused = true;
            this._reuseCount += 1;
        }

        persistent.lastFrameUsed = this._frame;
        this._frameResources.push(persistent);
        return snapshotRecord(persistent);
    }

    endFrame(): void {
        if (this._disposed) {
            return;
        }

        for (const [id, record] of this._active) {
            this._active.delete(id);
            const bucket = this._freeTransient.get(record.signature) ?? [];
            if (bucket.length < this._resourcePoolCapacity) {
                bucket.push(record);
                this._freeTransient.set(record.signature, bucket);
            } else if (record.native && this._allocator?.destroyTexture) {
                this._allocator.destroyTexture(record.native, record.descriptor);
            }
        }
    }

    hasTexture(id: RenderResourceName): boolean {
        return this._active.has(id) || this._persistent.has(id);
    }

    getTexture(id: RenderResourceName): RenderTextureResourceSnapshot<TNative> | null {
        const record = this._active.get(id) ?? this._persistent.get(id);
        return record ? snapshotRecord(record) : null;
    }

    listTextures(): readonly RenderTextureResourceSnapshot<TNative>[] {
        return this._frameResources.map(snapshotRecord);
    }

    releasePersistent(id: RenderResourceName): boolean {
        const record = this._persistent.get(id);
        if (!record) {
            return false;
        }

        if (record.native && this._allocator?.destroyTexture) {
            this._allocator.destroyTexture(record.native, record.descriptor);
        }

        this._persistent.delete(id);
        return true;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        for (const record of this._active.values()) {
            if (record.native && this._allocator?.destroyTexture) {
                this._allocator.destroyTexture(record.native, record.descriptor);
            }
        }

        for (const record of this._persistent.values()) {
            if (record.native && this._allocator?.destroyTexture) {
                this._allocator.destroyTexture(record.native, record.descriptor);
            }
        }

        for (const bucket of this._freeTransient.values()) {
            for (const record of bucket) {
                if (record.native && this._allocator?.destroyTexture) {
                    this._allocator.destroyTexture(record.native, record.descriptor);
                }
            }
        }

        this._active.clear();
        this._persistent.clear();
        this._freeTransient.clear();
        this._frameResources.length = 0;
        this._disposed = true;
    }

    private _createRecord(
        id: RenderResourceName,
        descriptor: Readonly<RenderTextureDescriptor>,
        lifetime: RenderResourceLifetime,
        reused: boolean
    ): TextureRecord<TNative> {
        const native = this._allocator ? this._allocator.createTexture(descriptor) : null;
        if (reused) {
            this._reuseCount += 1;
        }

        return {
            id,
            descriptor,
            lifetime,
            native,
            version: 1,
            reused,
            lastFrameUsed: this._frame,
            signature: descriptorSignature(descriptor),
        };
    }

    private _hydrateReusedRecord(
        id: RenderResourceName,
        record: TextureRecord<TNative>,
        descriptor: Readonly<RenderTextureDescriptor>
    ): TextureRecord<TNative> {
        record.id = id;
        record.descriptor = descriptor;
        record.lifetime = 'transient';
        record.reused = true;
        record.lastFrameUsed = this._frame;
        record.signature = descriptorSignature(descriptor);
        this._reuseCount += 1;
        return record;
    }
}
