import { Vec2, IVec2Like } from '@axrone/numeric';
import type {
    IPhysicsWorld2D,
    IPhysicsWorldConfig,
    IPhysicsWorldStatistics,
    IPhysicsProfiler,
    BodyId,
    ShapeId,
    ConstraintId,
    IPhysicsBodyDef2D,
    ICircleShapeDef,
    IBoxShapeDef2D,
    IPolygonShapeDef,
    ISegmentShapeDef,
    ICapsuleShapeDef2D,
    IDistanceConstraintDef2D,
    IRevoluteConstraintDef2D,
    IPrismaticConstraintDef2D,
    IWeldConstraintDef2D,
    IWheelConstraintDef2D,
    IMotorConstraintDef2D,
    IMouseConstraintDef2D,
    IGearConstraintDef,
    IRopeConstraintDef2D,
    IContactListener2D,
    ICollisionFilter,
    RaycastCallback2D,
    IRaycastResult2D,
    IQueryFilter,
    IAABBQueryCallback,
    IPhysicsBody2D,
    IShape2D,
    IConstraint2D,
} from '../types';
import { SolverFlags } from '../types';

import { BodyManager2D } from './body-manager';
import { ShapeManager2D } from './shape-manager';
import { ConstraintManager2D } from './constraint-manager';
import { ContactManager2D } from './contact-manager';
import { IslandSolver2D } from './island-solver';

export class PhysicsWorld2D implements IPhysicsWorld2D {
    readonly config: Readonly<IPhysicsWorldConfig>;
    private readonly _gravity: Vec2;

    private readonly _bodyManager: BodyManager2D;
    private readonly _shapeManager: ShapeManager2D;
    private readonly _constraintManager: ConstraintManager2D;
    private readonly _contactManager: ContactManager2D;
    private readonly _solver: IslandSolver2D;

    private _autoClearForces: boolean = true;
    private _profiler: IPhysicsProfiler | null = null;
    private _disposed: boolean = false;

    private _stepTime: number = 0;

    constructor(config: IPhysicsWorldConfig = {}) {
        this.config = config;
        this._gravity = config.gravity
            ? Vec2.from(config.gravity as IVec2Like)
            : new Vec2(0, -9.81);

        const maxBodies = config.maxBodies ?? 1024;
        const maxShapes = config.maxShapes ?? 2048;
        const maxConstraints = config.maxConstraints ?? 1024;
        const maxContacts = config.maxContacts ?? 4096;

        this._bodyManager = new BodyManager2D(maxBodies);
        this._shapeManager = new ShapeManager2D(maxShapes);
        this._constraintManager = new ConstraintManager2D(maxConstraints);
        this._contactManager = new ContactManager2D(maxContacts);

        this._solver = new IslandSolver2D(
            this._bodyManager,
            this._contactManager,
            this._constraintManager
        );

        if (config.enableProfiler) {
            this._profiler = {
                stepTime: 0,
                collisionTime: 0,
                solveTime: 0,
                broadphaseTime: 0,
                narrowphaseTime: 0,
                solveInitTime: 0,
                solveVelocityTime: 0,
                solvePositionTime: 0,
                sleepTime: 0,
            };
        }
    }

    get gravity(): Readonly<IVec2Like> {
        return this._gravity;
    }

    step(deltaTime: number, velocityIterations: number = 8, positionIterations: number = 3): void {
        if (this._disposed) return;

        const t0 = performance.now();

        const solverFlags = this.config.solverFlags ?? SolverFlags.Default;
        const allowSleep = this.config.allowSleep ?? true;

        this._solver.solveIslands(
            deltaTime,
            velocityIterations,
            positionIterations,
            allowSleep,
            solverFlags,
            this._profiler as any
        );

        if (this._autoClearForces) {
            this.clearForces();
        }

        this._stepTime = performance.now() - t0;
        if (this._profiler) {
            this._profiler.stepTime = this._stepTime;
        }
    }

    createBody(def: IPhysicsBodyDef2D): BodyId {
        return this._bodyManager.createBody(def);
    }

    destroyBody(bodyId: BodyId): void {
        const shapes = this._shapeManager.getShapesForBody(bodyId);
        for (const shapeId of shapes) {
            this._shapeManager.destroyShape(shapeId);
        }

        const constraints = this._constraintManager.getConstraintsForBody(bodyId);
        for (const constraintId of constraints) {
            this._constraintManager.destroyConstraint(constraintId);
        }

        const contacts = this._contactManager.getContactsForBody(bodyId);

        const contactList = Array.from(contacts);
        for (const contactId of contactList) {
            this._contactManager.destroyContact(contactId);
        }

        this._bodyManager.destroyBody(bodyId);
    }

    getBody(bodyId: BodyId): IPhysicsBody2D | null {
        if (!this._bodyManager.hasBody(bodyId)) return null;

        return null as any;
    }

    getBodies(): ReadonlyMap<BodyId, IPhysicsBody2D> {
        return new Map();
    }

    createCircleShape(bodyId: BodyId, def: ICircleShapeDef): ShapeId {
        return this._shapeManager.createCircle(bodyId, def);
    }

    createBoxShape(bodyId: BodyId, def: IBoxShapeDef2D): ShapeId {
        return this._shapeManager.createBox(bodyId, def);
    }

