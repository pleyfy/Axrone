import { Vec2, Vec3, IVec2Like, IVec3Like, EPSILON } from '@axrone/numeric';
import {
    Raycaster2D,
    Raycaster3D,
    RaycastResult2D,
    RaycastResult3D,
} from './raycast-engine';
import {
    IRay2D,
    IRay3D,
    IRaycastQuery2D,
    IRaycastQuery3D,
    IRaycastHit2D,
    IRaycastHit3D,
    LayerMask,
    RaycastFlags,
    RaycastPredicate2D,
    RaycastPredicate3D,
    RaycastLayer,
} from '../types/raycast-types';
import { RaycastCache2D, RaycastCache3D, RaycastBatcher2D, RaycastBatcher3D, RaycastStatistics } from './raycast-optimization';
import { SpatialHashGrid3D, SpatialOctree } from './raycast-spatial';
import { InvalidRayError, RaycastQueryError } from './raycast-errors';
import type { BodyId, ShapeId } from '../types/primitives';

const DEFAULT_MAX_DISTANCE = 1000;
const DEFAULT_LAYER_MASK = RaycastLayer.All as LayerMask;

export class RaycastSystem2D {
    private readonly _raycaster: Raycaster2D;
    private readonly _cache: RaycastCache2D;
    private readonly _batcher: RaycastBatcher2D;
    private readonly _statistics: RaycastStatistics;
    private _enableCache: boolean = true;
    private _enableBatching: boolean = false;

    constructor() {
        this._raycaster = new Raycaster2D();
        this._cache = new RaycastCache2D();
        this._batcher = new RaycastBatcher2D();
        this._statistics = new RaycastStatistics();
    }

    public raycast(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        flags: RaycastFlags = RaycastFlags.ClosestOnly,
        predicate?: RaycastPredicate2D
    ): IRaycastHit2D | null {
        this._validateRay(origin, direction, maxDistance);

        if (this._enableCache) {
            const cached = this._cache.get(origin, direction, maxDistance, layerMask);
            if (cached) {
                this._statistics.recordCacheHit();
                return cached;
            }
        }

        const query: IRaycastQuery2D = {
            ray: this._createRay2D(origin, direction, maxDistance),
            layerMask,
            flags: flags | RaycastFlags.ClosestOnly | RaycastFlags.StopAtFirstHit,
            maxHits: 1
        };

        const result = this._raycaster.raycast(query, predicate);
        const hit = result.hasHit ? result.hits[0] : null;

        if (this._enableCache && hit) {
            this._cache.set(origin, direction, maxDistance, layerMask, hit);
        }

        this._statistics.recordRaycast(hit !== null, 1);

        return hit;
    }

    public raycastAll(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        maxHits: number = 128,
        predicate?: RaycastPredicate2D
    ): readonly IRaycastHit2D[] {
        this._validateRay(origin, direction, maxDistance);

        const query: IRaycastQuery2D = {
            ray: this._createRay2D(origin, direction, maxDistance),
            layerMask,
            flags: RaycastFlags.AllHits | RaycastFlags.SortByDistance,
            maxHits
        };

        const result = this._raycaster.raycast(query, predicate);
        this._statistics.recordRaycast(result.hasHit, 1);

        return result.hits;
    }

    public raycastAsync(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        flags: RaycastFlags = RaycastFlags.ClosestOnly,
        callback: (hit: IRaycastHit2D | null) => void
    ): void {
        if (!this._enableBatching) {
            const hit = this.raycast(origin, direction, maxDistance, layerMask, flags);
            callback(hit);
            return;
        }

        this._batcher.add(origin, direction, maxDistance, layerMask, flags, callback);
    }

    public registerShape(
        bodyId: BodyId,
        shapeId: ShapeId,
        layer: LayerMask,
        type: number,
        data: unknown
    ): void {
        this._raycaster.registerShape(bodyId, shapeId, layer, type, data);
    }

    public unregisterShape(shapeId: ShapeId): void {
        this._raycaster.unregisterShape(shapeId);
    }

    public flushBatch(): void {
        this._batcher.flush();
    }

    public advanceFrame(): void {
        this._cache.advanceFrame();
        this._statistics.endFrame();
    }

    public clearCache(): void {
        this._cache.clear();
    }

    public set enableCache(value: boolean) {
        this._enableCache = value;
    }

    public get enableCache(): boolean {
        return this._enableCache;
    }

    public set enableBatching(value: boolean) {
        this._enableBatching = value;
    }

    public get enableBatching(): boolean {
        return this._enableBatching;
    }

    public get statistics(): RaycastStatistics {
        return this._statistics;
    }

    private _validateRay(origin: Readonly<IVec2Like>, direction: Readonly<IVec2Like>, maxDistance: number): void {
        if (!isFinite(origin.x) || !isFinite(origin.y)) {
            throw new InvalidRayError('Ray origin contains invalid values');
        }

        if (!isFinite(direction.x) || !isFinite(direction.y)) {
            throw new InvalidRayError('Ray direction contains invalid values');
        }

        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        if (length < EPSILON) {
            throw new InvalidRayError('Ray direction must have non-zero length');
        }

        if (maxDistance <= 0 || !isFinite(maxDistance)) {
            throw new InvalidRayError('Ray max distance must be positive and finite');
        }
    }

    private _createRay2D(origin: Readonly<IVec2Like>, direction: Readonly<IVec2Like>, maxDistance: number): IRay2D {
        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        const normalizedDir = Vec2.create(direction.x / length, direction.y / length);

        return {
            origin: Vec2.from(origin),
            direction: normalizedDir,
            length: maxDistance
        };
    }
}

