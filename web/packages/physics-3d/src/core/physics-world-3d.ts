import { Vec3, Quat, type IVec3Like } from '@axrone/numeric';
import type {
    IAABBQueryCallback,
    ICollisionFilter,
    IConstraint3D,
    IMassData3D,
    IMaterial,
    IPhysicsBody3D,
    IPhysicsWorldStatistics,
    ISingleRaycastResult3D,
    IShape3D,
    Mass,
} from '../types';
import {
    BodyFlags,
    BodyType,
    ShapeType,
} from '../types';
import type {
    BodyId3D,
    ConstraintId3D,
    IBoxShapeDef3D,
    ICapsuleShapeDef3D,
    ICollisionFilter3D,
    IConeShapeDef3D,
    IConeTwistConstraintDef3D,
    IContactListener3D,
    IConvexHullShapeDef3D,
    ICylinderShapeDef3D,
    IFixedConstraintDef3D,
    IGenericConstraintDef3D,
    IHeightFieldShapeDef3D,
    IHingeConstraintDef3D,
    IPhysicsBodyDef3D,
    IPhysicsProfiler3D,
    IPhysicsWorld3DConfig,
    IQueryFilter3D,
    ISliderConstraintDef3D,
    ISphereShapeDef3D,
    ISpringConstraintDef3D,
    ITriangleMeshShapeDef3D,
    RaycastCallback3D,
    ShapeId3D,
} from '../types/physics-3d';
import {
    BodyManager3D,
    ConstraintManager3D,
    ShapeManager3D,
} from './physics-managers-3d';
import { PhysicsWorld3DContactRuntime } from './physics-world-3d-contact-runtime';
import {
    BODY_TYPE_DYNAMIC,
    CONSTRAINT_TYPE_CONE_TWIST,
    CONSTRAINT_TYPE_FIXED,
    CONSTRAINT_TYPE_GENERIC,
    CONSTRAINT_TYPE_HINGE,
    CONSTRAINT_TYPE_SLIDER,
    CONSTRAINT_TYPE_SPRING,
    type IAabb3D,
    type IConstraintDescriptor3D,
    type IShapeDescriptor3D,
    type IShapeOptions3D,
    type IShapeRayHit3D,
    type SupportedConstraintDef3D,
    inverseTransformPoint3D,
    inverseVec3,
    transformPoint3D,
} from './physics-world-3d-shared';
import { PhysicsConstants } from '../types';
import {
    computeShapeMassData,
} from './physics-world-3d-shape-mass-properties';
import {
    computeShapeAabb as computeShapeAabbImpl,
    getShapeWorldCenter as getShapeWorldCenterImpl,
    refreshShapeFrame as refreshShapeFrameImpl,
    rayCastShape as rayCastShapeImpl,
    testPointShape as testPointShapeImpl,
} from './physics-world-3d-shape-geometry';
import {
    integratePositions as integratePositionsImpl,
    integrateVelocities as integrateVelocitiesImpl,
} from './physics-world-3d-integration';
import {
    queryAABB as queryAABBImpl,
    queryAABBAll as queryAABBAllImpl,
    queryPoint as queryPointImpl,
    queryPointAll as queryPointAllImpl,
    raycast as raycastImpl,
    rayCastAll as rayCastAllImpl,
    rayCastClosest as rayCastClosestImpl,
    shiftOrigin as shiftOriginImpl,
} from './physics-world-3d-queries';
import {
    createBoxShape as createBoxShapeImpl,
    createCapsuleShape as createCapsuleShapeImpl,
    createConeShape as createConeShapeImpl,
    createConvexHullShape as createConvexHullShapeImpl,
    createCylinderShape as createCylinderShapeImpl,
    createHeightFieldShape as createHeightFieldShapeImpl,
    createSphereShape as createSphereShapeImpl,
    createTriangleMeshShape as createTriangleMeshShapeImpl,
} from './physics-world-3d-shape-factory';

export { BodyManager3D, ShapeManager3D, ConstraintManager3D } from './physics-managers-3d';

export class PhysicsWorld3D implements Disposable {
    readonly config: Readonly<IPhysicsWorld3DConfig>;
    private readonly _gravity: Vec3;

    private readonly _bodyManager: BodyManager3D;
    private readonly _shapeManager: ShapeManager3D;
    private readonly _constraintManager: ConstraintManager3D;
    private readonly _shapeDescriptors = new Map<ShapeId3D, IShapeDescriptor3D>();
    private readonly _shapeViews = new Map<ShapeId3D, IShape3D>();
    private readonly _constraintDescriptors = new Map<ConstraintId3D, IConstraintDescriptor3D>();
    private readonly _constraintViews = new Map<ConstraintId3D, IConstraint3D>();
    private readonly _bodyViews = new Map<BodyId3D, IPhysicsBody3D>();
    private readonly _contactRuntime: PhysicsWorld3DContactRuntime;

    private _profiler: IPhysicsProfiler3D | null = null;
    /**
     * Monotonic step token. Shape transform frames are refreshed during the
     * broadphase pass of the same step and are only trusted while the token
     * matches, so a frame can never be read after bodies have moved.
     */
    private _frameGeneration = 0;
    private _contactListener: IContactListener3D | null = null;
    private _collisionFilter: ICollisionFilter | null = null;
    private _autoClearForces = true;
    private _disposed = false;
    private readonly _sleepTimes = new Map<BodyId3D, number>();
    /** Previous transform for kinematic bodies — detects actual movement. (P1-4) */
    private readonly _kinematicPrevPos = new Map<BodyId3D, { x: number; y: number; z: number }>();
    private readonly _kinematicPrevRot = new Map<BodyId3D, { x: number; y: number; z: number; w: number }>();

