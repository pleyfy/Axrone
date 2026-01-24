import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { script } from '../../decorators';
import { Component } from '../../core/component';
import type { Rigidbody3D } from './rigidbody3d';
import type {
    ShapeId3D,
    ISphereShapeDef3D,
    IBoxShapeDef3D,
    ICapsuleShapeDef3D,
    ICylinderShapeDef3D,
    IConvexHullShapeDef3D,
} from '../../../physics/types/physics-3d';
import type { IMaterial, Friction, Restitution, Density } from '../../../physics/types';
import type { PhysicsWorld3D, ShapeManager3D } from '../../../physics/core/physics-world-3d';

const enum PhysicMaterialCombine {
    Average = 0,
    Minimum = 1,
    Maximum = 2,
    Multiply = 3,
}

interface IPhysicMaterial3D {
    staticFriction: number;
    dynamicFriction: number;
    bounciness: number;
    frictionCombine: PhysicMaterialCombine;
    bounceCombine: PhysicMaterialCombine;
}

interface IMutableCollisionFilter3D {
    categoryBits: number;
    maskBits: number;
    groupIndex: number;
}

const DEFAULT_PHYSIC_MATERIAL: Readonly<IPhysicMaterial3D> = {
    staticFriction: 0.6,
    dynamicFriction: 0.6,
    bounciness: 0,
    frictionCombine: PhysicMaterialCombine.Average,
    bounceCombine: PhysicMaterialCombine.Average,
};

const enum CapsuleDirection3D {
    XAxis = 0,
    YAxis = 1,
    ZAxis = 2,
}

const INVALID_SHAPE_ID = -1 as ShapeId3D;

export abstract class Collider3D extends Component {
    protected _shapeId: ShapeId3D = INVALID_SHAPE_ID;
    protected _shapeManager: ShapeManager3D | null = null;
    protected _world: PhysicsWorld3D | null = null;
    protected _rigidbody: Rigidbody3D | null = null;
    protected _collider3dEnabled: boolean = true;

    protected readonly _center: Vec3 = Vec3.create();
    protected readonly _bounds: { min: Vec3; max: Vec3 } = {
        min: Vec3.create(),
        max: Vec3.create(),
    };

    private _isTrigger: boolean = false;
    private _providesContacts: boolean = true;
    private readonly _contactOffset: number = 0.01;
    private readonly _filter: IMutableCollisionFilter3D = {
        categoryBits: 1,
        maskBits: 0xffff,
        groupIndex: 0,
    };
    private _material: IPhysicMaterial3D = { ...DEFAULT_PHYSIC_MATERIAL };

    get shapeId(): ShapeId3D {
        return this._shapeId;
    }
    get isTrigger(): boolean {
        return this._isTrigger;
    }
    set isTrigger(value: boolean) {
        this._isTrigger = value;
    }
    get providesContacts(): boolean {
        return this._providesContacts;
    }
    set providesContacts(value: boolean) {
        this._providesContacts = value;
    }
    get contactOffset(): number {
        return this._contactOffset;
    }
    get attachedRigidbody(): Rigidbody3D | null {
        return this._rigidbody;
    }

    get center(): Readonly<Vec3> {
        return this._center;
    }
    set center(value: IVec3Like) {
        this._center.x = value.x;
        this._center.y = value.y;
        this._center.z = value.z;
        this._updateShape();
    }

    get bounds(): Readonly<{ min: Vec3; max: Vec3 }> {
        this._calculateBounds();
        return this._bounds;
    }

    get material(): Readonly<IPhysicMaterial3D> {
        return this._material;
    }
    set material(value: Partial<IPhysicMaterial3D>) {
        if (value.staticFriction !== undefined)
            this._material.staticFriction = Math.max(0, value.staticFriction);
        if (value.dynamicFriction !== undefined)
            this._material.dynamicFriction = Math.max(0, value.dynamicFriction);
        if (value.bounciness !== undefined)
            this._material.bounciness = Math.max(0, Math.min(1, value.bounciness));
        if (value.frictionCombine !== undefined)
            this._material.frictionCombine = value.frictionCombine;
        if (value.bounceCombine !== undefined) this._material.bounceCombine = value.bounceCombine;
    }

