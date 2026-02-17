import { Vec2, Vec3, IVec2Like, IVec3Like } from '@axrone/numeric';
import {
    IRaycastHit2D,
    IRaycastHit3D,
    LayerMask,
    RaycastFlags,
} from '../types/raycast-types';

export class RaycastHitComparator {
    public static sortByDistance2D(a: IRaycastHit2D, b: IRaycastHit2D): number {
        return a.distance - b.distance;
    }

    public static sortByDistance3D(a: IRaycastHit3D, b: IRaycastHit3D): number {
        return a.distance - b.distance;
    }

    public static sortByFraction2D(a: IRaycastHit2D, b: IRaycastHit2D): number {
        return a.fraction - b.fraction;
    }

    public static sortByFraction3D(a: IRaycastHit3D, b: IRaycastHit3D): number {
        return a.fraction - b.fraction;
    }

    public static filterByLayer2D(hits: readonly IRaycastHit2D[], layerMask: LayerMask): IRaycastHit2D[] {
        return hits.filter(hit => (hit.layer & layerMask) !== 0);
    }

    public static filterByLayer3D(hits: readonly IRaycastHit3D[], layerMask: LayerMask): IRaycastHit3D[] {
        return hits.filter(hit => (hit.layer & layerMask) !== 0);
    }

    public static findClosest2D(hits: readonly IRaycastHit2D[]): IRaycastHit2D | null {
        if (hits.length === 0) return null;
        
        let closest = hits[0];
        for (let i = 1; i < hits.length; i++) {
            if (hits[i].distance < closest.distance) {
                closest = hits[i];
            }
        }
        return closest;
    }

    public static findClosest3D(hits: readonly IRaycastHit3D[]): IRaycastHit3D | null {
        if (hits.length === 0) return null;
        
        let closest = hits[0];
        for (let i = 1; i < hits.length; i++) {
            if (hits[i].distance < closest.distance) {
                closest = hits[i];
            }
        }
        return closest;
    }

    public static findFurthest2D(hits: readonly IRaycastHit2D[]): IRaycastHit2D | null {
        if (hits.length === 0) return null;
        
        let furthest = hits[0];
        for (let i = 1; i < hits.length; i++) {
            if (hits[i].distance > furthest.distance) {
                furthest = hits[i];
            }
        }
        return furthest;
    }

    public static findFurthest3D(hits: readonly IRaycastHit3D[]): IRaycastHit3D | null {
        if (hits.length === 0) return null;
        
        let furthest = hits[0];
        for (let i = 1; i < hits.length; i++) {
            if (hits[i].distance > furthest.distance) {
                furthest = hits[i];
            }
        }
        return furthest;
    }
}

export class RayBuilder2D {
    private _origin: Vec2 = Vec2.ZERO.clone();
    private _direction: Vec2 = Vec2.create(1, 0);
    private _length: number = 1000;

    public setOrigin(x: number, y: number): this {
        this._origin.x = x;
        this._origin.y = y;
        return this;
    }

    public setOriginVec(origin: Readonly<IVec2Like>): this {
        this._origin.x = origin.x;
        this._origin.y = origin.y;
        return this;
    }

    public setDirection(x: number, y: number): this {
        this._direction.x = x;
        this._direction.y = y;
        Vec2.normalize(this._direction, this._direction);
        return this;
    }

    public setDirectionVec(direction: Readonly<IVec2Like>): this {
        this._direction.x = direction.x;
        this._direction.y = direction.y;
        Vec2.normalize(this._direction, this._direction);
        return this;
    }

    public setTarget(target: Readonly<IVec2Like>): this {
        Vec2.subtract(target, this._origin, this._direction);
        Vec2.normalize(this._direction, this._direction);
        return this;
    }

    public setLength(length: number): this {
        this._length = length;
        return this;
    }

    public setAngle(radians: number): this {
        this._direction.x = Math.cos(radians);
        this._direction.y = Math.sin(radians);
        return this;
    }

    public get origin(): Readonly<IVec2Like> {
        return this._origin;
    }

    public get direction(): Readonly<IVec2Like> {
        return this._direction;
    }