    // ADR 0004: Config-driven physics limits (metre-based)
    /** Maximum linear velocity in metres per second (m/s). @see ADR 0004 */
    private readonly _maxVelocity: number;
    /** Maximum angular velocity in radians per second (rad/s). @see ADR 0004 */
    private readonly _maxAngularVelocity: number;
    /** Maximum position translation per step in metres per step (m/step). @see ADR 0004 */
    private readonly _maxTranslation: number;

    constructor(config: IPhysicsWorld3DConfig = {}) {
        this.config = config;
        this._gravity = config.gravity ? Vec3.from(config.gravity) : new Vec3(0, -9.81, 0);

        const maxBodies = config.maxBodies ?? 4096;
        const maxShapes = config.maxShapes ?? 8192;
        const maxConstraints = config.maxConstraints ?? 2048;

        this._bodyManager = new BodyManager3D(maxBodies);
        this._shapeManager = new ShapeManager3D(maxShapes);
        this._constraintManager = new ConstraintManager3D(maxConstraints);

        if (config.enableProfiler) {
            this._profiler = {
                stepTime: 0,
                collisionTime: 0,
                solveTime: 0,
                broadphaseTime: 0,
                narrowphaseTime: 0,
                solveVelocityTime: 0,
                solvePositionTime: 0,
                sleepTime: 0,
                warmStartTime: 0,
                persistTime: 0,
                integrateVelocityTime: 0,
                integratePositionTime: 0,
                eventsTime: 0,
            };
        }

        this._contactRuntime = new PhysicsWorld3DContactRuntime({
            bodyManager: this._bodyManager,
            constraintManager: this._constraintManager,
            shapeDescriptors: this._shapeDescriptors,
            constraintDescriptors: this._constraintDescriptors,
            getProfiler: () => this._profiler,
            getContactListener: () => this._contactListener,
            getCollisionFilter: () => this._collisionFilter,
            computeShapeAabb: (descriptor) => this._computeShapeAabb(descriptor),
            getFrameGeneration: () => this._frameGeneration,
            getShapeWorldCenter: (descriptor) => this._getShapeWorldCenter(descriptor),
            getConstraintAnchor: (def, firstBody) => this._getConstraintAnchor(def, firstBody),
        });

        // P1-4: Kinematic transform tracking — wake sleeping contact neighbors
        // when a kinematic body actually moves.
        this._bodyManager.onKinematicTransformChange((bodyId) => {
            this._wakeKinematicContacts(bodyId);
        });

        // ADR 0004: Config-driven physics limits (metre-based)
        const cfg = config as IPhysicsWorld3DConfig & {
            maxVelocity?: number;
            maxAngularVelocity?: number;
            maxTranslation?: number;
        };
        this._maxVelocity = cfg.maxVelocity ?? PhysicsConstants.MAX_VELOCITY;
        this._maxAngularVelocity = cfg.maxAngularVelocity ?? PhysicsConstants.MAX_ANGULAR_VELOCITY;
        this._maxTranslation = cfg.maxTranslation ?? PhysicsConstants.MAX_TRANSLATION;
    }

    get gravity(): Readonly<IVec3Like> {
        return this._gravity;
    }

    createBody(def: IPhysicsBodyDef3D): BodyId3D {
        return this._bodyManager.createBody(def);
    }

    destroyBody(bodyId: BodyId3D): void {
        const shapeIds = [...this._shapeManager.getShapesForBody(bodyId)];
        for (const shapeId of shapeIds) {
            this.destroyShape(shapeId);
        }

        const constraintIds = [...this._constraintManager.getConstraintsForBody(bodyId)];
        for (const constraintId of constraintIds) {
            this.destroyConstraint(constraintId);
        }

        this._bodyViews.delete(bodyId);
        this._kinematicPrevPos.delete(bodyId);
        this._kinematicPrevRot.delete(bodyId);
        this._sleepTimes.delete(bodyId);
        this._contactRuntime.removeBodyState(bodyId);
        this._bodyManager.destroyBody(bodyId);
    }

    getBody(bodyId: BodyId3D): IPhysicsBody3D | null {
        if (!this._bodyManager.hasBody(bodyId)) {
            return null;
        }

        let view = this._bodyViews.get(bodyId);
        if (!view) {
            view = this._createBodyView(bodyId);
            this._bodyViews.set(bodyId, view);
        }
        return view;
    }

    getBodies(): ReadonlyMap<BodyId3D, IPhysicsBody3D> {
        const bodies = new Map<BodyId3D, IPhysicsBody3D>();
        for (const bodyId of this._bodyManager.getBodyIds()) {
            const body = this.getBody(bodyId);
            if (body) {
                bodies.set(bodyId, body);
            }
        }
        return bodies;
    }

