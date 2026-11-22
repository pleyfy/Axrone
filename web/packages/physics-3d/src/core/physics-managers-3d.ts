import type { IVec3Like, IQuatLike } from '@axrone/numeric';
import type {
    BodyId3D,
    ConstraintId3D,
    IBoxShapeDef3D,
    ICapsuleShapeDef3D,
    ICollisionFilter3D,
    IConeShapeDef3D,
    IConeTwistConstraintDef3D,
    IConvexHullShapeDef3D,
    IFixedConstraintDef3D,
    IGenericConstraintDef3D,
    IHeightFieldShapeDef3D,
    IHingeConstraintDef3D,
    IPhysicsBodyDef3D,
    ISliderConstraintDef3D,
    ISphereShapeDef3D,
    ISpringConstraintDef3D,
    ICylinderShapeDef3D,
    ITriangleMeshShapeDef3D,
    ShapeId3D,
} from '../types/physics-3d';
import type { BodyType, IMaterial } from '../types';
import { BodyFlags, BodyType as BodyTypeEnum, ShapeType } from '../types';

const BODY_TYPE_DYNAMIC = BodyTypeEnum.Dynamic;

const POSITION_STRIDE = 8;
const VELOCITY_STRIDE = 8;
const MASS_STRIDE = 16;
const CONSTRAINT_STRIDE = 32;

const POSITION_OFFSET = 0;
const ROTATION_OFFSET = 3;
const LINEAR_VEL_OFFSET = 0;
const ANGULAR_VEL_OFFSET = 3;

/**
 * Row layout of the body manager structure-of-arrays. Exported for the contact
 * solver, which reads and writes rows directly (see `resolveIndex` and the
 * `*Raw()` views on {@link BodyManager3D}).
 */
export const BODY_LAYOUT = {
    positionStride: POSITION_STRIDE,
    velocityStride: VELOCITY_STRIDE,
    massStride: MASS_STRIDE,
    positionOffset: POSITION_OFFSET,
    rotationOffset: ROTATION_OFFSET,
    linearVelocityOffset: LINEAR_VEL_OFFSET,
    angularVelocityOffset: ANGULAR_VEL_OFFSET,
    mass: 0,
    inverseMass: 1,
    inertia: 2,
    inverseInertia: 5,
} as const;

type ErrorCode3D =
    | 'INVALID_STATE'
    | 'NOT_FOUND'
    | 'CAPACITY_EXCEEDED'
    | 'INVALID_ARGUMENT'
    | 'DUPLICATE'
    | 'PERMISSION_DENIED';

export class PhysicsError3D<TCode extends ErrorCode3D = ErrorCode3D> extends Error {
    readonly code: TCode;
    readonly timestamp: number;
    readonly context: Readonly<Record<string, unknown>>;

    constructor(message: string, code: TCode, context: Record<string, unknown> = {}) {
        super(message);
        this.name = 'PhysicsError3D';
        this.code = code;
        this.timestamp = performance.now();
        this.context = Object.freeze({ ...context });
        Object.setPrototypeOf(this, PhysicsError3D.prototype);
    }

    withContext(additional: Record<string, unknown>): PhysicsError3D<TCode> {
        return new PhysicsError3D<TCode>(this.message, this.code, {
            ...this.context,
            ...additional,
        });
    }
}

export interface IShapeCreateOptions3D {
    readonly isSensor?: boolean;
}

export class BodyManager3D implements Disposable {
    private _nextBodyId = 1n;
    private _bodyCount = 0n;
    private readonly _maxBodies: number;
    private readonly _bodyIdToIndex = new Map<BodyId3D, number>();
    private readonly _freeList: number[] = [];
    private readonly _userData = new Map<BodyId3D, unknown>();

    private readonly _positions: Float64Array;
    private readonly _velocities: Float64Array;
    private readonly _massData: Float64Array;
    private readonly _bodyTypes: Uint8Array;
    private readonly _bodyFlags: Uint32Array;
    private readonly _gravityScales: Float32Array;
    private readonly _dampings: Float32Array;
    private readonly _forces: Float64Array;
    private readonly _torques: Float64Array;
    /** Called when a KINEMATIC body's position or rotation changes. (P1-4) */
    private _onKinematicTransformChange: ((bodyId: BodyId3D) => void) | null = null;

    constructor(maxBodies: number = 4096) {
        this._maxBodies = maxBodies;
        this._positions = new Float64Array(maxBodies * POSITION_STRIDE);
        this._velocities = new Float64Array(maxBodies * VELOCITY_STRIDE);
        this._massData = new Float64Array(maxBodies * MASS_STRIDE);
        this._bodyTypes = new Uint8Array(maxBodies);
        this._bodyFlags = new Uint32Array(maxBodies);
        this._gravityScales = new Float32Array(maxBodies);
        this._dampings = new Float32Array(maxBodies * 2);
        this._forces = new Float64Array(maxBodies * 3);
        this._torques = new Float64Array(maxBodies * 3);

        for (let i = 0; i < maxBodies; i++) {
            // Identity quaternion (w = 1) and neutral gravity scale defaults.
            this._positions[i * POSITION_STRIDE + ROTATION_OFFSET + 3] = 1;
            this._gravityScales[i] = 1;
        }
    }

    get bodyCount(): number { return Number(this._bodyCount); }