    public get length(): number {
        return this._length;
    }

    public getEndPoint(): Vec2 {
        return Vec2.add(this._origin, Vec2.multiplyScalar(this._direction, this._length));
    }

    public clone(): RayBuilder2D {
        const builder = new RayBuilder2D();
        builder._origin.x = this._origin.x;
        builder._origin.y = this._origin.y;
        builder._direction.x = this._direction.x;
        builder._direction.y = this._direction.y;
        builder._length = this._length;
        return builder;
    }
}

export class RayBuilder3D {
    private _origin: Vec3 = Vec3.ZERO.clone();
    private _direction: Vec3 = Vec3.create(1, 0, 0);
    private _length: number = 1000;

    public setOrigin(x: number, y: number, z: number): this {
        this._origin.x = x;
        this._origin.y = y;
        this._origin.z = z;
        return this;
    }

    public setOriginVec(origin: Readonly<IVec3Like>): this {
        this._origin.x = origin.x;
        this._origin.y = origin.y;
        this._origin.z = origin.z;
        return this;
    }

    public setDirection(x: number, y: number, z: number): this {
        this._direction.x = x;
        this._direction.y = y;
        this._direction.z = z;
        Vec3.normalize(this._direction, this._direction);
        return this;
    }

    public setDirectionVec(direction: Readonly<IVec3Like>): this {
        this._direction.x = direction.x;
        this._direction.y = direction.y;
        this._direction.z = direction.z;
        Vec3.normalize(this._direction, this._direction);
        return this;
    }

    public setTarget(target: Readonly<IVec3Like>): this {
        Vec3.subtract(target, this._origin, this._direction);
        Vec3.normalize(this._direction, this._direction);
        return this;
    }

    public setLength(length: number): this {
        this._length = length;
        return this;
    }

    public setEulerAngles(pitch: number, yaw: number): this {
        this._direction.x = Math.cos(pitch) * Math.cos(yaw);
        this._direction.y = Math.sin(pitch);
        this._direction.z = Math.cos(pitch) * Math.sin(yaw);
        Vec3.normalize(this._direction, this._direction);
        return this;
    }

    public get origin(): Readonly<IVec3Like> {
        return this._origin;
    }

    public get direction(): Readonly<IVec3Like> {
        return this._direction;
    }

    public get length(): number {
        return this._length;
    }

    public getEndPoint(): Vec3 {
        return Vec3.add(this._origin, Vec3.multiplyScalar(this._direction, this._length));
    }

    public clone(): RayBuilder3D {
        const builder = new RayBuilder3D();
        builder._origin.x = this._origin.x;
        builder._origin.y = this._origin.y;
        builder._origin.z = this._origin.z;
        builder._direction.x = this._direction.x;
        builder._direction.y = this._direction.y;
        builder._direction.z = this._direction.z;
        builder._length = this._length;
        return builder;
    }
}

export class LayerMaskBuilder {
    private _mask: number = 0;

    public add(layer: number): this {
        this._mask |= layer;
        return this;
    }

    public remove(layer: number): this {
        this._mask &= ~layer;
        return this;
    }

    public toggle(layer: number): this {
        this._mask ^= layer;
        return this;
    }

    public clear(): this {
        this._mask = 0;
        return this;
    }

    public setAll(): this {
        this._mask = 0xffffffff;
        return this;
    }

    public has(layer: number): boolean {
        return (this._mask & layer) !== 0;
    }

    public build(): LayerMask {
        return this._mask as LayerMask;
    }

    public static from(layers: number[]): LayerMask {
        const builder = new LayerMaskBuilder();
        for (const layer of layers) {
            builder.add(layer);
        }
        return builder.build();
    }

    public static combine(...masks: LayerMask[]): LayerMask {
        let combined = 0;
        for (const mask of masks) {
            combined |= mask;
        }
        return combined as LayerMask;
    }

    public static intersect(...masks: LayerMask[]): LayerMask {
        if (masks.length === 0) return 0 as LayerMask;
        
        let result = masks[0] as number;
        for (let i = 1; i < masks.length; i++) {
            result &= masks[i] as number;
        }
        return result as LayerMask;
    }

