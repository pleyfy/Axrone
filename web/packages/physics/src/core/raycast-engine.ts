import { Vec2, Vec3, IVec2Like, IVec3Like, EPSILON } from '@axrone/numeric';
import {
    IRay2D,
    IRay3D,
    IRaycastHit2D,
    IRaycastHit3D,
    IRaycastQuery2D,
    IRaycastQuery3D,
    IRaycastResult2D,
    IRaycastResult3D,
    RaycastFlags,
    LayerMask,
    RaycastPredicate2D,
    RaycastPredicate3D,
    IBarycentricCoords,
} from '../types/raycast-types';
import type { BodyId, ShapeId } from '../types/primitives';
import { RayPrimitiveIntersector2D, RayPrimitiveIntersector3D } from './raycast-primitives';
import type { DynamicAABBTree2D } from './broadphase';

const RAYCAST_HIT_POOL_SIZE = 512;
const DEFAULT_MAX_HITS = 128;

class RaycastHit2D implements IRaycastHit2D {
    public bodyId!: BodyId;
    public shapeId!: ShapeId;
    public readonly point: Vec2 = Vec2.ZERO.clone();
    public readonly normal: Vec2 = Vec2.ZERO.clone();
    public distance!: number;
    public fraction!: number;
    public layer!: LayerMask;

    public reset(): void {
        this.bodyId = 0 as BodyId;
        this.shapeId = 0 as ShapeId;
        this.point.x = 0;
        this.point.y = 0;
        this.normal.x = 0;
        this.normal.y = 0;
        this.distance = 0;
        this.fraction = 0;
        this.layer = 0 as LayerMask;
    }

    public copyFrom(other: IRaycastHit2D): void {
        this.bodyId = other.bodyId;
        this.shapeId = other.shapeId;
        this.point.x = other.point.x;
        this.point.y = other.point.y;
        this.normal.x = other.normal.x;
        this.normal.y = other.normal.y;
        this.distance = other.distance;
        this.fraction = other.fraction;
        this.layer = other.layer;
    }
}

class RaycastHit3D implements IRaycastHit3D {
    public bodyId!: BodyId;
    public shapeId!: ShapeId;
    public readonly point: Vec3 = Vec3.ZERO.clone();
    public readonly normal: Vec3 = Vec3.ZERO.clone();
    public distance!: number;
    public fraction!: number;
    public triangleIndex!: number;
    public barycentric: IBarycentricCoords | null = null;
    public layer!: LayerMask;

    public reset(): void {
        this.bodyId = 0 as BodyId;
        this.shapeId = 0 as ShapeId;
        this.point.x = 0;
        this.point.y = 0;
        this.point.z = 0;
        this.normal.x = 0;
        this.normal.y = 0;
        this.normal.z = 0;
        this.distance = 0;
        this.fraction = 0;
        this.triangleIndex = -1;
        this.barycentric = null;
        this.layer = 0 as LayerMask;
    }

    public copyFrom(other: IRaycastHit3D): void {
        this.bodyId = other.bodyId;
        this.shapeId = other.shapeId;
        this.point.x = other.point.x;
        this.point.y = other.point.y;
        this.point.z = other.point.z;
        this.normal.x = other.normal.x;
        this.normal.y = other.normal.y;
        this.normal.z = other.normal.z;
        this.distance = other.distance;
        this.fraction = other.fraction;
        this.triangleIndex = other.triangleIndex;
        this.barycentric = other.barycentric
            ? { u: other.barycentric.u, v: other.barycentric.v }
            : null;
        this.layer = other.layer;
    }
}

class ObjectPool<T> {
    private readonly _pool: T[] = [];
    private readonly _factory: () => T;
    private readonly _reset: (item: T) => void;
    private _size: number;

    constructor(factory: () => T, reset: (item: T) => void, initialSize: number) {
        this._factory = factory;
        this._reset = reset;
        this._size = 0;

        for (let i = 0; i < initialSize; i++) {
            this._pool.push(factory());
        }
    }

    public acquire(): T {
        if (this._pool.length > 0) {
            return this._pool.pop()!;
        }
        return this._factory();
    }

    public release(item: T): void {
        this._reset(item);
        this._pool.push(item);
    }

    public releaseAll(items: T[]): void {
        for (const item of items) {
            this.release(item);
        }
    }

    public get size(): number {
        return this._pool.length;
    }
}

export class RaycastResult2D implements IRaycastResult2D {
    private readonly _hits: RaycastHit2D[] = [];
    private _hitCount: number = 0;

    public get hits(): readonly IRaycastHit2D[] {
        return this._hits.slice(0, this._hitCount);
    }

    public get hitCount(): number {
        return this._hitCount;
    }

    public get hasHit(): boolean {
        return this._hitCount > 0;
    }

