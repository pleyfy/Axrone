import type { IVec3Like, IQuatLike } from '@axrone/numeric';
import type {
    BodyId,
    ShapeId,
    ConstraintId,
    BodyType,
    Mass,
    Inertia,
    Force,
    Torque,
    Impulse,
    Friction,
    Restitution,
    IMassData3D,
    IMaterial,
    ITransform3D,
    IVelocity3D,
    IContactManifold3D,
    ISingleRaycastResult3D,
    SolverFlags,
    BodyFlags,
} from '../types';

export type BodyId3D = BodyId & { readonly __3dBrand: unique symbol };
export type ShapeId3D = ShapeId & { readonly __3dBrand: unique symbol };
export type ConstraintId3D = ConstraintId & { readonly __3dBrand: unique symbol };

export const INVALID_BODY_ID_3D = 0 as BodyId3D;
export const INVALID_SHAPE_ID_3D = 0 as ShapeId3D;
export const INVALID_CONSTRAINT_ID_3D = 0 as ConstraintId3D;

export interface IPhysicsBodyDef3D {
    readonly type: BodyType;
    readonly position?: IVec3Like;
    readonly rotation?: IQuatLike;
    readonly linearVelocity?: IVec3Like;
    readonly angularVelocity?: IVec3Like;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly fixedRotation?: boolean;
    readonly bullet?: boolean;
    readonly allowSleep?: boolean;
    readonly awake?: boolean;
    readonly enabled?: boolean;
    readonly userData?: unknown;
}

export interface ISphereShapeDef3D {
    readonly center: IVec3Like;
    readonly radius: number;
}

export interface IBoxShapeDef3D {
    readonly center: IVec3Like;
    readonly halfExtents: IVec3Like;
    readonly rotation?: IQuatLike;
}

export interface ICapsuleShapeDef3D {
    readonly p1: IVec3Like;
    readonly p2: IVec3Like;
    readonly radius: number;
}

export interface ICylinderShapeDef3D {
    readonly center: IVec3Like;
    readonly radius: number;
    readonly height: number;
    readonly axis?: 0 | 1 | 2;
}

export interface IConeShapeDef3D {
    readonly center: IVec3Like;
    readonly radius: number;
    readonly height: number;
    readonly axis?: 0 | 1 | 2;
}

export interface IConvexHullShapeDef3D {
    readonly vertices: readonly IVec3Like[];
}

export interface ITriangleMeshShapeDef3D {
    readonly vertices: readonly IVec3Like[];
    readonly indices: readonly number[];
}

export interface IHeightFieldShapeDef3D {
    readonly heights: Float32Array;
    readonly width: number;
    readonly depth: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly scaleZ: number;
}

export interface ICollisionFilter3D {
    readonly categoryBits: number;
    readonly maskBits: number;
    readonly groupIndex: number;
}

