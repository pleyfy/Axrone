import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Component } from '@axrone/ecs-runtime';
import type { WasmPhysicsWorld3DCompat } from '../compat';
import {
    syncTransformWorldPose,
    syncTransformWorldPosition,
    syncTransformWorldRotation,
} from './transform-sync';

const enum Rigidbody3DType {
    Static = 0,
    Kinematic = 1,
    Dynamic = 2,
}

const enum ForceMode3D {
    Force = 0,
    Impulse = 1,
    VelocityChange = 2,
    Acceleration = 3,
}

const enum RigidbodyConstraints3D {
    None = 0,
    FreezePositionX = 1 << 0,
    FreezePositionY = 1 << 1,
    FreezePositionZ = 1 << 2,
    FreezeRotationX = 1 << 3,
    FreezeRotationY = 1 << 4,
    FreezeRotationZ = 1 << 5,
    FreezePosition = (1 << 0) | (1 << 1) | (1 << 2),
    FreezeRotation = (1 << 3) | (1 << 4) | (1 << 5),
    FreezeAll = 0x3f,
}

const enum CollisionDetectionMode3D {
    Discrete = 0,
    Continuous = 1,
    ContinuousDynamic = 2,
    ContinuousSpeculative = 3,
}

const enum RigidbodyInterpolation3D {
    None = 0,
    Interpolate = 1,
    Extrapolate = 2,
}

const SLEEPING_THRESHOLD = 0.005;
const TIME_TO_SLEEP = 0.5;
const MAX_ANGULAR_VELOCITY = 50;
const MAX_DEPENETRATION_VELOCITY = 10;

interface IRigidbody3DConfig {
    type?: Rigidbody3DType;
    mass?: number;
    linearDamping?: number;
    angularDamping?: number;
    gravityScale?: number;
    useGravity?: boolean;
    isKinematic?: boolean;
    constraints?: RigidbodyConstraints3D;
    interpolation?: RigidbodyInterpolation3D;
    collisionDetection?: CollisionDetectionMode3D;
    centerOfMass?: IVec3Like;
    inertiaTensor?: IVec3Like;
    inertiaTensorRotation?: IQuatLike;
    detectCollisions?: boolean;
    maxAngularVelocity?: number;
    maxDepenetrationVelocity?: number;
    sleepThreshold?: number;
}

/**
 * WASM-backed 3D physics body component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `Rigidbody3D` in `physics-3d` so that scene snapshots load unchanged.
 *
 * The WASM compat adapter exposes a subset of the reference PhysicsWorld3D
 * API. Operations not supported by the compat layer (setVelocity, applyForce,
 * setDamping, setGravityScale, setMassData, setAwake, setTransform) are
 * stored locally. The `syncTransformFromWorld()` method reads from the compat
 * world's `getTransform(bodyId)`.
 */
@script({ scriptName: 'Rigidbody3D', description: '3D physics body component' })
export class Rigidbody3D extends Component {
    private _bodyId: number = -1;
    private _world: WasmPhysicsWorld3DCompat | null = null;

    private _type: Rigidbody3DType = Rigidbody3DType.Dynamic;
    private _mass: number = 1;
    private _linearDamping: number = 0;
    private _angularDamping: number = 0.05;
    private _gravityScale: number = 1;
    private _useGravity: boolean = true;
    private _isKinematic: boolean = false;
    private _constraints: RigidbodyConstraints3D = RigidbodyConstraints3D.None;
    private _interpolation: RigidbodyInterpolation3D = RigidbodyInterpolation3D.None;
    private _collisionDetection: CollisionDetectionMode3D = CollisionDetectionMode3D.Discrete;
    private _detectCollisions: boolean = true;
    private _maxAngularVelocity: number = MAX_ANGULAR_VELOCITY;
    private _maxDepenetrationVelocity: number = MAX_DEPENETRATION_VELOCITY;
    private _sleepThreshold: number = SLEEPING_THRESHOLD;

    private readonly _centerOfMass: Vec3 = Vec3.create();
    private readonly _inertiaTensor: Vec3 = new Vec3(1, 1, 1);
    private readonly _inertiaTensorRotation: Quat = Quat.create();

    private readonly _previousPosition: Vec3 = Vec3.create();
    private readonly _previousRotation: Quat = Quat.create();

    // Locally-stored velocity state (compat adapter does not expose velocity read/write)
    private readonly _localVelocity: Vec3 = Vec3.create();
    private readonly _localAngularVelocity: Vec3 = Vec3.create();

