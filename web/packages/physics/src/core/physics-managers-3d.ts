import type { IVec3Like, IQuatLike } from '@axrone/numeric';
import type {
    BodyId3D,
    ConstraintId3D,
    IBoxShapeDef3D,
    ICapsuleShapeDef3D,
    ICollisionFilter3D,
    IConeTwistConstraintDef3D,
    IConvexHullShapeDef3D,
    IFixedConstraintDef3D,
    IGenericConstraintDef3D,
    IHingeConstraintDef3D,
    IPhysicsBodyDef3D,
    ISliderConstraintDef3D,
    ISphereShapeDef3D,
    ISpringConstraintDef3D,
    ICollisionFilter3D as ICollisionFilter3DShape,
    ICylinderShapeDef3D,
    ShapeId3D,
} from '../types/physics-3d';
import type { BodyType, IMaterial } from '../types';

const POSITION_STRIDE = 8;
const VELOCITY_STRIDE = 8;
const MASS_STRIDE = 16;
const SHAPE_STRIDE = 24;
const CONSTRAINT_STRIDE = 32;

const POSITION_OFFSET = 0;
const ROTATION_OFFSET = 3;
const LINEAR_VEL_OFFSET = 0;
const ANGULAR_VEL_OFFSET = 3;

const enum ManagerState {
    Active = 0,
    Disposed = 1,
}

const enum BodyManagerError {
    INVALID_STATE = 'INVALID_STATE',
    CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
}

class PhysicsError3D extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PhysicsError3D';
        this.code = code;
        Object.setPrototypeOf(this, PhysicsError3D.prototype);
    }
}

export class BodyManager3D implements Disposable {
    private _nextBodyId = 1;
    private _bodyCount = 0;
    private readonly _maxBodies: number;
    private readonly _bodyIdToIndex = new Map<BodyId3D, number>();
    private readonly _indexToBodyId = new Map<number, BodyId3D>();
    private readonly _freeIndices: number[] = [];

    private readonly _positions: Float64Array;
    private readonly _velocities: Float64Array;
    private readonly _massData: Float64Array;
    private readonly _bodyTypes: Uint8Array;
    private readonly _bodyFlags: Uint32Array;
    private readonly _gravityScales: Float32Array;
    private readonly _dampings: Float32Array;

    private _state: ManagerState = ManagerState.Active;

    constructor(maxBodies: number = 4096) {
        this._maxBodies = maxBodies;

        this._positions = new Float64Array(maxBodies * POSITION_STRIDE);
        this._velocities = new Float64Array(maxBodies * VELOCITY_STRIDE);
        this._massData = new Float64Array(maxBodies * MASS_STRIDE);
        this._bodyTypes = new Uint8Array(maxBodies);
        this._bodyFlags = new Uint32Array(maxBodies);
        this._gravityScales = new Float32Array(maxBodies);
        this._dampings = new Float32Array(maxBodies * 2);

        for (let i = 0; i < maxBodies; i++) {
            this._positions[i * POSITION_STRIDE + ROTATION_OFFSET + 3] = 1;
            this._gravityScales[i] = 1;
        }
    }

    get bodyCount(): number {
        return this._bodyCount;
    }

