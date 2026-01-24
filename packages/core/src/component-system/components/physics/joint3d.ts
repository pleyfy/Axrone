import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { script } from '../../decorators';
import { Component } from '../../core/component';
import type { Rigidbody3D } from './rigidbody3d';
import type {
    ConstraintId3D,
    IFixedConstraintDef3D,
    IHingeConstraintDef3D,
    ISliderConstraintDef3D,
    ISpringConstraintDef3D,
    IConeTwistConstraintDef3D,
    IGenericConstraintDef3D,
} from '../../../physics/types/physics-3d';
import type { Torque, Force } from '../../../physics/types';
import type { PhysicsWorld3D, ConstraintManager3D } from '../../../physics/core/physics-world-3d';

const INVALID_CONSTRAINT_ID = -1 as ConstraintId3D;

const enum JointDriveMode3D {
    None = 0,
    Position = 1,
    Velocity = 2,
    PositionAndVelocity = 3,
}

interface IJointDrive3D {
    positionSpring: number;
    positionDamper: number;
    maximumForce: number;
    useAcceleration: boolean;
}
interface IJointLimits3D {
    min: number;
    max: number;
    bounciness: number;
    contactDistance: number;
}
interface IJointMotor3D {
    targetVelocity: number;
    force: number;
    freeSpin: boolean;
}
interface ISoftJointLimit3D {
    limit: number;
    bounciness: number;
    contactDistance: number;
}
interface ISoftJointLimitSpring3D {
    spring: number;
    damper: number;
}

const DEFAULT_JOINT_DRIVE: Readonly<IJointDrive3D> = {
    positionSpring: 0,
    positionDamper: 0,
    maximumForce: Infinity,
    useAcceleration: false,
};
const DEFAULT_JOINT_MOTOR: Readonly<IJointMotor3D> = {
    targetVelocity: 0,
    force: 0,
    freeSpin: false,
};
const DEFAULT_SOFT_JOINT_LIMIT: Readonly<ISoftJointLimit3D> = {
    limit: 0,
    bounciness: 0,
    contactDistance: 0,
};
const DEFAULT_SOFT_JOINT_LIMIT_SPRING: Readonly<ISoftJointLimitSpring3D> = { spring: 0, damper: 0 };

export abstract class Joint3D extends Component {
    protected _constraintId: ConstraintId3D = INVALID_CONSTRAINT_ID;
    protected _constraintManager: ConstraintManager3D | null = null;
    protected _world: PhysicsWorld3D | null = null;
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