    createBody(def: IPhysicsBodyDef3D): BodyId3D {
        if (Number(this._bodyCount) >= this._maxBodies && this._freeList.length === 0) {
            throw new PhysicsError3D('Body capacity exceeded', 'CAPACITY_EXCEEDED');
        }

        const bodyId = this._nextBodyId as unknown as BodyId3D;
        this._nextBodyId += 1n;
        const index = this._allocateIndex();
        this._bodyIdToIndex.set(bodyId, index);

        const posOffset = index * POSITION_STRIDE;
        if (def.position) {
            this._positions[posOffset] = def.position.x;
            this._positions[posOffset + 1] = def.position.y;
            this._positions[posOffset + 2] = def.position.z;
        }

        if (def.rotation) {
            this._writeQuat(posOffset + ROTATION_OFFSET, def.rotation);
        } else {
            this._positions[posOffset + ROTATION_OFFSET + 3] = 1;
        }

        const velOffset = index * VELOCITY_STRIDE;
        if (def.linearVelocity) {
            this._velocities[velOffset] = def.linearVelocity.x;
            this._velocities[velOffset + 1] = def.linearVelocity.y;
            this._velocities[velOffset + 2] = def.linearVelocity.z;
        }

        if (def.angularVelocity) {
            this._velocities[velOffset + ANGULAR_VEL_OFFSET] = def.angularVelocity.x;
            this._velocities[velOffset + ANGULAR_VEL_OFFSET + 1] = def.angularVelocity.y;
            this._velocities[velOffset + ANGULAR_VEL_OFFSET + 2] = def.angularVelocity.z;
        }

        const type = def.type === undefined ? BodyTypeEnum.Dynamic : def.type;
        this._bodyTypes[index] = type;
        this._gravityScales[index] = def.gravityScale ?? 1;
        this._dampings[index * 2] = def.linearDamping ?? 0;
        this._dampings[index * 2 + 1] = def.angularDamping ?? 0;

        let flags = 0;
        if (def.fixedRotation === true) flags |= BodyFlags.FixedRotation;
        if (def.bullet === true) flags |= BodyFlags.Bullet;
        if (def.allowSleep !== false) flags |= BodyFlags.AutoSleep;
        if (def.awake !== false) flags |= BodyFlags.Awake;
        if (def.enabled !== false) flags |= BodyFlags.Active;
        this._bodyFlags[index] = flags;

        const massOffset = index * MASS_STRIDE;
        if (type === BODY_TYPE_DYNAMIC) {
            this._massData[massOffset] = 1;
            this._massData[massOffset + 1] = 1;
        } else {
            for (let i = 0; i < MASS_STRIDE; i++) this._massData[massOffset + i] = 0;
        }

        if (def.userData !== undefined) {
            this._userData.set(bodyId, def.userData);
        }

        this._bodyCount += 1n;
        return bodyId;
    }

    destroyBody(bodyId: BodyId3D): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        this._bodyIdToIndex.delete(bodyId);
        this._freeList.push(index);

        for (let i = 0; i < POSITION_STRIDE; i++) this._positions[index * POSITION_STRIDE + i] = 0;
        this._velocities.fill(0, index * VELOCITY_STRIDE, index * VELOCITY_STRIDE + VELOCITY_STRIDE);
        this._bodyTypes[index] = 0;
        this._bodyFlags[index] = 0;
        this._gravityScales[index] = 1;
        this._dampings[index * 2] = 0;
        this._dampings[index * 2 + 1] = 0;

        const massOffset = index * MASS_STRIDE;
        for (let i = 0; i < MASS_STRIDE; i++) this._massData[massOffset + i] = 0;

        if (this._userData.has(bodyId)) {
            this._userData.delete(bodyId);
        }