    createBody(def: IPhysicsBodyDef3D): BodyId3D {
        this._assertActive();

        if (this._bodyCount >= this._maxBodies && this._freeIndices.length === 0) {
            throw new PhysicsError3D('Body capacity exceeded', BodyManagerError.CAPACITY_EXCEEDED);
        }

        const bodyId = this._nextBodyId++ as BodyId3D;
        const index = this._allocateIndex();

        this._bodyIdToIndex.set(bodyId, index);
        this._indexToBodyId.set(index, bodyId);

        const posOffset = index * POSITION_STRIDE;
        if (def.position) {
            this._positions[posOffset + POSITION_OFFSET] = def.position.x;
            this._positions[posOffset + POSITION_OFFSET + 1] = def.position.y;
            this._positions[posOffset + POSITION_OFFSET + 2] = def.position.z;
        }

        if (def.rotation) {
            this._positions[posOffset + ROTATION_OFFSET] = def.rotation.x;
            this._positions[posOffset + ROTATION_OFFSET + 1] = def.rotation.y;
            this._positions[posOffset + ROTATION_OFFSET + 2] = def.rotation.z;
            this._positions[posOffset + ROTATION_OFFSET + 3] = def.rotation.w;
        } else {
            this._positions[posOffset + ROTATION_OFFSET + 3] = 1;
        }

        const velOffset = index * VELOCITY_STRIDE;
        if (def.linearVelocity) {
            this._velocities[velOffset + LINEAR_VEL_OFFSET] = def.linearVelocity.x;
            this._velocities[velOffset + LINEAR_VEL_OFFSET + 1] = def.linearVelocity.y;
            this._velocities[velOffset + LINEAR_VEL_OFFSET + 2] = def.linearVelocity.z;
        }

        if (def.angularVelocity) {
            this._velocities[velOffset + ANGULAR_VEL_OFFSET] = def.angularVelocity.x;
            this._velocities[velOffset + ANGULAR_VEL_OFFSET + 1] = def.angularVelocity.y;
            this._velocities[velOffset + ANGULAR_VEL_OFFSET + 2] = def.angularVelocity.z;
        }

        this._bodyTypes[index] = def.type;
        this._gravityScales[index] = def.gravityScale ?? 1;
        this._dampings[index * 2] = def.linearDamping ?? 0;
        this._dampings[index * 2 + 1] = def.angularDamping ?? 0;

        let flags = 0;
        if (def.fixedRotation) flags |= 1;
        if (def.bullet) flags |= 2;
        if (def.allowSleep !== false) flags |= 16;
        if (def.awake !== false) flags |= 32;
        if (def.enabled !== false) flags |= 64;
        this._bodyFlags[index] = flags;

        const massOffset = index * MASS_STRIDE;
        if (def.type === 2) {
            this._massData[massOffset] = 1;
            this._massData[massOffset + 1] = 1;
            this._massData[massOffset + 2] = 1;
            this._massData[massOffset + 3] = 1;
            this._massData[massOffset + 4] = 1;
            this._massData[massOffset + 5] = 1;
            this._massData[massOffset + 6] = 1;
            this._massData[massOffset + 7] = 1;
        }

        this._bodyCount += 1;
        return bodyId;
    }

    destroyBody(bodyId: BodyId3D): void {
        this._assertActive();

        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        this._bodyIdToIndex.delete(bodyId);
        this._indexToBodyId.delete(index);
        this._freeIndices.push(index);

        const posOffset = index * POSITION_STRIDE;
        for (let i = 0; i < POSITION_STRIDE; i++) {
            this._positions[posOffset + i] = 0;
        }
        this._positions[posOffset + ROTATION_OFFSET + 3] = 1;

        const velOffset = index * VELOCITY_STRIDE;
        for (let i = 0; i < VELOCITY_STRIDE; i++) {
            this._velocities[velOffset + i] = 0;
        }

        this._bodyTypes[index] = 0;
        this._bodyFlags[index] = 0;
        this._gravityScales[index] = 1;
        this._dampings[index * 2] = 0;
        this._dampings[index * 2 + 1] = 0;

        this._bodyCount -= 1;
    }

