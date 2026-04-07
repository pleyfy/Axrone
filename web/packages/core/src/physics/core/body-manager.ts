import { Vec2, IVec2Like, EPSILON } from '@axrone/numeric';
import type {
    BodyId,
    ShapeId,
    BodyType,
    BodyFlags,
    Mass,
    Inertia,
    IMassData2D,
    ITransform2D,
    IVelocity2D,
    PhysicsConstants,
} from '../types';
import type { IPhysicsBody2D, IPhysicsBodyDef2D } from '../types';

type BodyManagerState = 'active' | 'stepping' | 'disposed';

const enum BodyManagerError {
    INVALID_STATE = 'INVALID_STATE',
    BODY_NOT_FOUND = 'BODY_NOT_FOUND',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
}

class PhysicsBodyError extends Error {
    readonly code: BodyManagerError;
    readonly timestamp: number;

    constructor(message: string, code: BodyManagerError) {
        super(message);
        this.name = 'PhysicsBodyError';
        this.code = code;
        this.timestamp = performance.now();
        Object.setPrototypeOf(this, PhysicsBodyError.prototype);
    }
}

const BODY_SOA_STRIDE = 16;
const POSITION_OFFSET = 0;
const ROTATION_OFFSET = 2;
const LINEAR_VELOCITY_OFFSET = 3;
const ANGULAR_VELOCITY_OFFSET = 5;
const FORCE_OFFSET = 6;
const TORQUE_OFFSET = 8;
const MASS_OFFSET = 9;
const INV_MASS_OFFSET = 10;
const INERTIA_OFFSET = 11;
const INV_INERTIA_OFFSET = 12;
const CENTER_OFFSET = 13;
const SLEEP_TIME_OFFSET = 15;

export class BodyManager2D implements Disposable {
    private _state: BodyManagerState = 'active';
    private _nextBodyId: number = 1;
    private _bodyCount: number = 0;
    private readonly _maxBodies: number;
    private readonly _bodyData: Float64Array;
    private readonly _bodyFlags: Uint32Array;
    private readonly _bodyTypes: Uint8Array;
    private readonly _bodyShapes: Map<BodyId, ShapeId[]>;
    private readonly _bodyIdToIndex: Map<BodyId, number>;
    private readonly _indexToBodyId: Map<number, BodyId>;
    private readonly _freeIndices: number[];
    private readonly _gravityScales: Float32Array;
    private readonly _dampingData: Float32Array;
    private readonly _userData: Map<BodyId, unknown>;

    constructor(maxBodies: number = 1024) {
        this._maxBodies = maxBodies;
        this._bodyData = new Float64Array(maxBodies * BODY_SOA_STRIDE);
        this._bodyFlags = new Uint32Array(maxBodies);
        this._bodyTypes = new Uint8Array(maxBodies);
        this._bodyShapes = new Map();
        this._bodyIdToIndex = new Map();
        this._indexToBodyId = new Map();
        this._freeIndices = [];
        this._gravityScales = new Float32Array(maxBodies);
        this._dampingData = new Float32Array(maxBodies * 2);
        this._userData = new Map();

        this._gravityScales.fill(1.0);
    }

    get bodyCount(): number {
        return this._bodyCount;
    }

    get capacity(): number {
        return this._maxBodies;
    }

    createBody(def: IPhysicsBodyDef2D): BodyId {
        this._assertActive();

        if (this._bodyCount >= this._maxBodies) {
            throw new PhysicsBodyError(
                'Body capacity exceeded',
                BodyManagerError.CAPACITY_EXCEEDED
            );
        }

        const index = this._allocateIndex();
        const bodyId = this._nextBodyId++ as BodyId;
        const offset = index * BODY_SOA_STRIDE;

        this._bodyIdToIndex.set(bodyId, index);
        this._indexToBodyId.set(index, bodyId);

        const pos = def.position ?? { x: 0, y: 0 };
        this._bodyData[offset + POSITION_OFFSET] = pos.x;
        this._bodyData[offset + POSITION_OFFSET + 1] = pos.y;
        this._bodyData[offset + ROTATION_OFFSET] = def.rotation ?? 0;

        const linVel = def.linearVelocity ?? { x: 0, y: 0 };
        this._bodyData[offset + LINEAR_VELOCITY_OFFSET] = linVel.x;
        this._bodyData[offset + LINEAR_VELOCITY_OFFSET + 1] = linVel.y;
        this._bodyData[offset + ANGULAR_VELOCITY_OFFSET] = def.angularVelocity ?? 0;

        this._bodyData[offset + FORCE_OFFSET] = 0;
        this._bodyData[offset + FORCE_OFFSET + 1] = 0;
        this._bodyData[offset + TORQUE_OFFSET] = 0;

        this._bodyData[offset + MASS_OFFSET] = 0;
        this._bodyData[offset + INV_MASS_OFFSET] = 0;
        this._bodyData[offset + INERTIA_OFFSET] = 0;
        this._bodyData[offset + INV_INERTIA_OFFSET] = 0;
        this._bodyData[offset + CENTER_OFFSET] = 0;
        this._bodyData[offset + CENTER_OFFSET + 1] = 0;
        this._bodyData[offset + SLEEP_TIME_OFFSET] = 0;

        this._bodyTypes[index] = def.type;

        let flags = 0;
        if (def.awake !== false) flags |= 1 << 5;
        if (def.enabled !== false) flags |= 1 << 6;
        if (def.fixedRotation) flags |= 1 << 0;
        if (def.bullet) flags |= 1 << 1;
        if (def.allowSleep !== false) flags |= 1 << 4;
        this._bodyFlags[index] = flags;

        this._gravityScales[index] = def.gravityScale ?? 1.0;
        this._dampingData[index * 2] = def.linearDamping ?? 0;
        this._dampingData[index * 2 + 1] = def.angularDamping ?? 0;

        this._bodyShapes.set(bodyId, []);

        if (def.userData !== undefined) {
            this._userData.set(bodyId, def.userData);
        }

        this._bodyCount++;
        return bodyId;
    }

