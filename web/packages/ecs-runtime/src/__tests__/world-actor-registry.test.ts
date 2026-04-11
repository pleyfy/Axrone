import { describe, expect, it } from 'vitest';
import { WorldActorRegistry } from '@axrone/ecs-runtime';

describe('WorldActorRegistry', () => {
    it('reuses cached actor snapshots until the registry structure changes', () => {
        const registry = new WorldActorRegistry();
        const actorA = { id: 'actor-a' } as any;
        const actorB = { id: 'actor-b' } as any;

        registry.register(1 as any, actorA);
        const first = registry.getAll();
        const second = registry.getAll();

        expect(second).toBe(first);
        expect(second).toEqual([actorA]);

        registry.register(2 as any, actorB);
        const third = registry.getAll();

        expect(third).not.toBe(first);
        expect(third).toEqual([actorA, actorB]);

        registry.unregister(1 as any);
        const fourth = registry.getAll();

        expect(fourth).not.toBe(third);
        expect(fourth).toEqual([actorB]);
    });
});