    public addHit(hit: RaycastHit2D): void {
        if (this._hitCount < this._hits.length) {
            this._hits[this._hitCount].copyFrom(hit);
        } else {
            const newHit = new RaycastHit2D();
            newHit.copyFrom(hit);
            this._hits.push(newHit);
        }
        this._hitCount++;
    }

    public clear(): void {
        this._hitCount = 0;
    }

    public sort(): void {
        if (this._hitCount <= 1) return;

        const hits = this._hits.slice(0, this._hitCount);
        hits.sort((a, b) => a.distance - b.distance);

        for (let i = 0; i < this._hitCount; i++) {
            this._hits[i].copyFrom(hits[i]);
        }
    }
}

export class RaycastResult3D implements IRaycastResult3D {
    private readonly _hits: RaycastHit3D[] = [];
    private _hitCount: number = 0;

    public get hits(): readonly IRaycastHit3D[] {
        return this._hits.slice(0, this._hitCount);
    }

    public get hitCount(): number {
        return this._hitCount;
    }

    public get hasHit(): boolean {
        return this._hitCount > 0;
    }

    public addHit(hit: RaycastHit3D): void {
        if (this._hitCount < this._hits.length) {
            this._hits[this._hitCount].copyFrom(hit);
        } else {
            const newHit = new RaycastHit3D();
            newHit.copyFrom(hit);
            this._hits.push(newHit);
        }
        this._hitCount++;
    }

    public clear(): void {
        this._hitCount = 0;
    }

    public sort(): void {
        if (this._hitCount <= 1) return;

        const hits = this._hits.slice(0, this._hitCount);
        hits.sort((a, b) => a.distance - b.distance);

        for (let i = 0; i < this._hitCount; i++) {
            this._hits[i].copyFrom(hits[i]);
        }
    }
}

interface ShapeData2D {
    bodyId: BodyId;
    shapeId: ShapeId;
    layer: LayerMask;
    type: number;
    data: unknown;
}

interface ShapeData3D {
    bodyId: BodyId;
    shapeId: ShapeId;
    layer: LayerMask;
    type: number;
    data: unknown;
}

export class Raycaster2D {
    private readonly _hitPool: ObjectPool<RaycastHit2D>;
    private readonly _tempHit: RaycastHit2D = new RaycastHit2D();
    private readonly _invDirection: Vec2 = Vec2.ZERO.clone();
    private readonly _aabbTestResult = { tMin: 0, tMax: 0 };

    private _shapes: ShapeData2D[] = [];
    private _broadphase: DynamicAABBTree2D | null = null;

    constructor() {
        this._hitPool = new ObjectPool(
            () => new RaycastHit2D(),
            (hit) => hit.reset(),
            RAYCAST_HIT_POOL_SIZE
        );
    }

    public setBroadphase(broadphase: DynamicAABBTree2D): void {
        this._broadphase = broadphase;
    }

    public registerShape(
        bodyId: BodyId,
        shapeId: ShapeId,
        layer: LayerMask,
        type: number,
        data: unknown
    ): void {
        this._shapes.push({ bodyId, shapeId, layer, type, data });
    }

    public unregisterShape(shapeId: ShapeId): void {
        const index = this._shapes.findIndex((s) => s.shapeId === shapeId);
        if (index !== -1) {
            this._shapes.splice(index, 1);
        }
    }

    public raycast(query: IRaycastQuery2D, predicate?: RaycastPredicate2D): RaycastResult2D {
        const result = new RaycastResult2D();

        const ray = query.ray;
        const maxHits = Math.min(query.maxHits || DEFAULT_MAX_HITS, DEFAULT_MAX_HITS);
        const closestOnly = (query.flags & RaycastFlags.ClosestOnly) !== 0;
        const stopAtFirst = (query.flags & RaycastFlags.StopAtFirstHit) !== 0;

        this._computeInvDirection(ray.direction, this._invDirection);

        const candidates = this._broadphaseQuery(ray, query.layerMask);

        for (const shape of candidates) {
            if ((shape.layer & query.layerMask) === 0) {
                continue;
            }

            if (predicate && !predicate(shape.bodyId, shape.shapeId)) {
                continue;
            }

            const hit = this._intersectShape(ray, shape, query.flags);
            if (hit) {
                result.addHit(hit);
                this._hitPool.release(hit);

                if (stopAtFirst) {
                    break;
                }

                if (result.hitCount >= maxHits) {
                    break;
                }
            }
        }

        if ((query.flags & RaycastFlags.SortByDistance) !== 0) {
            result.sort();
        }

        if (closestOnly && result.hitCount > 1) {
            const closestHit = result.hits[0];
            result.clear();
            this._tempHit.copyFrom(closestHit);
            result.addHit(this._tempHit);
        }

        return result;
    }

