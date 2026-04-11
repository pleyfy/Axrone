import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { Component } from '@axrone/ecs-runtime';
import type {
    Density,
    Friction,
    IMaterial,
    Restitution,
    ShapeId3D,
} from '../types';
import type { PhysicsWorld3D, ShapeManager3D } from '../core/physics-world-3d';
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

export const INVALID_SHAPE_ID = -1 as ShapeId3D;

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

export { PhysicMaterialCombine, CapsuleDirection3D };
export type { IPhysicMaterial3D, IMutableCollisionFilter3D };
