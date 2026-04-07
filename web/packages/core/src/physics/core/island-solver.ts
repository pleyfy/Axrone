import { Vec2 } from '@axrone/numeric';
import type { BodyId, ContactId, ConstraintId, SolverFlags, PhysicsConstants } from '../types';
import type { BodyManager2D } from './body-manager';
import type { ContactManager2D } from './contact-manager';
import type { ConstraintManager2D } from './constraint-manager';

interface ProfilerData {
    solveVelocityTime: number;
    solvePositionTime: number;
}

interface VelocityConstraintPoint {
    rA: { x: number; y: number };
    rB: { x: number; y: number };
    normalMass: number;
    tangentMass: number;
    velocityBias: number;
    normalImpulse: number;
    tangentImpulse: number;
}

interface VelocityConstraint {
    contactId: ContactId;
    indexA: number;
    indexB: number;
    invMassA: number;
    invMassB: number;
    invIA: number;
    invIB: number;
    friction: number;
    restitution: number;
    tangentSpeed: number;
    normal: { x: number; y: number };
    tangent: { x: number; y: number };
    pointCount: number;
    points: [VelocityConstraintPoint, VelocityConstraintPoint];
}

interface PositionConstraintPoint {
    localAnchorA: { x: number; y: number };
    localAnchorB: { x: number; y: number };
    separation: number;
}

interface PositionConstraint {
    contactId: ContactId;
    indexA: number;
    indexB: number;
    invMassA: number;
    invMassB: number;
    localCenterA: { x: number; y: number };
    localCenterB: { x: number; y: number };
    invIA: number;
    invIB: number;
    normal: { x: number; y: number };
    pointCount: number;
    points: [PositionConstraintPoint, PositionConstraintPoint];
}

export class IslandSolver2D {
    private readonly _bodyStack: BodyId[] = [];
    private readonly _contactStack: ContactId[] = [];
    private readonly _constraintStack: ConstraintId[] = [];
    private readonly _bodyManager: BodyManager2D;
    private readonly _contactManager: ContactManager2D;
    private readonly _constraintManager: ConstraintManager2D;

    private readonly _velocities: Float64Array;
    private readonly _positions: Float64Array;
    private readonly _velocityConstraints: VelocityConstraint[] = [];
    private readonly _positionConstraints: PositionConstraint[] = [];

    constructor(
        bodyManager: BodyManager2D,
        contactManager: ContactManager2D,
        constraintManager: ConstraintManager2D,
        maxBodiesPerIsland: number = 1024
    ) {
        this._bodyManager = bodyManager;
        this._contactManager = contactManager;
        this._constraintManager = constraintManager;

        this._velocities = new Float64Array(maxBodiesPerIsland * 3);
        this._positions = new Float64Array(maxBodiesPerIsland * 3);
    }

    solveIslands(
        deltaTime: number,
        velocityIterations: number,
        positionIterations: number,
        allowSleep: boolean,
        flags: SolverFlags,
        profiler?: ProfilerData
    ): void {
        const bodies = this._bodyManager.getBodyIds();
        const visitedBodies = new Set<BodyId>();

        for (const seedBodyId of bodies) {
            if (visitedBodies.has(seedBodyId)) continue;

            const type = this._bodyManager.getBodyType(seedBodyId);
            const isAwake = this._bodyManager.isAwake(seedBodyId);

            if (type === 0 || (allowSleep && !isAwake)) {
                continue;
            }

            this._buildIsland(seedBodyId, visitedBodies, allowSleep);

            if (this._bodyStack.length > 0) {
                this._solveIsland(
                    deltaTime,
                    velocityIterations,
                    positionIterations,
                    flags,
                    profiler
                );
                this._bodyStack.length = 0;
                this._contactStack.length = 0;
                this._constraintStack.length = 0;
            }
        }
    }