    get categoryBits(): number {
        return this._filter.categoryBits;
    }
    set categoryBits(value: number) {
        this._filter.categoryBits = value;
    }
    get maskBits(): number {
        return this._filter.maskBits;
    }
    set maskBits(value: number) {
        this._filter.maskBits = value;
    }
    get groupIndex(): number {
        return this._filter.groupIndex;
    }
    set groupIndex(value: number) {
        this._filter.groupIndex = value;
    }

    initialize(world: PhysicsWorld3D, rigidbody?: Rigidbody3D): void {
        this._world = world;
        this._shapeManager = world.getShapeManager();
        this._rigidbody = rigidbody ?? null;
        this._createShape();
    }

    closestPoint(position: IVec3Like): IVec3Like {
        return this._closestPointOnCollider(position);
    }

    raycast(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return this._raycastCollider(ray, maxDistance);
    }

    override onDestroy(): void {
        if (this._shapeManager && this._shapeId !== INVALID_SHAPE_ID) {
            this._shapeManager.destroyShape(this._shapeId);
            this._shapeId = INVALID_SHAPE_ID;
        }
        this._shapeManager = null;
        this._world = null;
        this._rigidbody = null;
    }

    protected abstract _createShape(): void;
    protected abstract _updateShape(): void;
    protected abstract _calculateBounds(): void;
    protected abstract _closestPointOnCollider(position: IVec3Like): IVec3Like;
    protected abstract _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number };

    protected _getMaterial(): IMaterial {
        return {
            friction: this._material.dynamicFriction as unknown as Friction,
            restitution: this._material.bounciness as unknown as Restitution,
            density: 1 as unknown as Density,
        };
    }

    protected _getFilter(): IMutableCollisionFilter3D {
        return this._filter;
    }

    protected _getWorldCenter(): IVec3Like {
        if (!this.transform) return this._center;
        const pos = this.transform.worldPosition;
        const rot = this.transform.worldRotation;
        return this._transformPoint(pos, rot, this._center);
    }

    protected _transformPoint(pos: IVec3Like, rot: IQuatLike, localPoint: IVec3Like): IVec3Like {
        const rx = rot.x * 2;
        const ry = rot.y * 2;
        const rz = rot.z * 2;
        const wx = rot.w * rx;
        const wy = rot.w * ry;
        const wz = rot.w * rz;
        const xx = rot.x * rx;
        const xy = rot.x * ry;
        const xz = rot.x * rz;
        const yy = rot.y * ry;
        const yz = rot.y * rz;
        const zz = rot.z * rz;
        return {
            x:
                pos.x +
                (1 - (yy + zz)) * localPoint.x +
                (xy - wz) * localPoint.y +
                (xz + wy) * localPoint.z,
            y:
                pos.y +
                (xy + wz) * localPoint.x +
                (1 - (xx + zz)) * localPoint.y +
                (yz - wx) * localPoint.z,
            z:
                pos.z +
                (xz - wy) * localPoint.x +
                (yz + wx) * localPoint.y +
                (1 - (xx + yy)) * localPoint.z,
        };
    }

    protected _setBounds(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number
    ): void {
        this._bounds.min.x = minX;
        this._bounds.min.y = minY;
        this._bounds.min.z = minZ;
        this._bounds.max.x = maxX;
        this._bounds.max.y = maxY;
        this._bounds.max.z = maxZ;
    }
}