    getPosition(bodyId: BodyId3D): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };

        const offset = index * POSITION_STRIDE + POSITION_OFFSET;
        return {
            x: this._positions[offset],
            y: this._positions[offset + 1],
            z: this._positions[offset + 2],
        };
    }

    setPosition(bodyId: BodyId3D, position: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        const offset = index * POSITION_STRIDE + POSITION_OFFSET;
        this._positions[offset] = position.x;
        this._positions[offset + 1] = position.y;
        this._positions[offset + 2] = position.z;
    }

    getRotation(bodyId: BodyId3D): IQuatLike {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0, w: 1 };

        const offset = index * POSITION_STRIDE + ROTATION_OFFSET;
        return {
            x: this._positions[offset],
            y: this._positions[offset + 1],
            z: this._positions[offset + 2],
            w: this._positions[offset + 3],
        };
    }

    setRotation(bodyId: BodyId3D, rotation: IQuatLike): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        const offset = index * POSITION_STRIDE + ROTATION_OFFSET;
        this._positions[offset] = rotation.x;
        this._positions[offset + 1] = rotation.y;
        this._positions[offset + 2] = rotation.z;
        this._positions[offset + 3] = rotation.w;
    }

    getLinearVelocity(bodyId: BodyId3D): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };

        const offset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        return {
            x: this._velocities[offset],
            y: this._velocities[offset + 1],
            z: this._velocities[offset + 2],
        };
    }

    setLinearVelocity(bodyId: BodyId3D, velocity: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        const offset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        this._velocities[offset] = velocity.x;
        this._velocities[offset + 1] = velocity.y;
        this._velocities[offset + 2] = velocity.z;
    }

    getAngularVelocity(bodyId: BodyId3D): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };

        const offset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
        return {
            x: this._velocities[offset],
            y: this._velocities[offset + 1],
            z: this._velocities[offset + 2],
        };
    }

    setAngularVelocity(bodyId: BodyId3D, velocity: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        const offset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
        this._velocities[offset] = velocity.x;
        this._velocities[offset + 1] = velocity.y;
        this._velocities[offset + 2] = velocity.z;
    }

    getBodyType(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return 0;
        return this._bodyTypes[index];
    }

    setBodyType(bodyId: BodyId3D, type: BodyType): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        this._bodyTypes[index] = type;
    }

    getMass(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return 0;
        return this._massData[index * MASS_STRIDE];
    }

    setMass(bodyId: BodyId3D, mass: number): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        const offset = index * MASS_STRIDE;
        this._massData[offset] = mass;
        this._massData[offset + 1] = mass > 0 ? 1 / mass : 0;
    }

    getInverseMass(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return 0;
        return this._massData[index * MASS_STRIDE + 1];
    }

    getInertiaTensor(bodyId: BodyId3D): IVec3Like {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return { x: 0, y: 0, z: 0 };

        const offset = index * MASS_STRIDE + 2;
        return {
            x: this._massData[offset],
            y: this._massData[offset + 1],
            z: this._massData[offset + 2],
        };
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

    isAwake(bodyId: BodyId3D): boolean {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return false;
        return (this._bodyFlags[index] & 32) !== 0;
    }

    setAwake(bodyId: BodyId3D, awake: boolean): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;

        if (awake) {
            this._bodyFlags[index] |= 32;
        } else {
            this._bodyFlags[index] &= ~32;
        }
    }

    applyForce(bodyId: BodyId3D, force: IVec3Like, point?: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || this._bodyTypes[index] !== 2) return;

        const invMass = this._massData[index * MASS_STRIDE + 1];
        if (invMass === 0) return;

        const velOffset = index * VELOCITY_STRIDE + LINEAR_VEL_OFFSET;
        this._velocities[velOffset] += force.x * invMass;
        this._velocities[velOffset + 1] += force.y * invMass;
        this._velocities[velOffset + 2] += force.z * invMass;

        if (point) {
            const posOffset = index * POSITION_STRIDE + POSITION_OFFSET;
            const rx = point.x - this._positions[posOffset];
            const ry = point.y - this._positions[posOffset + 1];
            const rz = point.z - this._positions[posOffset + 2];

            const torqueX = ry * force.z - rz * force.y;
            const torqueY = rz * force.x - rx * force.z;
            const torqueZ = rx * force.y - ry * force.x;

            const massOffset = index * MASS_STRIDE + 5;
            const invIx = this._massData[massOffset];
            const invIy = this._massData[massOffset + 1];
            const invIz = this._massData[massOffset + 2];

            const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
            this._velocities[angOffset] += torqueX * invIx;
            this._velocities[angOffset + 1] += torqueY * invIy;
            this._velocities[angOffset + 2] += torqueZ * invIz;
        }

        this.setAwake(bodyId, true);
    }

    applyForceToCenter(bodyId: BodyId3D, force: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || this._bodyTypes[index] !== 2) return;

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
        if (index === undefined || this._bodyTypes[index] !== 2) return;

        const massOffset = index * MASS_STRIDE + 5;
        const invIx = this._massData[massOffset];
        const invIy = this._massData[massOffset + 1];
        const invIz = this._massData[massOffset + 2];

        const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
        this._velocities[angOffset] += torque.x * invIx;
        this._velocities[angOffset + 1] += torque.y * invIy;
        this._velocities[angOffset + 2] += torque.z * invIz;

        this.setAwake(bodyId, true);
    }

    applyImpulse(bodyId: BodyId3D, impulse: IVec3Like, point?: IVec3Like): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined || this._bodyTypes[index] !== 2) return;

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

            const angImpulseX = ry * impulse.z - rz * impulse.y;
            const angImpulseY = rz * impulse.x - rx * impulse.z;
            const angImpulseZ = rx * impulse.y - ry * impulse.x;

            const massOffset = index * MASS_STRIDE + 5;
            const invIx = this._massData[massOffset];
            const invIy = this._massData[massOffset + 1];
            const invIz = this._massData[massOffset + 2];

            const angOffset = index * VELOCITY_STRIDE + ANGULAR_VEL_OFFSET;
            this._velocities[angOffset] += angImpulseX * invIx;
            this._velocities[angOffset + 1] += angImpulseY * invIy;
            this._velocities[angOffset + 2] += angImpulseZ * invIz;
        }

        this.setAwake(bodyId, true);
    }

    getBodyIds(): BodyId3D[] {
        return Array.from(this._bodyIdToIndex.keys());
    }

    getGravityScale(bodyId: BodyId3D): number {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return 1;
        return this._gravityScales[index];
    }

    setGravityScale(bodyId: BodyId3D, scale: number): void {
        const index = this._bodyIdToIndex.get(bodyId);
        if (index === undefined) return;
        this._gravityScales[index] = scale;
    }

    private _allocateIndex(): number {
        if (this._freeIndices.length > 0) {
            return this._freeIndices.pop()!;
        }

        return this._bodyCount;
    }

    private _assertActive(): void {
        if (this._state !== ManagerState.Active) {
            throw new PhysicsError3D('Manager is disposed', BodyManagerError.INVALID_STATE);
        }
    }

    [Symbol.dispose](): void {
        if (this._state === ManagerState.Disposed) return;
        this._state = ManagerState.Disposed;
        this._bodyIdToIndex.clear();
        this._indexToBodyId.clear();
        this._freeIndices.length = 0;
    }
}