    destroyBody(bodyId: BodyId): void {
        this._assertActive();

        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) {
            throw new PhysicsBodyError(`Body ${bodyId} not found`, BodyManagerError.BODY_NOT_FOUND);
        }

        this._bodyIdToIndex.delete(bodyId);
        this._indexToBodyId.delete(index);
        this._bodyShapes.delete(bodyId);
        this._userData.delete(bodyId);
        this._freeIndices.push(index);
        this._bodyCount--;
    }

    getPosition(bodyId: BodyId, out?: IVec2Like): IVec2Like {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE + POSITION_OFFSET;

        if (out) {
            out.x = this._bodyData[offset];
            out.y = this._bodyData[offset + 1];
            return out;
        }

        return { x: this._bodyData[offset], y: this._bodyData[offset + 1] };
    }

    setPosition(bodyId: BodyId, position: Readonly<IVec2Like>): void {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE + POSITION_OFFSET;
        this._bodyData[offset] = position.x;
        this._bodyData[offset + 1] = position.y;
    }

    getRotation(bodyId: BodyId): number {
        const index = this._getIndex(bodyId);
        return this._bodyData[index * BODY_SOA_STRIDE + ROTATION_OFFSET];
    }

    setRotation(bodyId: BodyId, rotation: number): void {
        const index = this._getIndex(bodyId);
        this._bodyData[index * BODY_SOA_STRIDE + ROTATION_OFFSET] = rotation;
    }

    getLinearVelocity(bodyId: BodyId, out?: IVec2Like): IVec2Like {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE + LINEAR_VELOCITY_OFFSET;

        if (out) {
            out.x = this._bodyData[offset];
            out.y = this._bodyData[offset + 1];
            return out;
        }

        return { x: this._bodyData[offset], y: this._bodyData[offset + 1] };
    }

    setLinearVelocity(bodyId: BodyId, velocity: Readonly<IVec2Like>): void {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE + LINEAR_VELOCITY_OFFSET;
        this._bodyData[offset] = velocity.x;
        this._bodyData[offset + 1] = velocity.y;
    }

    getAngularVelocity(bodyId: BodyId): number {
        const index = this._getIndex(bodyId);
        return this._bodyData[index * BODY_SOA_STRIDE + ANGULAR_VELOCITY_OFFSET];
    }

    setAngularVelocity(bodyId: BodyId, velocity: number): void {
        const index = this._getIndex(bodyId);
        this._bodyData[index * BODY_SOA_STRIDE + ANGULAR_VELOCITY_OFFSET] = velocity;
    }

    applyForce(bodyId: BodyId, force: Readonly<IVec2Like>, point?: Readonly<IVec2Like>): void {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE;

        this._bodyData[offset + FORCE_OFFSET] += force.x;
        this._bodyData[offset + FORCE_OFFSET + 1] += force.y;

        if (point) {
            const cx =
                this._bodyData[offset + POSITION_OFFSET] + this._bodyData[offset + CENTER_OFFSET];
            const cy =
                this._bodyData[offset + POSITION_OFFSET + 1] +
                this._bodyData[offset + CENTER_OFFSET + 1];
            const rx = point.x - cx;
            const ry = point.y - cy;
            this._bodyData[offset + TORQUE_OFFSET] += rx * force.y - ry * force.x;
        }
    }

    applyImpulse(bodyId: BodyId, impulse: Readonly<IVec2Like>, point?: Readonly<IVec2Like>): void {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE;
        const invMass = this._bodyData[offset + INV_MASS_OFFSET];

        this._bodyData[offset + LINEAR_VELOCITY_OFFSET] += impulse.x * invMass;
        this._bodyData[offset + LINEAR_VELOCITY_OFFSET + 1] += impulse.y * invMass;

        if (point) {
            const invI = this._bodyData[offset + INV_INERTIA_OFFSET];
            const cx =
                this._bodyData[offset + POSITION_OFFSET] + this._bodyData[offset + CENTER_OFFSET];
            const cy =
                this._bodyData[offset + POSITION_OFFSET + 1] +
                this._bodyData[offset + CENTER_OFFSET + 1];
            const rx = point.x - cx;
            const ry = point.y - cy;
            this._bodyData[offset + ANGULAR_VELOCITY_OFFSET] +=
                invI * (rx * impulse.y - ry * impulse.x);
        }
    }

    getMass(bodyId: BodyId): Mass {
        const index = this._getIndex(bodyId);
        return this._bodyData[index * BODY_SOA_STRIDE + MASS_OFFSET] as Mass;
    }

    getInverseMass(bodyId: BodyId): number {
        const index = this._getIndex(bodyId);
        return this._bodyData[index * BODY_SOA_STRIDE + INV_MASS_OFFSET];
    }

    setMassData(bodyId: BodyId, mass: number, inertia: number, center: Readonly<IVec2Like>): void {
        const index = this._getIndex(bodyId);
        const offset = index * BODY_SOA_STRIDE;

        this._bodyData[offset + MASS_OFFSET] = mass;
        this._bodyData[offset + INV_MASS_OFFSET] = mass > EPSILON ? 1 / mass : 0;
        this._bodyData[offset + INERTIA_OFFSET] = inertia;
        this._bodyData[offset + INV_INERTIA_OFFSET] = inertia > EPSILON ? 1 / inertia : 0;
        this._bodyData[offset + CENTER_OFFSET] = center.x;
        this._bodyData[offset + CENTER_OFFSET + 1] = center.y;
    }

    getBodyType(bodyId: BodyId): BodyType {
        const index = this._getIndex(bodyId);
        return this._bodyTypes[index] as BodyType;
    }

    isAwake(bodyId: BodyId): boolean {
        const index = this._getIndex(bodyId);
        return (this._bodyFlags[index] & (1 << 5)) !== 0;
    }

    setAwake(bodyId: BodyId, awake: boolean): void {
        const index = this._getIndex(bodyId);
        if (awake) {
            this._bodyFlags[index] |= 1 << 5;
            this._bodyData[index * BODY_SOA_STRIDE + SLEEP_TIME_OFFSET] = 0;
        } else {
            this._bodyFlags[index] &= ~(1 << 5);
            this._bodyData[index * BODY_SOA_STRIDE + LINEAR_VELOCITY_OFFSET] = 0;
            this._bodyData[index * BODY_SOA_STRIDE + LINEAR_VELOCITY_OFFSET + 1] = 0;
            this._bodyData[index * BODY_SOA_STRIDE + ANGULAR_VELOCITY_OFFSET] = 0;
            this._bodyData[index * BODY_SOA_STRIDE + FORCE_OFFSET] = 0;
            this._bodyData[index * BODY_SOA_STRIDE + FORCE_OFFSET + 1] = 0;
            this._bodyData[index * BODY_SOA_STRIDE + TORQUE_OFFSET] = 0;
        }
    }

    clearForces(): void {
        for (const [, index] of this._bodyIdToIndex) {
            const offset = index * BODY_SOA_STRIDE;
            this._bodyData[offset + FORCE_OFFSET] = 0;
            this._bodyData[offset + FORCE_OFFSET + 1] = 0;
            this._bodyData[offset + TORQUE_OFFSET] = 0;
        }
    }

    getBodyIds(): IterableIterator<BodyId> {
        return this._bodyIdToIndex.keys();
    }

    hasBody(bodyId: BodyId): boolean {
        return this._bodyIdToIndex.has(bodyId);
    }

    private _allocateIndex(): number {
        if (this._freeIndices.length > 0) {
            return this._freeIndices.pop()!;
        }
        return this._bodyCount;
    }

    private _getIndex(bodyId: BodyId): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) {
            throw new PhysicsBodyError(`Body ${bodyId} not found`, BodyManagerError.BODY_NOT_FOUND);
        }
        return index;
    }

    private _assertActive(): void {
        if (this._state !== 'active') {
            throw new PhysicsBodyError(`Manager is ${this._state}`, BodyManagerError.INVALID_STATE);
        }
    }

    [Symbol.dispose](): void {
        if (this._state === 'disposed') return;
        this._state = 'disposed';
        this._bodyIdToIndex.clear();
        this._indexToBodyId.clear();
        this._bodyShapes.clear();
        this._userData.clear();
        this._freeIndices.length = 0;
    }
}
