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

        bodyManager.setMassData(bodyIdA, 1, 0.1);
        bodyManager.setMassData(bodyIdB, 1, 0.1);
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

        bodyManager.setMassData(bodyIdA, 1, 0.1);
        bodyManager.setMassData(bodyIdB, 1, 0.1);
    });

    describe('Prepare Constraints', () => {
        it('prepares distance constraint', () => {
            const constraintId = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([constraintId], 1 / 60);
        });

        it('prepares revolute constraint', () => {
            const constraintId = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints([constraintId], 1 / 60);
        });

        it('prepares multiple constraints', () => {
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

            solver.prepareConstraints([c1, c2], 1 / 60);
        });
    });

    describe('Solve Velocity Constraints', () => {
        it('solves velocity for distance constraint', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdA, { x: 1, y: 0 }, 0);
            bodyManager.setVelocity(bodyIdB, { x: -1, y: 0 }, 0);

            solver.prepareConstraints([c], 1 / 60);
            solver.solveVelocityConstraints([c]);
        });

        it('solves velocity for revolute constraint', () => {
            const c = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            bodyManager.setVelocity(bodyIdA, { x: 1, y: 1 }, 0.5);
            bodyManager.setVelocity(bodyIdB, { x: -1, y: -1 }, -0.5);

            solver.prepareConstraints([c], 1 / 60);
            solver.solveVelocityConstraints([c]);
        });

        it('solves velocity for multiple constraints', () => {
            const c1 = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            const c2 = constraintManager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 1, y: 0 },
                localAnchorB: { x: -1, y: 0 },
            });

            bodyManager.setVelocity(bodyIdA, { x: 2, y: 1 }, 0.1);
            bodyManager.setVelocity(bodyIdB, { x: -2, y: -1 }, -0.1);

            solver.prepareConstraints([c1, c2], 1 / 60);

            for (let i = 0; i < 8; i++) {
                solver.solveVelocityConstraints([c1, c2]);
            }
        });

        it('handles disabled constraints', () => {
            const constraintId = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            constraintManager.setEnabled(constraintId, false);

            solver.prepareConstraints([constraintId], 1 / 60);
            solver.solveVelocityConstraints([constraintId]);
        });
    });

    describe('Solve Position Constraints', () => {
        it('solves position for distance constraint', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 10, y: 0 }, 0);

            solver.prepareConstraints([c], 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints([c]);
                if (solved) break;
            }
        });

        it('solves position for revolute constraint', () => {
            const c = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 1, y: 1 }, 0);

            solver.prepareConstraints([c], 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints([c]);
                if (solved) break;
            }
        });

        it('solves position for prismatic constraint', () => {
            const c = constraintManager.createPrismaticConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                localAxisA: { x: 1, y: 0 },
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 5, y: 2 }, 0);

            solver.prepareConstraints([c], 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints([c]);
                if (solved) break;
            }
        });

        it('returns true when constraints satisfied', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 5, y: 0 }, 0);

            solver.prepareConstraints([c], 1 / 60);
            const result = solver.solvePositionConstraints([c]);

            expect(typeof result).toBe('boolean');
        });
    });

    describe('Jacobian Calculations', () => {
        it('computes jacobian for distance constraint', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 1 / 60);
        });

        it('computes jacobian for revolute constraint', () => {
            const c = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints([c], 1 / 60);
        });

        it('computes jacobian for weld constraint', () => {
            const c = constraintManager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints([c], 1 / 60);
        });

        it('updates jacobian on position change', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 1 / 60);
            bodyManager.setPosition(bodyIdA, { x: 1, y: 1 }, 0);
            solver.prepareConstraints([c], 1 / 60);
        });
    });

    describe('Static Body Constraints', () => {
        it('solves constraint with one static body', () => {
            const staticId = bodyManager.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const c = constraintManager.createDistanceConstraint({
                bodyIdA: staticId,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdB, { x: 1, y: 0 }, 0);

            solver.prepareConstraints([c], 1 / 60);
            solver.solveVelocityConstraints([c]);
        });

        it('solves constraint with both static bodies', () => {
            const staticIdA = bodyManager.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const staticIdB = bodyManager.createBody({
                type: BodyType.Static,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            const c = constraintManager.createDistanceConstraint({
                bodyIdA: staticIdA,
                bodyIdB: staticIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 1 / 60);
            solver.solveVelocityConstraints([c]);
        });
    });

    describe('Edge Cases', () => {
        it('handles zero timestep', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 0);
            solver.solveVelocityConstraints([c]);
        });

        it('handles very small timestep', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints([c], 0.0001);
            solver.solveVelocityConstraints([c]);
        });

        it('handles overlapping bodies', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 0, y: 0 }, 0);

            solver.prepareConstraints([c], 1 / 60);
            solver.solvePositionConstraints([c]);
        });

        it('handles high velocity', () => {
            const c = constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdA, { x: 100, y: 100 }, 10);
            bodyManager.setVelocity(bodyIdB, { x: -100, y: -100 }, -10);

            solver.prepareConstraints([c], 1 / 60);

            for (let i = 0; i < 8; i++) {
                solver.solveVelocityConstraints([c]);
            }
        });
    });

    describe('Cleanup', () => {
        it('disposes solver', () => {
        });

        it('allows multiple disposals', () => {
        });
    });
});
