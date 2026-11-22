import { Vec2 } from '@axrone/numeric';
import type { IVec2Like } from '@axrone/numeric';
import { AABB2D } from '@axrone/geometry';
import type {
    IPhysicsWorld2D,
    IPhysicsWorldConfig,
    IPhysicsWorldStatistics,
    IPhysicsProfiler,
    BodyId,
    ShapeId,
    ConstraintId,
    ContactId,
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
    IContactManifold2D,
    ICollisionFilter,
    RaycastCallback2D,
    ISingleRaycastResult2D,
    IQueryFilter,
    IAABBQueryCallback,
    IPhysicsBody2D,
    IShape2D,
    IConstraint2D,
} from '../types';
import { ConstraintType, SolverFlags, PhysicsConstants } from '../types';

import { BodyManager2D } from './body-manager';
import { ShapeManager2D } from './shape-manager';
import { ConstraintManager2D } from './constraint-manager';
import { ContactManager2D } from './contact-manager';
import { IslandSolver2D } from './island-solver';
import { Narrowphase2D } from './narrowphase';
import { DynamicAABBTree2D } from './broadphase';
import { ContinuousCollisionDetection } from './continuous-collision';
import { createPhysicsBody2DView } from './physics-world-2d-body-view';
import { PhysicsWorld2DConstraintStore } from './physics-world-2d-constraint-store';
import { PhysicsWorld2DShapeStore } from './physics-world-2d-shape-store';
import type { IConstraintDescriptor2D } from './physics-world-2d-helpers';
import { makeCollisionPairKey } from './foundation';

const NULL_VEC: IVec2Like = { x: 0, y: 0 };

function cloneVec(v: Readonly<IVec2Like>): IVec2Like {
    return { x: v.x, y: v.y };
}

type ConstraintRegistration = Omit<IConstraintDescriptor2D, 'storage'>;

function baseDescriptor(
    type: ConstraintType,
    def: { bodyIdA: BodyId; bodyIdB: BodyId; collideConnected?: boolean; userData?: unknown }
): ConstraintRegistration {
    return {
        type,
        bodyIdA: def.bodyIdA,
        bodyIdB: def.bodyIdB,
        collideConnected: def.collideConnected ?? false,
        enabled: true,
        userData: def.userData,
        localAnchorA: null,
        localAnchorB: null,
        localAxisA: null,
        linearOffset: null,
        target: null,
        constraintIdA: null,
        constraintIdB: null,
        referenceAngle: null,
        angularOffset: null,
        length: null,
        minLength: null,
        maxLength: null,
        stiffness: null,
        damping: null,
        lowerTranslation: null,
        upperTranslation: null,
        motorSpeed: null,
        maxMotorTorque: null,
        maxMotorForce: null,
        maxForce: null,
        maxTorque: null,
        correctionFactor: null,
        ratio: null,
    };
}

export class PhysicsWorld2D implements IPhysicsWorld2D {
    readonly config: Readonly<IPhysicsWorldConfig>;
    private readonly _gravity: Vec2;

    private readonly _bodyManager: BodyManager2D;
    private readonly _shapeManager: ShapeManager2D;
    private readonly _constraintManager: ConstraintManager2D;
    private readonly _contactManager: ContactManager2D;
    private readonly _solver: IslandSolver2D;
    private readonly _narrowphase: Narrowphase2D;
    private readonly _broadphase: DynamicAABBTree2D;
    private readonly _bodyViews = new Map<BodyId, IPhysicsBody2D>();
    private readonly _shapeStore: PhysicsWorld2DShapeStore;
    private readonly _constraintStore: PhysicsWorld2DConstraintStore;
    private readonly _shapeProxyMap = new Map<ShapeId, number>();
    private readonly _shapePreviousCenter = new Map<ShapeId, IVec2Like>();
    private readonly _contactPairCache = new Map<number, ContactId>();
    /**
     * Counter-based index: tracks how many constraints with `collideConnected=false`
     * connect each body pair. When count > 0, the pair is suppressed from contact generation.
     * Uses canonical `makeCollisionPairKey` with body IDs.
     */
    private readonly _jointCollisionCounts = new Map<number, number>();
    /** Cached AABB for static-body shapes; only recomputed when dirty. (P1-2) */
    private readonly _staticAabbCache = new Map<ShapeId, AABB2D>();
    /** Static shapes whose AABB needs recomputation. */
    private readonly _staticAabbDirty = new Set<ShapeId>();
    /** Previous transform for kinematic bodies — detects actual movement. (P1-4) */
    private readonly _kinematicPrevPos = new Map<BodyId, IVec2Like>();
    private readonly _kinematicPrevRot = new Map<BodyId, number>();