    private _sleepTime: number = 0;
    private _isSleeping: boolean = false;
    private _rb3dEnabled: boolean = true;

    get bodyId(): number {
        return this._bodyId;
    }

    get bodyType(): Rigidbody3DType {
        return this._type;
    }

    set bodyType(value: Rigidbody3DType) {
        if (this._type === value) return;
        this._type = value;
        // WASM compat does not support runtime body-type changes; stored locally.
    }

    /**
     * Mass of the body (always > 0, minimum 0.0001).
     * Stored locally; the compat adapter does not expose setMassData.
     */
    get mass(): number {
        return this._mass;
    }

    set mass(value: number) {
        if (value <= 0) value = 0.0001;
        this._mass = value;
    }

    get linearDamping(): number {
        return this._linearDamping;
    }

    set linearDamping(value: number) {
        this._linearDamping = Math.max(0, value);
    }

    get angularDamping(): number {
        return this._angularDamping;
    }

    set angularDamping(value: number) {
        this._angularDamping = Math.max(0, value);
    }

    get gravityScale(): number {
        return this._gravityScale;
    }

    set gravityScale(value: number) {
        this._gravityScale = value;
    }

    get useGravity(): boolean {
        return this._useGravity;
    }

    set useGravity(value: boolean) {
        this._useGravity = value;
    }

    get isKinematic(): boolean {
        return this._isKinematic;
    }

    set isKinematic(value: boolean) {
        if (this._isKinematic === value) return;
        this._isKinematic = value;
        this._type = value ? Rigidbody3DType.Kinematic : Rigidbody3DType.Dynamic;
    }

    get constraints(): RigidbodyConstraints3D {
        return this._constraints;
    }

    set constraints(value: RigidbodyConstraints3D) {
        this._constraints = value;
    }

    get interpolation(): RigidbodyInterpolation3D {
        return this._interpolation;
    }

    set interpolation(value: RigidbodyInterpolation3D) {
        this._interpolation = value;
    }

    get collisionDetection(): CollisionDetectionMode3D {
        return this._collisionDetection;
    }

    set collisionDetection(value: CollisionDetectionMode3D) {
        this._collisionDetection = value;
    }

    get detectCollisions(): boolean {
        return this._detectCollisions;
    }

    set detectCollisions(value: boolean) {
        this._detectCollisions = value;
    }

    get maxAngularVelocity(): number {
        return this._maxAngularVelocity;
    }

    set maxAngularVelocity(value: number) {
        this._maxAngularVelocity = Math.max(0, value);
    }

    get maxDepenetrationVelocity(): number {
        return this._maxDepenetrationVelocity;
    }

    set maxDepenetrationVelocity(value: number) {
        this._maxDepenetrationVelocity = Math.max(0, value);
    }

    get sleepThreshold(): number {
        return this._sleepThreshold;
    }

    set sleepThreshold(value: number) {
        this._sleepThreshold = Math.max(0, value);
    }

    get isSleeping(): boolean {
        return this._isSleeping;
    }

    get velocity(): Readonly<IVec3Like> {
        return this._localVelocity;
    }

    set velocity(value: IVec3Like) {
        if (this._type !== Rigidbody3DType.Dynamic) return;
        const constrained = this._applyVelocityConstraints(value);
        this._localVelocity.x = constrained.x;
        this._localVelocity.y = constrained.y;
        this._localVelocity.z = constrained.z;
        this.wakeUp();
    }

    get angularVelocity(): Readonly<IVec3Like> {
        return this._localAngularVelocity;
    }

    set angularVelocity(value: IVec3Like) {
        if (this._type !== Rigidbody3DType.Dynamic) return;
        const clamped = this._clampAngularVelocity(this._applyAngularConstraints(value));
        this._localAngularVelocity.x = clamped.x;
        this._localAngularVelocity.y = clamped.y;
        this._localAngularVelocity.z = clamped.z;
        this.wakeUp();
    }

    get position(): Readonly<IVec3Like> {
        if (!this._world || this._bodyId === -1) {
            return this.transform?.worldPosition ?? Vec3.ZERO;
        }
        const snap = this._world.getTransform(this._bodyId);
        return { x: snap.position[0], y: snap.position[1], z: snap.position[2] };
    }

    set position(value: IVec3Like) {
        // WASM compat does not expose setTransform; update the ECS transform directly.
        syncTransformWorldPosition(this.transform, value);
    }

