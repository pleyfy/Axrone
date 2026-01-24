import type { IVec2Like, IVec3Like } from '@axrone/numeric';

export type PhysicsScalar = number & { readonly __physicsScalarBrand: unique symbol };
export type Mass = PhysicsScalar & { readonly __massBrand: unique symbol };
export type Inertia = PhysicsScalar & { readonly __inertiaBrand: unique symbol };
export type Force = PhysicsScalar & { readonly __forceBrand: unique symbol };
export type Torque = PhysicsScalar & { readonly __torqueBrand: unique symbol };
export type Velocity = PhysicsScalar & { readonly __velocityBrand: unique symbol };
export type AngularVelocity = PhysicsScalar & { readonly __angularVelocityBrand: unique symbol };
export type Impulse = PhysicsScalar & { readonly __impulseBrand: unique symbol };
export type Friction = PhysicsScalar & { readonly __frictionBrand: unique symbol };
export type Restitution = PhysicsScalar & { readonly __restitutionBrand: unique symbol };
export type Density = PhysicsScalar & { readonly __densityBrand: unique symbol };

export type BodyId = number & { readonly __bodyIdBrand: unique symbol };
export type ShapeId = number & { readonly __shapeIdBrand: unique symbol };
export type ConstraintId = number & { readonly __constraintIdBrand: unique symbol };
export type ContactId = number & { readonly __contactIdBrand: unique symbol };
export type ManifoldId = number & { readonly __manifoldIdBrand: unique symbol };
export type IslandId = number & { readonly __islandIdBrand: unique symbol };

export const INVALID_BODY_ID = 0 as BodyId;
export const INVALID_SHAPE_ID = 0 as ShapeId;
export const INVALID_CONSTRAINT_ID = 0 as ConstraintId;
export const INVALID_CONTACT_ID = 0 as ContactId;

export const enum BodyType {
    Static = 0,
    Kinematic = 1,
    Dynamic = 2,
}

export const enum ShapeType {
    Circle = 0,
    Capsule = 1,
    Polygon = 2,
    Box = 3,
    Segment = 4,
    Sphere = 5,
    Cylinder = 6,
    Cone = 7,
    ConvexHull = 8,
    TriangleMesh = 9,
    HeightField = 10,
}

export const enum ConstraintType {
    Distance = 0,
    Revolute = 1,
    Prismatic = 2,
    Weld = 3,
    Wheel = 4,
    Motor = 5,
    Mouse = 6,
    Gear = 7,
    Rope = 8,
}

export const enum CollisionFilter {
    None = 0,
    Default = 1,
    Static = 2,
    Dynamic = 4,
    Kinematic = 8,
    Trigger = 16,
    All = 0xffff,
}

export const enum SolverFlags {
    None = 0,
    WarmStarting = 1 << 0,
    ContinuousDetection = 1 << 1,
    SubStepping = 1 << 2,
    SleepingBodies = 1 << 3,
    PositionCorrection = 1 << 4,
    VelocityConstraints = 1 << 5,
    Default = WarmStarting | SleepingBodies | PositionCorrection | VelocityConstraints,
}

export const enum BodyFlags {
    None = 0,
    FixedRotation = 1 << 0,
    Bullet = 1 << 1,
    Sensor = 1 << 2,
    Sleeping = 1 << 3,
    AutoSleep = 1 << 4,
    Awake = 1 << 5,
    Active = 1 << 6,
    Island = 1 << 7,
}

export interface ITransform2D {
    readonly position: Readonly<IVec2Like>;
    readonly rotation: number;
}

export interface ITransform3D {
    readonly position: Readonly<IVec3Like>;
    readonly rotation: Readonly<IVec3Like>;
}

export interface IVelocity2D {
    linear: IVec2Like;
    angular: number;
}

export interface IVelocity3D {
    linear: IVec3Like;
    angular: IVec3Like;
}