@script({ scriptName: 'SphereCollider3D' })
export class SphereCollider3D extends Collider3D {
    private _radius: number = 0.5;
    get radius(): number {
        return this._radius;
    }
    set radius(value: number) {
        this._radius = Math.max(0.001, value);
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const def: ISphereShapeDef3D = { center: this._center, radius: this._radius };
        this._shapeId = this._shapeManager.createSphere(
            this._rigidbody.bodyId,
            def,
            this._getMaterial(),
            this._getFilter()
        );
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        this._setBounds(wc.x - sr, wc.y - sr, wc.z - sr, wc.x + sr, wc.y + sr, wc.z + sr);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        const dx = position.x - wc.x;
        const dy = position.y - wc.y;
        const dz = position.z - wc.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < sr) return position;
        const invDist = dist > 1e-10 ? sr / dist : 0;
        return { x: wc.x + dx * invDist, y: wc.y + dy * invDist, z: wc.z + dz * invDist };
    }

    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        const ox = ray.origin.x - wc.x;
        const oy = ray.origin.y - wc.y;
        const oz = ray.origin.z - wc.z;
        const a =
            ray.direction.x * ray.direction.x +
            ray.direction.y * ray.direction.y +
            ray.direction.z * ray.direction.z;
        const b = 2 * (ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z);
        const c = ox * ox + oy * oy + oz * oz - sr * sr;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return { hit: false };
        const sqD = Math.sqrt(disc);
        let t = (-b - sqD) / (2 * a);
        if (t < 0) t = (-b + sqD) / (2 * a);
        if (t < 0 || t > maxDistance) return { hit: false };
        const pt = {
            x: ray.origin.x + ray.direction.x * t,
            y: ray.origin.y + ray.direction.y * t,
            z: ray.origin.z + ray.direction.z * t,
        };
        const invL = 1 / sr;
        return {
            hit: true,
            point: pt,
            normal: { x: (pt.x - wc.x) * invL, y: (pt.y - wc.y) * invL, z: (pt.z - wc.z) * invL },
            distance: t,
        };
    }
}

@script({ scriptName: 'BoxCollider3D' })
export class BoxCollider3D extends Collider3D {
    private readonly _size: Vec3 = new Vec3(1, 1, 1);
    get size(): Readonly<Vec3> {
        return this._size;
    }
    set size(value: IVec3Like) {
        this._size.x = Math.max(0.001, value.x);
        this._size.y = Math.max(0.001, value.y);
        this._size.z = Math.max(0.001, value.z);
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const def: IBoxShapeDef3D = {
            center: this._center,
            halfExtents: { x: this._size.x * 0.5, y: this._size.y * 0.5, z: this._size.z * 0.5 },
        };
        this._shapeId = this._shapeManager.createBox(
            this._rigidbody.bodyId,
            def,
            this._getMaterial(),
            this._getFilter()
        );
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        this._setBounds(wc.x - hx, wc.y - hy, wc.z - hz, wc.x + hx, wc.y + hy, wc.z + hz);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        const lx = position.x - wc.x;
        const ly = position.y - wc.y;
        const lz = position.z - wc.z;
        return {
            x: wc.x + Math.max(-hx, Math.min(hx, lx)),
            y: wc.y + Math.max(-hy, Math.min(hy, ly)),
            z: wc.z + Math.max(-hz, Math.min(hz, lz)),
        };
    }

    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        const mnX = wc.x - hx;
        const mxX = wc.x + hx;
        const mnY = wc.y - hy;
        const mxY = wc.y + hy;
        const mnZ = wc.z - hz;
        const mxZ = wc.z + hz;
        let tmin = 0;
        let tmax = maxDistance;
        const normal = { x: 0, y: 0, z: 0 };
        const axes = [
            { min: mnX, max: mxX, o: ray.origin.x, d: ray.direction.x, n: { x: -1, y: 0, z: 0 } },
            { min: mnY, max: mxY, o: ray.origin.y, d: ray.direction.y, n: { x: 0, y: -1, z: 0 } },
            { min: mnZ, max: mxZ, o: ray.origin.z, d: ray.direction.z, n: { x: 0, y: 0, z: -1 } },
        ];
        for (const axis of axes) {
            if (Math.abs(axis.d) < 1e-10) {
                if (axis.o < axis.min || axis.o > axis.max) return { hit: false };
            } else {
                const invD = 1 / axis.d;
                let t1 = (axis.min - axis.o) * invD;
                let t2 = (axis.max - axis.o) * invD;
                let tn = axis.n;
                if (t1 > t2) {
                    const tmp = t1;
                    t1 = t2;
                    t2 = tmp;
                    tn = { x: -axis.n.x, y: -axis.n.y, z: -axis.n.z };
                }
                if (t1 > tmin) {
                    tmin = t1;
                    normal.x = tn.x;
                    normal.y = tn.y;
                    normal.z = tn.z;
                }
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return { hit: false };
            }
        }
        if (tmin < 0) return { hit: false };
        return {
            hit: true,
            point: {
                x: ray.origin.x + ray.direction.x * tmin,
                y: ray.origin.y + ray.direction.y * tmin,
                z: ray.origin.z + ray.direction.z * tmin,
            },
            normal,
            distance: tmin,
        };
    }
}

