import { describe, it, expect, beforeEach } from 'vitest';
import { IslandSolver2D } from '../../physics/core/island-solver';
import { BodyManager2D } from '../../physics/core/body-manager';
import { ContactManager2D } from '../../physics/core/contact-manager';
import { ConstraintManager2D } from '../../physics/core/constraint-manager';
import { BodyType } from '../../physics/types';

describe('IslandSolver2D', () => {
    let islandSolver: IslandSolver2D;
    let bodyManager: BodyManager2D;
    let contactManager: ContactManager2D;
    let constraintManager: ConstraintManager2D;

    beforeEach(() => {
        bodyManager = new BodyManager2D(64);
        contactManager = new ContactManager2D(128, 8);
        constraintManager = new ConstraintManager2D(64);
        islandSolver = new IslandSolver2D(
            bodyManager,
            contactManager,
            constraintManager,
            128
        );
    });

    describe('Island Solver Basics', () => {
        it('creates solver', () => {
            expect(islandSolver).toBeDefined();
        });

        it('solves empty islands', () => {
            expect(() =>
                islandSolver.solveIslands(1 / 60, 8, 3, true, 0)
            ).not.toThrow();
        });

        it('solves islands with dynamic bodies', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1, { x: 0, y: 0 });

            expect(() =>
                islandSolver.solveIslands(1 / 60, 8, 3, true, 0)
            ).not.toThrow();
        });

        it('solves islands with multiple bodies', () => {
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

            bodyManager.setMassData(bodyA, 1, 0.1, { x: 0, y: 0 });
            bodyManager.setMassData(bodyB, 1, 0.1, { x: 0, y: 0 });

            expect(() =>
                islandSolver.solveIslands(1 / 60, 8, 3, true, 0)
            ).not.toThrow();
        });

        it('handles sleep flag', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1, { x: 0, y: 0 });

            expect(() =>
                islandSolver.solveIslands(1 / 60, 8, 3, false, 0)
            ).not.toThrow();
        });

        it('handles different iteration counts', () => {
            const bodyA = bodyManager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyManager.setMassData(bodyA, 1, 0.1, { x: 0, y: 0 });

            expect(() =>
                islandSolver.solveIslands(1 / 60, 4, 2, true, 0)
            ).not.toThrow();

            expect(() =>
                islandSolver.solveIslands(1 / 60, 16, 6, true, 0)
            ).not.toThrow();
        });
    });
});