export class RaycastSystem3D {
    private readonly _raycaster: Raycaster3D;
    private readonly _cache: RaycastCache3D;
    private readonly _batcher: RaycastBatcher3D;
    private readonly _statistics: RaycastStatistics;
    private readonly _spatialGrid: SpatialHashGrid3D<ShapeId> | null = null;
    private readonly _octree: SpatialOctree<ShapeId> | null = null;
    private _enableCache: boolean = true;
    private _enableBatching: boolean = false;
    private _spatialAcceleration: 'none' | 'grid' | 'octree' | 'bvh' = 'none';

    constructor() {
        this._raycaster = new Raycaster3D();
        this._cache = new RaycastCache3D();
        this._batcher = new RaycastBatcher3D();
        this._statistics = new RaycastStatistics();
    }

    public raycast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        flags: RaycastFlags = RaycastFlags.ClosestOnly,
        predicate?: RaycastPredicate3D
    ): IRaycastHit3D | null {
        this._validateRay(origin, direction, maxDistance);

        if (this._enableCache) {
            const cached = this._cache.get(origin, direction, maxDistance, layerMask);
            if (cached) {
                this._statistics.recordCacheHit();
                return cached;
            }
        }

        const query: IRaycastQuery3D = {
            ray: this._createRay3D(origin, direction, maxDistance),
            layerMask,
            flags: flags | RaycastFlags.ClosestOnly | RaycastFlags.StopAtFirstHit,
            maxHits: 1
        };

        const result = this._raycaster.raycast(query, predicate);
        const hit = result.hasHit ? result.hits[0] : null;

        if (this._enableCache && hit) {
            this._cache.set(origin, direction, maxDistance, layerMask, hit);
        }

        this._statistics.recordRaycast(hit !== null, 1);

        return hit;
    }

    public raycastAll(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        maxHits: number = 128,
        predicate?: RaycastPredicate3D
    ): readonly IRaycastHit3D[] {
        this._validateRay(origin, direction, maxDistance);

        const query: IRaycastQuery3D = {
            ray: this._createRay3D(origin, direction, maxDistance),
            layerMask,
            flags: RaycastFlags.AllHits | RaycastFlags.SortByDistance,
            maxHits
        };

        const result = this._raycaster.raycast(query, predicate);
        this._statistics.recordRaycast(result.hasHit, 1);

        return result.hits;
    }

    public raycastAsync(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number = DEFAULT_MAX_DISTANCE,
        layerMask: LayerMask = DEFAULT_LAYER_MASK,
        flags: RaycastFlags = RaycastFlags.ClosestOnly,
        callback: (hit: IRaycastHit3D | null) => void
    ): void {
        if (!this._enableBatching) {
            const hit = this.raycast(origin, direction, maxDistance, layerMask, flags);
            callback(hit);
            return;
        }

        this._batcher.add(origin, direction, maxDistance, layerMask, flags, callback);
    }

    public registerShape(
        bodyId: BodyId,
        shapeId: ShapeId,
        layer: LayerMask,
        type: number,
        data: unknown
    ): void {
        this._raycaster.registerShape(bodyId, shapeId, layer, type, data);
    }

    public unregisterShape(shapeId: ShapeId): void {
        this._raycaster.unregisterShape(shapeId);
    }

    public flushBatch(): void {
        this._batcher.flush();
    }

    public advanceFrame(): void {
        this._cache.advanceFrame();
        this._statistics.endFrame();
    }

    public clearCache(): void {
        this._cache.clear();
    }

    public set enableCache(value: boolean) {
        this._enableCache = value;
    }

    public get enableCache(): boolean {
        return this._enableCache;
    }

    public set enableBatching(value: boolean) {
        this._enableBatching = value;
    }

    public get enableBatching(): boolean {
        return this._enableBatching;
    }

    public set spatialAcceleration(value: 'none' | 'grid' | 'octree' | 'bvh') {
        this._spatialAcceleration = value;
    }

    public get spatialAcceleration(): 'none' | 'grid' | 'octree' | 'bvh' {
        return this._spatialAcceleration;
    }

    public get statistics(): RaycastStatistics {
        return this._statistics;
    }

    private _validateRay(origin: Readonly<IVec3Like>, direction: Readonly<IVec3Like>, maxDistance: number): void {
        if (!isFinite(origin.x) || !isFinite(origin.y) || !isFinite(origin.z)) {
            throw new InvalidRayError('Ray origin contains invalid values');
        }

        if (!isFinite(direction.x) || !isFinite(direction.y) || !isFinite(direction.z)) {
            throw new InvalidRayError('Ray direction contains invalid values');
        }

        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
        if (length < EPSILON) {
            throw new InvalidRayError('Ray direction must have non-zero length');
        }

        if (maxDistance <= 0 || !isFinite(maxDistance)) {
            throw new InvalidRayError('Ray max distance must be positive and finite');
        }
    }

    private _createRay3D(origin: Readonly<IVec3Like>, direction: Readonly<IVec3Like>, maxDistance: number): IRay3D {
        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
        const normalizedDir = Vec3.create(direction.x / length, direction.y / length, direction.z / length);

        return {
            origin: Vec3.from(origin),
            direction: normalizedDir,
            length: maxDistance
        };
    }
}

export function createRaycastSystem2D(): RaycastSystem2D {
    return new RaycastSystem2D();
}

export function createRaycastSystem3D(): RaycastSystem3D {
    return new RaycastSystem3D();
}