    get rotation(): Readonly<IQuatLike> {
        if (!this._world || this._bodyId === -1) {
            return this.transform?.worldRotation ?? Quat.IDENTITY;
        }
        const snap = this._world.getTransform(this._bodyId);
        return { x: snap.rotation[0], y: snap.rotation[1], z: snap.rotation[2], w: snap.rotation[3] };
    }

    set rotation(value: IQuatLike) {
        syncTransformWorldRotation(this.transform, value);
    }

    get centerOfMass(): Readonly<Vec3> {
        return this._centerOfMass;
    }

    set centerOfMass(value: IVec3Like) {
        this._centerOfMass.x = value.x;
        this._centerOfMass.y = value.y;
        this._centerOfMass.z = value.z;
    }

    get inertiaTensor(): Readonly<Vec3> {
        return this._inertiaTensor;
    }

    set inertiaTensor(value: IVec3Like) {
        this._inertiaTensor.x = value.x;
        this._inertiaTensor.y = value.y;
        this._inertiaTensor.z = value.z;
    }

    get inertiaTensorRotation(): Readonly<Quat> {
        return this._inertiaTensorRotation;
    }

    set inertiaTensorRotation(value: IQuatLike) {
        this._inertiaTensorRotation.x = value.x;
        this._inertiaTensorRotation.y = value.y;
        this._inertiaTensorRotation.z = value.z;
        this._inertiaTensorRotation.w = value.w;
    }