export interface IFixedConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localAnchorA: IVec3Like;
    readonly localAnchorB: IVec3Like;
    readonly localRotationA?: IQuatLike;
    readonly localRotationB?: IQuatLike;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface ISphericalConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localAnchorA: IVec3Like;
    readonly localAnchorB: IVec3Like;
    readonly swingLimitEnabled?: boolean;
    readonly swingLimit?: number;
    readonly twistLimitEnabled?: boolean;
    readonly twistLimitMin?: number;
    readonly twistLimitMax?: number;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface IHingeConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localAnchorA: IVec3Like;
    readonly localAnchorB: IVec3Like;
    readonly localAxisA: IVec3Like;
    readonly localAxisB: IVec3Like;
    readonly enableLimit?: boolean;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: Torque;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface ISliderConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localAnchorA: IVec3Like;
    readonly localAnchorB: IVec3Like;
    readonly localAxisA: IVec3Like;
    readonly enableLimit?: boolean;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorForce?: Force;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface IConeTwistConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localFrameA: { position: IVec3Like; rotation: IQuatLike };
    readonly localFrameB: { position: IVec3Like; rotation: IQuatLike };
    readonly swingSpan1?: number;
    readonly swingSpan2?: number;
    readonly twistSpan?: number;
    readonly softness?: number;
    /**
     * NOT consumed by the solver. The framework uses PhysicsConstants.BAUMGARTE_FACTOR
     * uniformly across all modules. Present for Editor/API compatibility only.
     * @see CharacterJoint3D — passes hardcoded 0.3; has no effect on simulation.
     */
    readonly biasFactor?: number;
    /**
     * NOT consumed by the solver. The framework does not apply per-constraint
     * relaxation. Present for Editor/API compatibility only.
     * @see CharacterJoint3D — passes hardcoded 1; has no effect on simulation.
     */
    readonly relaxationFactor?: number;
    /** Twist motor target velocity (rad/s). Undefined = motor disabled. */
    readonly motorSpeed?: number;
    /** Maximum twist motor torque (N·m). Undefined or zero = motor disabled. */
    readonly maxMotorTorque?: number;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface IGenericConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localFrameA: { position: IVec3Like; rotation: IQuatLike };
    readonly localFrameB: { position: IVec3Like; rotation: IQuatLike };
    readonly linearLowerLimit: IVec3Like;
    readonly linearUpperLimit: IVec3Like;
    readonly angularLowerLimit: IVec3Like;
    readonly angularUpperLimit: IVec3Like;
    readonly linearStiffness?: IVec3Like;
    readonly angularStiffness?: IVec3Like;
    readonly linearDamping?: IVec3Like;
    readonly angularDamping?: IVec3Like;
    /** Per-axis linear motor target speed (m/s). Undefined = no linear motor. */
    readonly motorSpeed?: IVec3Like;
    /** Per-axis linear motor max force (N). Undefined or zero component = no motor on that axis. */
    readonly maxMotorForce?: IVec3Like;
    /** Per-axis angular motor target speed (rad/s). Undefined = no angular motor. */
    readonly angularMotorSpeed?: IVec3Like;
    /** Per-axis angular motor max torque (N·m). Undefined or zero component = no motor on that axis. */
    readonly angularMaxMotorTorque?: IVec3Like;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface ISpringConstraintDef3D {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
    readonly localAnchorA: IVec3Like;
    readonly localAnchorB: IVec3Like;
    readonly restLength?: number;
    readonly stiffness?: number;
    readonly damping?: number;
    readonly collideConnected?: boolean;
    readonly userData?: unknown;
}

export interface IPhysicsWorld3DConfig {
    readonly gravity?: IVec3Like;
    readonly maxBodies?: number;
    readonly maxShapes?: number;
    readonly maxConstraints?: number;
    readonly maxContacts?: number;
    readonly solverIterations?: number;
    readonly enableProfiler?: boolean;
    readonly allowSleep?: boolean;
}

export interface IPhysicsProfiler3D {
    stepTime: number;
    collisionTime: number;
    solveTime: number;
    broadphaseTime: number;
    narrowphaseTime: number;
    solveVelocityTime: number;
    solvePositionTime: number;
    sleepTime: number;
    warmStartTime: number;
    persistTime: number;
    integrateVelocityTime: number;
    integratePositionTime: number;
    eventsTime: number;
    // ccdTime removed: 3D CCD is not implemented (separate scope).
    // Consistent with enableCCD removal (commit d2f7310f).
}

// IQueryFilter3D — defined here (physics-3d type section) because it is only
// consumed by the physics-3d package.  Kept in physics-core solely so that the
// physics-3d barrel (`export * from '@axrone/physics-core'`) re-exports it.
export interface IQueryFilter3D {
    readonly categoryBits?: number;
    readonly maskBits?: number;
    readonly groupIndex?: number;
}

export const enum ShapeType3D {
    Sphere = 5,
    Box = 3,
    Capsule = 1,
    Cylinder = 6,
    Cone = 7,
    ConvexHull = 8,
    TriangleMesh = 9,
    HeightField = 10,
}

export const enum ConstraintType3D {
    Fixed = 0,
    Spherical = 1,
    Hinge = 2,
    Slider = 3,
    ConeTwist = 4,
    Generic = 5,
    Spring = 6,
}
