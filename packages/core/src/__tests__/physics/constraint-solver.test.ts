import { describe, it, expect, beforeEach } from 'vitest';
import { ConstraintSolver2D } from '../../physics/core/constraint-solver';
import { ConstraintManager2D } from '../../physics/core/constraint-manager';
import { BodyManager2D } from '../../physics/core/body-manager';
import { BodyType } from '../../physics/types';

describe('ConstraintSolver2D', () => {
    let solver: ConstraintSolver2D;
    let constraintManager: ConstraintManager2D;
    let bodyManager: BodyManager2D;
    let bodyIdA: any;
    let bodyIdB: any;

    beforeEach(() => {
        bodyManager = new BodyManager2D(64);
        constraintManager = new ConstraintManager2D(64);
        solver = new ConstraintSolver2D(constraintManager, bodyManager);

        bodyIdA = bodyManager.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 0 },
            rotation: 0,
        });

        bodyIdB = bodyManager.createBody({
            type: BodyType.Dynamic,
            position: { x: 5, y: 0 },
            rotation: 0,
        });

        bodyManager.setMassData(bodyIdA, 1, 0.1, { x: 0, y: 0 });
        bodyManager.setMassData(bodyIdB, 1, 0.1, { x: 0, y: 0 });
    });

    describe('Constraint Solver Basics', () => {
        it('creates solver', () => {
            expect(solver).toBeDefined();
        });

        it('prepares constraints', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            expect(() => solver.prepareConstraints([c], 1 / 60)).not.toThrow();
        });

        it('solves velocity constraints', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 1 / 60);
            expect(() => solver.solveVelocityConstraints(8)).not.toThrow();
        });

        it('solves position constraints', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 1 / 60);
            const result = solver.solvePositionConstraints(3);
            expect(typeof result).toBe('boolean');
        });

        it('handles multiple constraint types', () => {
            const c1 = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            const c2 = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 1, y: 0 },
                localAnchorB: { x: -1, y: 0 },
            });

            expect(() => {
                solver.prepareConstraints([c1, c2], 1 / 60);
                solver.solveVelocityConstraints(8);
                solver.solvePositionConstraints(3);
            }).not.toThrow();
        });
    });
});