    public static exclude(base: LayerMask, exclude: LayerMask): LayerMask {
        return ((base as number) & ~(exclude as number)) as LayerMask;
    }
}

export class RaycastFlagsBuilder {
    private _flags: RaycastFlags = RaycastFlags.None;

    public add(flag: RaycastFlags): this {
        this._flags |= flag;
        return this;
    }

    public remove(flag: RaycastFlags): this {
        this._flags &= ~flag;
        return this;
    }

    public toggle(flag: RaycastFlags): this {
        this._flags ^= flag;
        return this;
    }

    public has(flag: RaycastFlags): boolean {
        return (this._flags & flag) !== 0;
    }

    public clear(): this {
        this._flags = RaycastFlags.None;
        return this;
    }

    public build(): RaycastFlags {
        return this._flags;
    }

    public static default(): RaycastFlags {
        return RaycastFlags.ClosestOnly | RaycastFlags.StopAtFirstHit | RaycastFlags.SortByDistance;
    }

    public static allHits(): RaycastFlags {
        return RaycastFlags.AllHits | RaycastFlags.SortByDistance;
    }

    public static precise(): RaycastFlags {
        return RaycastFlags.ClosestOnly | RaycastFlags.PreciseHitNormal | RaycastFlags.StopAtFirstHit;
    }
}

export function interpolateHit2D(
    hit1: IRaycastHit2D,
    hit2: IRaycastHit2D,
    t: number
): Partial<IRaycastHit2D> {
    const invT = 1 - t;
    
    return {
        point: Vec2.create(
            hit1.point.x * invT + hit2.point.x * t,
            hit1.point.y * invT + hit2.point.y * t
        ),
        normal: Vec2.create(
            hit1.normal.x * invT + hit2.normal.x * t,
            hit1.normal.y * invT + hit2.normal.y * t
        ),
        distance: hit1.distance * invT + hit2.distance * t,
        fraction: hit1.fraction * invT + hit2.fraction * t
    };
}

export function interpolateHit3D(
    hit1: IRaycastHit3D,
    hit2: IRaycastHit3D,
    t: number
): Partial<IRaycastHit3D> {
    const invT = 1 - t;
    
    return {
        point: Vec3.create(
            hit1.point.x * invT + hit2.point.x * t,
            hit1.point.y * invT + hit2.point.y * t,
            hit1.point.z * invT + hit2.point.z * t
        ),
        normal: Vec3.create(
            hit1.normal.x * invT + hit2.normal.x * t,
            hit1.normal.y * invT + hit2.normal.y * t,
            hit1.normal.z * invT + hit2.normal.z * t
        ),
        distance: hit1.distance * invT + hit2.distance * t,
        fraction: hit1.fraction * invT + hit2.fraction * t
    };
}

export function createSphereCastOrigins3D(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    radius: number,
    samples: number = 8
): Vec3[] {
    const origins: Vec3[] = [];
    const up = Vec3.create(0, 1, 0);
    const right = Vec3.cross(direction, up);
    Vec3.normalize(right, right);
    const actualUp = Vec3.cross(right, direction);
    Vec3.normalize(actualUp, actualUp);

    for (let i = 0; i < samples; i++) {
        const angle = (Math.PI * 2 * i) / samples;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const offset = Vec3.create(
            right.x * cos * radius + actualUp.x * sin * radius,
            right.y * cos * radius + actualUp.y * sin * radius,
            right.z * cos * radius + actualUp.z * sin * radius
        );

        origins.push(Vec3.add(origin, offset));
    }

    return origins;
}

export function createBoxCastOrigins3D(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    extents: Readonly<IVec3Like>
): Vec3[] {
    const origins: Vec3[] = [];
    
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                if (x === 0 && y === 0 && z === 0) continue;

                const offset = Vec3.create(
                    x * extents.x,
                    y * extents.y,
                    z * extents.z
                );

                origins.push(Vec3.add(origin, offset));
            }
        }
    }

    return origins;
}
