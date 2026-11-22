import { Vec3, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { Component } from '@axrone/ecs-runtime';
import type { WasmPhysicsWorld3DCompat } from '../compat';
import type { Rigidbody3D } from './rigidbody3d';

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
    density: number;
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
    density: 1,
    frictionCombine: PhysicMaterialCombine.Average,
    bounceCombine: PhysicMaterialCombine.Average,
};

const enum CapsuleDirection3D {
    XAxis = 0,
    YAxis = 1,
    ZAxis = 2,
}

export const INVALID_SHAPE_ID = -1;

/**
 * Abstract base class for all WASM-backed 3D collider components.
 *
 * Mirrors the serialized field names and structure of the reference
 * `Collider3D` in `physics-3d` so that scene snapshots load unchanged.
 */
export abstract class Collider3D extends Component {
    protected _shapeId: number = INVALID_SHAPE_ID;
    protected _world: WasmPhysicsWorld3DCompat | null = null;
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

    get shapeId(): number {
        return this._shapeId;
    }

    get isTrigger(): boolean {
        return this._isTrigger;
    }

    set isTrigger(value: boolean) {
        if (this._isTrigger === value) return;
        this._isTrigger = value;
        this._updateShape();
    }

    get providesContacts(): boolean {
        return this._providesContacts;
    }

    set providesContacts(value: boolean) {
        if (this._providesContacts === value) return;
        this._providesContacts = value;
        this._updateShape();
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
        if (value.staticFriction !== undefined) this._material.staticFriction = Math.max(0, value.staticFriction);
        if (value.dynamicFriction !== undefined) this._material.dynamicFriction = Math.max(0, value.dynamicFriction);
        if (value.bounciness !== undefined) this._material.bounciness = Math.max(0, Math.min(1, value.bounciness));
        if (value.density !== undefined) this._material.density = Math.max(0, value.density);
        if (value.frictionCombine !== undefined) this._material.frictionCombine = value.frictionCombine;
        if (value.bounceCombine !== undefined) this._material.bounceCombine = value.bounceCombine;
        this._updateShape();
    }

    get categoryBits(): number {
        return this._filter.categoryBits;
    }

    set categoryBits(value: number) {
        if (this._filter.categoryBits === value) return;
        this._filter.categoryBits = value;
        this._updateShape();
    }

    get maskBits(): number {
        return this._filter.maskBits;
    }

    set maskBits(value: number) {
        if (this._filter.maskBits === value) return;
        this._filter.maskBits = value;
        this._updateShape();
    }

    get groupIndex(): number {
        return this._filter.groupIndex;
    }

    set groupIndex(value: number) {
        if (this._filter.groupIndex === value) return;
        this._filter.groupIndex = value;
        this._updateShape();
    }

    initialize(world: WasmPhysicsWorld3DCompat, rigidbody?: Rigidbody3D): void {
        this._world = world;
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
        this._destroyCurrentShape();
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

    protected _getCompatMaterial(): { friction: number; restitution: number } {
        return {
            friction: Math.sqrt(this._material.staticFriction * this._material.dynamicFriction),
            restitution: this._material.bounciness,
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
        const qx = rot.x, qy = rot.y, qz = rot.z, qw = rot.w;
        const ix = qw * localPoint.x + qy * localPoint.z - qz * localPoint.y;
        const iy = qw * localPoint.y + qz * localPoint.x - qx * localPoint.z;
        const iz = qw * localPoint.z + qx * localPoint.y - qy * localPoint.x;
        const iw = -qx * localPoint.x - qy * localPoint.y - qz * localPoint.z;
        return {
            x: pos.x + ix * qw - iw * qx - iy * qz + iz * qy,
            y: pos.y + iy * qw - iw * qy - iz * qx + ix * qz,
            z: pos.z + iz * qw - iw * qz - ix * qy + iy * qx,
        };
    }

    protected _getWorldScale(): Readonly<IVec3Like> {
        return this.transform?.worldScale ?? { x: 1, y: 1, z: 1 };
    }

    protected _setBounds(
        minX: number, minY: number, minZ: number,
        maxX: number, maxY: number, maxZ: number
    ): void {
        this._bounds.min.x = minX;
        this._bounds.min.y = minY;
        this._bounds.min.z = minZ;
        this._bounds.max.x = maxX;
        this._bounds.max.y = maxY;
        this._bounds.max.z = maxZ;
    }

    protected _destroyCurrentShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
        if (this._world) {
            this._world.destroyShape(this._shapeId);
        }
        this._shapeId = INVALID_SHAPE_ID;
    }
}

export { PhysicMaterialCombine, CapsuleDirection3D };
export type { IPhysicMaterial3D, IMutableCollisionFilter3D };