    createPolygonShape(bodyId: BodyId, def: IPolygonShapeDef): ShapeId {
        return this._shapeManager.createPolygon(bodyId, def);
    }

    createCapsuleShape(bodyId: BodyId, def: ICapsuleShapeDef2D): ShapeId {
        return this._shapeManager.createCapsule(bodyId, def);
    }

    createSegmentShape(bodyId: BodyId, def: ISegmentShapeDef): ShapeId {
        return this._shapeManager.createSegment(bodyId, def);
    }

    destroyShape(shapeId: ShapeId): void {
        this._shapeManager.destroyShape(shapeId);
    }

    getShape(shapeId: ShapeId): IShape2D | null {
        return null;
    }

    createDistanceConstraint(def: IDistanceConstraintDef2D): ConstraintId {
        return this._constraintManager.createDistanceConstraint(def);
    }

    createRevoluteConstraint(def: IRevoluteConstraintDef2D): ConstraintId {
        return this._constraintManager.createRevoluteConstraint(def);
    }

    createPrismaticConstraint(def: IPrismaticConstraintDef2D): ConstraintId {
        return this._constraintManager.createPrismaticConstraint(def);
    }

    createWeldConstraint(def: IWeldConstraintDef2D): ConstraintId {
        return this._constraintManager.createWeldConstraint(def);
    }

    createWheelConstraint(def: IWheelConstraintDef2D): ConstraintId {
        return 0 as ConstraintId;
    }

    createMotorConstraint(def: IMotorConstraintDef2D): ConstraintId {
        return this._constraintManager.createMotorConstraint(def);
    }

    createMouseConstraint(def: IMouseConstraintDef2D): ConstraintId {
        return this._constraintManager.createMouseConstraint(def);
    }

    createGearConstraint(def: IGearConstraintDef): ConstraintId {
        return 0 as ConstraintId;
    }

    createRopeConstraint(def: IRopeConstraintDef2D): ConstraintId {
        return 0 as ConstraintId;
    }

    destroyConstraint(constraintId: ConstraintId): void {
        this._constraintManager.destroyConstraint(constraintId);
    }

    getConstraint(constraintId: ConstraintId): IConstraint2D | null {
        return null;
    }

    setGravity(gravity: Readonly<IVec2Like>): void {
        this._gravity.x = gravity.x;
        this._gravity.y = gravity.y;
    }

    getGravity(): Readonly<IVec2Like> {
        return this._gravity;
    }

    setContactListener(listener: IContactListener2D | null): void {
        this._contactManager.setContactListener(listener);
    }

    setCollisionFilter(filter: ICollisionFilter | null): void {
        this._contactManager.setCollisionFilter(filter);
    }

    rayCast(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        callback: RaycastCallback2D
    ): void {}
    rayCastClosest(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): IRaycastResult2D | null {
        return null;
    }
    rayCastAll(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): readonly IRaycastResult2D[] {
        return [];
    }

    queryAABB(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        callback: IAABBQueryCallback
    ): void {}
    queryAABBAll(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        filter?: IQueryFilter
    ): readonly ShapeId[] {
        return [];
    }

    queryPoint(point: Readonly<IVec2Like>, callback: IAABBQueryCallback): void {}
    queryPointAll(point: Readonly<IVec2Like>, filter?: IQueryFilter): readonly ShapeId[] {
        return [];
    }

    shiftOrigin(newOrigin: Readonly<IVec2Like>): void {
        for (const bodyId of this._bodyManager.getBodyIds()) {
            const pos = this._bodyManager.getPosition(bodyId);
            this._bodyManager.setPosition(bodyId, {
                x: pos.x - newOrigin.x,
                y: pos.y - newOrigin.y,
            });
        }
    }

    clearForces(): void {
        this._bodyManager.clearForces();
    }

    wakeAllBodies(): void {
        for (const bodyId of this._bodyManager.getBodyIds()) {
            this._bodyManager.setAwake(bodyId, true);
        }
    }

    getStatistics(): IPhysicsWorldStatistics {
        return {
            bodyCount: this._bodyManager.bodyCount,
            shapeCount: this._shapeManager.shapeCount,
            constraintCount: this._constraintManager.constraintCount,
            contactCount: this._contactManager.contactCount,
            proxyCount: 0,

            islandCount: 0,

            treeHeight: 0,

            treeBalance: 0,
            treeQuality: 0,
            stepTime: this._stepTime,
            collisionTime: 0,
            solveTime: 0,
            broadphaseTime: 0,
            narrowphaseTime: 0,
        };
    }

    getProfiler(): IPhysicsProfiler | null {
        return this._profiler;
    }

    setAutoClearForces(flag: boolean): void {
        this._autoClearForces = flag;
    }

    getAutoClearForces(): boolean {
        return this._autoClearForces;
    }

    getProxyCount(): number {
        return 0;
    }
    getTreeHeight(): number {
        return 0;
    }
    getTreeBalance(): number {
        return 0;
    }
    getTreeQuality(): number {
        return 0;
    }

    validate(): boolean {
        return true;
    }
    dump(): void {}

    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;

        this._bodyManager[Symbol.dispose]();
        this._shapeManager[Symbol.dispose]();
        this._constraintManager[Symbol.dispose]();
        this._contactManager[Symbol.dispose]();
    }
}
