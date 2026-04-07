import { describe, expect, it } from 'vitest';
import {
    BodyManager3D,
    ConstraintManager3D,
    PhysicsWorld3D,
    ShapeManager3D,
} from '../../physics/core/physics-world-3d';

describe('PhysicsWorld3D modular structure', () => {
    it('exposes dedicated manager instances through the world facade', () => {
        const world = new PhysicsWorld3D();

        expect(world.getBodyManager()).toBeInstanceOf(BodyManager3D);
        expect(world.getShapeManager()).toBeInstanceOf(ShapeManager3D);
        expect(world.getConstraintManager()).toBeInstanceOf(ConstraintManager3D);
    });

    it('steps dynamic bodies through the extracted manager boundary', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -10, z: 0 } });
        const bodyId = world.getBodyManager().createBody({
            type: 2,
            position: { x: 0, y: 10, z: 0 },
            linearVelocity: { x: 1, y: 0, z: 0 },
        });

        world.step(0.5);

        const position = world.getBodyManager().getPosition(bodyId);
        const velocity = world.getBodyManager().getLinearVelocity(bodyId);

        expect(position.x).toBeCloseTo(0.5, 5);
        expect(position.y).toBeCloseTo(7.5, 5);
        expect(velocity.y).toBeCloseTo(-5, 5);
    });

    it('keeps shape and constraint managers usable after extraction', () => {
        const world = new PhysicsWorld3D();
        const bodyA = world.getBodyManager().createBody({ type: 2 });
        const bodyB = world.getBodyManager().createBody({
            type: 2,
            position: { x: 1, y: 0, z: 0 },
        });

        const shapeId = world.getShapeManager().createSphere(bodyA, {
            center: { x: 0, y: 0, z: 0 },
            radius: 0.5,
        });
        const constraintId = world.getConstraintManager().createFixed({
            bodyIdA: bodyA,
            bodyIdB: bodyB,
            localAnchorA: { x: 0, y: 0, z: 0 },
            localAnchorB: { x: 0, y: 0, z: 0 },
        });

        expect(world.getShapeManager().getBodyForShape(shapeId)).toBe(bodyA);
        expect(world.getConstraintManager().getConstraintsForBody(bodyA)).toContain(constraintId);
        expect(world.getConstraintManager().getConstraintsForBody(bodyB)).toContain(constraintId);
    });
});