@script({ scriptName: 'CapsuleCollider3D' })
export class CapsuleCollider3D extends Collider3D {
    private _radius: number = 0.5;
    private _height: number = 2;
    private _direction: CapsuleDirection3D = CapsuleDirection3D.YAxis;
    get radius(): number {
        return this._radius;
    }
    set radius(value: number) {
        this._radius = Math.max(0.001, value);
        this._updateShape();
    }
    get height(): number {
        return this._height;
    }
    set height(value: number) {
        this._height = Math.max(this._radius * 2, value);
        this._updateShape();
    }
    get direction(): CapsuleDirection3D {
        return this._direction;
    }
    set direction(value: CapsuleDirection3D) {
        this._direction = value;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const hh = (this._height - this._radius * 2) * 0.5;
        let p1: IVec3Like;
        let p2: IVec3Like;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                p1 = { x: this._center.x - hh, y: this._center.y, z: this._center.z };
                p2 = { x: this._center.x + hh, y: this._center.y, z: this._center.z };
                break;
            case CapsuleDirection3D.YAxis:
                p1 = { x: this._center.x, y: this._center.y - hh, z: this._center.z };
                p2 = { x: this._center.x, y: this._center.y + hh, z: this._center.z };
                break;
            case CapsuleDirection3D.ZAxis:
                p1 = { x: this._center.x, y: this._center.y, z: this._center.z - hh };
                p2 = { x: this._center.x, y: this._center.y, z: this._center.z + hh };
                break;
        }
        const def: ICapsuleShapeDef3D = { p1, p2, radius: this._radius };
        this._shapeId = this._shapeManager.createCapsule(
            this._rigidbody.bodyId,
            def,
            this._getMaterial(),
            this._getFilter()
        );
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        let ex: number;
        let ey: number;
        let ez: number;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                ex = this._height * 0.5 * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.YAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._height * 0.5 * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.ZAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._height * 0.5 * Math.abs(s.z);
                break;
        }
        this._setBounds(wc.x - ex, wc.y - ey, wc.z - ez, wc.x + ex, wc.y + ey, wc.z + ez);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hh = (this._height - this._radius * 2) * 0.5;
        let aDir: IVec3Like;
        let aScale: number;
        let rScale: number;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                aDir = { x: 1, y: 0, z: 0 };
                aScale = Math.abs(s.x);
                rScale = Math.max(Math.abs(s.y), Math.abs(s.z));
                break;
            case CapsuleDirection3D.YAxis:
                aDir = { x: 0, y: 1, z: 0 };
                aScale = Math.abs(s.y);
                rScale = Math.max(Math.abs(s.x), Math.abs(s.z));
                break;
            case CapsuleDirection3D.ZAxis:
                aDir = { x: 0, y: 0, z: 1 };
                aScale = Math.abs(s.z);
                rScale = Math.max(Math.abs(s.x), Math.abs(s.y));
                break;
        }
        const sHH = hh * aScale;
        const sR = this._radius * rScale;
        const dx = position.x - wc.x;
        const dy = position.y - wc.y;
        const dz = position.z - wc.z;
        const proj = dx * aDir.x + dy * aDir.y + dz * aDir.z;
        const cProj = Math.max(-sHH, Math.min(sHH, proj));
        const cOA = {
            x: wc.x + aDir.x * cProj,
            y: wc.y + aDir.y * cProj,
            z: wc.z + aDir.z * cProj,
        };
        const tP = { x: position.x - cOA.x, y: position.y - cOA.y, z: position.z - cOA.z };
        const dist = Math.sqrt(tP.x * tP.x + tP.y * tP.y + tP.z * tP.z);
        if (dist < sR) return position;
        const invD = dist > 1e-10 ? sR / dist : 0;
        return { x: cOA.x + tP.x * invD, y: cOA.y + tP.y * invD, z: cOA.z + tP.z * invD };
    }

    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}