    private _autoClearForces = true;
    private _profiler: IPhysicsProfiler | null = null;
    private _disposed = false;
    private _stepTime = 0;
    // P1-6: Cache config-driven flags
    private readonly _warmStarting: boolean;
    private readonly _continuousPhysics: boolean;
    private readonly _subStepping: boolean;
    private readonly _defaultVelIters: number;
    private readonly _defaultPosIters: number;
    // ADR 0004: Config-driven physics limits (metre-based)
    private readonly _maxVelocity: number;
    private readonly _maxAngularVelocity: number;
    private readonly _maxTranslation: number;

    constructor(config: IPhysicsWorldConfig = {}) {
        this.config = config;
        this._gravity = config.gravity
            ? Vec2.from(config.gravity as IVec2Like)
            : new Vec2(0, -9.81);

        const maxBodies = config.maxBodies ?? config.bodyCapacity ?? 1024;
        const maxShapes = config.maxShapes ?? config.shapeCapacity ?? 2048;
        const maxConstraints = config.maxConstraints ?? config.constraintCapacity ?? 1024;
        const maxContacts = config.maxContacts ?? config.contactCapacity ?? 4096;

        this._bodyManager = new BodyManager2D(maxBodies);
        this._shapeManager = new ShapeManager2D(maxShapes);
        this._constraintManager = new ConstraintManager2D(maxConstraints);
        this._contactManager = new ContactManager2D(maxContacts);
        this._contactManager.setSensorChecker((shapeId) => this._shapeManager.isShapeSensor(shapeId));
        this._shapeStore = new PhysicsWorld2DShapeStore(this._bodyManager, this._shapeManager);
        this._constraintStore = new PhysicsWorld2DConstraintStore(
            this._bodyManager,
            this._constraintManager
        );

        this._solver = new IslandSolver2D(
            this._bodyManager,
            this._contactManager,
            this._constraintManager,
            this._shapeManager,
            maxBodies
        );

        this._narrowphase = new Narrowphase2D();
        this._broadphase = new DynamicAABBTree2D(1024);

        // RB-1: Centralized static AABB cache invalidation.
        // Whenever a STATIC body's transform is written (via bodyManager.setPosition /
        // setRotation), mark its shapes dirty so the next _updateBroadphase recomputes.
        this._bodyManager.onStaticTransformChange((bodyId) => {
            this._markStaticDirty(bodyId);
        });

        // P1-4: Kinematic transform tracking — wake sleeping contact neighbors
        // when a kinematic body actually moves.
        this._bodyManager.onKinematicTransformChange((bodyId) => {
            this._wakeKinematicContacts(bodyId);
        });

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

        // P1-6: Wire up previously decorative config fields
        this._warmStarting = config.warmStarting ?? true;
        this._continuousPhysics = config.continuousPhysics ?? true;
        this._subStepping = config.subStepping ?? false;
        this._defaultVelIters = config.solverIterations ?? 8;
        this._defaultPosIters = config.positionIterations ?? 3;

        // ADR 0004: Config-driven physics limits (metre-based)
        this._maxVelocity = config.maxVelocity ?? PhysicsConstants.MAX_VELOCITY;
        this._maxAngularVelocity = config.maxAngularVelocity ?? PhysicsConstants.MAX_ANGULAR_VELOCITY;
        this._maxTranslation = config.maxTranslation ?? PhysicsConstants.MAX_TRANSLATION;
    }

    get gravity(): Readonly<IVec2Like> {
        return this._gravity;
    }

    getBodyManager(): BodyManager2D {
        return this._bodyManager;
    }

    getShapeManager(): ShapeManager2D {
        return this._shapeManager;
    }

    getConstraintManager(): ConstraintManager2D {
        return this._constraintManager;
    }

    getContactManager(): ContactManager2D {
        return this._contactManager;
    }

    getSolver(): IslandSolver2D {
        return this._solver;
    }

