import type { IVec2Like, IVec3Like } from '@axrone/numeric';
import type {
    BodyId,
    ShapeId,
    ConstraintId,
    IslandId,
    SolverFlags,
    IRaycastResult2D,
    IRaycastResult3D,
    IContactManifold2D,
    IContactManifold3D,
} from './primitives';
import type {
    IPhysicsBody2D,
    IPhysicsBody3D,
    IPhysicsBodyDef2D,
    IPhysicsBodyDef3D,
    IShape2D,
    IShape3D,
    ICircleShapeDef,
    ISphereShapeDef,
    IBoxShapeDef2D,
    IBoxShapeDef3D,
    IPolygonShapeDef,
    IConvexHullShapeDef,
    ICapsuleShapeDef2D,
    ICapsuleShapeDef3D,
    ISegmentShapeDef,
    ICylinderShapeDef,
    IConeShapeDef,
} from './physics-body';
import type {
    IConstraint2D,
    IConstraint3D,
    IDistanceConstraintDef2D,
    IDistanceConstraintDef3D,
    IRevoluteConstraintDef2D,
    IRevoluteConstraintDef3D,
    IPrismaticConstraintDef2D,
    IPrismaticConstraintDef3D,
    IWeldConstraintDef2D,
    IWeldConstraintDef3D,
    IWheelConstraintDef2D,
    IMotorConstraintDef2D,
    IMotorConstraintDef3D,
    IMouseConstraintDef2D,
    IGearConstraintDef,
    IRopeConstraintDef2D,
    IRopeConstraintDef3D,
} from './constraints';
import type {
    IContactListener2D,
    IContactListener3D,
    ICollisionFilter,
    RaycastCallback2D,
    RaycastCallback3D,
} from './collision';

export interface IPhysicsWorldConfig {
    readonly gravity?: Readonly<IVec2Like> | Readonly<IVec3Like>;
    readonly solverIterations?: number;
    readonly positionIterations?: number;
    readonly allowSleep?: boolean;
    readonly warmStarting?: boolean;
    readonly continuousPhysics?: boolean;
    readonly subStepping?: boolean;
    readonly solverFlags?: SolverFlags;
    readonly maxBodies?: number;
    readonly maxShapes?: number;
    readonly maxConstraints?: number;
    readonly maxContacts?: number;
    /** Legacy alias for `maxBodies` used in tests */
    readonly bodyCapacity?: number;
    /** Legacy alias for `maxShapes` used in tests */
    readonly shapeCapacity?: number;
    /** Legacy alias for `maxContacts` used in tests */
    readonly contactCapacity?: number;
    /** Legacy alias for `maxConstraints` used in tests */
    readonly constraintCapacity?: number;
    readonly broadphaseType?: BroadphaseType;
    readonly enableProfiler?: boolean;
}

export const enum BroadphaseType {
    BruteForce = 0,
    SweepAndPrune = 1,
    DynamicAABBTree = 2,
    SpatialHash = 3,
    Quadtree = 4,
    Octree = 5,
}

export interface IPhysicsWorldStatistics {
    readonly bodyCount: number;
    readonly shapeCount: number;
    readonly constraintCount: number;
    readonly contactCount: number;
    readonly proxyCount: number;
    readonly islandCount: number;
    readonly treeHeight: number;
    readonly treeBalance: number;
    readonly treeQuality: number;
    readonly stepTime: number;
    readonly collisionTime: number;
    readonly solveTime: number;
    readonly broadphaseTime: number;
    readonly narrowphaseTime: number;
}

export interface IPhysicsProfiler {
    stepTime: number;
    collisionTime: number;
    solveTime: number;
    broadphaseTime: number;
    narrowphaseTime: number;
    solveInitTime: number;
    solveVelocityTime: number;
    solvePositionTime: number;
    sleepTime: number;
}

export interface IIsland2D {
    readonly id: IslandId;
    readonly bodies: readonly BodyId[];
    readonly contacts: readonly IContactManifold2D[];
    readonly constraints: readonly ConstraintId[];
    readonly isSleeping: boolean;
}

export interface IIsland3D {
    readonly id: IslandId;
    readonly bodies: readonly BodyId[];
    readonly contacts: readonly IContactManifold3D[];
    readonly constraints: readonly ConstraintId[];
    readonly isSleeping: boolean;
}

export interface IQueryFilter {
    readonly categoryBits?: number;
    readonly maskBits?: number;
    readonly groupIndex?: number;
}

export interface IAABBQueryCallback {
    (shapeId: ShapeId): boolean;
}

export interface IPhysicsWorld2D extends Disposable {
    readonly config: Readonly<IPhysicsWorldConfig>;
    readonly gravity: Readonly<IVec2Like>;

    step(deltaTime: number, velocityIterations?: number, positionIterations?: number): void;

    createBody(def: IPhysicsBodyDef2D): BodyId;
    destroyBody(bodyId: BodyId): void;
    getBody(bodyId: BodyId): IPhysicsBody2D | null;
    getBodies(): ReadonlyMap<BodyId, IPhysicsBody2D>;

    createCircleShape(bodyId: BodyId, def: ICircleShapeDef): ShapeId;
    createBoxShape(bodyId: BodyId, def: IBoxShapeDef2D): ShapeId;
    createPolygonShape(bodyId: BodyId, def: IPolygonShapeDef): ShapeId;
    createCapsuleShape(bodyId: BodyId, def: ICapsuleShapeDef2D): ShapeId;
    createSegmentShape(bodyId: BodyId, def: ISegmentShapeDef): ShapeId;
    destroyShape(shapeId: ShapeId): void;
    getShape(shapeId: ShapeId): IShape2D | null;

