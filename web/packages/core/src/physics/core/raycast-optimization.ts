import { Vec2, Vec3, IVec2Like, IVec3Like, EPSILON } from '@axrone/numeric';
import type { IRaycastHit2D, IRaycastHit3D, LayerMask, RaycastFlags } from '../types/raycast-types';
import type { BodyId, ShapeId } from '../types/primitives';

const CACHE_SIZE = 64;
const BATCH_SIZE = 256;

interface CachedRaycastHit2D {
    hit: IRaycastHit2D;
    frameId: number;
    hash: number;
}

interface CachedRaycastHit3D {
    hit: IRaycastHit3D;
    frameId: number;
    hash: number;
}

export class RaycastCache2D {
    private readonly _cache: Map<number, CachedRaycastHit2D> = new Map();
    private readonly _maxSize: number;
    private _currentFrame: number = 0;

    constructor(maxSize: number = CACHE_SIZE) {
        this._maxSize = maxSize;
    }

    public get(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number,
        layerMask: LayerMask
    ): IRaycastHit2D | null {
        const hash = this._computeHash(origin, direction, maxDistance, layerMask);
        const cached = this._cache.get(hash);

        if (cached && cached.frameId === this._currentFrame) {
            return cached.hit;
        }

        return null;
    }

    public set(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number,
        layerMask: LayerMask,
        hit: IRaycastHit2D
    ): void {
        const hash = this._computeHash(origin, direction, maxDistance, layerMask);

        if (this._cache.size >= this._maxSize) {
            this._evictOldest();
        }

        this._cache.set(hash, {
            hit,
            frameId: this._currentFrame,
            hash,
        });
    }

    public advanceFrame(): void {
        this._currentFrame++;

        if (this._currentFrame % 60 === 0) {
            this._clearOldEntries();
        }
    }

    public clear(): void {
        this._cache.clear();
    }

    private _computeHash(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number,
        layerMask: LayerMask
    ): number {
        let hash = 0;
        hash = (hash * 31 + this._floatToInt(origin.x)) | 0;
        hash = (hash * 31 + this._floatToInt(origin.y)) | 0;
        hash = (hash * 31 + this._floatToInt(direction.x)) | 0;
        hash = (hash * 31 + this._floatToInt(direction.y)) | 0;
        hash = (hash * 31 + this._floatToInt(maxDistance)) | 0;
        hash = (hash * 31 + (layerMask as number)) | 0;
        return hash;
    }

    private _floatToInt(value: number): number {
        return Math.floor(value * 1000);
    }

    private _evictOldest(): void {
        let oldestFrame = this._currentFrame;
        let oldestHash = -1;

        for (const [hash, cached] of this._cache) {
            if (cached.frameId < oldestFrame) {
                oldestFrame = cached.frameId;
                oldestHash = hash;
            }
        }

        if (oldestHash !== -1) {
            this._cache.delete(oldestHash);
        }
    }

    private _clearOldEntries(): void {
        const threshold = this._currentFrame - 10;
        const toDelete: number[] = [];

        for (const [hash, cached] of this._cache) {
            if (cached.frameId < threshold) {
                toDelete.push(hash);
            }
        }

        for (const hash of toDelete) {
            this._cache.delete(hash);
        }
    }
}

export class RaycastCache3D {
    private readonly _cache: Map<number, CachedRaycastHit3D> = new Map();
    private readonly _maxSize: number;
    private _currentFrame: number = 0;

    constructor(maxSize: number = CACHE_SIZE) {
        this._maxSize = maxSize;
    }

    public get(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask
    ): IRaycastHit3D | null {
        const hash = this._computeHash(origin, direction, maxDistance, layerMask);
        const cached = this._cache.get(hash);

        if (cached && cached.frameId === this._currentFrame) {
            return cached.hit;
        }

        return null;
    }

    public set(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        hit: IRaycastHit3D
    ): void {
        const hash = this._computeHash(origin, direction, maxDistance, layerMask);

        if (this._cache.size >= this._maxSize) {
            this._evictOldest();
        }

        this._cache.set(hash, {
            hit,
            frameId: this._currentFrame,
            hash,
        });
    }

    public advanceFrame(): void {
        this._currentFrame++;

        if (this._currentFrame % 60 === 0) {
            this._clearOldEntries();
        }
    }

    public clear(): void {
        this._cache.clear();
    }

    private _computeHash(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask
    ): number {
        let hash = 0;
        hash = (hash * 31 + this._floatToInt(origin.x)) | 0;
        hash = (hash * 31 + this._floatToInt(origin.y)) | 0;
        hash = (hash * 31 + this._floatToInt(origin.z)) | 0;
        hash = (hash * 31 + this._floatToInt(direction.x)) | 0;
        hash = (hash * 31 + this._floatToInt(direction.y)) | 0;
        hash = (hash * 31 + this._floatToInt(direction.z)) | 0;
        hash = (hash * 31 + this._floatToInt(maxDistance)) | 0;
        hash = (hash * 31 + (layerMask as number)) | 0;
        return hash;
    }

    private _floatToInt(value: number): number {
        return Math.floor(value * 1000);
    }

    private _evictOldest(): void {
        let oldestFrame = this._currentFrame;
        let oldestHash = -1;

        for (const [hash, cached] of this._cache) {
            if (cached.frameId < oldestFrame) {
                oldestFrame = cached.frameId;
                oldestHash = hash;
            }
        }

        if (oldestHash !== -1) {
            this._cache.delete(oldestHash);
        }
    }

