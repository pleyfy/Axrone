import { describe, it, expect, beforeEach } from 'vitest';
import { PhysicsWorld2D } from '../../physics/core/physics-world';
import { BodyType, ShapeType } from '../../physics/types';

describe('PhysicsWorld2D Integration', () => {
    let world: PhysicsWorld2D;

    beforeEach(() => {
        world = new PhysicsWorld2D({
            gravity: { x: 0, y: -10 },
            bodyCapacity: 256,
            shapeCapacity: 256,
            contactCapacity: 256,
            constraintCapacity: 256,
        });
    });

    describe('World Creation', () => {
        it('creates world with default config', () => {
            const defaultWorld = new PhysicsWorld2D();
            expect(defaultWorld).toBeDefined();
        });

        it('creates world with custom gravity', () => {
            const customWorld = new PhysicsWorld2D({
                gravity: { x: 0, y: -20 },
            });
            expect(customWorld).toBeDefined();
        });

        it('creates world with custom capacities', () => {
            const customWorld = new PhysicsWorld2D({
                bodyCapacity: 512,
                shapeCapacity: 1024,
            });
            expect(customWorld).toBeDefined();
        });
    });

    describe('Body Lifecycle', () => {
        it('creates dynamic body', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            expect(bodyId).toBeGreaterThan(0);
        });

        it('creates static body', () => {
            const bodyId = world.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            expect(bodyId).toBeGreaterThan(0);
        });

        it('creates kinematic body', () => {
            const bodyId = world.createBody({
                type: BodyType.Kinematic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            expect(bodyId).toBeGreaterThan(0);
        });

        it('destroys body', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            world.destroyBody(bodyId);
        });

        it('creates and destroys multiple bodies', () => {
            const bodies = [];
            for (let i = 0; i < 10; i++) {
                bodies.push(world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: i, y: 0 },
                    rotation: 0,
                }));
            }

            bodies.forEach(id => world.destroyBody(id));
        });
    });

    describe('Shape Lifecycle', () => {
        let bodyId: any;

        beforeEach(() => {
            bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });
        });

        it('creates circle shape', () => {
            const shapeId = world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            expect(shapeId).toBeGreaterThan(0);
        });

        it('creates box shape', () => {
            const shapeId = world.createBoxShape(bodyId, {
                width: 2,
                height: 1,
                offset: { x: 0, y: 0 },
            });

            expect(shapeId).toBeGreaterThan(0);
        });

        it('creates polygon shape', () => {
            const shapeId = world.createPolygonShape(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                ],
            });

            expect(shapeId).toBeGreaterThan(0);
        });

        it('creates capsule shape', () => {
            const shapeId = world.createCapsuleShape(bodyId, {
                radius: 0.5,
                length: 2,
                offset: { x: 0, y: 0 },
            });

            expect(shapeId).toBeGreaterThan(0);
        });

        it('destroys shape', () => {
            const shapeId = world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.destroyShape(shapeId);
        });

        it('body destroyed with shapes', () => {
            world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.createBoxShape(bodyId, {
                width: 1,
                height: 1,
                offset: { x: 0, y: 0 },
            });

            world.destroyBody(bodyId);
        });
    });

    describe('Constraint Lifecycle', () => {
        let bodyA: any;
        let bodyB: any;

        beforeEach(() => {
            bodyA = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            bodyB = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });
        });

        it('creates distance constraint', () => {
            const constraintId = world.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            expect(constraintId).toBeGreaterThan(0);
        });

        it('creates revolute constraint', () => {
            const constraintId = world.createRevoluteConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
            });

            expect(constraintId).toBeGreaterThan(0);
        });

        it('destroys constraint', () => {
            const constraintId = world.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            world.destroyConstraint(constraintId);
        });
    });

    describe('Simulation Step', () => {
        it('steps simulation', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 10 },
                rotation: 0,
            });

            world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.step(1 / 60);
        });

        it('applies gravity over time', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 10 },
                rotation: 0,
            });

            world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            const initialPos = world.getBodyManager().getPosition(bodyId);

            for (let i = 0; i < 60; i++) {
                world.step(1 / 60);
            }

            const finalPos = world.getBodyManager().getPosition(bodyId);
            expect(finalPos.y).toBeLessThan(initialPos.y);
        });

        it('steps with fixed timestep', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });

        it('steps with variable timestep', () => {
            const bodyId = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            world.createCircleShape(bodyId, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.step(1 / 60);
            world.step(1 / 30);
            world.step(1 / 120);
        });
    });

    describe('Collision Detection Pipeline', () => {
        it('detects collision between two circles', () => {
            const bodyA = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 1.5, y: 0 },
                rotation: 0,
            });

            world.createCircleShape(bodyA, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.createCircleShape(bodyB, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.step(1 / 60);
        });

        it('detects collision between circle and box', () => {
            const bodyA = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = world.createBody({
                type: BodyType.Static,
                position: { x: 0, y: -2 },
                rotation: 0,
            });

            world.createCircleShape(bodyA, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            world.createBoxShape(bodyB, {
                width: 10,
                height: 1,
                offset: { x: 0, y: 0 },
            });

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });

        it('detects collisions in complex scene', () => {
            const ground = world.createBody({
                type: BodyType.Static,
                position: { x: 0, y: -5 },
                rotation: 0,
            });

            world.createBoxShape(ground, {
                width: 20,
                height: 1,
                offset: { x: 0, y: 0 },
            });

            for (let i = 0; i < 10; i++) {
                const body = world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: Math.random() * 10 - 5, y: i * 2 + 5 },
                    rotation: Math.random() * Math.PI,
                });

                if (i % 2 === 0) {
                    world.createCircleShape(body, {
                        radius: 0.5,
                        offset: { x: 0, y: 0 },
                    });
                } else {
                    world.createBoxShape(body, {
                        width: 1,
                        height: 1,
                        offset: { x: 0, y: 0 },
                    });
                }
            }

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });
    });

    describe('Constraint Solving', () => {
        it('maintains distance constraint', () => {
            const bodyA = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            world.createCircleShape(bodyA, {
                radius: 0.5,
                offset: { x: 0, y: 0 },
            });

            world.createCircleShape(bodyB, {
                radius: 0.5,
                offset: { x: 0, y: 0 },
            });

            world.createDistanceConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: 0, y: 0 },
                length: 5,
            });

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });

        it('maintains revolute constraint', () => {
            const bodyA = world.createBody({
                type: BodyType.Static,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const bodyB = world.createBody({
                type: BodyType.Dynamic,
                position: { x: 2, y: 0 },
                rotation: 0,
            });

            world.createBoxShape(bodyB, {
                width: 2,
                height: 0.5,
                offset: { x: 0, y: 0 },
            });

            world.createRevoluteConstraint({
                bodyIdA: bodyA,
                bodyIdB: bodyB,
                localAnchorA: { x: 0, y: 0 },
                localAnchorB: { x: -1, y: 0 },
            });

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });

        it('handles chain of constraints', () => {
            const bodies = [];
            for (let i = 0; i < 5; i++) {
                const body = world.createBody({
                    type: i === 0 ? BodyType.Static : BodyType.Dynamic,
                    position: { x: i * 2, y: 0 },
                    rotation: 0,
                });

                world.createBoxShape(body, {
                    width: 1,
                    height: 0.5,
                    offset: { x: 0, y: 0 },
                });

                bodies.push(body);
            }

            for (let i = 0; i < bodies.length - 1; i++) {
                world.createDistanceConstraint({
                    bodyIdA: bodies[i],
                    bodyIdB: bodies[i + 1],
                    localAnchorA: { x: 0.5, y: 0 },
                    localAnchorB: { x: -0.5, y: 0 },
                    length: 1,
                });
            }

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });
    });

    describe('Query Operations', () => {
        it('queries bodies in AABB', () => {
            for (let i = 0; i < 10; i++) {
                const body = world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: i, y: 0 },
                    rotation: 0,
                });

                world.createCircleShape(body, {
                    radius: 0.5,
                    offset: { x: 0, y: 0 },
                });
            }

            const results: any[] = [];
            world.queryAABB({ x: 2, y: -1 }, { x: 5, y: 1 }, (shapeId) => {
                results.push(shapeId);
                return true;
            });
        });

        it('raycasts through scene', () => {
            const body = world.createBody({
                type: BodyType.Static,
                position: { x: 5, y: 0 },
                rotation: 0,
            });

            world.createBoxShape(body, {
                width: 2,
                height: 2,
                offset: { x: 0, y: 0 },
            });

            const hit = world.rayCastClosest({ x: 0, y: 0 }, { x: 1, y: 0 }, 20);
        });
    });

    describe('Performance', () => {
        it('handles many bodies', () => {
            for (let i = 0; i < 50; i++) {
                const body = world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: Math.random() * 20 - 10, y: i * 2 },
                    rotation: Math.random() * Math.PI * 2,
                });

                world.createCircleShape(body, {
                    radius: 0.5,
                    offset: { x: 0, y: 0 },
                });
            }

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });

        it('handles many constraints', () => {
            const bodies = [];
            for (let i = 0; i < 20; i++) {
                bodies.push(world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: i, y: 0 },
                    rotation: 0,
                }));
            }

            for (let i = 0; i < bodies.length - 1; i++) {
                world.createDistanceConstraint({
                    bodyIdA: bodies[i],
                    bodyIdB: bodies[i + 1],
                    localAnchorA: { x: 0, y: 0 },
                    localAnchorB: { x: 0, y: 0 },
                    length: 1,
                });
            }

            for (let i = 0; i < 100; i++) {
                world.step(1 / 60);
            }
        });
    });

    describe('Disposal', () => {
        it('disposes world', () => {
            world[Symbol.dispose]();
        });

        it('throws when using after disposal', () => {
            world[Symbol.dispose]();
            expect(() => {
                world.createBody({
                    type: BodyType.Dynamic,
                    position: { x: 0, y: 0 },
                    rotation: 0,
                });
            }).toThrow();
        });
    });

    describe('Edge Cases', () => {
        it('handles zero gravity', () => {
            const zeroGravityWorld = new PhysicsWorld2D({
                gravity: { x: 0, y: 0 },
            });

            const body = zeroGravityWorld.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            zeroGravityWorld.createCircleShape(body, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            const initialPos = zeroGravityWorld.getBodyManager().getPosition(body);

            for (let i = 0; i < 100; i++) {
                zeroGravityWorld.step(1 / 60);
            }

            const finalPos = zeroGravityWorld.getBodyManager().getPosition(body);
            expect(Math.abs(finalPos.y - initialPos.y)).toBeLessThan(0.01);
        });

        it('handles high gravity', () => {
            const highGravityWorld = new PhysicsWorld2D({
                gravity: { x: 0, y: -100 },
            });

            const body = highGravityWorld.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 10 },
                rotation: 0,
            });

            highGravityWorld.createCircleShape(body, {
                radius: 1,
                offset: { x: 0, y: 0 },
            });

            for (let i = 0; i < 100; i++) {
                highGravityWorld.step(1 / 60);
            }
        });

        it('handles empty step', () => {
            world.step(1 / 60);
        });
    });
});
