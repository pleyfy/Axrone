import type { IVec3Like } from '@axrone/numeric';
import type { ICollisionFilter, IContactManifold3D, Impulse } from '../types';
import type {
    BodyId3D,
    ConstraintId3D,
    IContactListener3D,
    IPhysicsProfiler3D,
    ShapeId3D,
} from '../types/physics-3d';
import { BodyManager3D, ConstraintManager3D } from './physics-managers-3d';
import { DynamicAABBTree3D } from './broadphase-3d';
import type {
    IAabb3D,
    IConstraintDescriptor3D,
    IResolvedContactManifold3D,
    IShapeDescriptor3D,
    IShapePairCandidate3D,
    SupportedConstraintDef3D,
} from './physics-world-3d-shared';
import { CONTACT_BREAK_THRESHOLD } from './physics-world-3d-shared';
import { PhysicsWorld3DBroadphase } from './physics-world-3d-broadphase';
import { PhysicsWorld3DContactIndex } from './physics-world-3d-contact-index';
import { PhysicsWorld3DEvents } from './physics-world-3d-events';
import { PhysicsWorld3DManifoldBuilder } from './physics-world-3d-manifold';
import { PhysicsWorld3DNarrowphase } from './physics-world-3d-narrowphase';
import { ContactSolverCache, HEADER_FLOATS, POINT_FLOATS, PhysicsWorld3DSolver } from './physics-world-3d-solver';
import { CONTACT_POSITION_BETA_FINAL, CONTACT_POSITION_BETA_SOFT } from './physics-solver-policy-3d';
import { PhysicsWorld3DSpring } from './physics-world-3d-spring';
import { makeCollisionPairKey } from '@axrone/physics-core';

// ─── Constraint Framework Imports ─────────────────────────────────────────────
// Side-effect imports: each module calls registerConstraintModule() at load time.
import './physics-world-3d-constraints-fixed';
import './physics-world-3d-constraints-hinge';
import './physics-world-3d-constraints-slider';
import './physics-world-3d-constraints-cone-twist';
import './physics-world-3d-constraints-configurable';
import {
    type JacobianRow3D,
    type SolverBody3D,
    prepareAllConstraints,
    solveAllVelocityConstraints,
    commitSolverVelocities3D,
    syncSolverBodiesFromManager,
    applyConstraintPositionCorrection,
} from './physics-world-3d-constraints-framework';

/** Cached warm-start impulses for one contact point, plus the step that wrote it. */

export interface IContactDiagnosticsSnapshot {
    manifolds: {
        pairKey: number;
        bodyIdA: BodyId3D;
        bodyIdB: BodyId3D;
        normal: { x: number; y: number; z: number };
        tangent1: { x: number; y: number; z: number };
        tangent2: { x: number; y: number; z: number };
        pointCount: number;
        friction: number;
        restitution: number;
        sensor: boolean;
        solverOffset: number;
        points: {
            separation: number;
            normalImpulse: number;
            tangentImpulse1: number;
            tangentImpulse2: number;
            localPointA: { x: number; y: number; z: number };
            localPointB: { x: number; y: number; z: number };
        }[];
    }[];
    cacheValues: Float64Array;
    headerFloats: number;
    pointFloats: number;
    warmImpulses: { key: number; normal: number; tangent: number; generation: number }[];
    contactCount: number;
}

export interface IWarmImpulseEntry3D {
    normal: number;
    tangent: number;
    generation: number;
}

export interface IPhysicsWorld3DContactRuntimeHost {
    readonly bodyManager: BodyManager3D;
    readonly constraintManager: ConstraintManager3D;
    readonly shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>;
    readonly constraintDescriptors: ReadonlyMap<ConstraintId3D, IConstraintDescriptor3D>;
    readonly getProfiler: () => IPhysicsProfiler3D | null;
    readonly getContactListener: () => IContactListener3D | null;
    readonly getCollisionFilter: () => ICollisionFilter | null;
    readonly computeShapeAabb: (descriptor: IShapeDescriptor3D) => IAabb3D;
    /** Step token used to validate per-shape transform frames (see INarrowphaseHost). */
    readonly getFrameGeneration: () => number;
    readonly getShapeWorldCenter: (descriptor: IShapeDescriptor3D) => IVec3Like;
    readonly getConstraintAnchor: (
        def: SupportedConstraintDef3D,
        firstBody: boolean
    ) => IVec3Like;
}