    step(deltaTime: number, velocityIterations?: number, positionIterations?: number): void {
        if (this._disposed) return;

        const t0 = performance.now();
        const allowSleep = this.config.allowSleep ?? true;

        // P1-6: Resolve iteration defaults from config
        const velIters = velocityIterations ?? this._defaultVelIters;
        const posIters = positionIterations ?? this._defaultPosIters;

        // P1-6: Build solver flags — warmStarting from config
        let solverFlags = this.config.solverFlags ?? SolverFlags.Default;
        if (this._warmStarting) {
            solverFlags |= SolverFlags.WarmStarting;
        } else {
            solverFlags &= ~SolverFlags.WarmStarting;
        }

        // P1-6: Sub-stepping — split large dt into smaller fixed steps
        const subSteps = this._subStepping
            ? Math.min(Math.ceil(deltaTime / (1.0 / 60.0)), PhysicsConstants.MAX_SUB_STEPS)
            : 1;
        const subDt = deltaTime / subSteps;

        // Phase timing — only measured when profiler is attached (zero overhead otherwise)
        const prof = this._profiler;
        let broadphaseAccum = 0;
        let narrowphaseAccum = 0;
        if (prof) {
            prof.solveVelocityTime = 0;
            prof.solvePositionTime = 0;
        }

        for (let sub = 0; sub < subSteps; sub++) {
            if (prof) {
                const tb = performance.now();
                this._updateBroadphase();
                broadphaseAccum += performance.now() - tb;
            } else {
                this._updateBroadphase();
            }

            // P1-6: continuousPhysics gates the CCD pass
            if (this._continuousPhysics) {
                this._performCCD(subDt);
            }

            if (prof) {
                const tn = performance.now();
                this._detectCollisions();
                narrowphaseAccum += performance.now() - tn;
            } else {
                this._detectCollisions();
            }

            this._solver.solveIslands(
                subDt,
                velIters,
                posIters,
                allowSleep,
                solverFlags,
                { x: this._gravity.x, y: this._gravity.y },
                prof ?? undefined,
                {
                    maxVelocity: this._maxVelocity,
                    maxAngularVelocity: this._maxAngularVelocity,
                    maxTranslation: this._maxTranslation,
                }
            );
        }

        if (this._autoClearForces) {
            this.clearForces();
        }

        this._stepTime = performance.now() - t0;
        if (prof) {
            prof.stepTime = this._stepTime;
            prof.broadphaseTime = broadphaseAccum;
            prof.narrowphaseTime = narrowphaseAccum;
            prof.collisionTime = narrowphaseAccum;
            prof.solveTime = (prof.solveVelocityTime ?? 0) + (prof.solvePositionTime ?? 0);
        }
    }

    /**
     * Continuous Collision Detection pass for bullet-flagged bodies.
     * Prevents tunneling by computing time-of-impact and clamping movement.
     */
    private _performCCD(deltaTime: number): void {
        const BodyFlagsBullet = 1 << 2; // BodyFlags.Bullet
        for (const bodyId of this._bodyManager.getBodyIds()) {
            const flags = this._bodyManager.getFlags(bodyId);
            if ((flags & BodyFlagsBullet) === 0) continue;

            const velocity = this._bodyManager.getLinearVelocity(bodyId);
            const speedSq = velocity.x * velocity.x + velocity.y * velocity.y;
            if (speedSq < 1e-8) continue;

            // Get all shapes for this bullet body
            const bodyShapes = this._shapeManager.getShapesForBody(bodyId);
            for (const shapeId of bodyShapes) {
                const currentAabb = this._computeShapeAabb(shapeId);
                if (!currentAabb) continue;

                // Compute swept AABB (expand by velocity * dt)
                const sweptMin = {
                    x: Math.min(currentAabb.min.x, currentAabb.min.x + velocity.x * deltaTime),
                    y: Math.min(currentAabb.min.y, currentAabb.min.y + velocity.y * deltaTime),
                };
                const sweptMax = {
                    x: Math.max(currentAabb.max.x, currentAabb.max.x + velocity.x * deltaTime),
                    y: Math.max(currentAabb.max.y, currentAabb.max.y + velocity.y * deltaTime),
                };
                const sweptAabb = new AABB2D(sweptMin, sweptMax);

                // Query broadphase for potential colliders in swept volume
                const candidates: number[] = [];
                this._broadphase.query((proxyId) => {
                    const otherShapeId = this._broadphase.getUserData(proxyId);
                    if (otherShapeId && otherShapeId !== shapeId) {
                        const otherDesc = this._shapeStore.getDescriptor(otherShapeId);
                        if (otherDesc && otherDesc.bodyId !== bodyId) {
                            candidates.push(proxyId);
                        }
                    }
                    return true;
                }, sweptAabb);

                // Check TOI for each candidate
                for (const proxyId of candidates) {
                    const otherShapeId = this._broadphase.getUserData(proxyId);
                    if (!otherShapeId) continue;
                    const otherAabb = this._computeShapeAabb(otherShapeId);
                    if (!otherAabb) continue;

                    const otherBodyId = this._shapeStore.getDescriptor(otherShapeId)?.bodyId;
                    if (!otherBodyId) continue;
                    const otherVel = this._bodyManager.getLinearVelocity(otherBodyId);

                    const ccdResult = ContinuousCollisionDetection.computeTimeOfImpact(
                        currentAabb,
                        velocity,
                        otherAabb,
                        otherVel,
                        deltaTime
                    );

                    if (ccdResult.hit && ccdResult.toi < deltaTime) {
                        // Clamp body position to TOI
                        const position = this._bodyManager.getPosition(bodyId);
                        const clampedPos = {
                            x: position.x + velocity.x * ccdResult.toi,
                            y: position.y + velocity.y * ccdResult.toi,
                        };
                        this._bodyManager.setPosition(bodyId, clampedPos);
                        // Break after first TOI found for this shape
                        break;
                    }
                }
            }
        }
    }