        this._bodyCount -= 1n;
    }

    hasBody(bodyId: BodyId3D): boolean { return this._bodyIdToIndex.has(bodyId); }

    getPosition(bodyId: BodyId3D, out?: IVec3Like): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };
        return this._readVec(this._positions, index * POSITION_STRIDE + POSITION_OFFSET, out);
    }

    setPosition(bodyId: BodyId3D, position: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        const offset = index * POSITION_STRIDE + POSITION_OFFSET;
        this._positions[offset] = position.x;
        this._positions[offset + 1] = position.y;
        this._positions[offset + 2] = position.z;
        if (this._onKinematicTransformChange && this._bodyTypes[index] === 1) {
            this._onKinematicTransformChange(bodyId);
        }
    }

    getRotation(bodyId: BodyId3D, out?: IQuatLike): IQuatLike {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0, w: 1 };
        return this._readQuat(this._positions, index * POSITION_STRIDE + ROTATION_OFFSET, out);
    }

    setRotation(bodyId: BodyId3D, rotation: IQuatLike): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        this._writeQuat(index * POSITION_STRIDE + ROTATION_OFFSET, rotation);
        if (this._onKinematicTransformChange && this._bodyTypes[index] === 1) {
            this._onKinematicTransformChange(bodyId);
        }
    }

    getLinearVelocity(bodyId: BodyId3D, out?: IVec3Like): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };
        return this._readVec(this._velocities, index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET, out);
    }

    setLinearVelocity(bodyId: BodyId3D, velocity: IVec3Like, wake = true): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        const offset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        this._velocities[offset] = velocity.x;
        this._velocities[offset + 1] = velocity.y;
        this._velocities[offset + 2] = velocity.z;
        // Wake the body so the new velocity takes effect immediately.
        // Component API (Rigidbody3D.velocity) already calls wakeUp() separately;
        // this ensures the raw API path is correct too.
        // Internal callers (e.g. _updateSleeping) pass wake=false to avoid
        // conflicting with the sleep system.
        if (wake) this.setAwake(bodyId, true);
    }

    getAngularVelocity(bodyId: BodyId3D, out?: IVec3Like): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };
        return this._readVec(this._velocities, index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET, out);
    }

    setAngularVelocity(bodyId: BodyId3D, velocity: IVec3Like, wake = true): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        const offset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
        this._velocities[offset] = velocity.x;
        this._velocities[offset + 1] = velocity.y;
        this._velocities[offset + 2] = velocity.z;
        // Wake the body so the new angular velocity takes effect immediately.
        // Component API (Rigidbody3D.angularVelocity) already calls wakeUp() separately;
        // this ensures the raw API path is correct too.
        // Internal callers (e.g. _updateSleeping) pass wake=false to avoid
        // conflicting with the sleep system.
        if (wake) this.setAwake(bodyId, true);
    }

    getBodyType(bodyId: BodyId3D): number { return Number(this._bodyTypes[this._getBodyIndex(bodyId)]); }
    setBodyType(bodyId: BodyId3D, type: BodyType): void { this._bodyTypes[this._getBodyIndex(bodyId)] = type; }

    getBodyFlags(bodyId: BodyId3D): number { return Number(this._bodyFlags[this._getBodyIndex(bodyId)]); }
    isEnabled(bodyId: BodyId3D): boolean {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return false;
        return (this._bodyFlags[index] & BodyFlags.Active) !== 0;
    }
    setEnabled(bodyId: BodyId3D, enabled: boolean): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        if (enabled) this._bodyFlags[index] |= BodyFlags.Active;
        else this._bodyFlags[index] &= ~BodyFlags.Active;
    }

    isFixedRotation(bodyId: BodyId3D): boolean {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return false;
        return (this._bodyFlags[index] & BodyFlags.FixedRotation) !== 0;
    }
    setFixedRotation(bodyId: BodyId3D, fixed: boolean): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        if (fixed) this._bodyFlags[index] |= BodyFlags.FixedRotation;
        else this._bodyFlags[index] &= ~BodyFlags.FixedRotation;
    }

    isBullet(bodyId: BodyId3D): boolean {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return false;
        return (this._bodyFlags[index] & BodyFlags.Bullet) !== 0;
    }
    setBullet(bodyId: BodyId3D, bullet: boolean): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        if (bullet) this._bodyFlags[index] |= BodyFlags.Bullet;
        else this._bodyFlags[index] &= ~BodyFlags.Bullet;
    }

    getMass(bodyId: BodyId3D): number { return Number(this._massData[this._getBodyIndex(bodyId) * MASS_STRIDE]); }
    setMass(bodyId: BodyId3D, mass: number): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        const offset = index * MASS_STRIDE;
        this._massData[offset] = mass;
        this._massData[offset + 1] = mass > 0 ? 1 / mass : 0;
    }

    getInverseMass(bodyId: BodyId3D): number { return Number(this._massData[this._getBodyIndex(bodyId) * MASS_STRIDE + 1]); }
    getInertiaTensor(bodyId: BodyId3D, out?: IVec3Like): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };
        const offset = index * MASS_STRIDE + 2;
        return this._readVec(this._massData, offset, out);
    }

    getInverseInertia(bodyId: BodyId3D, out?: IVec3Like): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };
        const offset = index * MASS_STRIDE + 5;
        return this._readVec(this._massData, offset, out);
    }

    setInertiaTensor(bodyId: BodyId3D, inertia: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        const offset = index * MASS_STRIDE + 2;
        this._massData[offset] = inertia.x;
        this._massData[offset + 1] = inertia.y;
        this._massData[offset + 2] = inertia.z;
        this._massData[offset + 3] = inertia.x > 0 ? 1 / inertia.x : 0;
        this._massData[offset + 4] = inertia.y > 0 ? 1 / inertia.y : 0;
        this._massData[offset + 5] = inertia.z > 0 ? 1 / inertia.z : 0;
    }

    getLinearDamping(bodyId: BodyId3D): number { return Number(this._dampings[this._getBodyIndex(bodyId) * 2]); }
    setLinearDamping(bodyId: BodyId3D, damping: number): void { this._dampings[this._getBodyIndex(bodyId) * 2] = damping; }

    getAngularDamping(bodyId: BodyId3D): number { return Number(this._dampings[this._getBodyIndex(bodyId) * 2 + 1]); }
    setAngularDamping(bodyId: BodyId3D, damping: number): void { this._dampings[this._getBodyIndex(bodyId) * 2 + 1] = damping; }

    getUserData(bodyId: BodyId3D): unknown { return this._userData.get(bodyId); }
    setUserData(bodyId: BodyId3D, userData: unknown): void {
        if (!this._bodyIdToIndex.has(bodyId)) return;
        if (userData === undefined) this._userData.delete(bodyId);
        else this._userData.set(bodyId, userData);
    }

    isAwake(bodyId: BodyId3D): boolean {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return false;
        return (this._bodyFlags[index] & BodyFlags.Awake) !== 0;
    }

    setAwake(bodyId: BodyId3D, awake: boolean): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        if (awake) this._bodyFlags[index] |= BodyFlags.Awake;
        else this._bodyFlags[index] &= ~BodyFlags.Awake;
    }

    applyForce(bodyId: BodyId3D, force: IVec3Like, point?: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) return;

        // Accumulate linear force
        const fOffset = index * 3;
        this._forces[fOffset] += force.x;
        this._forces[fOffset + 1] += force.y;
        this._forces[fOffset + 2] += force.z;

        // Accumulate torque from off-center force application (τ = r × F)
        if (point) {
            const posOffset = index * POSITION_STRIDE + POSITION_OFFSET;
            const rx = point.x - this._positions[posOffset];
            const ry = point.y - this._positions[posOffset + 1];
            const rz = point.z - this._positions[posOffset + 2];

            const tOffset = index * 3;
            this._torques[tOffset] += ry * force.z - rz * force.y;
            this._torques[tOffset + 1] += rz * force.x - rx * force.z;
            this._torques[tOffset + 2] += rx * force.y - ry * force.x;
        }

        this.setAwake(bodyId, true);
    }

    applyForceToCenter(bodyId: BodyId3D, force: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) return;

        const invMass = this._massData[index * MASS_STRIDE + 1];
        if (invMass === 0) return;

        const velOffset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        this._velocities[velOffset] += force.x * invMass;
        this._velocities[velOffset + 1] += force.y * invMass;
        this._velocities[velOffset + 2] += force.z * invMass;

        this.setAwake(bodyId, true);
    }

    applyTorque(bodyId: BodyId3D, torque: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) return;

        const tOffset = index * 3;
        this._torques[tOffset] += torque.x;
        this._torques[tOffset + 1] += torque.y;
        this._torques[tOffset + 2] += torque.z;

        this.setAwake(bodyId, true);
    }

    applyImpulse(bodyId: BodyId3D, impulse: IVec3Like, point?: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) return;

        const invMass = this._massData[index * MASS_STRIDE + 1];
        if (invMass === 0) return;

        const velOffset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        this._velocities[velOffset] += impulse.x * invMass;
        this._velocities[velOffset + 1] += impulse.y * invMass;
        this._velocities[velOffset + 2] += impulse.z * invMass;

        if (point) {
            const posOffset = index * POSITION_STRIDE + POSITION_OFFSET;
            const rx = point.x - this._positions[posOffset];
            const ry = point.y - this._positions[posOffset + 1];
            const rz = point.z - this._positions[posOffset + 2];

            const massOffset = index * MASS_STRIDE + 5;
            const invIx = this._massData[massOffset];
            const invIy = this._massData[massOffset + 1];
            const invIz = this._massData[massOffset + 2];

            const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
            this._velocities[angOffset] += (ry * impulse.z - rz * impulse.y) * invIx;
            this._velocities[angOffset + 1] += (rz * impulse.x - rx * impulse.z) * invIy;
            this._velocities[angOffset + 2] += (rx * impulse.y - ry * impulse.x) * invIz;
        }

        this.setAwake(bodyId, true);
    }

    applyImpulseToCenter(bodyId: BodyId3D, impulse: IVec3Like): void { this.applyImpulse(bodyId, impulse); }

    applyAngularImpulse(bodyId: BodyId3D, impulse: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) return;

        const massOffset = index * MASS_STRIDE + 5;
        const invIx = this._massData[massOffset];
        const invIy = this._massData[massOffset + 1];
        const invIz = this._massData[massOffset + 2];

        const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
        this._velocities[angOffset] += impulse.x * invIx;
        this._velocities[angOffset + 1] += impulse.y * invIy;
        this._velocities[angOffset + 2] += impulse.z * invIz;

        this.setAwake(bodyId, true);
    }

    /**
     * Integrate accumulated forces and torques into velocities.
     * Called once per step before damping. Converts force → velocity via F*dt*invMass.
     */
    integrateForces(dt: number): void {
        for (const [bodyId, index] of this._bodyIdToIndex) {
            if (Number(this._bodyTypes[index]) !== BODY_TYPE_DYNAMIC) continue;

            const invMass = this._massData[index * MASS_STRIDE + 1];
            if (invMass === 0) continue;

            const fOffset = index * 3;
            const velOffset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
            this._velocities[velOffset] += this._forces[fOffset] * dt * invMass;
            this._velocities[velOffset + 1] += this._forces[fOffset + 1] * dt * invMass;
            this._velocities[velOffset + 2] += this._forces[fOffset + 2] * dt * invMass;

            const massOffset = index * MASS_STRIDE + 5;
            const invIx = this._massData[massOffset];
            const invIy = this._massData[massOffset + 1];
            const invIz = this._massData[massOffset + 2];

            const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
            this._velocities[angOffset] += this._torques[fOffset] * dt * invIx;
            this._velocities[angOffset + 1] += this._torques[fOffset + 1] * dt * invIy;
            this._velocities[angOffset + 2] += this._torques[fOffset + 2] * dt * invIz;
        }
    }

    clearForceAccumulators(): void {
        this._forces.fill(0);
        this._torques.fill(0);
    }

    /**
     * Register a callback invoked whenever a KINEMATIC body's position or rotation
     * is written. Used by PhysicsWorld3D to wake sleeping contact neighbors. (P1-4)
     */
    onKinematicTransformChange(callback: (bodyId: BodyId3D) => void): void {
        this._onKinematicTransformChange = callback;
    }

    getBodyIds(): BodyId3D[] { return Array.from(this._bodyIdToIndex.keys()); }

    getGravityScale(bodyId: BodyId3D): number { return Number(this._gravityScales[this._getBodyIndex(bodyId)]); }
    setGravityScale(bodyId: BodyId3D, scale: number): void { this._gravityScales[this._getBodyIndex(bodyId)] = scale; }

    /**
     * Compute composite inertia tensor for a body from its attached shape geometries.
     * Inertia is accumulated about the body origin (parallel-axis per shape), the
     * same policy the contact solver's lever arms use. Per-shape mass comes from the
     * shape's density and volume; the distribution is scaled so the shape masses sum
     * to the body's configured mass.
     */
    computeInertiaForBody(bodyId: BodyId3D, shapeManager: ShapeManager3D): IVec3Like {
        const mass = this.getMass(bodyId);
        if (mass <= 0) return { x: 0, y: 0, z: 0 };

        const shapes = shapeManager.getShapesForBodyWithDefs(bodyId);
        if (shapes.length === 0) return { x: 1, y: 1, z: 1 };

        let totalShapeMass = 0;
        for (const { kind, def, density } of shapes) {
            totalShapeMass += _computeShapeMass(kind, def as Record<string, unknown>, density);
        }
        const massScale = totalShapeMass > 1e-10 ? mass / totalShapeMass : 0;

        let ix = 0, iy = 0, iz = 0;
        const fallbackMass = mass / shapes.length;

        for (const { kind, def, density } of shapes) {
            const shapeMass = massScale > 0
                ? _computeShapeMass(kind, def as Record<string, unknown>, density) * massScale
                : fallbackMass;
            const inertia = _computeShapeInertia(kind, def as Record<string, unknown>, shapeMass);
            ix += inertia.x;
            iy += inertia.y;
            iz += inertia.z;
        }

        return { x: ix, y: iy, z: iz };
    }

    private _allocateIndex(): number {
        if (this._freeList.length > 0) return this._freeList.pop()!;
        return Number(this._bodyCount);
    }

    private _getBodyIndex(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) throw new PhysicsError3D('Body not found', 'INVALID_STATE');
        return index;
    }

    /**
     * Row index for a body id, or -1 when the body no longer exists.
     *
     * Internal to physics-3d. The contact solver resolves each body once per
     * step and then works against the returned row (`*Raw()` views below),
     * instead of paying a Map lookup per accessor call inside the solve
     * iterations.
     */
    resolveIndex(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        return index === undefined ? -1 : index;
    }

    /**
     * Structure-of-arrays backing stores, keyed by row index.
     *
     * Internal to physics-3d: owned by this manager, never reallocated, and
     * must not be retained across a body destroy or handed to package
     * consumers. Written through these views only by the contact solver, which
     * reproduces the exact arithmetic of the accessor methods above.
     */
    positionsRaw(): Float64Array { return this._positions; }
    velocitiesRaw(): Float64Array { return this._velocities; }
    massDataRaw(): Float64Array { return this._massData; }
    bodyTypesRaw(): Uint8Array { return this._bodyTypes; }
    bodyFlagsRaw(): Uint32Array { return this._bodyFlags; }

    private _readVec(arr: Float64Array, offset: number, out?: IVec3Like): IVec3Like {
        if (out) {
            out.x = arr[offset];
            out.y = arr[offset + 1];
            out.z = arr[offset + 2];
            return out;
        }
        return { x: arr[offset], y: arr[offset + 1], z: arr[offset + 2] };
    }

    private _readQuat(arr: Float64Array, offset: number, out?: IQuatLike): IQuatLike {
        if (out) {
            out.x = arr[offset];
            out.y = arr[offset + 1];
            out.z = arr[offset + 2];
            out.w = arr[offset + 3];
            return out;
        }
        return { x: arr[offset], y: arr[offset + 1], z: arr[offset + 2], w: arr[offset + 3] };
    }

    private _writeQuat(baseOffset: number, q: IQuatLike): void {
        this._positions[baseOffset] = q.x;
        this._positions[baseOffset + 1] = q.y;
        this._positions[baseOffset + 2] = q.z;
        this._positions[baseOffset + 3] = q.w ?? 1;
    }

    [Symbol.dispose](): void {
        this._bodyIdToIndex.clear();
        this._freeList.length = 0;
        this._userData.clear();
    }
}