export class PhysicsWorld3DContactRuntime {
    private _contactManifolds = new Map<number, IResolvedContactManifold3D>();
    private readonly _broadphase = new DynamicAABBTree3D<ShapeId3D>(1024);

    /**
     * Flat view of `_contactManifolds` used by the solve phases. The velocity
     * and position solvers walk every manifold 10 and 5 times per step; a Map
     * iterator per pass allocated an iterator object per pass, so the loops
     * index this array instead. Rebuilt whenever the map size diverges.
     */
    private readonly _manifoldList: IResolvedContactManifold3D[] = [];

    // ─── Constraint solver state (reused per step, allocated once) ───
    private _jacobianCache = new Map<ConstraintId3D, JacobianRow3D[]>();
    private _solverBodies = new Map<BodyId3D, SolverBody3D>();

    /** Warm-start impulse cache keyed by pairKey * 4 + pointIndex. */
    private readonly _warmImpulses = new Map<number, IWarmImpulseEntry3D>();
    private _warmImpulseGeneration = 0;

    /** Refreshes the flat manifold view when it diverged from the map. */
    private _ensureManifoldList(): IResolvedContactManifold3D[] {
        if (this._manifoldList.length !== this._contactManifolds.size - this._gapPairKeys.size) {
            this._manifoldList.length = 0;
            for (const m of this._contactManifolds.values()) {
                if (!this._gapPairKeys.has(m.pairKey)) this._manifoldList.push(m);
            }
        }
        return this._manifoldList;
    }
    private _lastIslandCount = 0;

    /** Previous-frame manifold snapshot for event dispatch diff. */
    private _previousManifolds = new Map<number, IResolvedContactManifold3D>();
    private _contactedPairs = new Map<number, IResolvedContactManifold3D>();
    private _nextContactedPairs = new Map<number, IResolvedContactManifold3D>();
    private _gapPairKeys = new Set<number>();
    private _indexScratch = new Map<number, IResolvedContactManifold3D>();
    private _enteringFlags: boolean[] = [];
    private readonly _gapCandidate = {
        descriptorA: null as unknown as IShapeDescriptor3D,
        descriptorB: null as unknown as IShapeDescriptor3D,
        aabbA: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
        aabbB: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
        pairKey: 0,
    };

    private readonly _narrowphase: PhysicsWorld3DNarrowphase;
    private readonly _manifoldBuilder: PhysicsWorld3DManifoldBuilder;
    private readonly _solver: PhysicsWorld3DSolver;
    /** Per-step contact solve data; reset whenever manifolds are recollected. */
    private readonly _solverCache = new ContactSolverCache();
    private readonly _spring: PhysicsWorld3DSpring;
    private readonly _broadphaseModule: PhysicsWorld3DBroadphase;
    private readonly _events: PhysicsWorld3DEvents;
    private readonly _contactIndex: PhysicsWorld3DContactIndex;

    constructor(private readonly _host: IPhysicsWorld3DContactRuntimeHost) {
        this._narrowphase = new PhysicsWorld3DNarrowphase(_host);
        this._solver = new PhysicsWorld3DSolver(_host);
        this._spring = new PhysicsWorld3DSpring(_host);
        this._broadphaseModule = new PhysicsWorld3DBroadphase(this._broadphase);
        this._events = new PhysicsWorld3DEvents({
            getContactListener: _host.getContactListener,
            toContactManifold: (m) => this._toContactManifold(m),
        });
        this._contactIndex = new PhysicsWorld3DContactIndex();
        this._manifoldBuilder = new PhysicsWorld3DManifoldBuilder({
            bodyManager: _host.bodyManager,
            getShapeWorldCenter: _host.getShapeWorldCenter,
            getFrameGeneration: _host.getFrameGeneration,
            detectCollision: (dA, dB, aabbA, aabbB) =>
                this._narrowphase.detectCollision(dA, dB, aabbA, aabbB),
            buildBoxBoxManifold: (dA, dB, normal, totalPen) =>
                this._narrowphase.buildBoxBoxManifold(dA, dB, normal, totalPen),
        });
    }

