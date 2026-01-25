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
        islandSolver = new IslandSolver2D(128);
    });

    describe('Island Building', () => {
        it('builds islands from bodies', () => {
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
        });

        it('separates disconnected bodies into different islands', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 100, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1);
            bodyManager.setMassData(bodyB, 1, 0.1);

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
        });

        it('groups connected bodies into same island', () => {
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
        });

        it('handles static bodies in islands', () => {
            const staticBody = bodyManager.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const dynamicBody = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(dynamicBody, 1, 0.1);

            constraintManager.createDistanceConstraint({
                bodyIdA: staticBody,
                bodyIdB: dynamicBody,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
        });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
        });

        it('applies gravity to velocities', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);
            bodyManager.setVelocity(body, { x: 0, y: 0 }, 0);

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });

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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);

            for (let i = 0; i < 10; i++) {
                islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);

            for (let i = 0; i < 100; i++) {
                islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: 0 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);

            for (let i = 0; i < 100; i++) {
                islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: 0 });
            }

            bodyManager.applyForce(body, { x: 100, y: 0 }, { x: 0, y: 0 });

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: 0 });
        });
    });

    describe('Edge Cases', () => {
        it('handles empty simulation', () => {
            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
        });

        it('handles single body', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
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

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 1 / 60, { x: 0, y: -10 });
        });

        it('handles zero timestep', () => {
            const body = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(body, 1, 0.1);

            islandSolver.buildIslands(bodyManager, constraintManager, contactManager);
            islandSolver.solveIslands(bodyManager, constraintManager, contactManager, 0, { x: 0, y: -10 });
        });
    });

    describe('Disposal', () => {
        it('disposes island solver', () => {
            islandSolver[Symbol.dispose]();
        });

        it('allows multiple disposals', () => {
            islandSolver[Symbol.dispose]();
            islandSolver[Symbol.dispose]();
        });
    });
});