export class ShapeManager3D implements Disposable {
    private _nextShapeId = 1;
    private _shapeCount = 0;
    private readonly _maxShapes: number;
    private readonly _shapeIdToIndex = new Map<ShapeId3D, number>();
    private readonly _shapeToBody = new Map<ShapeId3D, BodyId3D>();
    private readonly _bodyToShapes = new Map<BodyId3D, Set<ShapeId3D>>();

    private readonly _shapeTypes: Uint8Array;
    private readonly _shapeData: Float64Array;
    private readonly _materials: Float32Array;
    private readonly _filters: Uint32Array;
    private readonly _aabbs: Float32Array;

    private _state: ManagerState = ManagerState.Active;
    private readonly _freeIndices: number[] = [];

    constructor(maxShapes: number = 8192) {
        this._maxShapes = maxShapes;
        this._shapeTypes = new Uint8Array(maxShapes);
        this._shapeData = new Float64Array(maxShapes * SHAPE_STRIDE);
        this._materials = new Float32Array(maxShapes * 4);
        this._filters = new Uint32Array(maxShapes * 3);
        this._aabbs = new Float32Array(maxShapes * 6);
    }

    get shapeCount(): number {
        return this._shapeCount;
    }

    createSphere(
        bodyId: BodyId3D,
        def: ISphereShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        return this._createShape(
            bodyId,
            5,
            (offset) => {
                this._shapeData[offset] = def.center.x;
                this._shapeData[offset + 1] = def.center.y;
                this._shapeData[offset + 2] = def.center.z;
                this._shapeData[offset + 3] = def.radius;
            },
            material,
            filter
        );
    }

