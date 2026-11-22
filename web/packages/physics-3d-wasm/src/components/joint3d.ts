import { Vec3, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { Component } from '@axrone/ecs-runtime';
import type { WasmPhysicsWorld3DCompat } from '../compat';
import type { Rigidbody3D } from './rigidbody3d';

export const INVALID_CONSTRAINT_ID = -1;

/**
 * 3D joint solver capability matrix (WASM backend).
 *
 * The WASM backend supports fixed, hinge, and spring joints through the
 * compat adapter's createFixedJoint / createHingeJoint / createSpringJoint.
 */
export const JOINT_CAPABILITY_3D = {
    FIXED: 'full',
    SPRING: 'full',
    HINGE: 'full',
} as const;

export type JointCapability3D = typeof JOINT_CAPABILITY_3D[keyof typeof JOINT_CAPABILITY_3D];

export const enum JointDriveMode3D {
    None = 0,
    Position = 1,
    Velocity = 2,
    PositionAndVelocity = 3,
}

export interface IJointDrive3D {
    positionSpring: number;
    positionDamper: number;
    maximumForce: number;
    useAcceleration: boolean;
}
export interface IJointLimits3D {
    min: number;
    max: number;
    bounciness: number;
    contactDistance: number;
}
export interface IJointMotor3D {
    targetVelocity: number;
    force: number;
    freeSpin: boolean;
}
export interface ISoftJointLimit3D {
    limit: number;
    bounciness: number;
    contactDistance: number;
}
export interface ISoftJointLimitSpring3D {
    spring: number;
    damper: number;
}

export const DEFAULT_JOINT_DRIVE: Readonly<IJointDrive3D> = {
    positionSpring: 0,
    positionDamper: 0,
    maximumForce: Infinity,
    useAcceleration: false,
};
export const DEFAULT_JOINT_MOTOR: Readonly<IJointMotor3D> = {
    targetVelocity: 0,
    force: 0,
    freeSpin: false,
};
export const DEFAULT_SOFT_JOINT_LIMIT: Readonly<ISoftJointLimit3D> = {
    limit: 0,
    bounciness: 0,
    contactDistance: 0,
};
export const DEFAULT_SOFT_JOINT_LIMIT_SPRING: Readonly<ISoftJointLimitSpring3D> = {
    spring: 0,
    damper: 0,
};

/**
 * Abstract base class for all WASM-backed 3D joint components.
 *
 * Mirrors the serialized field names and structure of the reference
 * `Joint3D` in `physics-3d` so that scene snapshots load unchanged.
 *
 * The WASM compat adapter does not expose constraint creation methods.
 * Joint constraints are stored locally and can be materialized by a
 * higher-level bridge that has access to the inner WasmPhysicsWorld3D.
 */
export abstract class Joint3D extends Component {
    protected _constraintId: number = INVALID_CONSTRAINT_ID;
    protected _world: WasmPhysicsWorld3DCompat | null = null;
    protected _ownerBody: Rigidbody3D | null = null;
    protected _joint3dEnabled: boolean = true;
    protected _connectedBody: Rigidbody3D | null = null;
    protected _autoConfigureConnectedAnchor: boolean = true;
    protected readonly _anchor: Vec3 = Vec3.create();
    protected readonly _connectedAnchor: Vec3 = Vec3.create();
    protected readonly _axis: Vec3 = new Vec3(1, 0, 0);
    protected readonly _secondaryAxis: Vec3 = new Vec3(0, 1, 0);
    protected _breakForce: number = Infinity;
    protected _breakTorque: number = Infinity;
    protected _enableCollision: boolean = false;
    protected _enablePreprocessing: boolean = true;
    protected _massScale: number = 1;
    protected _connectedMassScale: number = 1;
    private readonly _currentForce: Vec3 = Vec3.create();
    private readonly _currentTorque: Vec3 = Vec3.create();

    get constraintId(): number {
        return this._constraintId;
    }

    get connectedBody(): Rigidbody3D | null {
        return this._connectedBody;
    }

    set connectedBody(value: Rigidbody3D | null) {
        if (this._connectedBody === value) return;
        this._connectedBody = value;
        if (this._autoConfigureConnectedAnchor && value) this._configureConnectedAnchor();
        this._recreateConstraint();
    }

    get autoConfigureConnectedAnchor(): boolean {
        return this._autoConfigureConnectedAnchor;
    }

    set autoConfigureConnectedAnchor(value: boolean) {
        this._autoConfigureConnectedAnchor = value;
        if (value && this._connectedBody) {
            this._configureConnectedAnchor();
            this._recreateConstraint();
        }
    }

    get anchor(): Readonly<Vec3> {
        return this._anchor;
    }

    set anchor(value: IVec3Like) {
        this._anchor.x = value.x;
        this._anchor.y = value.y;
        this._anchor.z = value.z;
        if (this._autoConfigureConnectedAnchor) this._configureConnectedAnchor();
        this._updateConstraint();
    }

    get connectedAnchor(): Readonly<Vec3> {
        return this._connectedAnchor;
    }

    set connectedAnchor(value: IVec3Like) {
        this._autoConfigureConnectedAnchor = false;
        this._connectedAnchor.x = value.x;
        this._connectedAnchor.y = value.y;
        this._connectedAnchor.z = value.z;
        this._updateConstraint();
    }

    get axis(): Readonly<Vec3> {
        return this._axis;
    }

    set axis(value: IVec3Like) {
        if (Vec3.len(value) < 1e-6) return;
        Vec3.normalize(value, this._axis);
        this._updateConstraint();
    }

    get secondaryAxis(): Readonly<Vec3> {
        return this._secondaryAxis;
    }

    set secondaryAxis(value: IVec3Like) {
        if (Vec3.len(value) < 1e-6) return;
        Vec3.normalize(value, this._secondaryAxis);
        this._updateConstraint();
    }

    get breakForce(): number {
        return this._breakForce;
    }

    set breakForce(value: number) {
        this._breakForce = Math.max(0, value);
    }

    get breakTorque(): number {
        return this._breakTorque;
    }

    set breakTorque(value: number) {
        this._breakTorque = Math.max(0, value);
    }

    get enableCollision(): boolean {
        return this._enableCollision;
    }

    set enableCollision(value: boolean) {
        this._enableCollision = value;
        this._updateConstraint();
    }

    get enablePreprocessing(): boolean {
        return this._enablePreprocessing;
    }

    set enablePreprocessing(value: boolean) {
        this._enablePreprocessing = value;
    }

    get massScale(): number {
        return this._massScale;
    }

    set massScale(value: number) {
        this._massScale = Math.max(0.0001, value);
    }

    get connectedMassScale(): number {
        return this._connectedMassScale;
    }

    set connectedMassScale(value: number) {
        this._connectedMassScale = Math.max(0.0001, value);
    }

    get currentForce(): Readonly<IVec3Like> {
        return this._currentForce;
    }

    get currentTorque(): Readonly<IVec3Like> {
        return this._currentTorque;
    }

    initialize(world: WasmPhysicsWorld3DCompat, ownerBody: Rigidbody3D, connectedBody?: Rigidbody3D): void {
        this._world = world;
        this._ownerBody = ownerBody;
        this._connectedBody = connectedBody ?? null;
        this._createConstraint(ownerBody);
    }

    override fixedUpdate(_deltaTime: number): void {
        if (!this._joint3dEnabled) return;
        // WASM compat does not expose reaction force/torque queries.
    }

    override onDestroy(): void {
        // WASM compat does not expose destroyConstraint; constraint ID is
        // tracked for bridge-level cleanup.
        this._constraintId = INVALID_CONSTRAINT_ID;
        this._world = null;
        this._ownerBody = null;
        this._connectedBody = null;
    }

    protected abstract _createConstraint(ownerBody: Rigidbody3D): void;
    protected abstract _updateConstraint(): void;

    protected _recreateConstraint(): void {
        this._constraintId = INVALID_CONSTRAINT_ID;
        if (!this._ownerBody) return;
        this._createConstraint(this._ownerBody);
    }

    protected _configureConnectedAnchor(): void {
        if (!this._connectedBody || !this.transform) return;
        const worldAnchor = this._getWorldAnchor();
        const connectedPos = this._connectedBody.position;
        this._connectedAnchor.x = worldAnchor.x - connectedPos.x;
        this._connectedAnchor.y = worldAnchor.y - connectedPos.y;
        this._connectedAnchor.z = worldAnchor.z - connectedPos.z;
    }

    protected _getWorldAnchor(): IVec3Like {
        if (!this.transform) return this._anchor;
        const pos = this.transform.worldPosition;
        const rot = this.transform.worldRotation;
        return this._transformPoint(pos, rot, this._anchor);
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

    protected _calculatePerpendicularAxis(): IVec3Like {
        const ax = this._axis.x;
        const ay = this._axis.y;
        const az = this._axis.z;
        let perpX: number;
        let perpY: number;
        let perpZ: number;
        if (Math.abs(ax) < 0.9) {
            perpX = ay;
            perpY = -ax;
            perpZ = 0;
        } else {
            perpX = 0;
            perpY = az;
            perpZ = -ay;
        }
        const invLen = 1 / Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
        return { x: perpX * invLen, y: perpY * invLen, z: perpZ * invLen };
    }

    /**
     * Normalize a serialized Vec3 value to {x, y, z} object format.
     * Supports both array [x,y,z] (Editor) and object {x,y,z} (engine).
     */
    protected normalizeVec3Value(
        value: unknown,
        fallbackX: number = 0,
        fallbackY: number = 0,
        fallbackZ: number = 0
    ): IVec3Like {
        if (Array.isArray(value) && value.length >= 3) {
            return {
                x: Number.isFinite(value[0]) ? value[0] : fallbackX,
                y: Number.isFinite(value[1]) ? value[1] : fallbackY,
                z: Number.isFinite(value[2]) ? value[2] : fallbackZ,
            };
        }
        if (value && typeof value === 'object') {
            const v = value as Record<string, unknown>;
            return {
                x: typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : fallbackX,
                y: typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : fallbackY,
                z: typeof v.z === 'number' && Number.isFinite(v.z) ? v.z : fallbackZ,
            };
        }
        return { x: fallbackX, y: fallbackY, z: fallbackZ };
    }

    /**
     * Normalize a serialized Quat value to {x, y, z, w} object format.
     */
    protected normalizeQuatValue(
        value: unknown,
        fallbackX: number = 0,
        fallbackY: number = 0,
        fallbackZ: number = 0,
        fallbackW: number = 1
    ): { x: number; y: number; z: number; w: number } {
        if (Array.isArray(value) && value.length >= 4) {
            return {
                x: Number.isFinite(value[0]) ? value[0] : fallbackX,
                y: Number.isFinite(value[1]) ? value[1] : fallbackY,
                z: Number.isFinite(value[2]) ? value[2] : fallbackZ,
                w: Number.isFinite(value[3]) ? value[3] : fallbackW,
            };
        }
        if (value && typeof value === 'object') {
            const v = value as Record<string, unknown>;
            return {
                x: typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : fallbackX,
                y: typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : fallbackY,
                z: typeof v.z === 'number' && Number.isFinite(v.z) ? v.z : fallbackZ,
                w: typeof v.w === 'number' && Number.isFinite(v.w) ? v.w : fallbackW,
            };
        }
        return { x: fallbackX, y: fallbackY, z: fallbackZ, w: fallbackW };
    }

    /**
     * Normalize a serialized reference value.
     * Editor sends "" for null references; normalize empties to null.
     */
    protected normalizeReferenceValue(value: unknown): unknown {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
            return value.trim() === '' ? null : value;
        }
        return value;
    }

    serialize(): Record<string, any> {
        return {
            connectedBody: '',
            anchor: { x: this._anchor.x, y: this._anchor.y, z: this._anchor.z },
            connectedAnchor: { x: this._connectedAnchor.x, y: this._connectedAnchor.y, z: this._connectedAnchor.z },
            autoConfigureConnectedAnchor: this._autoConfigureConnectedAnchor,
            axis: { x: this._axis.x, y: this._axis.y, z: this._axis.z },
            secondaryAxis: { x: this._secondaryAxis.x, y: this._secondaryAxis.y, z: this._secondaryAxis.z },
            breakForce: this._breakForce,
            breakTorque: this._breakTorque,
            enableCollision: this._enableCollision,
            enablePreprocessing: this._enablePreprocessing,
            massScale: this._massScale,
            connectedMassScale: this._connectedMassScale,
            enabled: this._joint3dEnabled,
        };
    }

    deserialize(data: Record<string, any>): void {
        const rawCB = data.connectedBody;
        if (rawCB !== undefined) {
            const normalised = this.normalizeReferenceValue(rawCB);
            this._connectedBody = (normalised as Rigidbody3D) ?? null;
        }
        if (data.anchor !== undefined) {
            const v = this.normalizeVec3Value(data.anchor);
            this._anchor.x = v.x;
            this._anchor.y = v.y;
            this._anchor.z = v.z;
        }
        if (data.connectedAnchor !== undefined) {
            const v = this.normalizeVec3Value(data.connectedAnchor);
            this._connectedAnchor.x = v.x;
            this._connectedAnchor.y = v.y;
            this._connectedAnchor.z = v.z;
        }
        if (data.autoConfigureConnectedAnchor !== undefined) {
            this._autoConfigureConnectedAnchor = data.autoConfigureConnectedAnchor;
        }
        if (data.axis !== undefined) {
            const v = this.normalizeVec3Value(data.axis, 1, 0, 0);
            this._axis.x = v.x;
            this._axis.y = v.y;
            this._axis.z = v.z;
        }
        if (data.secondaryAxis !== undefined) {
            const v = this.normalizeVec3Value(data.secondaryAxis, 0, 1, 0);
            this._secondaryAxis.x = v.x;
            this._secondaryAxis.y = v.y;
            this._secondaryAxis.z = v.z;
        }
        if (data.breakForce !== undefined) this._breakForce = data.breakForce;
        if (data.breakTorque !== undefined) this._breakTorque = data.breakTorque;
        if (data.enableCollision !== undefined) this._enableCollision = data.enableCollision;
        if (data.enablePreprocessing !== undefined) {
            this._enablePreprocessing = data.enablePreprocessing;
        } else if (data.preprocessing !== undefined) {
            this._enablePreprocessing = data.preprocessing;
        }
        if (data.massScale !== undefined) this._massScale = data.massScale;
        if (data.connectedMassScale !== undefined) this._connectedMassScale = data.connectedMassScale;
        if (data.enabled !== undefined) this._joint3dEnabled = data.enabled;
    }
}
