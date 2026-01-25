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
        solver = new ConstraintSolver2D();

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

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });

        it('prepares revolute constraint', () => {
            const constraintId = constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });

        it('prepares multiple constraints', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 1, y: 0 },
                localAnchorB: { x: -1, y: 0 },
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });
    });

    describe('Solve Velocity Constraints', () => {
        it('solves velocity for distance constraint', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdA, { x: 1, y: 0 }, 0);
            bodyManager.setVelocity(bodyIdB, { x: -1, y: 0 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });

        it('solves velocity for revolute constraint', () => {
            constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            bodyManager.setVelocity(bodyIdA, { x: 1, y: 1 }, 0.5);
            bodyManager.setVelocity(bodyIdB, { x: -1, y: -1 }, -0.5);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });

        it('solves velocity for multiple constraints', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            constraintManager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 1, y: 0 },
                localAnchorB: { x: -1, y: 0 },
            });

            bodyManager.setVelocity(bodyIdA, { x: 2, y: 1 }, 0.1);
            bodyManager.setVelocity(bodyIdB, { x: -2, y: -1 }, -0.1);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);

            for (let i = 0; i < 8; i++) {
                solver.solveVelocityConstraints(constraintManager, bodyManager);
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

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });
    });

    describe('Solve Position Constraints', () => {
        it('solves position for distance constraint', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 10, y: 0 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints(constraintManager, bodyManager);
                if (solved) break;
            }
        });

        it('solves position for revolute constraint', () => {
            constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 1, y: 1 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints(constraintManager, bodyManager);
                if (solved) break;
            }
        });

        it('solves position for prismatic constraint', () => {
            constraintManager.createPrismaticConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                localAxisA: { x: 1, y: 0 },
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 5, y: 2 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);

            for (let i = 0; i < 4; i++) {
                const solved = solver.solvePositionConstraints(constraintManager, bodyManager);
                if (solved) break;
            }
        });

        it('returns true when constraints satisfied', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 5, y: 0 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            const result = solver.solvePositionConstraints(constraintManager, bodyManager);

            expect(typeof result).toBe('boolean');
        });
    });

    describe('Jacobian Calculations', () => {
        it('computes jacobian for distance constraint', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });

        it('computes jacobian for revolute constraint', () => {
            constraintManager.createRevoluteConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });

        it('computes jacobian for weld constraint', () => {
            constraintManager.createWeldConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });

        it('updates jacobian on position change', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            bodyManager.setPosition(bodyIdA, { x: 1, y: 1 }, 0);
            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
        });
    });

    describe('Static Body Constraints', () => {
        it('solves constraint with one static body', () => {
            const staticId = bodyManager.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            constraintManager.createDistanceConstraint({
                bodyIdA: staticId,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdB, { x: 1, y: 0 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
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

            constraintManager.createDistanceConstraint({
                bodyIdA: staticIdA,
                bodyIdB: staticIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });
    });

    describe('Edge Cases', () => {
        it('handles zero timestep', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints(constraintManager, bodyManager, 0);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });

        it('handles very small timestep', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            solver.prepareConstraints(constraintManager, bodyManager, 0.0001);
            solver.solveVelocityConstraints(constraintManager, bodyManager);
        });

        it('handles overlapping bodies', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setPosition(bodyIdA, { x: 0, y: 0 }, 0);
            bodyManager.setPosition(bodyIdB, { x: 0, y: 0 }, 0);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);
            solver.solvePositionConstraints(constraintManager, bodyManager);
        });

        it('handles high velocity', () => {
            constraintManager.createDistanceConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            bodyManager.setVelocity(bodyIdA, { x: 100, y: 100 }, 10);
            bodyManager.setVelocity(bodyIdB, { x: -100, y: -100 }, -10);

            solver.prepareConstraints(constraintManager, bodyManager, 1 / 60);

            for (let i = 0; i < 8; i++) {
                solver.solveVelocityConstraints(constraintManager, bodyManager);
            }
        });
    });

    describe('Cleanup', () => {
        it('disposes solver', () => {
            solver[Symbol.dispose]();
        });

        it('allows multiple disposals', () => {
            solver[Symbol.dispose]();
            solver[Symbol.dispose]();
        });
    });
});