    createBox(
        bodyId: BodyId3D,
        def: IBoxShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        return this._createShape(
            bodyId,
            3,
            (offset) => {
                this._shapeData[offset] = def.center.x;
                this._shapeData[offset + 1] = def.center.y;
                this._shapeData[offset + 2] = def.center.z;
                this._shapeData[offset + 3] = def.halfExtents.x;
                this._shapeData[offset + 4] = def.halfExtents.y;
                this._shapeData[offset + 5] = def.halfExtents.z;
                if (def.rotation) {
                    this._shapeData[offset + 6] = def.rotation.x;
                    this._shapeData[offset + 7] = def.rotation.y;
                    this._shapeData[offset + 8] = def.rotation.z;
                    this._shapeData[offset + 9] = def.rotation.w;
                } else {
                    this._shapeData[offset + 9] = 1;
                }
            },
            material,
            filter
        );
    }

    createCapsule(
        bodyId: BodyId3D,
        def: ICapsuleShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        return this._createShape(
            bodyId,
            1,
            (offset) => {
                this._shapeData[offset] = def.p1.x;
                this._shapeData[offset + 1] = def.p1.y;
                this._shapeData[offset + 2] = def.p1.z;
                this._shapeData[offset + 3] = def.p2.x;
                this._shapeData[offset + 4] = def.p2.y;
                this._shapeData[offset + 5] = def.p2.z;
                this._shapeData[offset + 6] = def.radius;
            },
            material,
            filter
        );
    }

    createCylinder(
        bodyId: BodyId3D,
        def: ICylinderShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        return this._createShape(
            bodyId,
            6,
            (offset) => {
                this._shapeData[offset] = def.center.x;
                this._shapeData[offset + 1] = def.center.y;
                this._shapeData[offset + 2] = def.center.z;
                this._shapeData[offset + 3] = def.radius;
                this._shapeData[offset + 4] = def.height;
                this._shapeData[offset + 5] = def.axis ?? 1;
            },
            material,
            filter
        );
    }

    createConvexHull(
        bodyId: BodyId3D,
        def: IConvexHullShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        return this._createShape(
            bodyId,
            8,
            (offset) => {
                this._shapeData[offset] = def.vertices.length;
            },
            material,
            filter
        );
    }

    destroyShape(shapeId: ShapeId3D): void {
        const index = this._shapeIdToIndex.get(shapeId);
        if (index === undefined) return;

        const bodyId = this._shapeToBody.get(shapeId);
        if (bodyId !== undefined) {
            const shapes = this._bodyToShapes.get(bodyId);
            if (shapes) {
                shapes.delete(shapeId);
                if (shapes.size === 0) {
                    this._bodyToShapes.delete(bodyId);
                }
            }
        }

        this._shapeIdToIndex.delete(shapeId);
        this._shapeToBody.delete(shapeId);
        this._freeIndices.push(index);

        this._shapeTypes[index] = 0;
        const dataOffset = index * SHAPE_STRIDE;
        for (let i = 0; i < SHAPE_STRIDE; i++) {
            this._shapeData[dataOffset + i] = 0;
        }

        this._shapeCount -= 1;
    }

    getShapeType(shapeId: ShapeId3D): number {
        const index = this._shapeIdToIndex.get(shapeId);
        if (index === undefined) return 0;
        return this._shapeTypes[index];
    }

    getBodyForShape(shapeId: ShapeId3D): BodyId3D | undefined {
        return this._shapeToBody.get(shapeId);
    }

    getShapesForBody(bodyId: BodyId3D): readonly ShapeId3D[] {
        const shapes = this._bodyToShapes.get(bodyId);
        return shapes ? Array.from(shapes) : [];
    }

