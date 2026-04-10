import { describe, expect, it } from 'vitest';
import * as ecs from '@axrone/ecs';

describe('ecs entry', () => {
    it('surfaces the extracted ecs runtime without leaking scene facades', () => {
        expect(ecs.Component).toBeDefined();
        expect(ecs.script).toBeDefined();
        expect(ecs.Actor).toBeDefined();
        expect(ecs.World).toBeDefined();
        expect(ecs.WorldStorageRuntime).toBeDefined();
        expect(ecs.WorldQueryRuntime).toBeDefined();
        expect(ecs.WorldEventRuntime).toBeDefined();
        expect(ecs.WorldMutationRuntime).toBeDefined();
        expect(ecs.WorldActorRegistry).toBeDefined();
        expect(ecs.WorldDiagnostics).toBeDefined();
        expect(ecs.WorldMetricsService).toBeDefined();
        expect(ecs.WorldQueryExecutionRuntime).toBeDefined();
        expect(ecs.WorldSingletonRegistry).toBeDefined();
        expect(ecs.SystemManager).toBeDefined();
        expect(ecs.SystemPhase).toBeDefined();
        expect(ecs.Transform).toBeDefined();
        expect(ecs.Hierarchy).toBeDefined();
        expect(ecs.ECSObservables).toBeDefined();
        expect(ecs.Archetype).toBeDefined();
        expect(ecs.OptimizedQueryCache).toBeDefined();
        expect('Scene' in ecs).toBe(false);
        expect('Camera' in ecs).toBe(false);
        expect('createSceneRegistry' in ecs).toBe(false);
    });
});