export class ShapeManager3D implements Disposable {
    private _nextShapeId = 1n;
    private _shapeCount = 0n;
    private readonly _maxShapes: number;
    private readonly _shapeIdToIndex = new Map<ShapeId3D, number>();
    private readonly _shapeToBody = new Map<ShapeId3D, BodyId3D>();
    private readonly _bodyToShapes = new Map<BodyId3D, Set<ShapeId3D>>();
    private readonly _freeList: number[] = [];

    private readonly _shapeTypes: Uint8Array;
    private readonly _materials: Float32Array;
    private readonly _filters: Int32Array;
    private readonly _shapeDefs = new Map<ShapeId3D, { kind: number; def: unknown }>();

    constructor(maxShapes: number = 8192) {
        this._maxShapes = maxShapes;
        this._shapeTypes = new Uint8Array(maxShapes);
        this._materials = new Float32Array(maxShapes * 4);
        this._filters = new Int32Array(maxShapes * 3);
    }

    get shapeCount(): number { return Number(this._shapeCount); }

    createSphere(
        bodyId: BodyId3D,
        def: ISphereShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.Sphere, def, material, filter, options);
    }

    createBox(
        bodyId: BodyId3D,
        def: IBoxShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.Box, def, material, filter, options);
    }

    createCapsule(
        bodyId: BodyId3D,
        def: ICapsuleShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.Capsule, def, material, filter, options);
    }

    createCylinder(
        bodyId: BodyId3D,
        def: ICylinderShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.Cylinder, def, material, filter, options);
    }

    createCone(
        bodyId: BodyId3D,
        def: IConeShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.Cone, def, material, filter, options);
    }

    createConvexHull(
        bodyId: BodyId3D,
        def: IConvexHullShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.ConvexHull, def, material, filter, options);
    }

    createTriangleMesh(
        bodyId: BodyId3D,
        def: ITriangleMeshShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.TriangleMesh, def, material, filter, options);
    }

    createHeightField(
        bodyId: BodyId3D,
        def: IHeightFieldShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeCreateOptions3D
    ): ShapeId3D {
        return this._createShape(bodyId, ShapeType.HeightField, def, material, filter, options);
    }

    destroyShape(shapeId: ShapeId3D): void {
        const index = this._shapeIdToIndex.get(shapeId);
        if (index === undefined) return;

        const bodyId = this._shapeToBody.get(shapeId);
        if (bodyId !== undefined) {
            const shapes = this._bodyToShapes.get(bodyId);
            if (shapes) {
                shapes.delete(shapeId);
                if (shapes.size === 0) this._bodyToShapes.delete(bodyId);
            }
        }

        this._shapeIdToIndex.delete(shapeId);
        this._shapeToBody.delete(shapeId);
        this._freeList.push(index);

        this._materials.fill(0, index * 4, index * 4 + 4);
        this._filters.fill(0, index * 3, index * 3 + 3);
        this._shapeTypes[index] = 0;
        this._shapeDefs.delete(shapeId);
        this._shapeCount -= 1n;
    }

    getShapeType(shapeId: ShapeId3D): number { return Number(this._shapeTypes[this._getShapeIndex(shapeId)]); }
    getBodyForShape(shapeId: ShapeId3D): BodyId3D | undefined { return this._shapeToBody.get(shapeId); }
    getShapesForBody(bodyId: BodyId3D): readonly ShapeId3D[] {
        const shapes = this._bodyToShapes.get(bodyId);
        return shapes ? Array.from(shapes) : [];
    }

    getMaterial(shapeId: ShapeId3D): IMaterial {
        const offset = this._getShapeIndex(shapeId) * 4;
        return {
            friction: this._materials[offset],
            restitution: this._materials[offset + 1],
            density: this._materials[offset + 2],
        } as IMaterial;
    }

    getFilter(shapeId: ShapeId3D): ICollisionFilter3D {
        const offset = this._getShapeIndex(shapeId) * 3;
        return {
            categoryBits: this._filters[offset],
            maskBits: this._filters[offset + 1],
            groupIndex: this._filters[offset + 2],
        } as ICollisionFilter3D;
    }

    isSensor(shapeId: ShapeId3D): boolean {
        return this._materials[this._getShapeIndex(shapeId) * 4 + 3] !== 0;
    }

    private _createShape(
        bodyId: BodyId3D,
        type: ShapeType,
        def: unknown,
        material: Partial<IMaterial> | undefined,
        filter: ICollisionFilter3D | undefined,
        options: IShapeCreateOptions3D | undefined
    ): ShapeId3D {
        if (Number(this._shapeCount) >= this._maxShapes && this._freeList.length === 0) {
            throw new PhysicsError3D('Shape capacity exceeded', 'CAPACITY_EXCEEDED');
        }

        const shapeId = this._nextShapeId as unknown as ShapeId3D;
        this._nextShapeId += 1n;
        const index = this._freeList.length > 0 ? this._freeList.pop()! : Number(this._shapeCount);

        this._shapeIdToIndex.set(shapeId, index);
        this._shapeToBody.set(shapeId, bodyId);

        let shapes = this._bodyToShapes.get(bodyId);
        if (!shapes) {
            shapes = new Set();
            this._bodyToShapes.set(bodyId, shapes);
        }
        shapes.add(shapeId);

        this._shapeTypes[index] = type;

        const materialOffset = index * 4;
        // Canonical default: friction=0.4, maskBits=0xffff — matches DEFAULT_MATERIAL
        // and DEFAULT_FILTER in physics-world-3d-shared.ts (P1-28 convergence).
        this._materials[materialOffset] = material?.friction ?? 0.4;
        this._materials[materialOffset + 1] = material?.restitution ?? 0;
        this._materials[materialOffset + 2] = material?.density ?? 1;
        this._materials[materialOffset + 3] = options?.isSensor ? 1 : 0;

        const filterOffset = index * 3;
        this._filters[filterOffset] = filter?.categoryBits ?? 1;
        this._filters[filterOffset + 1] = filter?.maskBits ?? 0xffff;
        this._filters[filterOffset + 2] = filter?.groupIndex ?? 0;

        this._shapeDefs.set(shapeId, { kind: type, def });
        this._shapeCount += 1n;
        return shapeId;
    }

    getShapesForBodyWithDefs(bodyId: BodyId3D): Array<{ kind: number; def: unknown; density: number }> {
        const shapes = this._bodyToShapes.get(bodyId);
        if (!shapes) return [];
        const result: Array<{ kind: number; def: unknown; density: number }> = [];
        for (const sid of shapes) {
            const entry = this._shapeDefs.get(sid);
            if (entry) {
                result.push({
                    kind: entry.kind,
                    def: entry.def,
                    density: this._materials[this._getShapeIndex(sid) * 4 + 2],
                });
            }
        }
        return result;
    }

    private _getShapeIndex(shapeId: ShapeId3D): number {
        const index = this._shapeIdToIndex.get(shapeId);
        if (index === undefined) throw new PhysicsError3D('Shape not found', 'INVALID_STATE');
        return index;
    }

    [Symbol.dispose](): void {
        this._shapeIdToIndex.clear();
        this._shapeToBody.clear();
        this._bodyToShapes.clear();
        this._shapeDefs.clear();
        this._freeList.length = 0;
    }
}

