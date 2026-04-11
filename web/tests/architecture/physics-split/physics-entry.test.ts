import { describe, expect, it } from 'vitest';
import * as physicsPackage from '@axrone/physics';
import * as physicsCorePackage from '@axrone/physics-core';
import * as physics2dPackage from '@axrone/physics-2d';
import * as physics3dPackage from '@axrone/physics-3d';

describe('physics entry', () => {
    it('keeps shared contracts in physics-core', () => {
        expect(physicsCorePackage.INVALID_BODY_ID).toBeDefined();
        expect(physicsCorePackage.ShapeType3D).toBeDefined();
        expect('PhysicsWorld2D' in physicsCorePackage).toBe(false);
        expect('PhysicsWorld3D' in physicsCorePackage).toBe(false);
    });

    it('keeps 2d runtime and components in physics-2d', () => {
        expect(physics2dPackage.PhysicsWorld2D).toBeDefined();
        expect(physics2dPackage.BodyManager2D).toBeDefined();
        expect(physics2dPackage.Rigidbody2D).toBeDefined();
        expect(physics2dPackage.BoxCollider2D).toBeDefined();
        expect('PhysicsWorld3D' in physics2dPackage).toBe(false);
    });

    it('keeps 3d runtime and components in physics-3d', () => {
        expect(physics3dPackage.PhysicsWorld3D).toBeDefined();
        expect(physics3dPackage.BodyManager3D).toBeDefined();
        expect(physics3dPackage.BoxCollider3D).toBeDefined();
        expect(physics3dPackage.CharacterController).toBeDefined();
        expect('PhysicsWorld2D' in physics3dPackage).toBe(false);
    });

    it('aggregates split packages and raycast surfaces in the bridge package', () => {
        expect(physicsPackage.PhysicsWorld2D).toBeDefined();
        expect(physicsPackage.PhysicsWorld3D).toBeDefined();
        expect(physicsPackage.DynamicAABBTree2D).toBeDefined();
        expect(physicsPackage.RaycastSystem3D).toBeDefined();
        expect(physicsPackage.ShapeType3D).toBeDefined();
        expect('InputSystem' in physicsPackage).toBe(false);
        expect('EventEmitter' in physicsPackage).toBe(false);
    });
});