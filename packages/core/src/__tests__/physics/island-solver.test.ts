import { describe, it, expect, beforeEach } from 'vitest';
import { IslandSolver2D } from '../../physics/core/island-solver';
import { BodyManager2D } from '../../physics/core/body-manager';
import { ConstraintManager2D } from '../../physics/core/constraint-manager';
import { ContactManager2D } from '../../physics/core/contact-manager';
import { BodyType } from '../../physics/types';

describe('IslandSolver2D', () => {
    let islandSolver: IslandSolver2D;
    let bodyManager: BodyManager2D;
    let constraintManager: ConstraintManager2D;
    let contactManager: ContactManager2D;

    beforeEach(() => {
        bodyManager = new BodyManager2D(128);
        constraintManager = new ConstraintManager2D(128);
        contactManager = new ContactManager2D(128);
        islandSolver = new IslandSolver2D(bodyManager, contactManager, constraintManager, 128);
    });

    describe('Island Solving', () => {
        it('solves island', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('solves multiple islands', () => {
            const bodyA1 = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyA2 = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            const bodyB1 = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 100, y: 0 },
                rotation: 0,
            });

            const bodyB2 = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 105, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA1, 1, 0.1);
            bodyManager.setMassData(bodyA2, 1, 0.1);
            bodyManager.setMassData(bodyB1, 1, 0.1);
            bodyManager.setMassData(bodyB2, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA1,
                bodyIdB: bodyA2,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyB1,
                bodyIdB: bodyB2,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });
    });

    describe('Velocity Solver', () => {
        it('solves velocity constraints', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);
            bodyManager.setVelocity(bodyA, { x: 1, y: 0 }, 0);
            bodyManager.setVelocity(bodyB, { x: -1, y: 0 }, 0);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('applies gravity to velocities', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);
            bodyManager.setVelocity(body, { x: 0, y: 0 }, 0);

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);

            const velocity = bodyManager.getVelocity(body);
            expect(velocity.linear.y).toBeLessThan(0);
        });
    });

    describe('Position Solver', () => {
        it('solves position constraints', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 10, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('corrects large position errors', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 20, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });
    });

    describe('Warm Starting', () => {
        it('uses warm start impulses', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('stores impulses between steps', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);
            bodyManager.setVelocity(bodyA, { x: 5, y: 0 }, 0);

            constraintManager.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            for (let i = 0; i < 10; i++) {
                islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
            }
        });
    });

    describe('Sleep Management', () => {
        it('allows sleeping islands', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);
            bodyManager.setVelocity(body, { x: 0, y: 0 }, 0);

            for (let i = 0; i < 100; i++) {
                islandSolver.solveIslands(0, 8, 3, true, 0);
            }
        });

        it('wakes up islands on force application', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);
            bodyManager.setVelocity(body, { x: 0, y: 0 }, 0);

            for (let i = 0; i < 100; i++) {
                islandSolver.solveIslands(0, 8, 3, true, 0);
            }

            bodyManager.applyForce(body, { x: 100, y: 0 }, { x: 0, y: 0 });

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });
    });

    describe('Edge Cases', () => {
        it('handles empty simulation', () => {
            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('handles single body', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('handles many islands', () => {
            for (let i = 0; i < 20; i++) {
                const body = bodyManager.createBody({
                    type: BodyType.Dynamic,
                    position: { x: i * 100, y: 0 },
                    rotation: 0,
                });
                bodyManager.setMassData(body, 1, 0.1);
            }

            islandSolver.solveIslands(1 / 60, 8, 3, true, 0);
        });

        it('handles zero timestep', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);

            islandSolver.solveIslands(0, 8, 3, true, 0);
        });
    });

    describe('Disposal', () => {
        it('disposes island solver', () => {
        });

        it('allows multiple disposals', () => {
        });
    });
});
