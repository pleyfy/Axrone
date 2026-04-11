import { describe, expect, it } from 'vitest';
import * as ecsRuntime from '@axrone/ecs-runtime';

describe('ecs-runtime entry', () => {
    it('surfaces the remaining ecs runtime ownership without leaking scene facades', () => {
        expect(ecsRuntime.Component).toBeDefined();
        expect(ecsRuntime.script).toBeDefined();
        expect(ecsRuntime.Actor).toBeDefined();
        expect(ecsRuntime.World).toBeDefined();
        expect(ecsRuntime.WorldEventRuntime).toBeDefined();
        expect(ecsRuntime.WorldMutationRuntime).toBeDefined();
        expect(ecsRuntime.WorldQueryExecutionRuntime).toBeDefined();
        expect(ecsRuntime.WorldActorRegistry).toBeDefined();
        expect(ecsRuntime.WorldMetricsService).toBeDefined();
        expect(ecsRuntime.SystemManager).toBeDefined();
        expect(ecsRuntime.Transform).toBeDefined();
        expect(ecsRuntime.Hierarchy).toBeDefined();
        expect(ecsRuntime.ECSObservables).toBeDefined();
        expect(ecsRuntime.Archetype).toBeDefined();
        expect(ecsRuntime.ComponentPool).toBeDefined();
        expect('Scene' in ecsRuntime).toBe(false);
        expect('Camera' in ecsRuntime).toBe(false);
        expect('createSceneRegistry' in ecsRuntime).toBe(false);
    });
});