    private _updateBroadphase(): void {
        for (const [shapeId] of this._shapeStore.entries()) {
            const descriptor = this._shapeStore.getDescriptor(shapeId);
            const bodyType = descriptor ? this._bodyManager.getBodyType(descriptor.bodyId) : 2;
            const isStatic = bodyType === 0;

            let shapeAabb: AABB2D | null;
            if (isStatic && !this._staticAabbDirty.has(shapeId) && this._staticAabbCache.has(shapeId)) {
                shapeAabb = this._staticAabbCache.get(shapeId)!;
            } else {
                shapeAabb = this._computeShapeAabb(shapeId);
                if (isStatic && shapeAabb) {
                    this._staticAabbCache.set(shapeId, shapeAabb);
                    this._staticAabbDirty.delete(shapeId);
                }
            }
            if (!shapeAabb) continue;

            const currentCenterX = (shapeAabb.min.x + shapeAabb.max.x) * 0.5;
            const currentCenterY = (shapeAabb.min.y + shapeAabb.max.y) * 0.5;

            const existingProxy = this._shapeProxyMap.get(shapeId);
            if (existingProxy !== undefined) {
                const prev = this._shapePreviousCenter.get(shapeId);
                const displacement = {
                    x: currentCenterX - (prev?.x ?? currentCenterX),
                    y: currentCenterY - (prev?.y ?? currentCenterY),
                };
                this._broadphase.moveProxy(existingProxy, shapeAabb, displacement);
            } else {
                const proxyId = this._broadphase.createProxy(shapeAabb, shapeId);
                this._shapeProxyMap.set(shapeId, proxyId);
            }
            this._shapePreviousCenter.set(shapeId, { x: currentCenterX, y: currentCenterY });
        }
    }

    private _detectCollisions(): void {
        const candidatePairs: Array<{ shapeIdA: ShapeId; shapeIdB: ShapeId }> = [];
        const visitedPairs = new Set<number>();

        for (const [shapeIdA, proxyIdA] of this._shapeProxyMap) {
            const aabbA = this._broadphase.getAABB(proxyIdA);

            this._broadphase.query((proxyIdB: number) => {
                if (proxyIdB === proxyIdA) return true;

                const shapeIdB = this._broadphase.getUserData(proxyIdB);
                if (!shapeIdB) return true;

                const descriptorA = this._shapeStore.getDescriptor(shapeIdA);
                const descriptorB = this._shapeStore.getDescriptor(shapeIdB);
                if (!descriptorA || !descriptorB) return true;
                if (descriptorA.bodyId === descriptorB.bodyId) return true;

                const typeA = this._bodyManager.getBodyType(descriptorA.bodyId);
                const typeB = this._bodyManager.getBodyType(descriptorB.bodyId);
                if (typeA === 0 && typeB === 0) return true;

                // Apply collision filter bits
                const filterA = this._shapeManager.getShapeFilter(shapeIdA);
                const filterB = this._shapeManager.getShapeFilter(shapeIdB);
                if (
                    (filterA.categoryBits & filterB.maskBits) === 0 ||
                    (filterB.categoryBits & filterA.maskBits) === 0
                ) {
                    return true;
                }

                // collideConnected filter: skip pairs joined by a non-colliding constraint
                // Early exit: when no joints exist, the index is empty — skip entirely.
                if (this._jointCollisionCounts.size > 0) {
                    const bodyPairKey = makeCollisionPairKey(
                        descriptorA.bodyId as number,
                        descriptorB.bodyId as number
                    );
                    if (this._jointCollisionCounts.has(bodyPairKey)) return true;
                }

                const pairKey = makeCollisionPairKey(shapeIdA as number, shapeIdB as number);

                if (visitedPairs.has(pairKey)) return true;
                visitedPairs.add(pairKey);

                const lo = shapeIdA < shapeIdB ? shapeIdA : shapeIdB;
                const hi = shapeIdA < shapeIdB ? shapeIdB : shapeIdA;
                candidatePairs.push({ shapeIdA: lo, shapeIdB: hi });
                return true;
            }, aabbA);
        }

        this._processNarrowphase(candidatePairs);
    }

