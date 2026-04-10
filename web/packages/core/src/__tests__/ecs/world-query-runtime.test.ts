import { describe, expect, it } from 'vitest';
import { OptimizedQueryCache } from '@axrone/ecs';
import { WorldQueryRuntime } from '@axrone/ecs';

describe('WorldQueryRuntime', () => {
    it('reuses cached archetype matches for repeated single-component queries', () => {
        const cache = new OptimizedQueryCache();
        const runtime = new WorldQueryRuntime({
            cache,
            getArchetypes: () =>
                [
                    { id: 'Transform', mask: 0b001n },
                    { id: 'Transform|Mesh', mask: 0b011n },
                    { id: 'Camera', mask: 0b100n },
                ] as any,
            createBitMask: (components) => (components[0] === 'Transform' ? 0b001n : 0b100n),
        });

        const first = runtime.resolveMatchingArchetypes(['Transform']);
        const second = runtime.resolveMatchingArchetypes(['Transform']);

        expect(first).toBe(second);
        expect(first).toEqual(['Transform', 'Transform|Mesh']);
    });

    it('normalizes multi-component query keys so cache hits survive argument order changes', () => {
        const cache = new OptimizedQueryCache();
        const runtime = new WorldQueryRuntime({
            cache,
            getArchetypes: () => [{ id: 'A|B', mask: 0b011n }] as any,
            createBitMask: () => 0b011n,
        });

        const first = runtime.resolveMatchingArchetypes(['B', 'A']);
        const second = runtime.resolveMatchingArchetypes(['A', 'B']);

        expect(first).toBe(second);
        expect(first).toEqual(['A|B']);
    });
});