    private _createShape(
        bodyId: BodyId3D,
        type: number,
        initData: (offset: number) => void,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3DShape
    ): ShapeId3D {
        if (this._shapeCount >= this._maxShapes && this._freeIndices.length === 0) {
            throw new PhysicsError3D('Shape capacity exceeded', 'CAPACITY_EXCEEDED');
        }

        const shapeId = this._nextShapeId++ as ShapeId3D;
        const index = this._freeIndices.length > 0 ? this._freeIndices.pop()! : this._shapeCount;

        this._shapeIdToIndex.set(shapeId, index);
        this._shapeToBody.set(shapeId, bodyId);

        let shapes = this._bodyToShapes.get(bodyId);
        if (!shapes) {
            shapes = new Set();
            this._bodyToShapes.set(bodyId, shapes);
        }
        shapes.add(shapeId);

        this._shapeTypes[index] = type;

        const dataOffset = index * SHAPE_STRIDE;
        initData(dataOffset);

        const matOffset = index * 4;
        this._materials[matOffset] = (material?.friction as number) ?? 0.4;
        this._materials[matOffset + 1] = (material?.restitution as number) ?? 0;
        this._materials[matOffset + 2] = (material?.density as number) ?? 1;
        this._materials[matOffset + 3] = 0;

        const filterOffset = index * 3;
        this._filters[filterOffset] = filter?.categoryBits ?? 1;
        this._filters[filterOffset + 1] = filter?.maskBits ?? 0xffff;
        this._filters[filterOffset + 2] = filter?.groupIndex ?? 0;

        this._shapeCount += 1;
        return shapeId;
    }

    [Symbol.dispose](): void {
        if (this._state === ManagerState.Disposed) return;
        this._state = ManagerState.Disposed;
        this._shapeIdToIndex.clear();
        this._shapeToBody.clear();
        this._bodyToShapes.clear();
    }
}

export class ConstraintManager3D implements Disposable {
    private _nextConstraintId = 1;
    private _constraintCount = 0;
    private readonly _maxConstraints: number;
    private readonly _constraintIdToIndex = new Map<ConstraintId3D, number>();
    private readonly _constraintTypes: Uint8Array;
    private readonly _constraintData: Float64Array;
    private readonly _bodyToConstraints = new Map<BodyId3D, Set<ConstraintId3D>>();
    private readonly _constraintBodies = new Map<ConstraintId3D, [BodyId3D, BodyId3D]>();

    private _state: ManagerState = ManagerState.Active;
    private readonly _freeIndices: number[] = [];

    constructor(maxConstraints: number = 2048) {
        this._maxConstraints = maxConstraints;
        this._constraintTypes = new Uint8Array(maxConstraints);
        this._constraintData = new Float64Array(maxConstraints * CONSTRAINT_STRIDE);
    }

    get constraintCount(): number {
        return this._constraintCount;
    }