export class ConstraintManager3D implements Disposable {
    private _nextConstraintId = 1n;
    private _constraintCount = 0n;
    private readonly _maxConstraints: number;
    private readonly _constraintIdToIndex = new Map<ConstraintId3D, number>();
    private readonly _bodyToConstraints = new Map<BodyId3D, Set<ConstraintId3D>>();
    private readonly _freeList: number[] = [];

    private readonly _constraintTypes: Uint8Array;
    private readonly _constraintData: Float64Array;

    constructor(maxConstraints: number = 2048) {
        this._maxConstraints = maxConstraints;
        this._constraintTypes = new Uint8Array(maxConstraints);
        this._constraintData = new Float64Array(maxConstraints * CONSTRAINT_STRIDE);
    }

    get constraintCount(): number { return Number(this._constraintCount); }

    createFixedConstraint(def: IFixedConstraintDef3D): ConstraintId3D {
        return this._createConstraint(0, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localAnchorA);
            this._writeVec(offset + 3, def.localAnchorB);
        });
    }

    createHingeConstraint(def: IHingeConstraintDef3D): ConstraintId3D {
        return this._createConstraint(2, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localAnchorA);
            this._writeVec(offset + 3, def.localAnchorB);
            this._writeVec(offset + 6, def.localAxisA);
            this._writeVec(offset + 9, def.localAxisB);
        });
    }

    createSliderConstraint(def: ISliderConstraintDef3D): ConstraintId3D {
        return this._createConstraint(3, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localAnchorA);
            this._writeVec(offset + 3, def.localAnchorB);
            this._writeVec(offset + 6, def.localAxisA);
        });
    }

    createSpringConstraint(def: ISpringConstraintDef3D): ConstraintId3D {
        return this._createConstraint(6, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localAnchorA);
            this._writeVec(offset + 3, def.localAnchorB);
            this._constraintData[offset + 6] = def.restLength ?? 1;
            this._constraintData[offset + 7] = def.stiffness ?? 10;
            this._constraintData[offset + 8] = def.damping ?? 0.5;
        });
    }

    createConeTwistConstraint(def: IConeTwistConstraintDef3D): ConstraintId3D {
        return this._createConstraint(4, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localFrameA.position);
            this._writeVec(offset + 3, def.localFrameB.position);
            this._constraintData[offset + 6] = def.swingSpan1 ?? Math.PI * 0.25;
            this._constraintData[offset + 7] = def.swingSpan2 ?? Math.PI * 0.25;
            this._constraintData[offset + 8] = def.twistSpan ?? Math.PI * 0.5;
            this._constraintData[offset + 9] = def.softness ?? 1;
        });
    }

    createGenericConstraint(def: IGenericConstraintDef3D): ConstraintId3D {
        return this._createConstraint(5, def.bodyIdA, def.bodyIdB, (offset) => {
            this._writeVec(offset, def.localFrameA.position);
            this._writeVec(offset + 3, def.localFrameB.position);
        });
    }

    createFixed(def: IFixedConstraintDef3D): ConstraintId3D { return this.createFixedConstraint(def); }
    createHinge(def: IHingeConstraintDef3D): ConstraintId3D { return this.createHingeConstraint(def); }
    createSlider(def: ISliderConstraintDef3D): ConstraintId3D { return this.createSliderConstraint(def); }
    createSpring(def: ISpringConstraintDef3D): ConstraintId3D { return this.createSpringConstraint(def); }
    createConeTwist(def: IConeTwistConstraintDef3D): ConstraintId3D { return this.createConeTwistConstraint(def); }
    createGeneric(def: IGenericConstraintDef3D): ConstraintId3D { return this.createGenericConstraint(def); }

    destroyConstraint(constraintId: ConstraintId3D): void {
        const index = this._constraintIdToIndex.get(constraintId);
        if (index === undefined) return;

        // Find both bodies that own this constraint and remove the reference
        let bodyIdsFound = 0;
        for (const [body, constraints] of this._bodyToConstraints.entries()) {
            if (constraints.has(constraintId)) {
                constraints.delete(constraintId);
                bodyIdsFound++;
                if (constraints.size === 0) this._bodyToConstraints.delete(body);
                if (bodyIdsFound >= 2) break;
            }
        }

        this._constraintIdToIndex.delete(constraintId);
        this._freeList.push(index);
        this._constraintTypes[index] = 0;
        this._constraintCount -= 1n;
    }

    getConstraintType(constraintId: ConstraintId3D): number { return Number(this._constraintTypes[this._getConstraintIndex(constraintId)]); }
    getConstraintsForBody(bodyId: BodyId3D): readonly ConstraintId3D[] {
        const constraints = this._bodyToConstraints.get(bodyId);
        return constraints ? Array.from(constraints) : [];
    }

    getAllConstraintIds(): ConstraintId3D[] {
        return Array.from(this._constraintIdToIndex.keys());
    }

    getConstraintBodyIds(constraintId: ConstraintId3D): { bodyIdA: BodyId3D; bodyIdB: BodyId3D } {
        const index = this._getConstraintIndex(constraintId);
        // Body IDs are stored in the _bodyToConstraints map; find them by scanning
        let bodyIdA: BodyId3D | null = null;
        let bodyIdB: BodyId3D | null = null;
        for (const [bodyId, constraints] of this._bodyToConstraints.entries()) {
            if (constraints.has(constraintId)) {
                if (bodyIdA === null) bodyIdA = bodyId;
                else { bodyIdB = bodyId; break; }
            }
        }
        return { bodyIdA: bodyIdA!, bodyIdB: bodyIdB! };
    }

    getConstraintLocalAnchorA(constraintId: ConstraintId3D): IVec3Like {
        const offset = this._getConstraintIndex(constraintId) * CONSTRAINT_STRIDE;
        return { x: this._constraintData[offset], y: this._constraintData[offset + 1], z: this._constraintData[offset + 2] };
    }

    getConstraintLocalAnchorB(constraintId: ConstraintId3D): IVec3Like {
        const offset = this._getConstraintIndex(constraintId) * CONSTRAINT_STRIDE;
        return { x: this._constraintData[offset + 3], y: this._constraintData[offset + 4], z: this._constraintData[offset + 5] };
    }

    getConstraintParam(constraintId: ConstraintId3D, paramOffset: number): number {
        const offset = this._getConstraintIndex(constraintId) * CONSTRAINT_STRIDE + 6 + paramOffset;
        return this._constraintData[offset];
    }

    private _createConstraint(
        type: number,
        bodyIdA: BodyId3D,
        bodyIdB: BodyId3D,
        initData: (offset: number) => void
    ): ConstraintId3D {
        if (Number(this._constraintCount) >= this._maxConstraints && this._freeList.length === 0) {
            throw new PhysicsError3D('Constraint capacity exceeded', 'CAPACITY_EXCEEDED');
        }

        const constraintId = this._nextConstraintId as unknown as ConstraintId3D;
        this._nextConstraintId += 1n;
        const index = this._freeList.length > 0 ? this._freeList.pop()! : Number(this._constraintCount);

        this._constraintIdToIndex.set(constraintId, index);
        this._constraintTypes[index] = type;

        for (const bodyId of [bodyIdA, bodyIdB]) {
            let constraints = this._bodyToConstraints.get(bodyId);
            if (!constraints) {
                constraints = new Set();
                this._bodyToConstraints.set(bodyId, constraints);
            }
            constraints.add(constraintId);
        }

        const dataOffset = index * CONSTRAINT_STRIDE;
        initData(dataOffset);

        this._constraintCount += 1n;
        return constraintId;
    }

    private _getConstraintIndex(constraintId: ConstraintId3D): number {
        const index = this._constraintIdToIndex.get(constraintId);
        if (index === undefined) throw new PhysicsError3D('Constraint not found', 'INVALID_STATE');
        return index;
    }

    private _writeVec(offset: number, v: IVec3Like): void {
        this._constraintData[offset] = v.x;
        this._constraintData[offset + 1] = v.y;
        this._constraintData[offset + 2] = v.z;
    }

    private _writeQuat(offset: number, q: IQuatLike): void {
        this._constraintData[offset] = q.x;
        this._constraintData[offset + 1] = q.y;
        this._constraintData[offset + 2] = q.z;
        this._constraintData[offset + 3] = q.w ?? 1;
    }

    [Symbol.dispose](): void {
        this._constraintIdToIndex.clear();
        this._bodyToConstraints.clear();
        this._freeList.length = 0;
    }
}

