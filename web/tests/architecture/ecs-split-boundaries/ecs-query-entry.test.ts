import { describe, expect, it } from 'vitest';
import * as ecsQuery from '@axrone/ecs-query';

describe('ecs-query entry', () => {
    it('surfaces query runtime primitives without leaking broader world ownership', () => {
        expect(ecsQuery.OptimizedQueryCache).toBeDefined();
        expect(ecsQuery.WorldQueryRuntime).toBeDefined();
        expect('World' in ecsQuery).toBe(false);
        expect('WorldStorageRuntime' in ecsQuery).toBe(false);
        expect('WorldEventRuntime' in ecsQuery).toBe(false);
        expect('Actor' in ecsQuery).toBe(false);
    });
});