    private _processNarrowphase(
        candidatePairs: Array<{ shapeIdA: ShapeId; shapeIdB: ShapeId }>
    ): void {
        const activeContactIds = new Set<ContactId>();

        for (const pair of candidatePairs) {
            const descriptorA = this._shapeStore.getDescriptor(pair.shapeIdA);
            const descriptorB = this._shapeStore.getDescriptor(pair.shapeIdB);
            if (!descriptorA || !descriptorB) continue;

            const pairKey = makeCollisionPairKey(pair.shapeIdA as number, pair.shapeIdB as number);
            const existingContactId = this._contactPairCache.get(pairKey);

            const posA = this._bodyManager.getPosition(descriptorA.bodyId);
            const rotA = this._bodyManager.getRotation(descriptorA.bodyId);
            const posB = this._bodyManager.getPosition(descriptorB.bodyId);
            const rotB = this._bodyManager.getRotation(descriptorB.bodyId);

            const ctx = {
                bodyIdA: descriptorA.bodyId,
                bodyIdB: descriptorB.bodyId,
                transformA: { position: posA, rotation: rotA },
                transformB: { position: posB, rotation: rotB },
            };

            const manifold = this._narrowphase.acquireManifold();
            const typeA = this._shapeManager.getShapeType(pair.shapeIdA);
            const typeB = this._shapeManager.getShapeType(pair.shapeIdB);

            this._narrowphase.collide(
                pair.shapeIdA,
                pair.shapeIdB,
                typeA,
                typeB,
                this._shapeManager,
                ctx,
                manifold
            );

            if (manifold.pointCount > 0) {
                let contactId = existingContactId;
                if (!contactId || !this._contactManager.getContactData(contactId)) {
                    const materialA = this._shapeManager.getShapeMaterial(pair.shapeIdA);
                    const materialB = this._shapeManager.getShapeMaterial(pair.shapeIdB);
                    contactId = this._contactManager.createContact(
                        pair.shapeIdA,
                        pair.shapeIdB,
                        descriptorA.bodyId,
                        descriptorB.bodyId,
                        materialA,
                        materialB
                    );
                    this._contactPairCache.set(pairKey, contactId);
                }

                const manifoldData: IContactManifold2D = {
                    id: contactId as unknown as IContactManifold2D['id'],
                    bodyIdA: descriptorA.bodyId,
                    bodyIdB: descriptorB.bodyId,
                    shapeIdA: pair.shapeIdA,
                    shapeIdB: pair.shapeIdB,
                    normal: manifold.normal,
                    pointCount: manifold.pointCount,
                    points: manifold.points.slice(0, manifold.pointCount).map((p) => ({
                        id: p.id,
                        localPointA: p.localPointA,
                        localPointB: p.localPointB,
                        normalImpulse: p.normalImpulse as IContactManifold2D['points'][number]['normalImpulse'],
                        tangentImpulse: p.tangentImpulse as IContactManifold2D['points'][number]['tangentImpulse'],
                        separation: p.separation,
                    })),
                };

                this._contactManager.updateContact(contactId, manifoldData);
                activeContactIds.add(contactId);
            }

            this._narrowphase.releaseManifold(manifold);
        }

        for (const [pairKey, contactId] of this._contactPairCache) {
            if (!activeContactIds.has(contactId)) {
                this._contactManager.destroyContact(contactId);
                this._contactPairCache.delete(pairKey);
            }
        }
    }

    private _computeShapeAabb(shapeId: ShapeId): AABB2D | null {
        const descriptor = this._shapeStore.getDescriptor(shapeId);
        if (!descriptor) return null;

        if (!this._bodyManager.hasBody(descriptor.bodyId)) return null;

        const shape = this._shapeStore.getShapeView(shapeId);
        if (!shape) return null;

        const aabb = shape.computeAABB();
        return new AABB2D(aabb.min, aabb.max);
    }

    createBody(def: IPhysicsBodyDef2D): BodyId {
        return this._bodyManager.createBody(def);
    }

    destroyBody(bodyId: BodyId): void {
        const shapes = this._shapeManager.getShapesForBody(bodyId);
        for (const shapeId of shapes) {
            this._shapeManager.destroyShape(shapeId);
            this._shapeStore.removeShape(shapeId);
        }

        const constraints = this._constraintStore.getConstraintsForBody(bodyId);
        for (const constraintId of constraints) {
            this.destroyConstraint(constraintId);
        }

        const contacts = this._contactManager.getContactsForBody(bodyId);
        for (const contactId of Array.from(contacts)) {
            this._contactManager.destroyContact(contactId);
        }

        this._bodyViews.delete(bodyId);
        this._kinematicPrevPos.delete(bodyId);
        this._kinematicPrevRot.delete(bodyId);
        this._bodyManager.destroyBody(bodyId);
    }

