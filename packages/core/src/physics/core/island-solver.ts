import { Vec2 } from '@axrone/numeric';
import type { BodyId, ContactId, ConstraintId, SolverFlags, PhysicsConstants } from '../types';
import type { BodyManager2D } from './body-manager';
import type { ContactManager2D } from './contact-manager';
import type { ConstraintManager2D } from './constraint-manager';

interface ProfilerData {
    solveVelocityTime: number;
    solvePositionTime: number;
}

export class IslandSolver2D {
    private readonly _bodyStack: BodyId[] = [];
    private readonly _bodyManager: BodyManager2D;
    private readonly _contactManager: ContactManager2D;
    private readonly _constraintManager: ConstraintManager2D;

    private readonly _velocities: Float64Array;
    private readonly _positions: Float64Array;

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
            }

            const constraints = this._constraintManager.getConstraintsForBody(bodyId);
            for (const constraintId of constraints) {
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

        for (const bodyId of this._bodyStack) {
            if (this._bodyManager.getBodyType(bodyId) === 2) {
                const index = 0;

                const mass = this._bodyManager.getMass(bodyId);
                const invMass = this._bodyManager.getInverseMass(bodyId);
            }
        }

        if ((flags & 1) !== 0) {
        }

        const t0 = performance.now();
        for (let i = 0; i < velIters; i++) {}
        if (profiler) profiler.solveVelocityTime += performance.now() - t0;

        for (const bodyId of this._bodyStack) {
            if (this._bodyManager.getBodyType(bodyId) !== 0) {
            }
        }

        const t1 = performance.now();
        let positionSolved = false;
        for (let i = 0; i < posIters; i++) {}
        if (profiler) profiler.solvePositionTime += performance.now() - t1;
    }
}