    get contactCount(): number {
        return this._contactManifolds.size - this._gapPairKeys.size;
    }

    get islandCount(): number {
        return this._lastIslandCount;
    }

    /** Expose the broadphase tree for world-level queries (P1-13). */
    get broadphase(): DynamicAABBTree3D<ShapeId3D> {
        return this._broadphase;
    }

    pruneShape(shapeId: ShapeId3D): void {
        for (const [k, m] of this._contactManifolds) {
            if (m.shapeIdA === shapeId || m.shapeIdB === shapeId) this._contactManifolds.delete(k);
        }
        this._broadphaseModule.pruneShape(shapeId);
    }

    /**
     * Remove all solver state associated with a body. Called on destroy to prevent
     * stale warm impulses, manifold history, and contact index entries from leaking.
     */
    removeBodyState(bodyId: BodyId3D): void {
        const bid = Number(bodyId);
        // Remove warm impulse entries whose pair involves this body
        for (const [key, m] of this._contactManifolds) {
            if (Number(m.bodyIdA) === bid || Number(m.bodyIdB) === bid) {
                // Remove warm impulses for this manifold's pairKey
                for (let pi = 0; pi < m.pointCount; pi++) {
                    this._warmImpulses.delete(m.pairKey * 4 + pi);
                }
            }
        }
        this._contactIndex.removeBodyState(
            bodyId,
            this._contactManifolds,
            this._warmImpulses,
            this._previousManifolds
        );
    }

    /**
     * Rebuild body→contact pairKey index from current manifolds. (P1-4)
     * O(C) where C = contact count. Called lazily when kinematic bodies move.
     */
    rebuildBodyContactIndex(): void {
        if (this._gapPairKeys.size === 0) {
            this._contactIndex.rebuildBodyContactIndex(this._contactManifolds);
            return;
        }
        const solvable = this._indexScratch;
        solvable.clear();
        for (const [key, m] of this._contactManifolds) {
            if (!this._gapPairKeys.has(key)) solvable.set(key, m);
        }
        this._contactIndex.rebuildBodyContactIndex(solvable);
    }

    /** Get contact pairKeys for a body from the pre-built index. (P1-4) */
    getContactPairKeysForBody(bodyId: BodyId3D): number[] | undefined {
        return this._contactIndex.getContactPairKeysForBody(bodyId);
    }

    /** Look up manifold bodyIds by pairKey. (P1-4) */
    getManifoldBodyIds(pairKey: number): { bodyIdA: BodyId3D; bodyIdB: BodyId3D } | null {
        return this._contactIndex.getManifoldBodyIds(this._contactManifolds, pairKey);
    }