    getBody(bodyId: BodyId): IPhysicsBody2D | null {
        if (!this._bodyManager.hasBody(bodyId)) return null;

        let view = this._bodyViews.get(bodyId);
        if (!view) {
            view = createPhysicsBody2DView(bodyId, {
                bodyManager: this._bodyManager,
                shapeManager: this._shapeManager,
                getBodyWorldCenter: (id) => this._shapeStore.getBodyWorldCenter(id),
                resetBodyMassData: (id) => this._shapeStore.resetBodyMassData(id),
            });
            this._bodyViews.set(bodyId, view);
        }

        return view;
    }

    getBodies(): ReadonlyMap<BodyId, IPhysicsBody2D> {
        const bodies = new Map<BodyId, IPhysicsBody2D>();
        for (const bodyId of this._bodyManager.getBodyIds()) {
            const body = this.getBody(bodyId);
            if (body) {
                bodies.set(bodyId, body);
            }
        }
        return bodies;
    }

    createCircleShape(bodyId: BodyId, def: ICircleShapeDef): ShapeId {
        const shapeId = this._shapeManager.createCircle(bodyId, def);
        this._shapeStore.registerCircle(shapeId, bodyId, def);
        this._shapeStore.resetBodyMassData(bodyId);
        this._markStaticDirty(bodyId);
        return shapeId;
    }

    createBoxShape(bodyId: BodyId, def: IBoxShapeDef2D): ShapeId {
        const shapeId = this._shapeManager.createBox(bodyId, def);
        this._shapeStore.registerBox(shapeId, bodyId, def);
        this._shapeStore.resetBodyMassData(bodyId);
        this._markStaticDirty(bodyId);
        return shapeId;
    }

    createPolygonShape(bodyId: BodyId, def: IPolygonShapeDef): ShapeId {
        const shapeId = this._shapeManager.createPolygon(bodyId, def);
        this._shapeStore.registerPolygon(shapeId, bodyId, def);
        this._shapeStore.resetBodyMassData(bodyId);
        this._markStaticDirty(bodyId);
        return shapeId;
    }

    createCapsuleShape(bodyId: BodyId, def: ICapsuleShapeDef2D): ShapeId {
        const shapeId = this._shapeManager.createCapsule(bodyId, def);
        this._shapeStore.registerCapsule(shapeId, bodyId, def);
        this._shapeStore.resetBodyMassData(bodyId);
        this._markStaticDirty(bodyId);
        return shapeId;
    }

    createSegmentShape(bodyId: BodyId, def: ISegmentShapeDef): ShapeId {
        const shapeId = this._shapeManager.createSegment(bodyId, def);
        this._shapeStore.registerSegment(shapeId, bodyId, def);
        this._shapeStore.resetBodyMassData(bodyId);
        this._markStaticDirty(bodyId);
        return shapeId;
    }

    private _registerJointCollisionPair(bodyIdA: BodyId, bodyIdB: BodyId): void {
        const key = makeCollisionPairKey(bodyIdA as number, bodyIdB as number);
        this._jointCollisionCounts.set(key, (this._jointCollisionCounts.get(key) ?? 0) + 1);
    }

    private _unregisterJointCollisionPair(bodyIdA: BodyId, bodyIdB: BodyId): void {
        const key = makeCollisionPairKey(bodyIdA as number, bodyIdB as number);
        const count = this._jointCollisionCounts.get(key);
        if (count === undefined) return;
        if (count <= 1) {
            this._jointCollisionCounts.delete(key);
        } else {
            this._jointCollisionCounts.set(key, count - 1);
        }
    }

    private _markStaticDirty(bodyId: BodyId): void {
        const shapes = this._shapeManager.getShapesForBody(bodyId);
        for (const shapeId of shapes) {
            this._staticAabbDirty.add(shapeId);
        }
    }

    /**
     * P1-4: When a kinematic body moves, wake sleeping dynamic bodies
     * that are in contact with it. Uses contact graph for precise targeting.
     */
    private _wakeKinematicContacts(bodyId: BodyId): void {
        const pos = this._bodyManager.getPosition(bodyId);
        const rot = this._bodyManager.getRotation(bodyId);
        const prevPos = this._kinematicPrevPos.get(bodyId);
        const prevRot = this._kinematicPrevRot.get(bodyId);
        this._kinematicPrevPos.set(bodyId, { x: pos.x, y: pos.y });
        this._kinematicPrevRot.set(bodyId, rot);

        // Early exit: no actual movement
        if (prevPos && prevPos.x === pos.x && prevPos.y === pos.y && prevRot === rot) {
            return;
        }

        // Wake sleeping dynamic neighbors via contact graph
        for (const contactId of this._contactManager.getContactsForBody(bodyId)) {
            const contactBodies = this._contactManager.getContactBodies(contactId);
            if (!contactBodies) continue;
            const otherId = contactBodies.bodyIdA === bodyId ? contactBodies.bodyIdB : contactBodies.bodyIdA;
            if (this._bodyManager.getBodyType(otherId) === 2 && !this._bodyManager.isAwake(otherId)) {
                this._bodyManager.setAwake(otherId, true);
            }
        }
    }

