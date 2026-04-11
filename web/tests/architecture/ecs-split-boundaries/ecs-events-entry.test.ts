import { describe, expect, it } from 'vitest';
import * as ecsEvents from '@axrone/ecs-events';

describe('ecs-events entry', () => {
    it('surfaces ecs event primitives without leaking world storage ownership', () => {
        expect(ecsEvents.createTypedEmitter).toBeDefined();
        expect(ecsEvents.createSubject).toBeDefined();
        expect(ecsEvents.createBehaviorSubject).toBeDefined();
        expect(ecsEvents.ECSObservables).toBeDefined();
        expect(ecsEvents.WorldEventRuntime).toBeDefined();
        expect('World' in ecsEvents).toBe(false);
        expect('WorldStorageRuntime' in ecsEvents).toBe(false);
        expect('WorldQueryRuntime' in ecsEvents).toBe(false);
        expect('Actor' in ecsEvents).toBe(false);
    });
});