export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export type MutableVec3 = [number, number, number];
export type MutableQuat = [number, number, number, number];

export type BodyType = "static" | "dynamic" | "kinematic";

export const WasmBodyType = Object.freeze({
    static: 0,
    kinematic: 1,
    dynamic: 2
} as const) satisfies Record<BodyType, number>;

export const WasmBodyTypeCode = Object.freeze({
    static: 0,
    dynamic: 1,
    kinematic: 2
} as const) satisfies Record<BodyType, number>;

export const BODY_FLAGS = Object.freeze({
    freezeRotationX: 1,
    freezeRotationY: 2,
    freezeRotationZ: 4,
    freezePositionX: 8,
    freezePositionY: 16,
    freezePositionZ: 32
});

export interface SphereShape {
    readonly kind: "sphere";
    readonly radius: number;
}

export interface BoxShape {
    readonly kind: "box";
    readonly halfExtents: Vec3Tuple;
}

export interface CapsuleShape {
    readonly kind: "capsule";
    readonly radius: number;
    readonly halfSegment: number;
}

export interface CylinderShape {
    readonly kind: "cylinder";
    readonly radius: number;
    readonly halfHeight: number;
}

export interface ConeShape {
    readonly kind: "cone";
    readonly radius: number;
    readonly halfHeight: number;
}

export interface Float32ArrayLike {
    readonly length: number;
    readonly [index: number]: number;
}

export type VertexSource = readonly number[] | Float32ArrayLike;

export interface HullShape {
    readonly kind: "hull";
    readonly vertices: VertexSource;
}

export interface TriangleMeshShape {
    readonly kind: "mesh";
    readonly vertices: VertexSource;
    readonly indices: readonly number[] | Uint32Array;
}

export interface HeightFieldShape {
    readonly kind: "heightField";
    readonly width: number;
    readonly depth: number;
    readonly heights: readonly number[] | Float32Array;
    readonly scale?: Vec3Tuple;
}

export type Shape = SphereShape | BoxShape | CapsuleShape | CylinderShape | ConeShape | HullShape | TriangleMeshShape | HeightFieldShape;

export interface CapsuleAttachOptions {
    readonly radius: number;
    readonly halfSegment: number;
    readonly density?: number;
    readonly offset?: Vec3Tuple;
    readonly rotation?: QuatTuple;
}

export interface CylinderAttachOptions {
    readonly radius: number;
    readonly halfHeight: number;
    readonly density?: number;
    readonly offset?: Vec3Tuple;
    readonly rotation?: QuatTuple;
}

export interface ConeAttachOptions {
    readonly radius: number;
    readonly halfHeight: number;
    readonly density?: number;
    readonly offset?: Vec3Tuple;
    readonly rotation?: QuatTuple;
}

export interface HullAttachOptions {
    readonly vertices: VertexSource;
    readonly density?: number;
    readonly offset?: Vec3Tuple;
}

export interface MeshAttachOptions {
    readonly vertices: VertexSource;
    readonly indices: readonly number[] | Uint32Array;
    readonly offset?: Vec3Tuple;
}

export interface HeightFieldAttachOptions {
    readonly width: number;
    readonly depth: number;
    readonly heights: readonly number[] | Float32Array;
    readonly scale?: Vec3Tuple;
    readonly offset?: Vec3Tuple;
}

export interface BodyOptions {
    readonly type?: BodyType;
    readonly shape?: Shape;
    readonly position?: Vec3Tuple;
    readonly rotation?: QuatTuple;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
}

export interface WorldOptions {
    readonly maxBodies: number;
    readonly maxContacts?: number;
    readonly gravity?: Vec3Tuple;
    readonly boxManifoldPointCap?: 4 | 8;
}