    destroyShape(shapeId: ShapeId): void {
        const descriptor = this._shapeStore.getDescriptor(shapeId);
        this._shapeManager.destroyShape(shapeId);
        this._shapeStore.removeShape(shapeId);

        const proxyId = this._shapeProxyMap.get(shapeId);
        if (proxyId !== undefined) {
            this._broadphase.destroyProxy(proxyId);
            this._shapeProxyMap.delete(shapeId);
        }
        this._shapePreviousCenter.delete(shapeId);
        this._staticAabbCache.delete(shapeId);
        this._staticAabbDirty.delete(shapeId);

        if (descriptor && this._bodyManager.hasBody(descriptor.bodyId)) {
            this._shapeStore.resetBodyMassData(descriptor.bodyId);
        }
    }

    getShape(shapeId: ShapeId): IShape2D | null {
        return this._shapeStore.getShapeView(shapeId);
    }

    private _registerConstraint(
        type: ConstraintType,
        def: { bodyIdA: BodyId; bodyIdB: BodyId; collideConnected?: boolean; userData?: unknown },
        overrides: Partial<ConstraintRegistration>
    ): ConstraintId {
        const desc = { ...baseDescriptor(type, def), ...overrides };
        return this._constraintStore.createStandaloneConstraint(desc);
    }