/**
 * Shape mass from density and shape volume, matching the formulas in
 * computeShapeMassData (physics-world-3d-shape-mass-properties.ts).
 */
function _computeShapeMass(
    kind: number,
    def: Record<string, unknown>,
    density: number
): number {
    const safeDensity = Math.max(0, density);
    if (safeDensity <= 0) return 0;

    switch (kind) {
        case ShapeType.Sphere: {
            const r = (def.radius as number) || 0;
            return (4 / 3) * Math.PI * r * r * r * safeDensity;
        }
        case ShapeType.Box: {
            const he = def.halfExtents as IVec3Like;
            if (!he) return 0;
            return 8 * he.x * he.y * he.z * safeDensity;
        }
        case ShapeType.Capsule: {
            const p1 = def.p1 as IVec3Like;
            const p2 = def.p2 as IVec3Like;
            const r = (def.radius as number) || 0;
            if (!p1 || !p2) return 0;
            const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
            const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
            return (Math.PI * r * r * segLen + (4 / 3) * Math.PI * r * r * r) * safeDensity;
        }
        case ShapeType.Cylinder: {
            const r = (def.radius as number) || 0;
            const h = (def.height as number) || 0;
            return Math.PI * r * r * h * safeDensity;
        }
        default:
            return 0;
    }
}