    createSphereShape(
        bodyId: BodyId3D,
        def: ISphereShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createSphereShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createBoxShape(
        bodyId: BodyId3D,
        def: IBoxShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createBoxShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createCapsuleShape(
        bodyId: BodyId3D,
        def: ICapsuleShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createCapsuleShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createCylinderShape(
        bodyId: BodyId3D,
        def: ICylinderShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createCylinderShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createConeShape(
        bodyId: BodyId3D,
        def: IConeShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createConeShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createConvexHullShape(
        bodyId: BodyId3D,
        def: IConvexHullShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createConvexHullShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createTriangleMeshShape(
        bodyId: BodyId3D,
        def: ITriangleMeshShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createTriangleMeshShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    createHeightFieldShape(
        bodyId: BodyId3D,
        def: IHeightFieldShapeDef3D,
        material?: Partial<IMaterial>,
        filter?: ICollisionFilter3D,
        options?: IShapeOptions3D
    ): ShapeId3D {
        return createHeightFieldShapeImpl(this._shapeManager, this._shapeDescriptors, bodyId, def, material, filter, options);
    }

    destroyShape(shapeId: ShapeId3D): void {
        this._shapeViews.delete(shapeId);
        this._shapeDescriptors.delete(shapeId);
        this._contactRuntime.pruneShape(shapeId);
        this._shapeManager.destroyShape(shapeId);
    }

    getShape(shapeId: ShapeId3D): IShape3D | null {
        const descriptor = this._shapeDescriptors.get(shapeId);
        if (!descriptor) {
            return null;
        }

        let view = this._shapeViews.get(shapeId);
        if (!view) {
            view = this._createShapeView(descriptor);
            this._shapeViews.set(shapeId, view);
        }
        return view;
    }

    createFixedConstraint(def: IFixedConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createFixed(def),
            CONSTRAINT_TYPE_FIXED,
            { ...def, localAnchorA: Vec3.copy(def.localAnchorA), localAnchorB: Vec3.copy(def.localAnchorB), kind: CONSTRAINT_TYPE_FIXED }
        );
    }

    createHingeConstraint(def: IHingeConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createHinge(def),
            CONSTRAINT_TYPE_HINGE,
            {
                ...def,
                localAnchorA: Vec3.copy(def.localAnchorA),
                localAnchorB: Vec3.copy(def.localAnchorB),
                localAxisA: Vec3.copy(def.localAxisA),
                localAxisB: Vec3.copy(def.localAxisB),
                kind: CONSTRAINT_TYPE_HINGE,
            }
        );
    }

    createSliderConstraint(def: ISliderConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createSlider(def),
            CONSTRAINT_TYPE_SLIDER,
            {
                ...def,
                localAnchorA: Vec3.copy(def.localAnchorA),
                localAnchorB: Vec3.copy(def.localAnchorB),
                localAxisA: Vec3.copy(def.localAxisA),
                kind: CONSTRAINT_TYPE_SLIDER,
            }
        );
    }

    createSpringConstraint(def: ISpringConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createSpring(def),
            CONSTRAINT_TYPE_SPRING,
            { ...def, localAnchorA: Vec3.copy(def.localAnchorA), localAnchorB: Vec3.copy(def.localAnchorB), kind: CONSTRAINT_TYPE_SPRING }
        );
    }

    createConeTwistConstraint(def: IConeTwistConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createConeTwist(def),
            CONSTRAINT_TYPE_CONE_TWIST,
            {
                ...def,
                localFrameA: {
                    position: Vec3.copy(def.localFrameA.position),
                    rotation: Quat.copy(def.localFrameA.rotation),
                },
                localFrameB: {
                    position: Vec3.copy(def.localFrameB.position),
                    rotation: Quat.copy(def.localFrameB.rotation),
                },
                kind: CONSTRAINT_TYPE_CONE_TWIST,
            }
        );
    }

    createGenericConstraint(def: IGenericConstraintDef3D): ConstraintId3D {
        return this._registerConstraint(
            this._constraintManager.createGeneric(def),
            CONSTRAINT_TYPE_GENERIC,
            {
                ...def,
                localFrameA: {
                    position: Vec3.copy(def.localFrameA.position),
                    rotation: Quat.copy(def.localFrameA.rotation),
                },
                localFrameB: {
                    position: Vec3.copy(def.localFrameB.position),
                    rotation: Quat.copy(def.localFrameB.rotation),
                },
                linearLowerLimit: Vec3.copy(def.linearLowerLimit),
                linearUpperLimit: Vec3.copy(def.linearUpperLimit),
                angularLowerLimit: Vec3.copy(def.angularLowerLimit),
                angularUpperLimit: Vec3.copy(def.angularUpperLimit),
                ...(def.linearStiffness ? { linearStiffness: Vec3.copy(def.linearStiffness) } : {}),
                ...(def.angularStiffness ? { angularStiffness: Vec3.copy(def.angularStiffness) } : {}),
                ...(def.linearDamping ? { linearDamping: Vec3.copy(def.linearDamping) } : {}),
                ...(def.angularDamping ? { angularDamping: Vec3.copy(def.angularDamping) } : {}),
                kind: CONSTRAINT_TYPE_GENERIC,
            }
        );
    }

    destroyConstraint(constraintId: ConstraintId3D): void {
        const descriptor = this._constraintDescriptors.get(constraintId);
        if (descriptor && !descriptor.collideConnected) {
            this._contactRuntime.unregisterJointCollisionPair(
                descriptor.def.bodyIdA,
                descriptor.def.bodyIdB
            );
        }
        this._constraintViews.delete(constraintId);
        this._constraintDescriptors.delete(constraintId);
        this._constraintManager.destroyConstraint(constraintId);
    }

    getConstraint(constraintId: ConstraintId3D): IConstraint3D | null {
        const descriptor = this._constraintDescriptors.get(constraintId);
        if (!descriptor) {
            return null;
        }

        let view = this._constraintViews.get(constraintId);
        if (!view) {
            view = this._createConstraintView(descriptor);
            this._constraintViews.set(constraintId, view);
        }
        return view;
    }

    getBodyManager(): BodyManager3D {
        return this._bodyManager;
    }

    getShapeManager(): ShapeManager3D {
        return this._shapeManager;
    }

    getConstraintManager(): ConstraintManager3D {
        return this._constraintManager;
    }

    getSolverDiagnostics() {
        return this._contactRuntime.getContactDiagnostics();
    }

    step(deltaTime: number, velocityIterations: number = 10, positionIterations: number = 4): void {
        if (this._disposed) return;

        const profiler = this._profiler;
        const t0 = performance.now();

        const integrateVelocityStart = profiler ? performance.now() : 0;
        // 1. Integrate forces → velocities (gravity, damping, force accumulators)
        this._integrateVelocities(deltaTime);
        if (profiler) profiler.integrateVelocityTime = performance.now() - integrateVelocityStart;

        // 2-5. Warm start, velocity solve and position solve run on the
        // manifolds collected at the end of the previous step (their positions
        // equal the start-of-step transforms). Position integration then moves
        // the bodies exactly one integration against those anchors, which the
        // position pass corrects — the same drift relation the old order had.
        this._contactRuntime.warmStart();
        this._contactRuntime.solveVelocity(velocityIterations, deltaTime);

        const integratePositionStart = profiler ? performance.now() : 0;
        this._integratePositions(deltaTime);
        if (profiler) profiler.integratePositionTime = performance.now() - integratePositionStart;

        this._contactRuntime.solvePosition(positionIterations, deltaTime);

        // 6. Persist warm impulses for next frame (after full solve, before events)
        this._contactRuntime.persistWarmImpulses();

        // 7. Broadphase + narrowphase AFTER position integration: manifolds are
        // detected against the transforms the step actually produced, so a pair
        // begins contact on the step it starts overlapping (WASM core order:
        // integrate, update bounds, broadphase, narrowphase, solve). Warm-start
        // keeps working because these fresh manifolds carry the impulses just
        // persisted in step 6 and are solved by the next step's phase-2-5 block.
        // Shape transform frames are valid only for this step.
        this._frameGeneration += 1;
        this._contactRuntime.collectManifolds();

        const eventsStart = profiler ? performance.now() : 0;
        // 8. Fire contact events
        this._contactRuntime.dispatchEvents();
        if (profiler) profiler.eventsTime = performance.now() - eventsStart;

        // 9. World-level sleeping check
        const sleepStart = profiler ? performance.now() : 0;
        if (this.config.allowSleep !== false) {
            this._updateSleeping(deltaTime);
        }
        if (profiler) {
            profiler.sleepTime = performance.now() - sleepStart;
            profiler.solveTime = profiler.solveVelocityTime + profiler.solvePositionTime;
            profiler.stepTime = performance.now() - t0;
        }
    }

    setContactListener(listener: IContactListener3D | null): void {
        this._contactListener = listener;
    }

    setCollisionFilter(filter: ICollisionFilter | null): void {
        this._collisionFilter = filter;
    }

    setGravity(gravity: Readonly<IVec3Like>): void {
        this._gravity.x = gravity.x;
        this._gravity.y = gravity.y;
        this._gravity.z = gravity.z;
    }

    getGravity(): Readonly<IVec3Like> {
        return this._gravity;
    }

    raycast(
        origin: IVec3Like,
        direction: IVec3Like,
        maxDistance: number,
        callback: RaycastCallback3D,
        filter?: IQueryFilter3D
    ): void {
        raycastImpl(origin, direction, maxDistance, callback, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager, filter);
    }

    rayCastClosest(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number,
        filter?: IQueryFilter3D
    ): ISingleRaycastResult3D | null {
        return rayCastClosestImpl(origin, direction, maxFraction, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager, filter);
    }

    rayCastAll(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number,
        filter?: IQueryFilter3D
    ): readonly ISingleRaycastResult3D[] {
        return rayCastAllImpl(origin, direction, maxFraction, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager, filter);
    }

    queryAABB(min: Readonly<IVec3Like>, max: Readonly<IVec3Like>, callback: IAABBQueryCallback): void {
        queryAABBImpl(min, max, callback, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager);
    }

    queryAABBAll(
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>,
        filter?: IQueryFilter3D
    ): readonly ShapeId3D[] {
        return queryAABBAllImpl(min, max, filter, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager);
    }

    queryPoint(point: Readonly<IVec3Like>, callback: IAABBQueryCallback): void {
        queryPointImpl(point, callback, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager);
    }

    queryPointAll(point: Readonly<IVec3Like>, filter?: IQueryFilter3D): readonly ShapeId3D[] {
        return queryPointAllImpl(point, filter, this._shapeDescriptors, this._contactRuntime.broadphase, this._bodyManager);
    }

    shiftOrigin(newOrigin: Readonly<IVec3Like>): void {
        shiftOriginImpl(newOrigin, this._bodyManager);
    }

    clearForces(): void {
        this._bodyManager.clearForceAccumulators();
    }

    wakeAllBodies(): void {
        for (const bodyId of this._bodyManager.getBodyIds()) {
            this._bodyManager.setAwake(bodyId, true);
        }
    }

    getStatistics(): IPhysicsWorldStatistics {
        const tree = this._contactRuntime.broadphase;
        return {
            bodyCount: this._bodyManager.bodyCount,
            shapeCount: this._shapeManager.shapeCount,
            constraintCount: this._constraintManager.constraintCount,
            contactCount: this._contactRuntime.contactCount,
            proxyCount: this._shapeManager.shapeCount,
            islandCount: this._contactRuntime.islandCount,
            treeHeight: tree.getHeight(),
            treeBalance: tree.getTreeBalance(),
            treeQuality: tree.getTreeQuality(),
            stepTime: this._profiler?.stepTime ?? 0,
            collisionTime: this._profiler?.collisionTime ?? 0,
            solveTime: this._profiler?.solveTime ?? 0,
            broadphaseTime: this._profiler?.broadphaseTime ?? 0,
            narrowphaseTime: this._profiler?.narrowphaseTime ?? 0,
        };
    }

    getProfiler(): IPhysicsProfiler3D | null {
        return this._profiler;
    }

    setAutoClearForces(flag: boolean): void {
        this._autoClearForces = flag;
    }

    getAutoClearForces(): boolean {
        return this._autoClearForces;
    }

    getProxyCount(): number {
        return this._shapeManager.shapeCount;
    }

    getTreeHeight(): number {
        return this._contactRuntime.broadphase.getHeight();
    }

    getTreeBalance(): number {
        return this._contactRuntime.broadphase.getTreeBalance();
    }

    getTreeQuality(): number {
        return this._contactRuntime.broadphase.getTreeQuality();
    }

    validate(): boolean {
        return !this._disposed;
    }

    private _integrateVelocities(dt: number): void {
        integrateVelocitiesImpl(this._bodyManager, this._gravity, dt, this._maxVelocity, this._maxAngularVelocity);
    }


    /**
     * World-level sleeping: bodies with low kinetic energy for SLEEP_TIME
     * are put to sleep to skip integration/solving.
     */
    private _updateSleeping(dt: number): void {
        const linTolSq = PhysicsConstants.LINEAR_SLEEP_TOLERANCE * PhysicsConstants.LINEAR_SLEEP_TOLERANCE;
        const angTolSq = PhysicsConstants.ANGULAR_SLEEP_TOLERANCE * PhysicsConstants.ANGULAR_SLEEP_TOLERANCE;
        const sleepTime = PhysicsConstants.SLEEP_TIME;

        for (const bodyId of this._bodyManager.getBodyIds()) {
            if (this._bodyManager.getBodyType(bodyId) !== BODY_TYPE_DYNAMIC) continue;
            if (!this._bodyManager.isEnabled(bodyId)) continue;
            if (!this._bodyManager.isAwake(bodyId)) continue;
            if (!(this._bodyManager.getBodyFlags(bodyId) & BodyFlags.AutoSleep)) {
                this._sleepTimes.delete(bodyId);
                continue;
            }

            const lv = this._bodyManager.getLinearVelocity(bodyId);
            const av = this._bodyManager.getAngularVelocity(bodyId);
            const lvSq = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
            const avSq = av.x * av.x + av.y * av.y + av.z * av.z;

            if (lvSq > linTolSq || avSq > angTolSq) {
                this._sleepTimes.set(bodyId, 0);
            } else {
                const t = (this._sleepTimes.get(bodyId) ?? 0) + dt;
                this._sleepTimes.set(bodyId, t);
                if (t >= sleepTime) {
                    this._bodyManager.setAwake(bodyId, false);
                    // Zero velocities without re-waking (wake=false bypasses the
                    // raw-API wake added in Wave 3a). Sleep takes priority.
                    this._bodyManager.setLinearVelocity(bodyId, { x: 0, y: 0, z: 0 }, false);
                    this._bodyManager.setAngularVelocity(bodyId, { x: 0, y: 0, z: 0 }, false);
                    this._sleepTimes.delete(bodyId);
                }
            }
        }
    }

    private _integratePositions(dt: number): void {
        integratePositionsImpl(this._bodyManager, dt, this._autoClearForces, this._maxTranslation);
    }

    /**
     * P1-4: When a kinematic body moves, wake sleeping dynamic bodies
     * that are in contact with it. Uses contact index for precise targeting.
     */
    private _wakeKinematicContacts(bodyId: BodyId3D): void {
        const pos = this._bodyManager.getPosition(bodyId);
        const rot = this._bodyManager.getRotation(bodyId);
        const prevPos = this._kinematicPrevPos.get(bodyId);
        const prevRot = this._kinematicPrevRot.get(bodyId);
        this._kinematicPrevPos.set(bodyId, { x: pos.x, y: pos.y, z: pos.z });
        this._kinematicPrevRot.set(bodyId, { x: rot.x, y: rot.y, z: rot.z, w: rot.w });

        // Early exit: no actual movement
        if (prevPos && prevPos.x === pos.x && prevPos.y === pos.y && prevPos.z === pos.z &&
            prevRot && prevRot.x === rot.x && prevRot.y === rot.y && prevRot.z === rot.z && prevRot.w === rot.w) {
            return;
        }

        // Rebuild body contact index from current manifolds
        this._contactRuntime.rebuildBodyContactIndex();

        // Wake sleeping dynamic neighbors via contact graph
        const pairKeys = this._contactRuntime.getContactPairKeysForBody(bodyId);
        if (!pairKeys) return;
        for (const pairKey of pairKeys) {
            const bodies = this._contactRuntime.getManifoldBodyIds(pairKey);
            if (!bodies) continue;
            const otherId = bodies.bodyIdA === bodyId ? bodies.bodyIdB : bodies.bodyIdA;
            if (this._bodyManager.getBodyType(otherId) === BODY_TYPE_DYNAMIC && !this._bodyManager.isAwake(otherId)) {
                this._bodyManager.setAwake(otherId, true);
            }
        }
    }

    private _registerConstraint(
        constraintId: ConstraintId3D,
        type: number,
        def: SupportedConstraintDef3D
    ): ConstraintId3D {
        this._constraintDescriptors.set(constraintId, {
            id: constraintId,
            type,
            def,
            enabled: true,
            collideConnected: def.collideConnected ?? false,
            ...(def.userData !== undefined ? { userData: def.userData } : {}),
        });
        if (!def.collideConnected) {
            this._contactRuntime.registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    private _createBodyView(bodyId: BodyId3D): IPhysicsBody3D {
        const bodyWorld = this;

        return {
            id: bodyId,
            get type() {
                return bodyWorld._bodyManager.getBodyType(bodyId) as BodyType;
            },
            get transform() {
                return {
                    position: Vec3.copy(bodyWorld._bodyManager.getPosition(bodyId)),
                    rotation: Quat.copy(bodyWorld._bodyManager.getRotation(bodyId)),
                };
            },
            get velocity() {
                return {
                    linear: Vec3.copy(bodyWorld._bodyManager.getLinearVelocity(bodyId)),
                    angular: Vec3.copy(bodyWorld._bodyManager.getAngularVelocity(bodyId)),
                };
            },
            get massData() {
                return bodyWorld._getBodyMassData(bodyId);
            },
            get shapes() {
                return bodyWorld._shapeManager.getShapesForBody(bodyId);
            },
            get flags() {
                let flags = bodyWorld._bodyManager.getBodyFlags(bodyId) as BodyFlags;
                if (!bodyWorld._bodyManager.isAwake(bodyId)) {
                    flags |= BodyFlags.Sleeping;
                }
                return flags;
            },
            get gravityScale() {
                return bodyWorld._bodyManager.getGravityScale(bodyId);
            },
            get linearDamping() {
                return bodyWorld._bodyManager.getLinearDamping(bodyId);
            },
            get angularDamping() {
                return bodyWorld._bodyManager.getAngularDamping(bodyId);
            },
            get sleepTime() {
                return 0;
            },
            get userData() {
                return bodyWorld._bodyManager.getUserData(bodyId);
            },
            applyForce(force, point) {
                bodyWorld._bodyManager.applyForce(bodyId, force, point);
            },
            applyForceToCenter(force) {
                bodyWorld._bodyManager.applyForceToCenter(bodyId, force);
            },
            applyTorque(torque) {
                bodyWorld._bodyManager.applyTorque(bodyId, torque);
            },
            applyImpulse(impulse, point) {
                bodyWorld._bodyManager.applyImpulse(bodyId, impulse, point);
            },
            applyImpulseToCenter(impulse) {
                bodyWorld._bodyManager.applyImpulseToCenter(bodyId, impulse);
            },
            applyAngularImpulse(impulse) {
                bodyWorld._bodyManager.applyAngularImpulse(bodyId, impulse);
            },
            getPosition() {
                return Vec3.copy(bodyWorld._bodyManager.getPosition(bodyId));
            },
            setPosition(position) {
                bodyWorld._bodyManager.setPosition(bodyId, position);
            },
            getRotation() {
                return Quat.copy(bodyWorld._bodyManager.getRotation(bodyId));
            },
            setRotation(rotation) {
                bodyWorld._bodyManager.setRotation(bodyId, rotation);
            },
            getTransform() {
                return {
                    position: Vec3.copy(bodyWorld._bodyManager.getPosition(bodyId)),
                    rotation: Quat.copy(bodyWorld._bodyManager.getRotation(bodyId)),
                };
            },
            setTransform(position, rotation) {
                bodyWorld._bodyManager.setPosition(bodyId, position);
                bodyWorld._bodyManager.setRotation(bodyId, rotation);
            },
            getLinearVelocity() {
                return Vec3.copy(bodyWorld._bodyManager.getLinearVelocity(bodyId));
            },
            setLinearVelocity(velocity) {
                bodyWorld._bodyManager.setLinearVelocity(bodyId, velocity);
            },
            getAngularVelocity() {
                return Vec3.copy(bodyWorld._bodyManager.getAngularVelocity(bodyId));
            },
            setAngularVelocity(velocity) {
                bodyWorld._bodyManager.setAngularVelocity(bodyId, velocity);
            },
            getLocalPoint(worldPoint) {
                return inverseTransformPoint3D(
                    worldPoint,
                    bodyWorld._bodyManager.getPosition(bodyId),
                    bodyWorld._bodyManager.getRotation(bodyId)
                );
            },
            getWorldPoint(localPoint) {
                return transformPoint3D(
                    localPoint,
                    bodyWorld._bodyManager.getPosition(bodyId),
                    bodyWorld._bodyManager.getRotation(bodyId)
                );
            },
            getLocalVector(worldVector) {
                return Quat.rotateVector(Quat.conjugate(bodyWorld._bodyManager.getRotation(bodyId)), worldVector);
            },
            getWorldVector(localVector) {
                return Quat.rotateVector(bodyWorld._bodyManager.getRotation(bodyId), localVector);
            },
            getLinearVelocityAtPoint(point) {
                const relativePoint = Vec3.subtract(point, bodyWorld._bodyManager.getPosition(bodyId));
                return Vec3.add(
                    bodyWorld._bodyManager.getLinearVelocity(bodyId),
                    Vec3.cross(bodyWorld._bodyManager.getAngularVelocity(bodyId), relativePoint)
                );
            },
            getMass() {
                return bodyWorld._bodyManager.getMass(bodyId) as Mass;
            },
            getInertiaTensor() {
                return Vec3.copy(bodyWorld._bodyManager.getInertiaTensor(bodyId));
            },
            getMassData() {
                return bodyWorld._getBodyMassData(bodyId);
            },
            setMassData(massData) {
                bodyWorld._bodyManager.setMass(bodyId, massData.mass);
                bodyWorld._bodyManager.setInertiaTensor(bodyId, massData.inertiaTensor);
            },
            resetMassData() {
                const massData = bodyWorld._computeBodyMassData(bodyId);
                bodyWorld._bodyManager.setMass(bodyId, massData.mass);
                bodyWorld._bodyManager.setInertiaTensor(bodyId, massData.inertiaTensor);
            },
            isSleeping() {
                return !bodyWorld._bodyManager.isAwake(bodyId);
            },
            setSleeping(sleeping) {
                bodyWorld._bodyManager.setAwake(bodyId, !sleeping);
            },
            isAwake() {
                return bodyWorld._bodyManager.isAwake(bodyId);
            },
            setAwake(awake) {
                bodyWorld._bodyManager.setAwake(bodyId, awake);
            },
            isEnabled() {
                return bodyWorld._bodyManager.isEnabled(bodyId);
            },
            setEnabled(enabled) {
                bodyWorld._bodyManager.setEnabled(bodyId, enabled);
            },
            isFixedRotation() {
                return bodyWorld._bodyManager.isFixedRotation(bodyId);
            },
            setFixedRotation(fixed) {
                bodyWorld._bodyManager.setFixedRotation(bodyId, fixed);
            },
            isBullet() {
                return bodyWorld._bodyManager.isBullet(bodyId);
            },
            setBullet(bullet) {
                bodyWorld._bodyManager.setBullet(bodyId, bullet);
            },
            getWorldCenter() {
                const massData = bodyWorld._getBodyMassData(bodyId);
                return transformPoint3D(
                    massData.center,
                    bodyWorld._bodyManager.getPosition(bodyId),
                    bodyWorld._bodyManager.getRotation(bodyId)
                );
            },
            getLocalCenter() {
                return Vec3.copy(bodyWorld._getBodyMassData(bodyId).center);
            },
        };
    }

    private _createShapeView(descriptor: IShapeDescriptor3D): IShape3D {
        return {
            id: descriptor.id,
            bodyId: descriptor.bodyId,
            get type() {
                return descriptor.type as ShapeType;
            },
            get material() {
                return descriptor.material;
            },
            get isSensor() {
                return descriptor.isSensor;
            },
            get filter() {
                return descriptor.filter;
            },
            get userData() {
                return descriptor.userData;
            },
            computeAABB: () => this._computeShapeAabb(descriptor),
            computeMassData: (density) => computeShapeMassData(descriptor, density),
            testPoint: (point) => this._testPointShape(descriptor, point),
            rayCast: (origin, direction, maxFraction) => {
                const hit = this._rayCastShape(descriptor, origin, direction, maxFraction);
                if (!hit) {
                    return null;
                }
                return { hit: true, fraction: hit.fraction, normal: hit.normal };
            },
            getCenter: () => this._getShapeWorldCenter(descriptor),
        };
    }

    private _createConstraintView(descriptor: IConstraintDescriptor3D): IConstraint3D {
        return {
            id: descriptor.id,
            type: descriptor.type,
            bodyIdA: descriptor.def.bodyIdA,
            bodyIdB: descriptor.def.bodyIdB,
            collideConnected: descriptor.collideConnected,
            get userData() {
                return descriptor.userData;
            },
            getAnchorA: () => this._getConstraintAnchor(descriptor.def, true),
            getAnchorB: () => this._getConstraintAnchor(descriptor.def, false),
            getReactionForce: () => ({ x: 0, y: 0, z: 0 }),
            getReactionTorque: () => ({ x: 0, y: 0, z: 0 }),
            isEnabled: () => descriptor.enabled,
            setEnabled: (enabled) => {
                descriptor.enabled = enabled;
            },
        };
    }

    private _getBodyMassData(bodyId: BodyId3D): IMassData3D {
        const mass = this._bodyManager.getMass(bodyId);
        const inertiaTensor = this._bodyManager.getInertiaTensor(bodyId);
        return {
            mass: mass as Mass,
            inverseMass: mass > 0 ? 1 / mass : 0,
            inertiaTensor: Vec3.copy(inertiaTensor),
            inverseInertiaTensor: inverseVec3(inertiaTensor),
            center: this._computeBodyMassData(bodyId).center,
        };
    }

    private _computeBodyMassData(bodyId: BodyId3D): IMassData3D {
        const shapes = this._shapeManager.getShapesForBody(bodyId);
        if (shapes.length === 0 || this._bodyManager.getBodyType(bodyId) !== BODY_TYPE_DYNAMIC) {
            const inertiaTensor = this._bodyManager.getInertiaTensor(bodyId);
            return {
                mass: this._bodyManager.getMass(bodyId) as Mass,
                inverseMass: this._bodyManager.getInverseMass(bodyId),
                inertiaTensor: Vec3.copy(inertiaTensor),
                inverseInertiaTensor: inverseVec3(inertiaTensor),
                center: { x: 0, y: 0, z: 0 },
            };
        }

        let totalMass = 0;
        const shapeMassData: IMassData3D[] = [];

        for (const shapeId of shapes) {
            const descriptor = this._shapeDescriptors.get(shapeId);
            if (!descriptor) {
                continue;
            }
            const massData = computeShapeMassData(descriptor, descriptor.material.density);
            shapeMassData.push(massData);
            totalMass += massData.mass;
        }

        if (totalMass <= 1e-10) {
            return {
                mass: 0 as Mass,
                inverseMass: 0,
                inertiaTensor: { x: 0, y: 0, z: 0 },
                inverseInertiaTensor: { x: 0, y: 0, z: 0 },
                center: { x: 0, y: 0, z: 0 },
            };
        }

        let inertiaTensor = { x: 0, y: 0, z: 0 };
        for (const massData of shapeMassData) {
            const offset = massData.center;
            inertiaTensor = {
                x:
                    inertiaTensor.x +
                    massData.inertiaTensor.x +
                    massData.mass * (offset.y * offset.y + offset.z * offset.z),
                y:
                    inertiaTensor.y +
                    massData.inertiaTensor.y +
                    massData.mass * (offset.x * offset.x + offset.z * offset.z),
                z:
                    inertiaTensor.z +
                    massData.inertiaTensor.z +
                    massData.mass * (offset.x * offset.x + offset.y * offset.y),
            };
        }

        return {
            mass: totalMass as Mass,
            inverseMass: totalMass > 0 ? 1 / totalMass : 0,
            inertiaTensor,
            inverseInertiaTensor: inverseVec3(inertiaTensor),
            center: { x: 0, y: 0, z: 0 },
        };
    }



    private _computeShapeAabb(descriptor: IShapeDescriptor3D): IAabb3D {
        const position = this._bodyManager.getPosition(descriptor.bodyId);
        const rotation = this._bodyManager.getRotation(descriptor.bodyId);
        // One derivation per shape per step, shared with the box-box narrowphase.
        const frame = refreshShapeFrameImpl(
            descriptor,
            position,
            rotation,
            this._frameGeneration
        );
        return computeShapeAabbImpl(descriptor, position, rotation, frame);
    }

    private _testPointShape(descriptor: IShapeDescriptor3D, point: Readonly<IVec3Like>): boolean {
        return testPointShapeImpl(
            descriptor,
            point,
            this._bodyManager.getPosition(descriptor.bodyId),
            this._bodyManager.getRotation(descriptor.bodyId)
        );
    }

    private _rayCastShape(
        descriptor: IShapeDescriptor3D,
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number
    ): IShapeRayHit3D | null {
        return rayCastShapeImpl(
            descriptor,
            origin,
            direction,
            maxFraction,
            this._bodyManager.getPosition(descriptor.bodyId),
            this._bodyManager.getRotation(descriptor.bodyId)
        );
    }

    private _getShapeWorldCenter(descriptor: IShapeDescriptor3D): IVec3Like {
        return getShapeWorldCenterImpl(
            descriptor,
            this._bodyManager.getPosition(descriptor.bodyId),
            this._bodyManager.getRotation(descriptor.bodyId)
        );
    }

    private _getConstraintAnchor(def: SupportedConstraintDef3D, firstBody: boolean): IVec3Like {
        if (def.kind === CONSTRAINT_TYPE_FIXED || def.kind === CONSTRAINT_TYPE_HINGE || def.kind === CONSTRAINT_TYPE_SLIDER || def.kind === CONSTRAINT_TYPE_SPRING) {
            const bodyId = firstBody ? def.bodyIdA : def.bodyIdB;
            const localAnchor = firstBody ? def.localAnchorA : def.localAnchorB;
            return transformPoint3D(
                localAnchor,
                this._bodyManager.getPosition(bodyId),
                this._bodyManager.getRotation(bodyId)
            );
        }

        const bodyId = firstBody ? def.bodyIdA : def.bodyIdB;
        const localFrame = firstBody ? def.localFrameA : def.localFrameB;
        return transformPoint3D(
            localFrame.position,
            this._bodyManager.getPosition(bodyId),
            this._bodyManager.getRotation(bodyId)
        );
    }


    [Symbol.dispose](): void {
        if (this._disposed) return;
        this._disposed = true;
        this._bodyViews.clear();
        this._shapeViews.clear();
        this._shapeDescriptors.clear();
        this._constraintViews.clear();
        this._constraintDescriptors.clear();
        this._bodyManager[Symbol.dispose]();
        this._shapeManager[Symbol.dispose]();
        this._constraintManager[Symbol.dispose]();
    }
}