    createDistanceConstraint(def: IDistanceConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createDistanceConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Distance, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            length: def.length ?? null,
            minLength: def.minLength ?? null,
            maxLength: def.maxLength ?? null,
            stiffness: def.stiffness ?? null,
            damping: def.damping ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createRevoluteConstraint(def: IRevoluteConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createRevoluteConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Revolute, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            referenceAngle: def.referenceAngle ?? 0,
            motorSpeed: def.motorSpeed ?? null,
            maxMotorTorque: def.maxMotorTorque ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createPrismaticConstraint(def: IPrismaticConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createPrismaticConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Prismatic, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            localAxisA: cloneVec(def.localAxisA),
            referenceAngle: def.referenceAngle ?? 0,
            lowerTranslation: def.lowerTranslation ?? null,
            upperTranslation: def.upperTranslation ?? null,
            motorSpeed: def.motorSpeed ?? null,
            maxMotorForce: def.maxMotorForce ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createWeldConstraint(def: IWeldConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createWeldConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Weld, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            referenceAngle: def.referenceAngle ?? 0,
            stiffness: def.stiffness ?? null,
            damping: def.damping ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createWheelConstraint(def: IWheelConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createWheelConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Wheel, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            localAxisA: cloneVec(def.localAxisA),
            stiffness: def.stiffness ?? null,
            damping: def.damping ?? null,
            lowerTranslation: def.lowerTranslation ?? null,
            upperTranslation: def.upperTranslation ?? null,
            motorSpeed: def.motorSpeed ?? null,
            maxMotorTorque: def.maxMotorTorque ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createMotorConstraint(def: IMotorConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createMotorConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Motor, def),
            linearOffset: cloneVec(def.linearOffset),
            angularOffset: def.angularOffset ?? 0,
            maxForce: def.maxForce ?? null,
            maxTorque: def.maxTorque ?? null,
            correctionFactor: def.correctionFactor ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createMouseConstraint(def: IMouseConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createMouseConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Mouse, def),
            target: cloneVec(def.target),
            stiffness: def.stiffness ?? null,
            damping: def.damping ?? null,
            maxForce: def.maxForce ?? null,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createGearConstraint(def: IGearConstraintDef): ConstraintId {
        const constraintId = this._constraintManager.createGearConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Gear, def),
            constraintIdA: def.constraintIdA,
            constraintIdB: def.constraintIdB,
            ratio: def.ratio ?? 1,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    createRopeConstraint(def: IRopeConstraintDef2D): ConstraintId {
        const constraintId = this._constraintManager.createRopeConstraint(def);
        this._constraintStore.registerManagedConstraint(constraintId, {
            ...baseDescriptor(ConstraintType.Rope, def),
            localAnchorA: cloneVec(def.localAnchorA),
            localAnchorB: cloneVec(def.localAnchorB),
            maxLength: def.maxLength,
        });
        if (!def.collideConnected) {
            this._registerJointCollisionPair(def.bodyIdA, def.bodyIdB);
        }
        return constraintId;
    }

    destroyConstraint(constraintId: ConstraintId): void {
        const descriptor = this._constraintStore.getConstraintDescriptor(constraintId);
        if (!descriptor) {
            if (this._constraintManager.hasConstraint(constraintId)) {
                this._constraintManager.destroyConstraint(constraintId);
            }
            return;
        }

        // Unregister collideConnected suppression before destroying
        if (!descriptor.collideConnected) {
            this._unregisterJointCollisionPair(descriptor.bodyIdA, descriptor.bodyIdB);
        }

        if (descriptor.storage === 'manager' && this._constraintManager.hasConstraint(constraintId)) {
            this._constraintManager.destroyConstraint(constraintId);
        }

        this._constraintStore.removeConstraint(constraintId);
    }

    getConstraint(constraintId: ConstraintId): IConstraint2D | null {
        return this._constraintStore.getConstraintView(constraintId);
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
    ): void {
        let clippedFraction = maxFraction;

        for (const hit of this._shapeStore.rayCastAll(origin, direction, maxFraction)) {
            if (hit.fraction > clippedFraction) continue;

            const callbackResult = callback(hit.shapeId, hit.point, hit.normal, hit.fraction);
            if (callbackResult === 0) break;

            if (Number.isFinite(callbackResult) && callbackResult > 0) {
                clippedFraction = Math.min(clippedFraction, callbackResult);
            }
        }
    }

    rayCastClosest(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): ISingleRaycastResult2D | null {
        const hits = this._shapeStore.rayCastAll(origin, direction, maxFraction, filter);
        return hits.length > 0 ? hits[0] : null;
    }

    rayCastAll(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number,
        filter?: IQueryFilter
    ): readonly ISingleRaycastResult2D[] {
        return this._shapeStore.rayCastAll(origin, direction, maxFraction, filter);
    }

    queryAABB(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        callback: IAABBQueryCallback
    ): void {
        for (const shapeId of this._shapeStore.queryAABBAll(min, max)) {
            if (!callback(shapeId)) break;
        }
    }

    queryAABBAll(
        min: Readonly<IVec2Like>,
        max: Readonly<IVec2Like>,
        filter?: IQueryFilter
    ): readonly ShapeId[] {
        return this._shapeStore.queryAABBAll(min, max, filter);
    }

    queryPoint(point: Readonly<IVec2Like>, callback: IAABBQueryCallback): void {
        for (const shapeId of this._shapeStore.queryPointAll(point)) {
            if (!callback(shapeId)) break;
        }
    }

    queryPointAll(point: Readonly<IVec2Like>, filter?: IQueryFilter): readonly ShapeId[] {
        return this._shapeStore.queryPointAll(point, filter);
    }

    shiftOrigin(newOrigin: Readonly<IVec2Like>): void {
        for (const bodyId of this._bodyManager.getBodyIds()) {
            const position = this._bodyManager.getPosition(bodyId);
            this._bodyManager.setPosition(bodyId, {
                x: position.x - newOrigin.x,
                y: position.y - newOrigin.y,
            });
            this._markStaticDirty(bodyId);
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
            shapeCount: this._shapeStore.size,
            constraintCount: this._constraintStore.size,
            contactCount: this._contactManager.contactCount,
            proxyCount: this.getProxyCount(),
            islandCount: this._solver.lastIslandCount,
            treeHeight: this._broadphase.getHeight(),
            treeBalance: this._broadphase.getTreeBalance(),
            treeQuality: this._broadphase.getTreeQuality(),
            stepTime: this._stepTime,
            collisionTime: this._profiler?.collisionTime ?? 0,
            solveTime: this._profiler?.solveTime ?? 0,
            broadphaseTime: this._profiler?.broadphaseTime ?? 0,
            narrowphaseTime: this._profiler?.narrowphaseTime ?? 0,
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
        return this._shapeStore.getProxyCount();
    }

    getTreeHeight(): number {
        return this._broadphase.getHeight();
    }

    getTreeBalance(): number {
        return this._broadphase.getTreeBalance();
    }

    getTreeQuality(): number {
        return this._broadphase.getTreeQuality();
    }

    validate(): boolean {
        return this._shapeStore.validate() && this._constraintStore.validate();
    }

    dump(): void {}

    /**
     * Whether `step()`/`[Symbol.dispose]()` have torn this world down.
     * Components use this to avoid pushing state into a destroyed world.
     */
    get isDisposed(): boolean {
        return this._disposed;
    }

    [Symbol.dispose](): void {
        if (this._disposed) return;

        this._disposed = true;
        this._bodyViews.clear();
        this._shapeStore.clear();
        this._constraintStore.clear();
        this._staticAabbCache.clear();
        this._staticAabbDirty.clear();
        this._jointCollisionCounts.clear();

        this._bodyManager[Symbol.dispose]();
        this._shapeManager[Symbol.dispose]();
        this._constraintManager[Symbol.dispose]();
        this._contactManager[Symbol.dispose]();
    }
}
