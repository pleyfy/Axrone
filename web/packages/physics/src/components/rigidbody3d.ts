import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { script } from '@axrone/ecs/decorators';
import { Component } from '@axrone/ecs';
import type {
    BodyId3D,
    BodyType,
    IPhysicsBodyDef3D,
} from '../types';
import type { BodyManager3D, PhysicsWorld3D } from '../core/physics-world-3d';

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

@script({ scriptName: 'Rigidbody3D', description: '3D physics body component' })
export class Rigidbody3D extends Component {
    private _bodyId: BodyId3D = -1 as BodyId3D;
    private _bodyManager: BodyManager3D | null = null;
    private _world: PhysicsWorld3D | null = null;

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
    private readonly _accumulatedForce: Vec3 = Vec3.create();
    private readonly _accumulatedTorque: Vec3 = Vec3.create();

    private _sleepTime: number = 0;
    private _isSleeping: boolean = false;
    private _rb3dEnabled: boolean = true;

    get bodyId(): BodyId3D {
        return this._bodyId;
    }

    get bodyType(): Rigidbody3DType {
        return this._type;
    }

    set bodyType(value: Rigidbody3DType) {
        if (this._type === value) return;
        this._type = value;
        this._syncBodyType();
    }

    get mass(): number {
        return this._mass;
    }