    private _clearOldEntries(): void {
        const threshold = this._currentFrame - 10;
        const toDelete: number[] = [];

        for (const [hash, cached] of this._cache) {
            if (cached.frameId < threshold) {
                toDelete.push(hash);
            }
        }

        for (const hash of toDelete) {
            this._cache.delete(hash);
        }
    }
}

interface BatchedRaycast2D {
    origin: Readonly<IVec2Like>;
    direction: Readonly<IVec2Like>;
    maxDistance: number;
    layerMask: LayerMask;
    flags: RaycastFlags;
    callback: (hit: IRaycastHit2D | null) => void;
}

interface BatchedRaycast3D {
    origin: Readonly<IVec3Like>;
    direction: Readonly<IVec3Like>;
    maxDistance: number;
    layerMask: LayerMask;
    flags: RaycastFlags;
    callback: (hit: IRaycastHit3D | null) => void;
}

export class RaycastBatcher2D {
    private readonly _pending: BatchedRaycast2D[] = [];
    private readonly _batchSize: number;

    constructor(batchSize: number = BATCH_SIZE) {
        this._batchSize = batchSize;
    }

    public add(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number,
        layerMask: LayerMask,
        flags: RaycastFlags,
        callback: (hit: IRaycastHit2D | null) => void
    ): void {
        this._pending.push({
            origin,
            direction,
            maxDistance,
            layerMask,
            flags,
            callback,
        });

        if (this._pending.length >= this._batchSize) {
            this.flush();
        }
    }

    public flush(): void {
        if (this._pending.length === 0) return;

        this._sortByDirection();

        this._pending.length = 0;
    }

    public get pendingCount(): number {
        return this._pending.length;
    }

    private _sortByDirection(): void {
        this._pending.sort((a, b) => {
            const angleA = Math.atan2(a.direction.y, a.direction.x);
            const angleB = Math.atan2(b.direction.y, b.direction.x);
            return angleA - angleB;
        });
    }
}

export class RaycastBatcher3D {
    private readonly _pending: BatchedRaycast3D[] = [];
    private readonly _batchSize: number;

    constructor(batchSize: number = BATCH_SIZE) {
        this._batchSize = batchSize;
    }

    public add(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        flags: RaycastFlags,
        callback: (hit: IRaycastHit3D | null) => void
    ): void {
        this._pending.push({
            origin,
            direction,
            maxDistance,
            layerMask,
            flags,
            callback,
        });

        if (this._pending.length >= this._batchSize) {
            this.flush();
        }
    }

    public flush(): void {
        if (this._pending.length === 0) return;

        this._sortByDirection();

        this._pending.length = 0;
    }

    public get pendingCount(): number {
        return this._pending.length;
    }

    private _sortByDirection(): void {
        this._pending.sort((a, b) => {
            const theta1 = Math.atan2(
                Math.sqrt(a.direction.x * a.direction.x + a.direction.y * a.direction.y),
                a.direction.z
            );
            const phi1 = Math.atan2(a.direction.y, a.direction.x);
            const theta2 = Math.atan2(
                Math.sqrt(b.direction.x * b.direction.x + b.direction.y * b.direction.y),
                b.direction.z
            );
            const phi2 = Math.atan2(b.direction.y, b.direction.x);

            const diff = theta1 - theta2;
            return Math.abs(diff) > EPSILON ? diff : phi1 - phi2;
        });
    }
}

export class RaycastStatistics {
    private _totalRaycasts: number = 0;
    private _hitCount: number = 0;
    private _missCount: number = 0;
    private _cacheHits: number = 0;
    private _averageTestsPerRay: number = 0;
    private _totalTests: number = 0;
    private _frameRaycasts: number = 0;

    public recordRaycast(hit: boolean, testsPerformed: number): void {
        this._totalRaycasts++;
        this._frameRaycasts++;
        this._totalTests += testsPerformed;

        if (hit) {
            this._hitCount++;
        } else {
            this._missCount++;
        }

        this._averageTestsPerRay = this._totalTests / this._totalRaycasts;
    }

    public recordCacheHit(): void {
        this._cacheHits++;
    }

    public endFrame(): void {
        this._frameRaycasts = 0;
    }

    public reset(): void {
        this._totalRaycasts = 0;
        this._hitCount = 0;
        this._missCount = 0;
        this._cacheHits = 0;
        this._averageTestsPerRay = 0;
        this._totalTests = 0;
        this._frameRaycasts = 0;
    }

    public get totalRaycasts(): number {
        return this._totalRaycasts;
    }

    public get hitCount(): number {
        return this._hitCount;
    }

    public get missCount(): number {
        return this._missCount;
    }

    public get cacheHits(): number {
        return this._cacheHits;
    }

    public get hitRate(): number {
        return this._totalRaycasts > 0 ? this._hitCount / this._totalRaycasts : 0;
    }

    public get cacheHitRate(): number {
        return this._totalRaycasts > 0 ? this._cacheHits / this._totalRaycasts : 0;
    }

    public get averageTestsPerRay(): number {
        return this._averageTestsPerRay;
    }

    public get frameRaycasts(): number {
        return this._frameRaycasts;
    }
}