export interface IMassData2D {
    readonly mass: Mass;
    readonly inverseMass: number;
    readonly inertia: Inertia;
    readonly inverseInertia: number;
    readonly center: Readonly<IVec2Like>;
}

export interface IMassData3D {
    readonly mass: Mass;
    readonly inverseMass: number;
    readonly inertiaTensor: Readonly<IVec3Like>;
    readonly inverseInertiaTensor: Readonly<IVec3Like>;
    readonly center: Readonly<IVec3Like>;
}

export interface IMaterial {
    readonly friction: Friction;
    readonly restitution: Restitution;
    readonly density: Density;
    readonly rollingFriction?: Friction;
    readonly spinningFriction?: Friction;
}

export interface IRaycastResult2D {
    readonly hit: boolean;
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
    readonly point: Readonly<IVec2Like>;
    readonly normal: Readonly<IVec2Like>;
    readonly fraction: number;
}

export interface IRaycastResult3D {
    readonly hit: boolean;
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
    readonly point: Readonly<IVec3Like>;
    readonly normal: Readonly<IVec3Like>;
    readonly fraction: number;
}

export interface IContactPoint2D {
    readonly id: ContactId;
    readonly localPointA: Readonly<IVec2Like>;
    readonly localPointB: Readonly<IVec2Like>;
    readonly normalImpulse: Impulse;
    readonly tangentImpulse: Impulse;
    readonly separation: number;
}

export interface IContactPoint3D {
    readonly id: ContactId;
    readonly localPointA: Readonly<IVec3Like>;
    readonly localPointB: Readonly<IVec3Like>;
    readonly normalImpulse: Impulse;
    readonly tangentImpulse1: Impulse;
    readonly tangentImpulse2: Impulse;
    readonly separation: number;
}

export interface IContactManifold2D {
    readonly id: ManifoldId;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly normal: Readonly<IVec2Like>;
    readonly pointCount: number;
    readonly points: readonly IContactPoint2D[];
}

export interface IContactManifold3D {
    readonly id: ManifoldId;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly normal: Readonly<IVec3Like>;
    readonly tangent1: Readonly<IVec3Like>;
    readonly tangent2: Readonly<IVec3Like>;
    readonly pointCount: number;
    readonly points: readonly IContactPoint3D[];
}

export const PhysicsConstants = Object.freeze({
    DEFAULT_GRAVITY_2D: { x: 0, y: -9.81 } as Readonly<IVec2Like>,
    DEFAULT_GRAVITY_3D: { x: 0, y: -9.81, z: 0 } as Readonly<IVec3Like>,
    MAX_VELOCITY: 200.0,
    MAX_ANGULAR_VELOCITY: 250.0,
    LINEAR_SLOP: 0.005,
    ANGULAR_SLOP: (2.0 / 180.0) * Math.PI,
    BAUMGARTE_FACTOR: 0.2,
    TOI_BAUMGARTE: 0.75,
    MAX_SUB_STEPS: 8,
    MAX_TOI_CONTACTS: 32,
    VELOCITY_THRESHOLD: 1.0,
    MAX_LINEAR_CORRECTION: 0.2,
    MAX_ANGULAR_CORRECTION: (8.0 / 180.0) * Math.PI,
    MAX_TRANSLATION: 2.0,
    MAX_ROTATION: 0.5 * Math.PI,
    CONTACT_BREAK_THRESHOLD: 0.02,
    SLEEP_TIME: 0.5,
    LINEAR_SLEEP_TOLERANCE: 0.01,
    ANGULAR_SLEEP_TOLERANCE: (2.0 / 180.0) * Math.PI,
    ALLOWED_PENETRATION: 0.01,
    CONTACT_PERSISTENT_THRESHOLD_SQ: 0.01,
    EPSILON: 1e-10,
});

export type Vec2Pool = Float64Array;
export type Vec3Pool = Float64Array;
export type TransformPool = Float64Array;
export type VelocityPool = Float64Array;
export type MassDataPool = Float64Array;