    get constraintId(): ConstraintId3D {
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
        const len = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
        if (len < 1e-6) return;
        const invLen = 1 / len;
        this._axis.x = value.x * invLen;
        this._axis.y = value.y * invLen;
        this._axis.z = value.z * invLen;
        this._updateConstraint();
    }
    get secondaryAxis(): Readonly<Vec3> {
        return this._secondaryAxis;
    }
    set secondaryAxis(value: IVec3Like) {
        const len = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
        if (len < 1e-6) return;
        const invLen = 1 / len;
        this._secondaryAxis.x = value.x * invLen;
        this._secondaryAxis.y = value.y * invLen;
        this._secondaryAxis.z = value.z * invLen;
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

    initialize(world: PhysicsWorld3D, ownerBody: Rigidbody3D, connectedBody?: Rigidbody3D): void {
        this._world = world;
        this._constraintManager = world.getConstraintManager();
        this._connectedBody = connectedBody ?? null;
        this._createConstraint(ownerBody);
    }

    override fixedUpdate(deltaTime: number): void {
        if (!this._joint3dEnabled) return;
        this._checkBreakForce();
    }

    override onDestroy(): void {
        if (this._constraintManager && this._constraintId !== INVALID_CONSTRAINT_ID) {
            this._constraintManager.destroyConstraint(this._constraintId);
            this._constraintId = INVALID_CONSTRAINT_ID;
        }
        this._constraintManager = null;
        this._world = null;
        this._connectedBody = null;
    }

    protected abstract _createConstraint(ownerBody: Rigidbody3D): void;
    protected abstract _updateConstraint(): void;

    protected _recreateConstraint(): void {
        if (this._constraintId !== INVALID_CONSTRAINT_ID && this._constraintManager) {
            this._constraintManager.destroyConstraint(this._constraintId);
            this._constraintId = INVALID_CONSTRAINT_ID;
        }
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

    protected _checkBreakForce(): void {
        if (!this._constraintManager || this._constraintId === INVALID_CONSTRAINT_ID) return;
        const forceLen = Math.sqrt(
            this._currentForce.x * this._currentForce.x +
                this._currentForce.y * this._currentForce.y +
                this._currentForce.z * this._currentForce.z
        );
        const torqueLen = Math.sqrt(
            this._currentTorque.x * this._currentTorque.x +
                this._currentTorque.y * this._currentTorque.y +
                this._currentTorque.z * this._currentTorque.z
        );
        if (forceLen > this._breakForce || torqueLen > this._breakTorque) {
            this._constraintManager.destroyConstraint(this._constraintId);
            this._constraintId = INVALID_CONSTRAINT_ID;
        }
    }
}

@script({ scriptName: 'FixedJoint3D' })
export class FixedJoint3D extends Joint3D {
    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const def: IFixedConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localAnchorA: this._anchor,
            localAnchorB: this._connectedAnchor,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createFixed(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }
}

@script({ scriptName: 'HingeJoint3D' })
export class HingeJoint3D extends Joint3D {
    private _useLimits: boolean = false;
    private _useMotor: boolean = false;
    private readonly _limits: IJointLimits3D = {
        min: 0,
        max: 0,
        bounciness: 0,
        contactDistance: 0,
    };
    private readonly _motor: IJointMotor3D = { ...DEFAULT_JOINT_MOTOR };
    private _useSpring: boolean = false;
    private readonly _spring: ISoftJointLimitSpring3D = { ...DEFAULT_SOFT_JOINT_LIMIT_SPRING };
    private _angle: number = 0;
    private _velocity: number = 0;

    get useLimits(): boolean {
        return this._useLimits;
    }
    set useLimits(value: boolean) {
        this._useLimits = value;
        this._updateConstraint();
    }
    get limits(): Readonly<IJointLimits3D> {
        return this._limits;
    }
    set limits(value: Partial<IJointLimits3D>) {
        if (value.min !== undefined) this._limits.min = value.min;
        if (value.max !== undefined) this._limits.max = value.max;
        if (value.bounciness !== undefined)
            this._limits.bounciness = Math.max(0, Math.min(1, value.bounciness));
        if (value.contactDistance !== undefined)
            this._limits.contactDistance = Math.max(0, value.contactDistance);
        this._updateConstraint();
    }
    get useMotor(): boolean {
        return this._useMotor;
    }
    set useMotor(value: boolean) {
        this._useMotor = value;
        this._updateConstraint();
    }
    get motor(): Readonly<IJointMotor3D> {
        return this._motor;
    }
    set motor(value: Partial<IJointMotor3D>) {
        if (value.targetVelocity !== undefined) this._motor.targetVelocity = value.targetVelocity;
        if (value.force !== undefined) this._motor.force = Math.max(0, value.force);
        if (value.freeSpin !== undefined) this._motor.freeSpin = value.freeSpin;
        this._updateConstraint();
    }
    get useSpring(): boolean {
        return this._useSpring;
    }
    set useSpring(value: boolean) {
        this._useSpring = value;
        this._updateConstraint();
    }
    get spring(): Readonly<ISoftJointLimitSpring3D> {
        return this._spring;
    }
    set spring(value: Partial<ISoftJointLimitSpring3D>) {
        if (value.spring !== undefined) this._spring.spring = Math.max(0, value.spring);
        if (value.damper !== undefined) this._spring.damper = Math.max(0, value.damper);
        this._updateConstraint();
    }
    get angle(): number {
        return this._angle;
    }
    get velocity(): number {
        return this._velocity;
    }

    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const def: IHingeConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localAnchorA: this._anchor,
            localAnchorB: this._connectedAnchor,
            localAxisA: this._axis,
            localAxisB: this._axis,
            enableLimit: this._useLimits,
            lowerLimit: this._limits.min,
            upperLimit: this._limits.max,
            enableMotor: this._useMotor,
            motorSpeed: this._motor.targetVelocity,
            maxMotorTorque: this._motor.force as unknown as Torque,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createHinge(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }
}

@script({ scriptName: 'SliderJoint3D' })
export class SliderJoint3D extends Joint3D {
    private _useLimits: boolean = false;
    private _useMotor: boolean = false;
    private readonly _limits: IJointLimits3D = {
        min: 0,
        max: 0,
        bounciness: 0,
        contactDistance: 0,
    };
    private readonly _motor: IJointMotor3D = { ...DEFAULT_JOINT_MOTOR };
    private _useSpring: boolean = false;
    private readonly _spring: ISoftJointLimitSpring3D = { ...DEFAULT_SOFT_JOINT_LIMIT_SPRING };

    get useLimits(): boolean {
        return this._useLimits;
    }
    set useLimits(value: boolean) {
        this._useLimits = value;
        this._updateConstraint();
    }
    get limits(): Readonly<IJointLimits3D> {
        return this._limits;
    }
    set limits(value: Partial<IJointLimits3D>) {
        if (value.min !== undefined) this._limits.min = value.min;
        if (value.max !== undefined) this._limits.max = value.max;
        if (value.bounciness !== undefined)
            this._limits.bounciness = Math.max(0, Math.min(1, value.bounciness));
        if (value.contactDistance !== undefined)
            this._limits.contactDistance = Math.max(0, value.contactDistance);
        this._updateConstraint();
    }
    get useMotor(): boolean {
        return this._useMotor;
    }
    set useMotor(value: boolean) {
        this._useMotor = value;
        this._updateConstraint();
    }
    get motor(): Readonly<IJointMotor3D> {
        return this._motor;
    }
    set motor(value: Partial<IJointMotor3D>) {
        if (value.targetVelocity !== undefined) this._motor.targetVelocity = value.targetVelocity;
        if (value.force !== undefined) this._motor.force = Math.max(0, value.force);
        if (value.freeSpin !== undefined) this._motor.freeSpin = value.freeSpin;
        this._updateConstraint();
    }
    get useSpring(): boolean {
        return this._useSpring;
    }
    set useSpring(value: boolean) {
        this._useSpring = value;
        this._updateConstraint();
    }
    get spring(): Readonly<ISoftJointLimitSpring3D> {
        return this._spring;
    }
    set spring(value: Partial<ISoftJointLimitSpring3D>) {
        if (value.spring !== undefined) this._spring.spring = Math.max(0, value.spring);
        if (value.damper !== undefined) this._spring.damper = Math.max(0, value.damper);
        this._updateConstraint();
    }

    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const def: ISliderConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localAnchorA: this._anchor,
            localAnchorB: this._connectedAnchor,
            localAxisA: this._axis,
            enableLimit: this._useLimits,
            lowerLimit: this._limits.min,
            upperLimit: this._limits.max,
            enableMotor: this._useMotor,
            motorSpeed: this._motor.targetVelocity,
            maxMotorForce: this._motor.force as unknown as Force,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createSlider(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }
}

@script({ scriptName: 'SpringJoint3D' })
export class SpringJoint3D extends Joint3D {
    private _minDistance: number = 0;
    private _maxDistance: number = 0;
    private _spring: number = 0;
    private _damper: number = 0;
    private _tolerance: number = 0.025;
    private _autoConfigureDistance: boolean = true;

    get minDistance(): number {
        return this._minDistance;
    }
    set minDistance(value: number) {
        this._minDistance = Math.max(0, value);
        this._updateConstraint();
    }
    get maxDistance(): number {
        return this._maxDistance;
    }
    set maxDistance(value: number) {
        this._maxDistance = Math.max(0, value);
        this._updateConstraint();
    }
    get springValue(): number {
        return this._spring;
    }
    set springValue(value: number) {
        this._spring = Math.max(0, value);
        this._updateConstraint();
    }
    get damper(): number {
        return this._damper;
    }
    set damper(value: number) {
        this._damper = Math.max(0, value);
        this._updateConstraint();
    }
    get tolerance(): number {
        return this._tolerance;
    }
    set tolerance(value: number) {
        this._tolerance = Math.max(0, value);
    }
    get autoConfigureDistance(): boolean {
        return this._autoConfigureDistance;
    }
    set autoConfigureDistance(value: boolean) {
        this._autoConfigureDistance = value;
        if (value) this._configureDistance();
    }

    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const def: ISpringConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localAnchorA: this._anchor,
            localAnchorB: this._connectedAnchor,
            restLength: (this._minDistance + this._maxDistance) * 0.5,
            stiffness: this._spring,
            damping: this._damper,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createSpring(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }

    private _configureDistance(): void {
        if (!this._connectedBody || !this.transform) return;
        const worldAnchor = this._getWorldAnchor();
        const connectedWorldAnchor = this._transformPoint(
            this._connectedBody.position,
            this._connectedBody.rotation,
            this._connectedAnchor
        );
        const dx = worldAnchor.x - connectedWorldAnchor.x;
        const dy = worldAnchor.y - connectedWorldAnchor.y;
        const dz = worldAnchor.z - connectedWorldAnchor.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this._minDistance = dist;
        this._maxDistance = dist;
    }
}

@script({ scriptName: 'ConfigurableJoint3D' })
export class ConfigurableJoint3D extends Joint3D {
    private _xMotion: number = 0;
    private _yMotion: number = 0;
    private _zMotion: number = 0;
    private _angularXMotion: number = 0;
    private _angularYMotion: number = 0;
    private _angularZMotion: number = 0;
    private readonly _linearLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _linearLimitSpring: ISoftJointLimitSpring3D = {
        ...DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    };
    private readonly _lowAngularXLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _highAngularXLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _angularYLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _angularZLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _angularXLimitSpring: ISoftJointLimitSpring3D = {
        ...DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    };
    private readonly _angularYZLimitSpring: ISoftJointLimitSpring3D = {
        ...DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    };
    private readonly _xDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _yDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _zDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _angularXDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _angularYZDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _slerpDrive: IJointDrive3D = { ...DEFAULT_JOINT_DRIVE };
    private readonly _targetPosition: Vec3 = Vec3.create();
    private readonly _targetVelocity: Vec3 = Vec3.create();
    private readonly _targetRotation: Quat = Quat.create();
    private readonly _targetAngularVelocity: Vec3 = Vec3.create();
    private _rotationDriveMode: JointDriveMode3D = JointDriveMode3D.None;
    private _projectionMode: number = 0;
    private _projectionDistance: number = 0.1;
    private _projectionAngle: number = 180;
    private _configuredInWorldSpace: boolean = false;
    private _swapBodies: boolean = false;

    get xMotion(): number {
        return this._xMotion;
    }
    set xMotion(value: number) {
        this._xMotion = value;
        this._updateConstraint();
    }
    get yMotion(): number {
        return this._yMotion;
    }
    set yMotion(value: number) {
        this._yMotion = value;
        this._updateConstraint();
    }
    get zMotion(): number {
        return this._zMotion;
    }
    set zMotion(value: number) {
        this._zMotion = value;
        this._updateConstraint();
    }
    get angularXMotion(): number {
        return this._angularXMotion;
    }
    set angularXMotion(value: number) {
        this._angularXMotion = value;
        this._updateConstraint();
    }
    get angularYMotion(): number {
        return this._angularYMotion;
    }
    set angularYMotion(value: number) {
        this._angularYMotion = value;
        this._updateConstraint();
    }
    get angularZMotion(): number {
        return this._angularZMotion;
    }
    set angularZMotion(value: number) {
        this._angularZMotion = value;
        this._updateConstraint();
    }
    get linearLimit(): Readonly<ISoftJointLimit3D> {
        return this._linearLimit;
    }
    set linearLimit(value: Partial<ISoftJointLimit3D>) {
        if (value.limit !== undefined) this._linearLimit.limit = value.limit;
        if (value.bounciness !== undefined) this._linearLimit.bounciness = value.bounciness;
        if (value.contactDistance !== undefined)
            this._linearLimit.contactDistance = value.contactDistance;
        this._updateConstraint();
    }
    get targetPosition(): Readonly<Vec3> {
        return this._targetPosition;
    }
    set targetPosition(value: IVec3Like) {
        this._targetPosition.x = value.x;
        this._targetPosition.y = value.y;
        this._targetPosition.z = value.z;
        this._updateConstraint();
    }
    get targetVelocity(): Readonly<Vec3> {
        return this._targetVelocity;
    }
    set targetVelocity(value: IVec3Like) {
        this._targetVelocity.x = value.x;
        this._targetVelocity.y = value.y;
        this._targetVelocity.z = value.z;
        this._updateConstraint();
    }
    get targetRotation(): Readonly<Quat> {
        return this._targetRotation;
    }
    set targetRotation(value: IQuatLike) {
        this._targetRotation.x = value.x;
        this._targetRotation.y = value.y;
        this._targetRotation.z = value.z;
        this._targetRotation.w = value.w;
        this._updateConstraint();
    }
    get targetAngularVelocity(): Readonly<Vec3> {
        return this._targetAngularVelocity;
    }
    set targetAngularVelocity(value: IVec3Like) {
        this._targetAngularVelocity.x = value.x;
        this._targetAngularVelocity.y = value.y;
        this._targetAngularVelocity.z = value.z;
        this._updateConstraint();
    }
    get rotationDriveMode(): JointDriveMode3D {
        return this._rotationDriveMode;
    }
    set rotationDriveMode(value: JointDriveMode3D) {
        this._rotationDriveMode = value;
        this._updateConstraint();
    }
    get configuredInWorldSpace(): boolean {
        return this._configuredInWorldSpace;
    }
    set configuredInWorldSpace(value: boolean) {
        this._configuredInWorldSpace = value;
        this._updateConstraint();
    }
    get swapBodies(): boolean {
        return this._swapBodies;
    }
    set swapBodies(value: boolean) {
        this._swapBodies = value;
        this._recreateConstraint();
    }

    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const linLow: IVec3Like = {
            x: this._xMotion === 2 ? -this._linearLimit.limit : this._xMotion === 0 ? 0 : -Infinity,
            y: this._yMotion === 2 ? -this._linearLimit.limit : this._yMotion === 0 ? 0 : -Infinity,
            z: this._zMotion === 2 ? -this._linearLimit.limit : this._zMotion === 0 ? 0 : -Infinity,
        };
        const linUp: IVec3Like = {
            x: this._xMotion === 2 ? this._linearLimit.limit : this._xMotion === 0 ? 0 : Infinity,
            y: this._yMotion === 2 ? this._linearLimit.limit : this._yMotion === 0 ? 0 : Infinity,
            z: this._zMotion === 2 ? this._linearLimit.limit : this._zMotion === 0 ? 0 : Infinity,
        };
        const angLow: IVec3Like = {
            x:
                this._angularXMotion === 2
                    ? this._lowAngularXLimit.limit
                    : this._angularXMotion === 0
                      ? 0
                      : -Infinity,
            y:
                this._angularYMotion === 2
                    ? -this._angularYLimit.limit
                    : this._angularYMotion === 0
                      ? 0
                      : -Infinity,
            z:
                this._angularZMotion === 2
                    ? -this._angularZLimit.limit
                    : this._angularZMotion === 0
                      ? 0
                      : -Infinity,
        };
        const angUp: IVec3Like = {
            x:
                this._angularXMotion === 2
                    ? this._highAngularXLimit.limit
                    : this._angularXMotion === 0
                      ? 0
                      : Infinity,
            y:
                this._angularYMotion === 2
                    ? this._angularYLimit.limit
                    : this._angularYMotion === 0
                      ? 0
                      : Infinity,
            z:
                this._angularZMotion === 2
                    ? this._angularZLimit.limit
                    : this._angularZMotion === 0
                      ? 0
                      : Infinity,
        };
        const def: IGenericConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localFrameA: { position: this._anchor, rotation: Quat.IDENTITY },
            localFrameB: { position: this._connectedAnchor, rotation: Quat.IDENTITY },
            linearLowerLimit: linLow,
            linearUpperLimit: linUp,
            angularLowerLimit: angLow,
            angularUpperLimit: angUp,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createGeneric(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }
}

@script({ scriptName: 'CharacterJoint3D' })
export class CharacterJoint3D extends Joint3D {
    private _swingAxis: Vec3 = new Vec3(1, 0, 0);
    private readonly _lowTwistLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _highTwistLimit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _swing1Limit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _swing2Limit: ISoftJointLimit3D = { ...DEFAULT_SOFT_JOINT_LIMIT };
    private readonly _twistLimitSpring: ISoftJointLimitSpring3D = {
        ...DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    };
    private readonly _swingLimitSpring: ISoftJointLimitSpring3D = {
        ...DEFAULT_SOFT_JOINT_LIMIT_SPRING,
    };
    private _enableProjection: boolean = false;
    private _projectionDistance: number = 0.1;
    private _projectionAngle: number = 180;

    get swingAxis(): Readonly<Vec3> {
        return this._swingAxis;
    }
    set swingAxis(value: IVec3Like) {
        const len = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
        if (len < 1e-6) return;
        const invLen = 1 / len;
        this._swingAxis.x = value.x * invLen;
        this._swingAxis.y = value.y * invLen;
        this._swingAxis.z = value.z * invLen;
        this._updateConstraint();
    }
    get lowTwistLimit(): Readonly<ISoftJointLimit3D> {
        return this._lowTwistLimit;
    }
    set lowTwistLimit(value: Partial<ISoftJointLimit3D>) {
        if (value.limit !== undefined) this._lowTwistLimit.limit = value.limit;
        if (value.bounciness !== undefined) this._lowTwistLimit.bounciness = value.bounciness;
        if (value.contactDistance !== undefined)
            this._lowTwistLimit.contactDistance = value.contactDistance;
        this._updateConstraint();
    }
    get highTwistLimit(): Readonly<ISoftJointLimit3D> {
        return this._highTwistLimit;
    }
    set highTwistLimit(value: Partial<ISoftJointLimit3D>) {
        if (value.limit !== undefined) this._highTwistLimit.limit = value.limit;
        if (value.bounciness !== undefined) this._highTwistLimit.bounciness = value.bounciness;
        if (value.contactDistance !== undefined)
            this._highTwistLimit.contactDistance = value.contactDistance;
        this._updateConstraint();
    }
    get swing1Limit(): Readonly<ISoftJointLimit3D> {
        return this._swing1Limit;
    }
    set swing1Limit(value: Partial<ISoftJointLimit3D>) {
        if (value.limit !== undefined) this._swing1Limit.limit = value.limit;
        if (value.bounciness !== undefined) this._swing1Limit.bounciness = value.bounciness;
        if (value.contactDistance !== undefined)
            this._swing1Limit.contactDistance = value.contactDistance;
        this._updateConstraint();
    }
    get swing2Limit(): Readonly<ISoftJointLimit3D> {
        return this._swing2Limit;
    }
    set swing2Limit(value: Partial<ISoftJointLimit3D>) {
        if (value.limit !== undefined) this._swing2Limit.limit = value.limit;
        if (value.bounciness !== undefined) this._swing2Limit.bounciness = value.bounciness;
        if (value.contactDistance !== undefined)
            this._swing2Limit.contactDistance = value.contactDistance;
        this._updateConstraint();
    }
    get twistLimitSpring(): Readonly<ISoftJointLimitSpring3D> {
        return this._twistLimitSpring;
    }
    set twistLimitSpring(value: Partial<ISoftJointLimitSpring3D>) {
        if (value.spring !== undefined) this._twistLimitSpring.spring = value.spring;
        if (value.damper !== undefined) this._twistLimitSpring.damper = value.damper;
        this._updateConstraint();
    }
    get swingLimitSpring(): Readonly<ISoftJointLimitSpring3D> {
        return this._swingLimitSpring;
    }
    set swingLimitSpring(value: Partial<ISoftJointLimitSpring3D>) {
        if (value.spring !== undefined) this._swingLimitSpring.spring = value.spring;
        if (value.damper !== undefined) this._swingLimitSpring.damper = value.damper;
        this._updateConstraint();
    }
    get enableProjection(): boolean {
        return this._enableProjection;
    }
    set enableProjection(value: boolean) {
        this._enableProjection = value;
    }
    get projectionDistance(): number {
        return this._projectionDistance;
    }
    set projectionDistance(value: number) {
        this._projectionDistance = Math.max(0, value);
    }
    get projectionAngle(): number {
        return this._projectionAngle;
    }
    set projectionAngle(value: number) {
        this._projectionAngle = Math.max(0, value);
    }

    protected override _createConstraint(ownerBody: Rigidbody3D): void {
        if (!this._constraintManager || !this._connectedBody) return;
        const def: IConeTwistConstraintDef3D = {
            bodyIdA: ownerBody.bodyId,
            bodyIdB: this._connectedBody.bodyId,
            localFrameA: { position: this._anchor, rotation: Quat.IDENTITY },
            localFrameB: { position: this._connectedAnchor, rotation: Quat.IDENTITY },
            swingSpan1: this._swing1Limit.limit,
            swingSpan2: this._swing2Limit.limit,
            twistSpan: this._highTwistLimit.limit - this._lowTwistLimit.limit,
            softness: 1,
            biasFactor: 0.3,
            relaxationFactor: 1,
            collideConnected: this._enableCollision,
        };
        this._constraintId = this._constraintManager.createConeTwist(def);
    }
    protected override _updateConstraint(): void {
        if (this._constraintId === INVALID_CONSTRAINT_ID) return;
    }
}

export { JointDriveMode3D };
export type {
    IJointDrive3D,
    IJointLimits3D,
    IJointMotor3D,
    ISoftJointLimit3D,
    ISoftJointLimitSpring3D,
};