export interface StepOptions {
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

export interface FixedJointOptions {
    readonly localAnchorA: Vec3Tuple;
    readonly localAnchorB: Vec3Tuple;
    readonly collideConnected?: boolean;
}

export interface HingeJointOptions {
    readonly localAnchorA: Vec3Tuple;
    readonly localAnchorB: Vec3Tuple;
    readonly localAxisA: Vec3Tuple;
    readonly localAxisB: Vec3Tuple;
    readonly enableLimit?: boolean;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: number;
    readonly collideConnected?: boolean;
}

export interface SliderJointOptions {
    readonly localAnchorA: Vec3Tuple;
    readonly localAnchorB: Vec3Tuple;
    readonly localAxisA: Vec3Tuple;
    readonly enableLimit?: boolean;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorForce?: number;
    readonly collideConnected?: boolean;
}

export interface SpringJointOptions {
    readonly localAnchorA: Vec3Tuple;
    readonly localAnchorB: Vec3Tuple;
    readonly restLength?: number;
    readonly stiffness?: number;
    readonly damping?: number;
    readonly collideConnected?: boolean;
}

export interface TransformSnapshot {
    readonly position: MutableVec3;
    readonly rotation: MutableQuat;
}

export interface ContactSnapshot {
    readonly a: number;
    readonly b: number;
    readonly normal: MutableVec3;
    readonly penetration: number;
}

export type ShapeMaterial = readonly [friction: number, restitution: number];

export type ShapeFilter = readonly [categoryBits: number, maskBits: number, groupIndex: number];

export type ContactEventKind =
    | "begin"
    | "stay"
    | "end"
    | "sensorEnter"
    | "sensorStay"
    | "sensorExit";

export interface ContactEventSnapshot {
    readonly kind: ContactEventKind;
    readonly bodyA: number;
    readonly bodyB: number;
    readonly shapeA: number;
    readonly shapeB: number;
    readonly normal: Vec3Tuple;
    readonly penetration: number;
}

export interface RaycastHit {
    readonly body: number;
    readonly shape: number;
    readonly distance: number;
    readonly point: Vec3Tuple;
    readonly normal: Vec3Tuple;
}

export interface QueryFilter {
    readonly categoryBits: number;
    readonly maskBits: number;
}

export interface RaycastFractionHit {
    readonly body: number;
    readonly shape: number;
    readonly fraction: number;
    readonly point: Vec3Tuple;
    readonly normal: Vec3Tuple;
}

export interface PhysicsStepCounters {
    readonly recordVersion: number;
    readonly recordBytes: number;
    readonly boxPointBuckets: readonly number[];
    readonly boxFacePairs: number;
    readonly boxEdgePairs: number;
    readonly boxPairsTotal: number;
    readonly cacheLookups: number;
    readonly cacheHits: number;
    readonly cacheStores: number;
    readonly pointIdentitiesPrevStep: number;
    readonly pointIdentitiesRepeatingPrevStep: number;
    readonly stepsRecorded: number;
    readonly boxClipCandidateTotal: number;
}

export interface StepStatistics {
    readonly broadphasePairsTested: number;
    readonly shapePairsTested: number;
    readonly contactsGenerated: number;
    readonly sensorContacts: number;
    readonly velocityIterations: number;
    readonly positionIterations: number;
    readonly sleepingBodies: number;
    readonly liveBodies: number;
    readonly statisticsVersion: number;
    readonly counters: PhysicsStepCounters | null;
}

export interface PhaseTimers {
    readonly recordVersion: number;
    readonly recordBytes: number;
    readonly integrateMs: number;
    readonly broadphaseMs: number;
    readonly collideMs: number;
    readonly prepareMs: number;
    readonly assembleConstraintsMs: number;
    readonly solveVelocitiesMs: number;
    readonly solvePositionsMs: number;
    readonly sleepAndCacheSwapMs: number;
    readonly packMs: number;
    readonly sweepSortMs: number;
    readonly pairLoopMs: number;
}

export interface PhaseTimerNesting {
    readonly sweptMs: number;
    readonly collideMs: number;
    readonly clampFired: boolean;
}

export interface WasmProfilerSnapshot {
    readonly stepTime: number;
    readonly collisionTime: number | null;
    readonly solveTime: number | null;
    readonly broadphaseTime: number | null;
    readonly narrowphaseTime: number | null;
    readonly sweepSortTime: number | null;
    readonly pairLoopTime: number | null;
    readonly solveVelocityTime: number | null;
    readonly solvePositionTime: number | null;
    readonly sleepTime: number | null;
    readonly sleepAndCacheSwapTime: number | null;
    readonly warmStartTime: number | null;
    readonly persistTime: number | null;
    readonly integrateVelocityTime: number | null;
    readonly integratePositionTime: number | null;
    readonly eventsTime: number | null;
}
