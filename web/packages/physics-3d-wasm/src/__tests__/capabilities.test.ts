import { describe, expect, it } from 'vitest';
import { WASM_PHYSICS_CAPABILITIES } from '../index';

describe('WASM physics capabilities', () => {
    it('reports the supported rigid-body subset', () => {
        expect(WASM_PHYSICS_CAPABILITIES.backend).toBe('wasm');
        expect(WASM_PHYSICS_CAPABILITIES.bodyTypes.static).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.bodyTypes.dynamic).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.bodyTypes.kinematic).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.box).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.sphere).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.capsule).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.cylinder).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.cone).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.multiShape).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapeOffsets).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.constraints).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.queries).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.raycast).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.overlapBox).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.queryPoint).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.sleeping).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.contactEvents).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.characterController).toBe(true);
        expect(Object.isFrozen(WASM_PHYSICS_CAPABILITIES)).toBe(true);
        expect(Object.isFrozen(WASM_PHYSICS_CAPABILITIES.bodyTypes)).toBe(true);
        expect(Object.isFrozen(WASM_PHYSICS_CAPABILITIES.shapes)).toBe(true);
    });
});