    private _buildIsland(seedBodyId: BodyId, visited: Set<BodyId>, allowSleep: boolean): void {
        const stack = [seedBodyId];
        visited.add(seedBodyId);
        this._bodyStack.push(seedBodyId);

        while (stack.length > 0) {
            const bodyId = stack.pop()!;

            if (
                allowSleep &&
                !this._bodyManager.isAwake(bodyId) &&
                this._bodyManager.getBodyType(bodyId) === 2
            ) {
                this._bodyManager.setAwake(bodyId, true);
            }

            const contacts = this._contactManager.getContactsForBody(bodyId);
            for (const contactId of contacts) {
                this._contactStack.push(contactId);
            }

            const constraints = this._constraintManager.getConstraintsForBody(bodyId);
            for (const constraintId of constraints) {
                this._constraintStack.push(constraintId);
            }
        }
    }

    private _solveIsland(
        dt: number,
        velIters: number,
        posIters: number,
        flags: SolverFlags,
        profiler?: ProfilerData
    ): void {
        const h = dt;
        const bodyCount = this._bodyStack.length;

        for (let i = 0; i < bodyCount; i++) {
            const bodyId = this._bodyStack[i];
            const type = this._bodyManager.getBodyType(bodyId);

            if (type === 2) {
                const offset = i * 3;
                const velocity = this._bodyManager.getLinearVelocity(bodyId);
                const angularVelocity = this._bodyManager.getAngularVelocity(bodyId);

                this._velocities[offset] = velocity.x;
                this._velocities[offset + 1] = velocity.y;
                this._velocities[offset + 2] = angularVelocity;

                const position = this._bodyManager.getPosition(bodyId);
                const rotation = this._bodyManager.getRotation(bodyId);

                this._positions[offset] = position.x;
                this._positions[offset + 1] = position.y;
                this._positions[offset + 2] = rotation;
            }
        }

        this._initializeVelocityConstraints();

        if ((flags & 1) !== 0) {
            this._warmStart();
        }

        const t0 = performance.now();
        for (let i = 0; i < velIters; i++) {
            this._solveVelocityConstraints();
        }
        if (profiler) profiler.solveVelocityTime += performance.now() - t0;

        for (let i = 0; i < bodyCount; i++) {
            const bodyId = this._bodyStack[i];
            const type = this._bodyManager.getBodyType(bodyId);

            if (type !== 0) {
                const offset = i * 3;
                const vx = this._velocities[offset];
                const vy = this._velocities[offset + 1];
                const w = this._velocities[offset + 2];

                this._positions[offset] += vx * h;
                this._positions[offset + 1] += vy * h;
                this._positions[offset + 2] += w * h;
            }
        }

        this._initializePositionConstraints();

        const t1 = performance.now();
        let positionSolved = false;
        for (let i = 0; i < posIters; i++) {
            const minSeparation = this._solvePositionConstraints();
            positionSolved = minSeparation >= -0.005;
            if (positionSolved) break;
        }
        if (profiler) profiler.solvePositionTime += performance.now() - t1;

        for (let i = 0; i < bodyCount; i++) {
            const bodyId = this._bodyStack[i];
            const type = this._bodyManager.getBodyType(bodyId);

            if (type !== 0) {
                const offset = i * 3;
                this._bodyManager.setPosition(bodyId, {
                    x: this._positions[offset],
                    y: this._positions[offset + 1],
                });
                this._bodyManager.setRotation(bodyId, this._positions[offset + 2]);
                this._bodyManager.setLinearVelocity(bodyId, {
                    x: this._velocities[offset],
                    y: this._velocities[offset + 1],
                });
                this._bodyManager.setAngularVelocity(bodyId, this._velocities[offset + 2]);
            }
        }

        this._storeImpulses();
        this._velocityConstraints.length = 0;
        this._positionConstraints.length = 0;
    }

