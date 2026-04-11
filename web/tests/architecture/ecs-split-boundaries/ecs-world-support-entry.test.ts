import { describe, expect, it } from 'vitest';
import * as ecsWorldSupport from '@axrone/ecs-world-support';

describe('ecs-world-support entry', () => {
    it('surfaces world support ownership without leaking world orchestration', () => {
        expect(ecsWorldSupport.ActorRegistry).toBeDefined();
        expect(ecsWorldSupport.SingletonRegistry).toBeDefined();
        expect(ecsWorldSupport.WorldMetricsService).toBeDefined();
        expect(ecsWorldSupport.WorldDiagnostics).toBeDefined();
        expect('World' in ecsWorldSupport).toBe(false);
        expect('WorldMutationRuntime' in ecsWorldSupport).toBe(false);
        expect('WorldQueryExecutionRuntime' in ecsWorldSupport).toBe(false);
        expect('Actor' in ecsWorldSupport).toBe(false);
    });
});