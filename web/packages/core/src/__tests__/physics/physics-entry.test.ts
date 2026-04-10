import { describe, expect, it } from 'vitest';
import * as physicsPackage from '@axrone/physics';

describe('physics entry', () => {
    it('surfaces 2d, 3d, and raycast primitives from the dedicated package', () => {
        expect(physicsPackage.PhysicsWorld2D).toBeDefined();
        expect(physicsPackage.PhysicsWorld3D).toBeDefined();
        expect(physicsPackage.BodyManager2D).toBeDefined();
        expect(physicsPackage.BodyManager3D).toBeDefined();
        expect(physicsPackage.DynamicAABBTree2D).toBeDefined();
        expect(physicsPackage.RaycastSystem3D).toBeDefined();
        expect('InputSystem' in physicsPackage).toBe(false);
        expect('EventEmitter' in physicsPackage).toBe(false);
    });
});