    set mass(value: number) {
        if (value <= 0) value = 0.0001;
        this._mass = value;
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.setMass(this._bodyId, value);
        }
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
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.setGravityScale(this._bodyId, this._useGravity ? value : 0);
        }
    }

    get useGravity(): boolean {
        return this._useGravity;
    }

    set useGravity(value: boolean) {
        this._useGravity = value;
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.setGravityScale(this._bodyId, value ? this._gravityScale : 0);
        }
    }

    get isKinematic(): boolean {
        return this._isKinematic;
    }

    set isKinematic(value: boolean) {
        if (this._isKinematic === value) return;
        this._isKinematic = value;
        this._type = value ? Rigidbody3DType.Kinematic : Rigidbody3DType.Dynamic;
        this._syncBodyType();
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
        if (!this._bodyManager || this._bodyId === -1) return Vec3.ZERO;
        return this._bodyManager.getLinearVelocity(this._bodyId);
    }

    set velocity(value: IVec3Like) {
        if (!this._bodyManager || this._bodyId === -1 || this._type !== Rigidbody3DType.Dynamic)
            return;
        this._bodyManager.setLinearVelocity(this._bodyId, this._applyVelocityConstraints(value));
        this.wakeUp();
    }

    get angularVelocity(): Readonly<IVec3Like> {
        if (!this._bodyManager || this._bodyId === -1) return Vec3.ZERO;
        return this._bodyManager.getAngularVelocity(this._bodyId);
    }

    set angularVelocity(value: IVec3Like) {
        if (!this._bodyManager || this._bodyId === -1 || this._type !== Rigidbody3DType.Dynamic)
            return;
        const clamped = this._clampAngularVelocity(this._applyAngularConstraints(value));
        this._bodyManager.setAngularVelocity(this._bodyId, clamped);
        this.wakeUp();
    }

    get position(): Readonly<IVec3Like> {
        if (!this._bodyManager || this._bodyId === -1) {
            return this.transform?.worldPosition ?? Vec3.ZERO;
        }
        return this._bodyManager.getPosition(this._bodyId);
    }

    set position(value: IVec3Like) {
        if (!this._bodyManager || this._bodyId === -1) return;
        this._bodyManager.setPosition(this._bodyId, value);
        if (this.transform) {
            this.transform.worldPosition = Vec3.from(value);
        }
    }

    get rotation(): Readonly<IQuatLike> {
        if (!this._bodyManager || this._bodyId === -1) {
            return this.transform?.worldRotation ?? Quat.IDENTITY;
        }
        return this._bodyManager.getRotation(this._bodyId);
    }

    set rotation(value: IQuatLike) {
        if (!this._bodyManager || this._bodyId === -1) return;
        this._bodyManager.setRotation(this._bodyId, value);
        if (this.transform) {
            this.transform.worldRotation = Quat.from(value);
        }
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
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.setInertiaTensor(this._bodyId, value);
        }
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
            x:
                pos.x +
                (1 - (yy + zz)) * localCom.x +
                (xy - wz) * localCom.y +
                (xz + wy) * localCom.z,
            y:
                pos.y +
                (xy + wz) * localCom.x +
                (1 - (xx + zz)) * localCom.y +
                (yz - wx) * localCom.z,
            z:
                pos.z +
                (xz - wy) * localCom.x +
                (yz + wx) * localCom.y +
                (1 - (xx + yy)) * localCom.z,
        };
    }

    initialize(world: PhysicsWorld3D, config: IRigidbody3DConfig = {}): void {
        this._world = world;
        this._bodyManager = world.getBodyManager();
        this._applyConfig(config);
        this._createBody();
    }

    addForce(force: IVec3Like, mode: ForceMode3D = ForceMode3D.Force): void {
        if (!this._bodyManager || this._bodyId === -1 || this._type !== Rigidbody3DType.Dynamic)
            return;
        const constrainedForce = this._applyVelocityConstraints(force);
        switch (mode) {
            case ForceMode3D.Force:
                Vec3.add(this._accumulatedForce, constrainedForce, this._accumulatedForce);
                break;
            case ForceMode3D.Impulse:
                this._bodyManager.applyImpulse(this._bodyId, constrainedForce);
                break;
            case ForceMode3D.VelocityChange: {
                const vel = this._bodyManager.getLinearVelocity(this._bodyId);
                this._bodyManager.setLinearVelocity(this._bodyId, {
                    x: vel.x + constrainedForce.x,
                    y: vel.y + constrainedForce.y,
                    z: vel.z + constrainedForce.z,
                });
                break;
            }
            case ForceMode3D.Acceleration:
                Vec3.add(
                    this._accumulatedForce,
                    {
                        x: constrainedForce.x * this._mass,
                        y: constrainedForce.y * this._mass,
                        z: constrainedForce.z * this._mass,
                    },
                    this._accumulatedForce
                );
                break;
        }
        this.wakeUp();
    }

    addForceAtPosition(
        force: IVec3Like,
        position: IVec3Like,
        mode: ForceMode3D = ForceMode3D.Force
    ): void {
        if (!this._bodyManager || this._bodyId === -1 || this._type !== Rigidbody3DType.Dynamic)
            return;
        const constrainedForce = this._applyVelocityConstraints(force);
        switch (mode) {
            case ForceMode3D.Force:
                Vec3.add(this._accumulatedForce, constrainedForce, this._accumulatedForce);
                this._addTorqueFromForceAtPosition(constrainedForce, position);
                break;
            case ForceMode3D.Impulse:
                this._bodyManager.applyImpulse(this._bodyId, constrainedForce, position);
                break;
            case ForceMode3D.VelocityChange:
            case ForceMode3D.Acceleration:
                this.addForce(force, mode);
                this._addTorqueFromForceAtPosition(constrainedForce, position);
                break;
        }
        this.wakeUp();
    }

    addRelativeForce(force: IVec3Like, mode: ForceMode3D = ForceMode3D.Force): void {
        const worldForce = this._transformDirection(force);
        this.addForce(worldForce, mode);
    }

    addTorque(torque: IVec3Like, mode: ForceMode3D = ForceMode3D.Force): void {
        if (!this._bodyManager || this._bodyId === -1 || this._type !== Rigidbody3DType.Dynamic)
            return;
        const constrainedTorque = this._applyAngularConstraints(torque);
        switch (mode) {
            case ForceMode3D.Force:
                Vec3.add(this._accumulatedTorque, constrainedTorque, this._accumulatedTorque);
                break;
            case ForceMode3D.Impulse: {
                const angVel = this._bodyManager.getAngularVelocity(this._bodyId);
                const invI = this._getInverseInertiaTensor();
                this._bodyManager.setAngularVelocity(this._bodyId, {
                    x: angVel.x + constrainedTorque.x * invI.x,
                    y: angVel.y + constrainedTorque.y * invI.y,
                    z: angVel.z + constrainedTorque.z * invI.z,
                });
                break;
            }
            case ForceMode3D.VelocityChange: {
                const angVel = this._bodyManager.getAngularVelocity(this._bodyId);
                this._bodyManager.setAngularVelocity(this._bodyId, {
                    x: angVel.x + constrainedTorque.x,
                    y: angVel.y + constrainedTorque.y,
                    z: angVel.z + constrainedTorque.z,
                });
                break;
            }
            case ForceMode3D.Acceleration:
                Vec3.add(
                    this._accumulatedTorque,
                    {
                        x: constrainedTorque.x * this._inertiaTensor.x,
                        y: constrainedTorque.y * this._inertiaTensor.y,
                        z: constrainedTorque.z * this._inertiaTensor.z,
                    },
                    this._accumulatedTorque
                );
                break;
        }
        this.wakeUp();
    }

    addRelativeTorque(torque: IVec3Like, mode: ForceMode3D = ForceMode3D.Force): void {
        const worldTorque = this._transformDirection(torque);
        this.addTorque(worldTorque, mode);
    }

    addExplosionForce(
        force: number,
        explosionPosition: IVec3Like,
        explosionRadius: number,
        upwardsModifier: number = 0,
        mode: ForceMode3D = ForceMode3D.Force
    ): void {
        const wcom = this.worldCenterOfMass;
        const dir = {
            x: wcom.x - explosionPosition.x,
            y: wcom.y - explosionPosition.y + upwardsModifier,
            z: wcom.z - explosionPosition.z,
        };
        const dist = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        if (dist > explosionRadius || dist < 1e-6) return;
        const invDist = 1 / dist;
        const normalizedDir = { x: dir.x * invDist, y: dir.y * invDist, z: dir.z * invDist };
        const effectiveFactor = 1 - dist / explosionRadius;
        const scaledForce = force * effectiveFactor;
        this.addForce(
            {
                x: normalizedDir.x * scaledForce,
                y: normalizedDir.y * scaledForce,
                z: normalizedDir.z * scaledForce,
            },
            mode
        );
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
        return this.getPointVelocity(this._transformPoint(relativePoint));
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
        if (!this._bodyManager || this._bodyId === -1) return;
        this._isSleeping = true;
        this._bodyManager.setAwake(this._bodyId, false);
        this._bodyManager.setLinearVelocity(this._bodyId, Vec3.ZERO);
        this._bodyManager.setAngularVelocity(this._bodyId, Vec3.ZERO);
    }

    wakeUp(): void {
        if (!this._bodyManager || this._bodyId === -1) return;
        this._isSleeping = false;
        this._sleepTime = 0;
        this._bodyManager.setAwake(this._bodyId, true);
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

    override awake(): void {}

    override start(): void {
        this._storeState();
    }

    override fixedUpdate(deltaTime: number): void {
        if (!this._bodyManager || this._bodyId === -1 || !this._rb3dEnabled) return;
        this._applyAccumulatedForces(deltaTime);
        if (this._interpolation !== RigidbodyInterpolation3D.None) this._storeState();
        this._updateSleepState(deltaTime);
        this._syncTransform();
    }

    override onDestroy(): void {
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.destroyBody(this._bodyId);
            this._bodyId = -1 as BodyId3D;
        }
        this._bodyManager = null;
        this._world = null;
    }

    private _applyConfig(config: IRigidbody3DConfig): void {
        if (config.type !== undefined) this._type = config.type;
        if (config.mass !== undefined) this._mass = Math.max(0.0001, config.mass);
        if (config.linearDamping !== undefined)
            this._linearDamping = Math.max(0, config.linearDamping);
        if (config.angularDamping !== undefined)
            this._angularDamping = Math.max(0, config.angularDamping);
        if (config.gravityScale !== undefined) this._gravityScale = config.gravityScale;
        if (config.useGravity !== undefined) this._useGravity = config.useGravity;
        if (config.isKinematic !== undefined) {
            this._isKinematic = config.isKinematic;
            if (config.isKinematic) this._type = Rigidbody3DType.Kinematic;
        }
        if (config.constraints !== undefined) this._constraints = config.constraints;
        if (config.interpolation !== undefined) this._interpolation = config.interpolation;
        if (config.collisionDetection !== undefined)
            this._collisionDetection = config.collisionDetection;
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
        if (config.maxAngularVelocity !== undefined)
            this._maxAngularVelocity = Math.max(0, config.maxAngularVelocity);
        if (config.maxDepenetrationVelocity !== undefined)
            this._maxDepenetrationVelocity = Math.max(0, config.maxDepenetrationVelocity);
        if (config.sleepThreshold !== undefined)
            this._sleepThreshold = Math.max(0, config.sleepThreshold);
    }

    private _createBody(): void {
        if (!this._bodyManager) return;
        const worldPos = this.transform?.worldPosition ?? Vec3.ZERO;
        const worldRot = this.transform?.worldRotation ?? Quat.IDENTITY;
        const def: IPhysicsBodyDef3D = {
            type: this._type as unknown as BodyType,
            position: worldPos,
            rotation: worldRot,
            linearDamping: this._linearDamping,
            angularDamping: this._angularDamping,
            gravityScale: this._useGravity ? this._gravityScale : 0,
            fixedRotation:
                this._constraints === RigidbodyConstraints3D.FreezeRotation ||
                this._constraints === RigidbodyConstraints3D.FreezeAll,
            bullet: this._collisionDetection !== CollisionDetectionMode3D.Discrete,
            allowSleep: this.isSleepingAllowed(),
            awake: true,
            enabled: this._rb3dEnabled,
        };
        this._bodyId = this._bodyManager.createBody(def);
        this._bodyManager.setMass(this._bodyId, this._mass);
        this._bodyManager.setInertiaTensor(this._bodyId, this._inertiaTensor);
    }

    private _syncBodyType(): void {
        if (this._bodyManager && this._bodyId !== -1) {
            this._bodyManager.setBodyType(this._bodyId, this._type as unknown as BodyType);
        }
    }

    private _syncTransform(): void {
        if (!this.transform || !this._bodyManager || this._bodyId === -1) return;
        const pos = this._bodyManager.getPosition(this._bodyId);
        const rot = this._bodyManager.getRotation(this._bodyId);
        if (this._interpolation === RigidbodyInterpolation3D.Interpolate) {
            const alpha = 0.5;
            const lerpedPos = Vec3.lerp(this._previousPosition, pos, alpha);
            const slerpedRot = Quat.slerp(this._previousRotation, rot, alpha);
            this.transform.worldPosition = Vec3.from(lerpedPos);
            this.transform.worldRotation = Quat.from(slerpedRot);
        } else {
            this.transform.worldPosition = Vec3.from(pos);
            this.transform.worldRotation = Quat.from(rot);
        }
    }

    private _storeState(): void {
        if (!this._bodyManager || this._bodyId === -1) return;
        const pos = this._bodyManager.getPosition(this._bodyId);
        const rot = this._bodyManager.getRotation(this._bodyId);
        this._previousPosition.x = pos.x;
        this._previousPosition.y = pos.y;
        this._previousPosition.z = pos.z;
        this._previousRotation.x = rot.x;
        this._previousRotation.y = rot.y;
        this._previousRotation.z = rot.z;
        this._previousRotation.w = rot.w;
    }

    private _applyAccumulatedForces(dt: number): void {
        if (!this._bodyManager || this._bodyId === -1) return;
        if (
            this._accumulatedForce.x !== 0 ||
            this._accumulatedForce.y !== 0 ||
            this._accumulatedForce.z !== 0
        ) {
            this._bodyManager.applyForceToCenter(this._bodyId, {
                x: this._accumulatedForce.x * dt,
                y: this._accumulatedForce.y * dt,
                z: this._accumulatedForce.z * dt,
            });
            this._accumulatedForce.x = 0;
            this._accumulatedForce.y = 0;
            this._accumulatedForce.z = 0;
        }
        if (
            this._accumulatedTorque.x !== 0 ||
            this._accumulatedTorque.y !== 0 ||
            this._accumulatedTorque.z !== 0
        ) {
            this._bodyManager.applyTorque(this._bodyId, {
                x: this._accumulatedTorque.x * dt,
                y: this._accumulatedTorque.y * dt,
                z: this._accumulatedTorque.z * dt,
            });
            this._accumulatedTorque.x = 0;
            this._accumulatedTorque.y = 0;
            this._accumulatedTorque.z = 0;
        }
    }

    private _updateSleepState(dt: number): void {
        if (!this.isSleepingAllowed()) return;
        const vel = this.velocity;
        const angVel = this.angularVelocity;
        const kineticEnergy =
            vel.x * vel.x +
            vel.y * vel.y +
            vel.z * vel.z +
            angVel.x * angVel.x +
            angVel.y * angVel.y +
            angVel.z * angVel.z;
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

    private _transformDirection(localDir: IVec3Like): IVec3Like {
        const rot = this.rotation;
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
            x: (1 - (yy + zz)) * localDir.x + (xy - wz) * localDir.y + (xz + wy) * localDir.z,
            y: (xy + wz) * localDir.x + (1 - (xx + zz)) * localDir.y + (yz - wx) * localDir.z,
            z: (xz - wy) * localDir.x + (yz + wx) * localDir.y + (1 - (xx + yy)) * localDir.z,
        };
    }

    private _transformPoint(localPoint: IVec3Like): IVec3Like {
        const worldDir = this._transformDirection(localPoint);
        const pos = this.position;
        return { x: pos.x + worldDir.x, y: pos.y + worldDir.y, z: pos.z + worldDir.z };
    }

    private _addTorqueFromForceAtPosition(force: IVec3Like, position: IVec3Like): void {
        const com = this.worldCenterOfMass;
        const rx = position.x - com.x;
        const ry = position.y - com.y;
        const rz = position.z - com.z;
        const torque = {
            x: ry * force.z - rz * force.y,
            y: rz * force.x - rx * force.z,
            z: rx * force.y - ry * force.x,
        };
        Vec3.add(this._accumulatedTorque, torque, this._accumulatedTorque);
    }

    private _getInverseInertiaTensor(): IVec3Like {
        return {
            x: this._inertiaTensor.x > 0 ? 1 / this._inertiaTensor.x : 0,
            y: this._inertiaTensor.y > 0 ? 1 / this._inertiaTensor.y : 0,
            z: this._inertiaTensor.z > 0 ? 1 / this._inertiaTensor.z : 0,
        };
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