    createDistanceConstraint(def: IDistanceConstraintDef2D): ConstraintId;
    createRevoluteConstraint(def: IRevoluteConstraintDef2D): ConstraintId;
    createPrismaticConstraint(def: IPrismaticConstraintDef2D): ConstraintId;
    createWeldConstraint(def: IWeldConstraintDef2D): ConstraintId;
    createWheelConstraint(def: IWheelConstraintDef2D): ConstraintId;
    createMotorConstraint(def: IMotorConstraintDef2D): ConstraintId;
    createMouseConstraint(def: IMouseConstraintDef2D): ConstraintId;
    createGearConstraint(def: IGearConstraintDef): ConstraintId;
    createRopeConstraint(def: IRopeConstraintDef2D): ConstraintId;
    destroyConstraint(constraintId: ConstraintId): void;
    getConstraint(constraintId: ConstraintId): IConstraint2D | null;

    setGravity(gravity: Readonly<IVec2Like>): void;
    getGravity(): Readonly<IVec2Like>;

    setContactListener(listener: IContactListener2D | null): void;
    setCollisionFilter(filter: ICollisionFilter | null): void;

    rayCast(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        callback: RaycastCallback2D
    ): void;
    rayCastClosest(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): IRaycastResult2D | null;
    rayCastAll(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): readonly IRaycastResult2D[];

    queryAABB(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        callback: IAABBQueryCallback
    ): void;
    queryAABBAll(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        filter?: IQueryFilter
    ): readonly ShapeId[];

    queryPoint(point: Readonly<IVec2Like>, callback: IAABBQueryCallback): void;
    queryPointAll(point: Readonly<IVec2Like>, filter?: IQueryFilter): readonly ShapeId[];

    shiftOrigin(newOrigin: Readonly<IVec2Like>): void;
    clearForces(): void;
    wakeAllBodies(): void;

    getStatistics(): IPhysicsWorldStatistics;
    getProfiler(): IPhysicsProfiler | null;

    setAutoClearForces(flag: boolean): void;
    getAutoClearForces(): boolean;

    getProxyCount(): number;
    getTreeHeight(): number;
    getTreeBalance(): number;
    getTreeQuality(): number;

    validate(): boolean;
    dump(): void;
}

export interface IPhysicsWorld3D extends Disposable {
    readonly config: Readonly<IPhysicsWorldConfig>;
    readonly gravity: Readonly<IVec3Like>;

    step(deltaTime: number, velocityIterations?: number, positionIterations?: number): void;

    createBody(def: IPhysicsBodyDef3D): BodyId;
    destroyBody(bodyId: BodyId): void;
    getBody(bodyId: BodyId): IPhysicsBody3D | null;
    getBodies(): ReadonlyMap<BodyId, IPhysicsBody3D>;

    createSphereShape(bodyId: BodyId, def: ISphereShapeDef): ShapeId;
    createBoxShape(bodyId: BodyId, def: IBoxShapeDef3D): ShapeId;
    createCapsuleShape(bodyId: BodyId, def: ICapsuleShapeDef3D): ShapeId;
    createCylinderShape(bodyId: BodyId, def: ICylinderShapeDef): ShapeId;
    createConeShape(bodyId: BodyId, def: IConeShapeDef): ShapeId;
    createConvexHullShape(bodyId: BodyId, def: IConvexHullShapeDef): ShapeId;
    destroyShape(shapeId: ShapeId): void;
    getShape(shapeId: ShapeId): IShape3D | null;

    createDistanceConstraint(def: IDistanceConstraintDef3D): ConstraintId;
    createRevoluteConstraint(def: IRevoluteConstraintDef3D): ConstraintId;
    createPrismaticConstraint(def: IPrismaticConstraintDef3D): ConstraintId;
    createWeldConstraint(def: IWeldConstraintDef3D): ConstraintId;
    createMotorConstraint(def: IMotorConstraintDef3D): ConstraintId;
    createRopeConstraint(def: IRopeConstraintDef3D): ConstraintId;
    destroyConstraint(constraintId: ConstraintId): void;
    getConstraint(constraintId: ConstraintId): IConstraint3D | null;

    setGravity(gravity: Readonly<IVec3Like>): void;
    getGravity(): Readonly<IVec3Like>;

    setContactListener(listener: IContactListener3D | null): void;
    setCollisionFilter(filter: ICollisionFilter | null): void;

    rayCast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number,
        callback: RaycastCallback3D
    ): void;
    rayCastClosest(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): IRaycastResult3D | null;
    rayCastAll(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): readonly IRaycastResult3D[];

    queryAABB(
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>,
        callback: IAABBQueryCallback
    ): void;
    queryAABBAll(
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>,
        filter?: IQueryFilter
    ): readonly ShapeId[];

    queryPoint(point: Readonly<IVec3Like>, callback: IAABBQueryCallback): void;
    queryPointAll(point: Readonly<IVec3Like>, filter?: IQueryFilter): readonly ShapeId[];

    shiftOrigin(newOrigin: Readonly<IVec3Like>): void;
    clearForces(): void;
    wakeAllBodies(): void;

    getStatistics(): IPhysicsWorldStatistics;
    getProfiler(): IPhysicsProfiler | null;

    setAutoClearForces(flag: boolean): void;
    getAutoClearForces(): boolean;

    getProxyCount(): number;
    getTreeHeight(): number;
    getTreeBalance(): number;
    getTreeQuality(): number;

    validate(): boolean;
    dump(): void;
}

export type PhysicsWorld = IPhysicsWorld2D | IPhysicsWorld3D;