    private _initializeVelocityConstraints(): void {
        for (const contactId of this._contactStack) {
            const contactData = this._contactManager.getContactData(contactId);
            if (!contactData || contactData.pointCount === 0) continue;

            const vc: VelocityConstraint = {
                contactId,
                indexA: 0,
                indexB: 0,
                invMassA: 0,
                invMassB: 0,
                invIA: 0,
                invIB: 0,
                friction: contactData.friction,
                restitution: contactData.restitution,
                tangentSpeed: 0,
                normal: { x: contactData.normal.x, y: contactData.normal.y },
                tangent: { x: -contactData.normal.y, y: contactData.normal.x },
                pointCount: contactData.pointCount,
                points: [
                    {
                        rA: { x: 0, y: 0 },
                        rB: { x: 0, y: 0 },
                        normalMass: 0,
                        tangentMass: 0,
                        velocityBias: 0,
                        normalImpulse: 0,
                        tangentImpulse: 0,
                    },
                    {
                        rA: { x: 0, y: 0 },
                        rB: { x: 0, y: 0 },
                        normalMass: 0,
                        tangentMass: 0,
                        velocityBias: 0,
                        normalImpulse: 0,
                        tangentImpulse: 0,
                    },
                ],
            };

            this._velocityConstraints.push(vc);
        }
    }

    private _warmStart(): void {
        for (const vc of this._velocityConstraints) {
            const warmData = this._contactManager.getWarmStartImpulse(vc.contactId, 0);
            vc.points[0].normalImpulse = warmData.normalImpulse;
            vc.points[0].tangentImpulse = warmData.tangentImpulse;

            if (vc.pointCount > 1) {
                const warmData2 = this._contactManager.getWarmStartImpulse(vc.contactId, 1);
                vc.points[1].normalImpulse = warmData2.normalImpulse;
                vc.points[1].tangentImpulse = warmData2.tangentImpulse;
            }
        }
    }

    private _solveVelocityConstraints(): void {
        for (const vc of this._velocityConstraints) {
            for (let j = 0; j < vc.pointCount; j++) {
                const vcp = vc.points[j];
                vcp.normalImpulse += 0.1;
                vcp.tangentImpulse += 0.01;
            }
        }
    }

    private _initializePositionConstraints(): void {
        for (const contactId of this._contactStack) {
            const contactData = this._contactManager.getContactData(contactId);
            if (!contactData || contactData.pointCount === 0) continue;

            const pc: PositionConstraint = {
                contactId,
                indexA: 0,
                indexB: 0,
                invMassA: 0,
                invMassB: 0,
                localCenterA: { x: 0, y: 0 },
                localCenterB: { x: 0, y: 0 },
                invIA: 0,
                invIB: 0,
                normal: { x: contactData.normal.x, y: contactData.normal.y },
                pointCount: contactData.pointCount,
                points: [
                    {
                        localAnchorA: contactData.point0.localA,
                        localAnchorB: contactData.point0.localB,
                        separation: contactData.point0.separation,
                    },
                    {
                        localAnchorA: contactData.point1?.localA ?? { x: 0, y: 0 },
                        localAnchorB: contactData.point1?.localB ?? { x: 0, y: 0 },
                        separation: contactData.point1?.separation ?? 0,
                    },
                ],
            };

            this._positionConstraints.push(pc);
        }
    }

    private _solvePositionConstraints(): number {
        let minSeparation = 0;

        for (const pc of this._positionConstraints) {
            for (let j = 0; j < pc.pointCount; j++) {
                const pcp = pc.points[j];
                if (pcp.separation < minSeparation) {
                    minSeparation = pcp.separation;
                }
            }
        }

        return minSeparation;
    }

    private _storeImpulses(): void {
        for (const vc of this._velocityConstraints) {
            for (let j = 0; j < vc.pointCount; j++) {
                const vcp = vc.points[j];
                this._contactManager.setWarmStartImpulse(
                    vc.contactId,
                    j,
                    vcp.normalImpulse,
                    vcp.tangentImpulse
                );
            }
        }
    }
}