    /**
     * Register a joint collision pair — increments the counter for the body pair.
     * Called when a constraint with `collideConnected=false` is created.
     */
    registerJointCollisionPair(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void {
        this._contactIndex.registerJointCollisionPair(bodyIdA, bodyIdB);
    }

    /**
     * Unregister a joint collision pair — decrements the counter, removes entry at zero.
     * Called when a constraint with `collideConnected=false` is destroyed.
     */
    unregisterJointCollisionPair(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void {
        this._contactIndex.unregisterJointCollisionPair(bodyIdA, bodyIdB);
    }

    /**
     * Legacy combined solve — kept for backward compat.
     * Internally delegates to the split pipeline.
     */
    solve(deltaTime: number, velIters: number, posIters: number): void {
        this.collectManifolds();
        this.warmStart();
        this.solveVelocity(velIters);
        this.solvePosition(posIters, deltaTime);
        this._persistWarmImpulses();
        this.dispatchEvents();
    }

    /** Phase 1: broadphase + narrowphase → build manifolds. */
    collectManifolds(): void {
        const bStart = performance.now();
        const pairs = this._broadphaseModule.collectPotentialCollisionPairs(this._host);
        const bTime = performance.now() - bStart;
        const nStart = performance.now();

        const next = this._contactManifolds;
        next.clear();
        this._manifoldList.length = 0;
        // Solver blocks are per step: manifolds are rebuilt every step, so the
        // flat cache starts over with them.
        this._solverCache.reset();

        const carried = this._contactedPairs;
        this._contactedPairs = this._nextContactedPairs;
        this._nextContactedPairs = carried;
        const carrying = this._contactedPairs;
        carrying.clear();
        const carryingGaps = this._gapPairKeys;
        carryingGaps.clear();
        const band = CONTACT_BREAK_THRESHOLD;

        // collideConnected filter: skip pairs joined by a non-colliding constraint.
        // The broadphase module owns proxy/candidate bookkeeping only, so the
        // joint-collision suppression lives here, next to the contact index.
        // Early exit: when no joints exist, skip entirely.
        const jointCollisionCounts = this._contactIndex.jointCollisionCounts;
        const hasJointCollisions = jointCollisionCounts.size > 0;

        for (const pair of pairs) {
            if (hasJointCollisions) {
                const bodyPairKey = makeCollisionPairKey(
                    Number(pair.descriptorA.bodyId),
                    Number(pair.descriptorB.bodyId)
                );
                if (jointCollisionCounts.has(bodyPairKey)) continue;
            }
            const strict = this._manifoldBuilder.buildContactManifold(pair, null);
            let m = strict;
            let gapContact = false;
            if (!m && carried.has(pair.pairKey)) {
                m = this._buildBandedManifold(pair.descriptorA, pair.descriptorB, pair.pairKey, band);
                gapContact = m !== null;
            }
            if (!m) continue;
            carrying.set(pair.pairKey, m);
            const bodyManager = this._host.bodyManager;
            const inverseMassSum = bodyManager.getInverseMass(m.bodyIdA) + bodyManager.getInverseMass(m.bodyIdB);
            const velocityA = bodyManager.getLinearVelocity(m.bodyIdA);
            const velocityB = bodyManager.getLinearVelocity(m.bodyIdB);
            const approach = (velocityB.x - velocityA.x) * m.normal.x
                + (velocityB.y - velocityA.y) * m.normal.y
                + (velocityB.z - velocityA.z) * m.normal.z;
            const seedCap = inverseMassSum > 0 && approach < 0 ? -approach / (inverseMassSum * m.pointCount) : 0;
            for (let pi = 0; pi < m.pointCount; pi++) {
                const warmKey = pair.pairKey * 4 + pi;
                const warm = this._warmImpulses.get(warmKey);
                if (!warm) continue;
                const seed = warm.normal < seedCap ? warm.normal : seedCap;
                m.points[pi].normalImpulse = seed as Impulse;
                m.points[pi].tangentImpulse1 = (warm.normal > 0 ? warm.tangent * (seed / warm.normal) : 0) as Impulse;
            }
            next.set(pair.pairKey, m);
            if (gapContact) {
                carryingGaps.add(pair.pairKey);
            } else {
                this._manifoldList.push(m);
                this._solver.prepareContact(m, this._solverCache);
            }
        }

        for (const entry of carried) {
            if (next.has(entry[0])) continue;
            const previous = entry[1];
            const m = this._buildBandedManifold(previous.descriptorA, previous.descriptorB, entry[0], band);
            if (!m) continue;
            carrying.set(entry[0], m);
            carryingGaps.add(entry[0]);
            next.set(entry[0], m);
        }

        const nTime = performance.now() - nStart;
        const profiler = this._host.getProfiler();
        if (profiler) {
            profiler.broadphaseTime = bTime;
            profiler.narrowphaseTime = nTime;
            profiler.collisionTime = bTime + nTime;
        }

        this._lastIslandCount = this._solver.countIslands(this._manifoldList, this._solverCache);
    }

    /** Phase 2: apply cached impulses to velocities. */
    warmStart(): void {
        const wStart = performance.now();
        const list = this._ensureManifoldList();
        for (let i = 0; i < list.length; i++) this._solver.warmStartContact(list[i], this._solverCache);
        const profiler = this._host.getProfiler();
        if (profiler) profiler.warmStartTime = performance.now() - wStart;
    }

    /** Phase 3: sequential impulse velocity solve. */
    solveVelocity(velIters: number, dt?: number): void {
        const vStart = performance.now();

        // ─── Prepare Jacobian constraints (once per step, outside iteration loop) ───
        const stepDt = dt ?? (1 / 60);
        this._solverBodies.clear();
        // Early-exit guard: when no constraints exist, skip prepareAllConstraints
        // entirely to avoid allocating a new Map every step. Clear the existing
        // cache in-place (zero allocation) instead.
        const constraintIds = this._host.constraintManager.getAllConstraintIds();
        if (constraintIds.length > 0) {
            this._jacobianCache = prepareAllConstraints(
                constraintIds,
                this._host.constraintManager,
                this._host.constraintDescriptors,
                this._host.bodyManager,
                this._solverBodies,
                stepDt,
            );
        } else {
            this._jacobianCache.clear();
        }

        const list = this._ensureManifoldList();
        for (let i = 0; i < velIters; i++) {
            for (let m = 0; m < list.length; m++) this._solver.solveContactVelocity(list[m], this._solverCache);
            this._solveDistanceConstraints(velIters);
            // Sync solver body velocities from body manager (contact solve modifies it directly)
            syncSolverBodiesFromManager(this._solverBodies, this._host.bodyManager);
            // Jacobian-based constraint velocity solve (Fixed, Hinge, etc.)
            solveAllVelocityConstraints(this._jacobianCache, this._solverBodies);
            // Commit constraint corrections back to body manager
            commitSolverVelocities3D(this._solverBodies, this._host.bodyManager);
        }

        // Spring forces are applied ONCE per step (not per velocity iteration)
        // to prevent over-accumulation. Box2D convention: soft constraint bias
        // is computed in prepare phase; only the pre-biased impulse is iterated.
        this._spring.solveSpringForces(dt);
        const profiler = this._host.getProfiler();
        if (profiler) profiler.solveVelocityTime = performance.now() - vStart;
    }

    /** Phase 4: Baumgarte positional correction. */
    private _buildBandedManifold(
        dA: IShapeDescriptor3D,
        dB: IShapeDescriptor3D,
        pairKey: number,
        band: number
    ): IResolvedContactManifold3D | null {
        const separation = this._narrowphase.pairSeparation(dA, dB);
        if (!separation || separation.distance >= band) return null;
        const candidate = this._gapCandidate;
        candidate.descriptorA = dA;
        candidate.descriptorB = dB;
        candidate.pairKey = pairKey;
        return this._manifoldBuilder.buildContactManifold(candidate, {
            normal: separation.normal,
            point: separation.point,
            penetration: -separation.distance,
        });
    }

    private _isEntering(manifold: IResolvedContactManifold3D): boolean {
        for (let pi = 0; pi < manifold.pointCount; pi++) {
            if (this._warmImpulses.has(manifold.pairKey * 4 + pi)) return false;
        }
        return manifold.pointCount > 0;
    }

    solvePosition(posIters: number, dt: number): void {
        const pStart = performance.now();
        const list = this._ensureManifoldList();
        if (posIters > 0) {
            for (let m = 0; m < list.length; m++) this._enteringFlags[m] = this._isEntering(list[m]);
            for (let i = 0; i < posIters; i++) {
                for (let m = 0; m < list.length; m++) {
                    this._solver.correctContactPositions(list[m], CONTACT_POSITION_BETA_SOFT, this._solverCache, this._enteringFlags[m]);
                }
            }
            for (let m = 0; m < list.length; m++) {
                this._solver.correctContactPositions(list[m], CONTACT_POSITION_BETA_FINAL, this._solverCache, this._enteringFlags[m]);
            }
        }

        // ─── Jacobian constraint position correction ───
        // Apply anchor-alignment position corrections for constraints (Fixed, Hinge, etc.)
        // This runs AFTER contact position corrections and AFTER position integration.
        if (this._jacobianCache.size > 0) {
            applyConstraintPositionCorrection(
                this._jacobianCache,
                this._host.bodyManager,
                this._host.constraintManager,
                dt,
            );
        }

        const profiler = this._host.getProfiler();
        if (profiler) profiler.solvePositionTime = performance.now() - pStart;
    }

    /** Persist accumulated impulses for next-frame warm starting.
     *  Reuses existing cache entries in-place to avoid per-step object allocation. */
    private _persistWarmImpulses(): void {
        const generation = ++this._warmImpulseGeneration;
        const list = this._ensureManifoldList();
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            for (let pi = 0; pi < m.pointCount; pi++) {
                const p = m.points[pi];
                const key = m.pairKey * 4 + pi;
                const entry = this._warmImpulses.get(key);
                if (entry) {
                    entry.normal = p.normalImpulse as number;
                    entry.tangent = p.tangentImpulse1 as number;
                    entry.generation = generation;
                } else {
                    this._warmImpulses.set(key, {
                        normal: p.normalImpulse as number,
                        tangent: p.tangentImpulse1 as number,
                        generation,
                    });
                }
            }
        }
        // Parity with the previous clear-then-rebuild: a key that this step did
        // not produce must not be readable by the next one.
        for (const [key, entry] of this._warmImpulses) {
            if (entry.generation !== generation) this._warmImpulses.delete(key);
        }
    }

    /**
     * Public accessor for warm-impulse persistence — called by the step() pipeline
     * after solvePosition(). Delegates to the private _persistWarmImpulses().
     */
    persistWarmImpulses(): void {
        const pStart = performance.now();
        this._persistWarmImpulses();
        const profiler = this._host.getProfiler();
        if (profiler) profiler.persistTime = performance.now() - pStart;
    }

    /** Expose warm impulse cache size for testing. */
    get warmImpulseCacheSize(): number {
        return this._warmImpulses.size;
    }

    getContactDiagnostics(): IContactDiagnosticsSnapshot {
        const manifolds = this._ensureManifoldList().map((m) => ({
            pairKey: m.pairKey,
            bodyIdA: m.bodyIdA,
            bodyIdB: m.bodyIdB,
            normal: { ...m.normal },
            tangent1: { ...m.tangent1 },
            tangent2: { ...m.tangent2 },
            pointCount: m.pointCount,
            friction: m.friction,
            restitution: m.restitution,
            sensor: m.sensor,
            solverOffset: m.solverOffset,
            points: m.points.map((p) => ({
                separation: p.separation,
                normalImpulse: Number(p.normalImpulse),
                tangentImpulse1: Number(p.tangentImpulse1),
                tangentImpulse2: Number(p.tangentImpulse2),
                localPointA: { ...p.localPointA },
                localPointB: { ...p.localPointB },
            })),
        }));
        const cacheValues = new Float64Array(this._solverCache.values);
        const warmImpulses = [...this._warmImpulses.entries()].map(([key, entry]) => ({ key, normal: entry.normal, tangent: entry.tangent, generation: entry.generation }));
        return { manifolds, cacheValues, headerFloats: HEADER_FLOATS, pointFloats: POINT_FLOATS, warmImpulses, contactCount: this._contactManifolds.size - this._gapPairKeys.size };
    }

    /** Fire contact events by comparing previous vs current manifolds. */
    dispatchEvents(): void {
        if (!this._host.getContactListener()) return;
        this._events.dispatchEvents(this._contactManifolds, this._previousManifolds);
        // Snapshot current manifolds for next frame's event diff
        this._previousManifolds = new Map(this._contactManifolds);
    }

    private _toContactManifold(m: IResolvedContactManifold3D): IContactManifold3D {
        return this._manifoldBuilder.toContactManifold(m);
    }

    /**
     * @deprecated Legacy anchor position correction. Now handled by the Jacobian
     * constraint framework (physics-world-3d-constraints-framework.ts).
     * Types 0 (Fixed) and 2 (Hinge) are solved by the new framework.
     * Kept as a no-op for backward compatibility; will be removed when all
     * constraint types migrate to the Jacobian framework.
     */
    private _solveDistanceConstraints(_iterations: number): void {
        // All rigid constraint types (Fixed, Hinge, Slider, ConeTwist, Generic)
        // are now handled by the Jacobian constraint framework in
        // solveVelocity()/solvePosition(). Spring (6) has its own
        // _solveSpringForces() path. This method is kept as a no-op for
        // backward compatibility with the velocity solve loop.
        return;
    }
}
