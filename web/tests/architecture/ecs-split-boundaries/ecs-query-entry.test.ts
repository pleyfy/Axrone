import { describe, expect, it } from 'vitest';
import * as ecsQuery from '@axrone/ecs-runtime/query';

describe('ecs-runtime query subpath entry', () => {
    it('surfaces query runtime primitives without leaking broader world ownership', () => {
        expect(ecsQuery.OptimizedQueryCache).toBeDefined();
        expect(ecsQuery.WorldQueryRuntime).toBeDefined();
        expect('World' in ecsQuery).toBe(false);
        expect('WorldStorageRuntime' in ecsQuery).toBe(false);
        expect('WorldEventRuntime' in ecsQuery).toBe(false);
        expect('Entity' in ecsQuery).toBe(false);
    });
});