@script({ scriptName: 'MeshCollider3D' })
export class MeshCollider3D extends Collider3D {
    private _convex: boolean = true;
    private _vertices: Float32Array = new Float32Array(0);
    private _indices: Uint32Array = new Uint32Array(0);
    get convex(): boolean {
        return this._convex;
    }
    set convex(value: boolean) {
        this._convex = value;
        this._updateShape();
    }
    get vertices(): Readonly<Float32Array> {
        return this._vertices;
    }
    get indices(): Readonly<Uint32Array> {
        return this._indices;
    }
    setMesh(vertices: Float32Array, indices: Uint32Array): void {
        this._vertices = vertices;
        this._indices = indices;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        if (this._convex) {
            const vArr: IVec3Like[] = [];
            for (let i = 0; i < this._vertices.length; i += 3)
                vArr.push({
                    x: this._vertices[i],
                    y: this._vertices[i + 1],
                    z: this._vertices[i + 2],
                });
            const def: IConvexHullShapeDef3D = { vertices: vArr };
            this._shapeId = this._shapeManager.createConvexHull(
                this._rigidbody.bodyId,
                def,
                this._getMaterial(),
                this._getFilter()
            );
        }
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        if (this._vertices.length === 0) return;
        let mnX = Infinity;
        let mnY = Infinity;
        let mnZ = Infinity;
        let mxX = -Infinity;
        let mxY = -Infinity;
        let mxZ = -Infinity;
        for (let i = 0; i < this._vertices.length; i += 3) {
            const x = this._vertices[i];
            const y = this._vertices[i + 1];
            const z = this._vertices[i + 2];
            if (x < mnX) mnX = x;
            if (y < mnY) mnY = y;
            if (z < mnZ) mnZ = z;
            if (x > mxX) mxX = x;
            if (y > mxY) mxY = y;
            if (z > mxZ) mxZ = z;
        }
        const wp = this.transform?.worldPosition ?? Vec3.ZERO;
        this._setBounds(wp.x + mnX, wp.y + mnY, wp.z + mnZ, wp.x + mxX, wp.y + mxY, wp.z + mxZ);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        return position;
    }
    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}

@script({ scriptName: 'CylinderCollider3D' })
export class CylinderCollider3D extends Collider3D {
    private _radius: number = 0.5;
    private _height: number = 2;
    private _axis: CapsuleDirection3D = CapsuleDirection3D.YAxis;
    get radius(): number {
        return this._radius;
    }
    set radius(value: number) {
        this._radius = Math.max(0.001, value);
        this._updateShape();
    }
    get height(): number {
        return this._height;
    }
    set height(value: number) {
        this._height = Math.max(0.001, value);
        this._updateShape();
    }
    get axis(): CapsuleDirection3D {
        return this._axis;
    }
    set axis(value: CapsuleDirection3D) {
        this._axis = value;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const def: ICylinderShapeDef3D = {
            center: this._center,
            radius: this._radius,
            height: this._height,
            axis: this._axis,
        };
        this._shapeId = this._shapeManager.createCylinder(
            this._rigidbody.bodyId,
            def,
            this._getMaterial(),
            this._getFilter()
        );
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        let ex: number;
        let ey: number;
        let ez: number;
        switch (this._axis) {
            case CapsuleDirection3D.XAxis:
                ex = this._height * 0.5 * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.YAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._height * 0.5 * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.ZAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._height * 0.5 * Math.abs(s.z);
                break;
        }
        this._setBounds(wc.x - ex, wc.y - ey, wc.z - ez, wc.x + ex, wc.y + ey, wc.z + ez);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        return position;
    }
    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}

export { PhysicMaterialCombine, CapsuleDirection3D };
export type { IPhysicMaterial3D, IMutableCollisionFilter3D };