    public raycastSingle(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxDistance: number,
        layerMask: LayerMask,
        predicate?: RaycastPredicate2D
    ): IRaycastHit2D | null {
        const query: IRaycastQuery2D = {
            ray: {
                origin,
                direction,
                length: maxDistance,
            },
            layerMask,
            flags: RaycastFlags.ClosestOnly | RaycastFlags.StopAtFirstHit,
            maxHits: 1,
        };

        const result = this.raycast(query, predicate);
        return result.hasHit ? result.hits[0] : null;
    }

    private _computeInvDirection(direction: Readonly<IVec2Like>, out: Vec2): void {
        out.x = Math.abs(direction.x) > EPSILON ? 1.0 / direction.x : Number.MAX_VALUE;
        out.y = Math.abs(direction.y) > EPSILON ? 1.0 / direction.y : Number.MAX_VALUE;
    }

    private _broadphaseQuery(ray: IRay2D, layerMask: LayerMask): ShapeData2D[] {
        if (this._broadphase) {
            return [];
        }

        return this._shapes.filter((s) => (s.layer & layerMask) !== 0);
    }

    private _intersectShape(
        ray: IRay2D,
        shape: ShapeData2D,
        flags: RaycastFlags
    ): RaycastHit2D | null {
        return null;
    }
}

export class Raycaster3D {
    private readonly _hitPool: ObjectPool<RaycastHit3D>;
    private readonly _tempHit: RaycastHit3D = new RaycastHit3D();
    private readonly _invDirection: Vec3 = Vec3.ZERO.clone();
    private readonly _aabbTestResult = { tMin: 0, tMax: 0 };

    private _shapes: ShapeData3D[] = [];

    constructor() {
        this._hitPool = new ObjectPool(
            () => new RaycastHit3D(),
            (hit) => hit.reset(),
            RAYCAST_HIT_POOL_SIZE
        );
    }

    public registerShape(
        bodyId: BodyId,
        shapeId: ShapeId,
        layer: LayerMask,
        type: number,
        data: unknown
    ): void {
        this._shapes.push({ bodyId, shapeId, layer, type, data });
    }

    public unregisterShape(shapeId: ShapeId): void {
        const index = this._shapes.findIndex((s) => s.shapeId === shapeId);
        if (index !== -1) {
            this._shapes.splice(index, 1);
        }
    }

    public raycast(query: IRaycastQuery3D, predicate?: RaycastPredicate3D): RaycastResult3D {
        const result = new RaycastResult3D();

        const ray = query.ray;
        const maxHits = Math.min(query.maxHits || DEFAULT_MAX_HITS, DEFAULT_MAX_HITS);
        const closestOnly = (query.flags & RaycastFlags.ClosestOnly) !== 0;
        const stopAtFirst = (query.flags & RaycastFlags.StopAtFirstHit) !== 0;

        this._computeInvDirection(ray.direction, this._invDirection);

        const candidates = this._broadphaseQuery(ray, query.layerMask);

        for (const shape of candidates) {
            if ((shape.layer & query.layerMask) === 0) {
                continue;
            }

            if (predicate && !predicate(shape.bodyId, shape.shapeId)) {
                continue;
            }

            const hit = this._intersectShape(ray, shape, query.flags);
            if (hit) {
                result.addHit(hit);
                this._hitPool.release(hit);

                if (stopAtFirst) {
                    break;
                }

                if (result.hitCount >= maxHits) {
                    break;
                }
            }
        }

        if ((query.flags & RaycastFlags.SortByDistance) !== 0) {
            result.sort();
        }

        if (closestOnly && result.hitCount > 1) {
            const closestHit = result.hits[0];
            result.clear();
            this._tempHit.copyFrom(closestHit);
            result.addHit(this._tempHit);
        }

        return result;
    }

    public raycastSingle(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number,
        layerMask: LayerMask,
        predicate?: RaycastPredicate3D
    ): IRaycastHit3D | null {
        const query: IRaycastQuery3D = {
            ray: {
                origin,
                direction,
                length: maxDistance,
            },
            layerMask,
            flags: RaycastFlags.ClosestOnly | RaycastFlags.StopAtFirstHit,
            maxHits: 1,
        };

        const result = this.raycast(query, predicate);
        return result.hasHit ? result.hits[0] : null;
    }

    private _computeInvDirection(direction: Readonly<IVec3Like>, out: Vec3): void {
        out.x = Math.abs(direction.x) > EPSILON ? 1.0 / direction.x : Number.MAX_VALUE;
        out.y = Math.abs(direction.y) > EPSILON ? 1.0 / direction.y : Number.MAX_VALUE;
        out.z = Math.abs(direction.z) > EPSILON ? 1.0 / direction.z : Number.MAX_VALUE;
    }

    private _broadphaseQuery(ray: IRay3D, layerMask: LayerMask): ShapeData3D[] {
        return this._shapes.filter((s) => (s.layer & layerMask) !== 0);
    }

    private _intersectShape(
        ray: IRay3D,
        shape: ShapeData3D,
        flags: RaycastFlags
    ): RaycastHit3D | null {
        return null;
    }
}