    get worldCenterOfMass(): IVec3Like {
        const localCom = this._centerOfMass;
        const rot = this.rotation;
        const pos = this.position;
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
            x: pos.x + (1 - (yy + zz)) * localCom.x + (xy - wz) * localCom.y + (xz + wy) * localCom.z,
            y: pos.y + (xy + wz) * localCom.x + (1 - (xx + zz)) * localCom.y + (yz - wx) * localCom.z,
            z: pos.z + (xz - wy) * localCom.x + (yz + wx) * localCom.y + (1 - (xx + yy)) * localCom.z,
        };
    }

    initialize(world: WasmPhysicsWorld3DCompat, config: IRigidbody3DConfig = {}): void {
        this._world = world;
        this._applyConfig(config);
        this._createBody();
    }

    /** WASM stub -- not implemented. */
    addForce(_force: IVec3Like, _mode: ForceMode3D = ForceMode3D.Force): void {
        throw new Error('addForce is not implemented in the WASM backend');
    }

    /** WASM stub -- not implemented. */
    addForceAtPosition(
        _force: IVec3Like,
        _position: IVec3Like,
        _mode: ForceMode3D = ForceMode3D.Force
    ): void {
        throw new Error('addForceAtPosition is not implemented in the WASM backend');
    }

    /** WASM stub -- not implemented. */
    addRelativeForce(_force: IVec3Like, _mode: ForceMode3D = ForceMode3D.Force): void {
        throw new Error('addRelativeForce is not implemented in the WASM backend');
    }

    /** WASM stub -- not implemented. */
    addTorque(_torque: IVec3Like, _mode: ForceMode3D = ForceMode3D.Force): void {
        throw new Error('addTorque is not implemented in the WASM backend');
    }

    /** WASM stub -- not implemented. */
    addRelativeTorque(_torque: IVec3Like, _mode: ForceMode3D = ForceMode3D.Force): void {
        throw new Error('addRelativeTorque is not implemented in the WASM backend');
    }

    /** WASM stub -- not implemented. */
    addExplosionForce(
        _force: number,
        _explosionPosition: IVec3Like,
        _explosionRadius: number,
        _upwardsModifier: number = 0,
        _mode: ForceMode3D = ForceMode3D.Force
    ): void {
        throw new Error('addExplosionForce is not implemented in the WASM backend');
    }

    getPointVelocity(worldPoint: IVec3Like): IVec3Like {
        const vel = this.velocity;
        const angVel = this.angularVelocity;
        const com = this.worldCenterOfMass;
        const rx = worldPoint.x - com.x;
        const ry = worldPoint.y - com.y;
        const rz = worldPoint.z - com.z;
        return {
            x: vel.x + angVel.y * rz - angVel.z * ry,
            y: vel.y + angVel.z * rx - angVel.x * rz,
            z: vel.z + angVel.x * ry - angVel.y * rx,
        };
    }

    getRelativePointVelocity(relativePoint: IVec3Like): IVec3Like {
        return this.getPointVelocity(relativePoint);
    }

    movePosition(position: IVec3Like): void {
        if (this._type !== Rigidbody3DType.Kinematic) return;
        this.position = position;
    }

    moveRotation(rotation: IQuatLike): void {
        if (this._type !== Rigidbody3DType.Kinematic) return;
        this.rotation = rotation;
    }

    sleep(): void {
        this._isSleeping = true;
        this._localVelocity.x = 0;
        this._localVelocity.y = 0;
        this._localVelocity.z = 0;
        this._localAngularVelocity.x = 0;
        this._localAngularVelocity.y = 0;
        this._localAngularVelocity.z = 0;
    }

    wakeUp(): void {
        this._isSleeping = false;
        this._sleepTime = 0;
    }

    isSleepingAllowed(): boolean {
        return this._type === Rigidbody3DType.Dynamic;
    }

    resetCenterOfMass(): void {
        this._centerOfMass.x = 0;
        this._centerOfMass.y = 0;
        this._centerOfMass.z = 0;
    }

    resetInertiaTensor(): void {
        this._inertiaTensor.x = 1;
        this._inertiaTensor.y = 1;
        this._inertiaTensor.z = 1;
        this._inertiaTensorRotation.x = 0;
        this._inertiaTensorRotation.y = 0;
        this._inertiaTensorRotation.z = 0;
        this._inertiaTensorRotation.w = 1;
    }

    closestPointOnBounds(position: IVec3Like): IVec3Like {
        return position;
    }

    override onLoad(): void {}

    override start(): void {
        this._storeState();
    }

    override fixedUpdate(deltaTime: number): void {
        if (!this._world || this._bodyId === -1 || !this._rb3dEnabled) return;
        if (this._interpolation !== RigidbodyInterpolation3D.None) this._storeState();
        this._updateSleepState(deltaTime);
    }

    /**
     * Read the physics world transform for this body and update the ECS
     * transform component accordingly.
     */
    syncTransformFromWorld(): void {
        if (!this._world || this._bodyId === -1 || !this.transform) return;
        const snap = this._world.getTransform(this._bodyId);
        const pos = snap.position;
        const rot = snap.rotation;

        if (this._interpolation === RigidbodyInterpolation3D.Interpolate) {
            const alpha = 0.5;
            const px = this._previousPosition.x + (pos[0] - this._previousPosition.x) * alpha;
            const py = this._previousPosition.y + (pos[1] - this._previousPosition.y) * alpha;
            const pz = this._previousPosition.z + (pos[2] - this._previousPosition.z) * alpha;
            // Linear interpolation of quaternion (approximation)
            const t = alpha;
            let qx = this._previousRotation.x + (rot[0] - this._previousRotation.x) * t;
            let qy = this._previousRotation.y + (rot[1] - this._previousRotation.y) * t;
            let qz = this._previousRotation.z + (rot[2] - this._previousRotation.z) * t;
            let qw = this._previousRotation.w + (rot[3] - this._previousRotation.w) * t;
            const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
            qx /= len; qy /= len; qz /= len; qw /= len;
            syncTransformWorldPose(this.transform, { x: px, y: py, z: pz }, { x: qx, y: qy, z: qz, w: qw });
        } else {
            syncTransformWorldPose(
                this.transform,
                { x: pos[0], y: pos[1], z: pos[2] },
                { x: rot[0], y: rot[1], z: rot[2], w: rot[3] }
            );
        }
    }

    override onDestroy(): void {
        if (this._world && this._bodyId !== -1) {
            this._world.destroyBody(this._bodyId);
            this._bodyId = -1;
        }
        this._world = null;
    }

    private _applyConfig(config: IRigidbody3DConfig): void {
        if (config.type !== undefined) this._type = config.type;
        if (config.mass !== undefined) this._mass = Math.max(0.0001, config.mass);
        if (config.linearDamping !== undefined) this._linearDamping = Math.max(0, config.linearDamping);
        if (config.angularDamping !== undefined) this._angularDamping = Math.max(0, config.angularDamping);
        if (config.gravityScale !== undefined) this._gravityScale = config.gravityScale;
        if (config.useGravity !== undefined) this._useGravity = config.useGravity;
        if (config.isKinematic !== undefined) {
            this._isKinematic = config.isKinematic;
            if (config.isKinematic) this._type = Rigidbody3DType.Kinematic;
        }
        if (config.constraints !== undefined) this._constraints = config.constraints;
        if (config.interpolation !== undefined) this._interpolation = config.interpolation;
        if (config.collisionDetection !== undefined) this._collisionDetection = config.collisionDetection;
        if (config.centerOfMass) {
            this._centerOfMass.x = config.centerOfMass.x;
            this._centerOfMass.y = config.centerOfMass.y;
            this._centerOfMass.z = config.centerOfMass.z;
        }
        if (config.inertiaTensor) {
            this._inertiaTensor.x = config.inertiaTensor.x;
            this._inertiaTensor.y = config.inertiaTensor.y;
            this._inertiaTensor.z = config.inertiaTensor.z;
        }
        if (config.inertiaTensorRotation) {
            this._inertiaTensorRotation.x = config.inertiaTensorRotation.x;
            this._inertiaTensorRotation.y = config.inertiaTensorRotation.y;
            this._inertiaTensorRotation.z = config.inertiaTensorRotation.z;
            this._inertiaTensorRotation.w = config.inertiaTensorRotation.w;
        }
        if (config.detectCollisions !== undefined) this._detectCollisions = config.detectCollisions;
        if (config.maxAngularVelocity !== undefined) this._maxAngularVelocity = Math.max(0, config.maxAngularVelocity);
        if (config.maxDepenetrationVelocity !== undefined) this._maxDepenetrationVelocity = Math.max(0, config.maxDepenetrationVelocity);
        if (config.sleepThreshold !== undefined) this._sleepThreshold = Math.max(0, config.sleepThreshold);
    }

    private _createBody(): void {
        if (!this._world) return;
        const worldPos = this.transform?.worldPosition ?? Vec3.ZERO;
        const worldRot = this.transform?.worldRotation ?? Quat.IDENTITY;
        this._bodyId = this._world.createBody({
            type: this._type as 0 | 1 | 2,
            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
            rotation: { x: worldRot.x, y: worldRot.y, z: worldRot.z, w: worldRot.w },
            allowSleep: this.isSleepingAllowed(),
        });
    }

    private _storeState(): void {
        if (!this._world || this._bodyId === -1) return;
        const snap = this._world.getTransform(this._bodyId);
        this._previousPosition.x = snap.position[0];
        this._previousPosition.y = snap.position[1];
        this._previousPosition.z = snap.position[2];
        this._previousRotation.x = snap.rotation[0];
        this._previousRotation.y = snap.rotation[1];
        this._previousRotation.z = snap.rotation[2];
        this._previousRotation.w = snap.rotation[3];
    }

    private _updateSleepState(dt: number): void {
        if (!this.isSleepingAllowed()) return;
        const vel = this._localVelocity;
        const angVel = this._localAngularVelocity;
        const kineticEnergy =
            vel.x * vel.x + vel.y * vel.y + vel.z * vel.z +
            angVel.x * angVel.x + angVel.y * angVel.y + angVel.z * angVel.z;
        if (kineticEnergy < this._sleepThreshold * this._sleepThreshold) {
            this._sleepTime += dt;
            if (this._sleepTime > TIME_TO_SLEEP) this.sleep();
        } else {
            this._sleepTime = 0;
            if (this._isSleeping) this.wakeUp();
        }
    }

    private _applyVelocityConstraints(velocity: IVec3Like): IVec3Like {
        return {
            x: this._constraints & RigidbodyConstraints3D.FreezePositionX ? 0 : velocity.x,
            y: this._constraints & RigidbodyConstraints3D.FreezePositionY ? 0 : velocity.y,
            z: this._constraints & RigidbodyConstraints3D.FreezePositionZ ? 0 : velocity.z,
        };
    }

    private _applyAngularConstraints(angularVelocity: IVec3Like): IVec3Like {
        return {
            x: this._constraints & RigidbodyConstraints3D.FreezeRotationX ? 0 : angularVelocity.x,
            y: this._constraints & RigidbodyConstraints3D.FreezeRotationY ? 0 : angularVelocity.y,
            z: this._constraints & RigidbodyConstraints3D.FreezeRotationZ ? 0 : angularVelocity.z,
        };
    }

    private _clampAngularVelocity(velocity: IVec3Like): IVec3Like {
        const sqLen = velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z;
        if (sqLen > this._maxAngularVelocity * this._maxAngularVelocity) {
            const scale = this._maxAngularVelocity / Math.sqrt(sqLen);
            return { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale };
        }
        return velocity;
    }
}

export {
    Rigidbody3DType,
    ForceMode3D,
    RigidbodyConstraints3D,
    CollisionDetectionMode3D,
    RigidbodyInterpolation3D,
};
export type { IRigidbody3DConfig };
