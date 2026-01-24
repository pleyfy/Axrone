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
    IRaycastResult3D,
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
    readonly biasFactor?: number;
    readonly relaxationFactor?: number;
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
    readonly enableCCD?: boolean;
    readonly enableProfiler?: boolean;
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
    ccdTime: number;
}

export interface IContactListener3D {
    onCollisionBegin?(manifold: IContactManifold3D): void;
    onCollisionStay?(manifold: IContactManifold3D): void;
    onCollisionEnd?(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void;
    onTriggerEnter?(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void;
    onTriggerExit?(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void;
}

export type RaycastCallback3D = (result: IRaycastResult3D) => boolean;

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
