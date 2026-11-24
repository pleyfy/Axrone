import { describe, expect, it } from 'vitest';
import * as ecsStorage from '@axrone/ecs-runtime/storage';

describe('ecs-runtime storage subpath entry', () => {
    it('surfaces storage ownership without leaking world orchestration', () => {
        expect(ecsStorage.ComponentPool).toBeDefined();
        expect(ecsStorage.Archetype).toBeDefined();
        expect(ecsStorage.EntityStore).toBeDefined();
        expect(ecsStorage.ArchetypeStore).toBeDefined();
        expect(ecsStorage.WorldStorageRuntime).toBeDefined();
        expect('World' in ecsStorage).toBe(false);
        expect('WorldQueryRuntime' in ecsStorage).toBe(false);
        expect('WorldEventRuntime' in ecsStorage).toBe(false);
        expect('Entity' in ecsStorage).toBe(false);
    });
});