/**
 * Compute inertia tensor diagonal for a single shape about the body origin.
 * Uses parallel-axis theorem to offset by shape center position.
 */
function _computeShapeInertia(
    kind: number,
    def: Record<string, unknown>,
    mass: number
): IVec3Like {
    if (mass <= 0) return { x: 0, y: 0, z: 0 };

    switch (kind) {
        case ShapeType.Sphere: {
            const r = (def.radius as number) || 0;
            const i = 0.4 * mass * r * r; // (2/5)*m*r²
            const c = (def.center as IVec3Like) || { x: 0, y: 0, z: 0 };
            return {
                x: i + mass * (c.y * c.y + c.z * c.z),
                y: i + mass * (c.x * c.x + c.z * c.z),
                z: i + mass * (c.x * c.x + c.y * c.y),
            };
        }

        case ShapeType.Box: {
            const he = def.halfExtents as IVec3Like;
            if (!he) return { x: 0, y: 0, z: 0 };
            const hx2 = he.x * 2, hy2 = he.y * 2, hz2 = he.z * 2;
            const f = mass / 12;
            const c = (def.center as IVec3Like) || { x: 0, y: 0, z: 0 };
            // Inertia about own center + parallel-axis offset
            return {
                x: f * (hy2 * hy2 + hz2 * hz2) + mass * (c.y * c.y + c.z * c.z),
                y: f * (hx2 * hx2 + hz2 * hz2) + mass * (c.x * c.x + c.z * c.z),
                z: f * (hx2 * hx2 + hy2 * hy2) + mass * (c.x * c.x + c.y * c.y),
            };
        }

        case ShapeType.Capsule: {
            const p1 = def.p1 as IVec3Like;
            const p2 = def.p2 as IVec3Like;
            const r = (def.radius as number) || 0;
            if (!p1 || !p2) return { x: 0, y: 0, z: 0 };

            // Capsule axis direction
            const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
            const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Hemisphere mass and cylinder mass (equal volumes for uniform density)
            const hemiMass = mass / 3;
            const cylMass = mass - 2 * hemiMass;

            // Center of capsule segment
            const cx = (p1.x + p2.x) * 0.5;
            const cy = (p1.y + p2.y) * 0.5;
            const cz = (p1.z + p2.z) * 0.5;

            // Unit axis direction
            const invSeg = segLen > 1e-10 ? 1 / segLen : 0;
            const nx = dx * invSeg, ny = dy * invSeg, nz = dz * invSeg;

            // Cylinder inertia about its own center (aligned with axis)
            const iCylAxial = 0.5 * cylMass * r * r;
            const iCylPerp = cylMass * (3 * r * r + segLen * segLen) / 12;

            // Hemisphere inertia about its own centroid (2/5*m*r²)
            const iHemi = 0.4 * hemiMass * r * r;
            // Distance from hemisphere centroid to capsule center
            const d = segLen * 0.5 + 0.375 * r; // centroid at 3r/8 from flat face
            const d2 = d * d;

            // Perpendicular-axis component for each hemisphere (parallel-axis theorem)
            const iHemiPerp = iHemi + hemiMass * d2;

            // Total inertia along axis and perpendicular
            const iAxial = iCylAxial + 2 * iHemi;
            const iPerp = iCylPerp + 2 * iHemiPerp;

            // Distribute to x,y,z using direction cosines + parallel-axis for center offset
            return {
                x: iPerp * (1 - nx * nx) + iAxial * nx * nx + mass * (cy * cy + cz * cz),
                y: iPerp * (1 - ny * ny) + iAxial * ny * ny + mass * (cx * cx + cz * cz),
                z: iPerp * (1 - nz * nz) + iAxial * nz * nz + mass * (cx * cx + cy * cy),
            };
        }

        case ShapeType.Cylinder: {
            const r = (def.radius as number) || 0;
            const h = (def.height as number) || 0;
            const axis = ((def.axis as number) ?? 1) as 0 | 1 | 2;
            const c = (def.center as IVec3Like) || { x: 0, y: 0, z: 0 };

            const iAxial = 0.5 * mass * r * r;
            const iPerp = mass * (3 * r * r + h * h) / 12;

            // Map axis to x,y,z
            const dir = [0, 0, 0];
            dir[axis] = 1;

            return {
                x: iPerp * (1 - dir[0] * dir[0]) + iAxial * dir[0] * dir[0] + mass * (c.y * c.y + c.z * c.z),
                y: iPerp * (1 - dir[1] * dir[1]) + iAxial * dir[1] * dir[1] + mass * (c.x * c.x + c.z * c.z),
                z: iPerp * (1 - dir[2] * dir[2]) + iAxial * dir[2] * dir[2] + mass * (c.x * c.x + c.y * c.y),
            };
        }

        default:
            return { x: 0, y: 0, z: 0 };
    }
}