    createFixedConstraint(def: IFixedConstraintDef3D): ConstraintId3D {
        return this._createConstraint(0, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localAnchorA.x;
            this._constraintData[offset + 1] = def.localAnchorA.y;
            this._constraintData[offset + 2] = def.localAnchorA.z;
            this._constraintData[offset + 3] = def.localAnchorB.x;
            this._constraintData[offset + 4] = def.localAnchorB.y;
            this._constraintData[offset + 5] = def.localAnchorB.z;
        });
    }

    createHingeConstraint(def: IHingeConstraintDef3D): ConstraintId3D {
        return this._createConstraint(2, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localAnchorA.x;
            this._constraintData[offset + 1] = def.localAnchorA.y;
            this._constraintData[offset + 2] = def.localAnchorA.z;
            this._constraintData[offset + 3] = def.localAnchorB.x;
            this._constraintData[offset + 4] = def.localAnchorB.y;
            this._constraintData[offset + 5] = def.localAnchorB.z;
            this._constraintData[offset + 6] = def.localAxisA.x;
            this._constraintData[offset + 7] = def.localAxisA.y;
            this._constraintData[offset + 8] = def.localAxisA.z;
            this._constraintData[offset + 9] = def.localAxisB.x;
            this._constraintData[offset + 10] = def.localAxisB.y;
            this._constraintData[offset + 11] = def.localAxisB.z;
            this._constraintData[offset + 12] = def.enableLimit ? 1 : 0;
            this._constraintData[offset + 13] = def.lowerLimit ?? -Math.PI;
            this._constraintData[offset + 14] = def.upperLimit ?? Math.PI;
            this._constraintData[offset + 15] = def.enableMotor ? 1 : 0;
            this._constraintData[offset + 16] = def.motorSpeed ?? 0;
            this._constraintData[offset + 17] = (def.maxMotorTorque as number) ?? 0;
        });
    }

    createSliderConstraint(def: ISliderConstraintDef3D): ConstraintId3D {
        return this._createConstraint(3, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localAnchorA.x;
            this._constraintData[offset + 1] = def.localAnchorA.y;
            this._constraintData[offset + 2] = def.localAnchorA.z;
            this._constraintData[offset + 3] = def.localAnchorB.x;
            this._constraintData[offset + 4] = def.localAnchorB.y;
            this._constraintData[offset + 5] = def.localAnchorB.z;
            this._constraintData[offset + 6] = def.localAxisA.x;
            this._constraintData[offset + 7] = def.localAxisA.y;
            this._constraintData[offset + 8] = def.localAxisA.z;
            this._constraintData[offset + 9] = def.enableLimit ? 1 : 0;
            this._constraintData[offset + 10] = def.lowerLimit ?? -1;
            this._constraintData[offset + 11] = def.upperLimit ?? 1;
            this._constraintData[offset + 12] = def.enableMotor ? 1 : 0;
            this._constraintData[offset + 13] = def.motorSpeed ?? 0;
            this._constraintData[offset + 14] = (def.maxMotorForce as number) ?? 0;
        });
    }

    createSpringConstraint(def: ISpringConstraintDef3D): ConstraintId3D {
        return this._createConstraint(6, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localAnchorA.x;
            this._constraintData[offset + 1] = def.localAnchorA.y;
            this._constraintData[offset + 2] = def.localAnchorA.z;
            this._constraintData[offset + 3] = def.localAnchorB.x;
            this._constraintData[offset + 4] = def.localAnchorB.y;
            this._constraintData[offset + 5] = def.localAnchorB.z;
            this._constraintData[offset + 6] = def.restLength ?? 1;
            this._constraintData[offset + 7] = def.stiffness ?? 10;
            this._constraintData[offset + 8] = def.damping ?? 0.5;
        });
    }

    createConeTwistConstraint(def: IConeTwistConstraintDef3D): ConstraintId3D {
        return this._createConstraint(4, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localFrameA.position.x;
            this._constraintData[offset + 1] = def.localFrameA.position.y;
            this._constraintData[offset + 2] = def.localFrameA.position.z;
            this._constraintData[offset + 3] = def.localFrameB.position.x;
            this._constraintData[offset + 4] = def.localFrameB.position.y;
            this._constraintData[offset + 5] = def.localFrameB.position.z;
            this._constraintData[offset + 6] = def.swingSpan1 ?? Math.PI * 0.25;
            this._constraintData[offset + 7] = def.swingSpan2 ?? Math.PI * 0.25;
            this._constraintData[offset + 8] = def.twistSpan ?? Math.PI * 0.5;
            this._constraintData[offset + 9] = def.softness ?? 1;
            this._constraintData[offset + 10] = def.biasFactor ?? 0.3;
            this._constraintData[offset + 11] = def.relaxationFactor ?? 1;
        });
    }

    createGenericConstraint(def: IGenericConstraintDef3D): ConstraintId3D {
        return this._createConstraint(5, def.bodyIdA, def.bodyIdB, (offset) => {
            this._constraintData[offset] = def.localFrameA.position.x;
            this._constraintData[offset + 1] = def.localFrameA.position.y;
            this._constraintData[offset + 2] = def.localFrameA.position.z;
            this._constraintData[offset + 3] = def.localFrameB.position.x;
            this._constraintData[offset + 4] = def.localFrameB.position.y;
            this._constraintData[offset + 5] = def.localFrameB.position.z;
            this._constraintData[offset + 6] = def.linearLowerLimit.x;
            this._constraintData[offset + 7] = def.linearLowerLimit.y;
            this._constraintData[offset + 8] = def.linearLowerLimit.z;
            this._constraintData[offset + 9] = def.linearUpperLimit.x;
            this._constraintData[offset + 10] = def.linearUpperLimit.y;
            this._constraintData[offset + 11] = def.linearUpperLimit.z;
            this._constraintData[offset + 12] = def.angularLowerLimit.x;
            this._constraintData[offset + 13] = def.angularLowerLimit.y;
            this._constraintData[offset + 14] = def.angularLowerLimit.z;
            this._constraintData[offset + 15] = def.angularUpperLimit.x;
            this._constraintData[offset + 16] = def.angularUpperLimit.y;
            this._constraintData[offset + 17] = def.angularUpperLimit.z;
        });
    }

    createFixed(def: IFixedConstraintDef3D): ConstraintId3D {
        return this.createFixedConstraint(def);
    }

    createHinge(def: IHingeConstraintDef3D): ConstraintId3D {
        return this.createHingeConstraint(def);
    }

    createSlider(def: ISliderConstraintDef3D): ConstraintId3D {
        return this.createSliderConstraint(def);
    }

    createSpring(def: ISpringConstraintDef3D): ConstraintId3D {
        return this.createSpringConstraint(def);
    }

    createConeTwist(def: IConeTwistConstraintDef3D): ConstraintId3D {
        return this.createConeTwistConstraint(def);
    }

    createGeneric(def: IGenericConstraintDef3D): ConstraintId3D {
        return this.createGenericConstraint(def);
    }

    destroyConstraint(constraintId: ConstraintId3D): void {
        const index = this._constraintIdToIndex.get(constraintId);
        if (index === undefined) return;

        const bodies = this._constraintBodies.get(constraintId);
        if (bodies) {
            for (const bodyId of bodies) {
                const constraints = this._bodyToConstraints.get(bodyId);
                if (constraints) {
                    constraints.delete(constraintId);
                    if (constraints.size === 0) {
                        this._bodyToConstraints.delete(bodyId);
                    }
                }
            }
        }

        this._constraintIdToIndex.delete(constraintId);
        this._constraintBodies.delete(constraintId);
        this._freeIndices.push(index);
        this._constraintTypes[index] = 0;
        this._constraintCount -= 1;
    }

    getConstraintType(constraintId: ConstraintId3D): number {
        const index = this._constraintIdToIndex.get(constraintId);
        if (index === undefined) return 0;
        return this._constraintTypes[index];
    }

    getConstraintsForBody(bodyId: BodyId3D): readonly ConstraintId3D[] {
        const constraints = this._bodyToConstraints.get(bodyId);
        return constraints ? Array.from(constraints) : [];
    }

    private _createConstraint(
        type: number,
        bodyIdA: BodyId3D,
        bodyIdB: BodyId3D,
        initData: (offset: number) => void
    ): ConstraintId3D {
        if (this._constraintCount >= this._maxConstraints && this._freeIndices.length === 0) {
            throw new PhysicsError3D('Constraint capacity exceeded', 'CAPACITY_EXCEEDED');
        }

        const constraintId = this._nextConstraintId++ as ConstraintId3D;
        const index =
            this._freeIndices.length > 0 ? this._freeIndices.pop()! : this._constraintCount;

        this._constraintIdToIndex.set(constraintId, index);
        this._constraintTypes[index] = type;
        this._constraintBodies.set(constraintId, [bodyIdA, bodyIdB]);

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

        this._constraintCount += 1;
        return constraintId;
    }

    [Symbol.dispose](): void {
        if (this._state === ManagerState.Disposed) return;
        this._state = ManagerState.Disposed;
        this._constraintIdToIndex.clear();
        this._bodyToConstraints.clear();
        this._constraintBodies.clear();
    }
}