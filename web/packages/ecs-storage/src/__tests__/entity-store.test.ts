import { describe, expect, it } from 'vitest';
import { EntityStore } from '@axrone/ecs-storage';

describe('EntityStore', () => {
    it('allocates entities into the configured empty archetype and recycles ids on destroy', () => {
        const store = new EntityStore();
        store.setEmptyArchetypeId('EMPTY');

        const first = store.createEntity();
        const second = store.createEntity();

        expect(first).toEqual({ entity: 1, archetypeId: 'EMPTY' });
        expect(second).toEqual({ entity: 2, archetypeId: 'EMPTY' });

        store.setEntityArchetype(first.entity, 'Position');
        expect(store.getEntityArchetypeId(first.entity)).toBe('Position');
        expect(store.destroyEntity(first.entity)).toBe('Position');
        expect(store.getAllEntities()).toEqual([second.entity]);

        const recycled = store.createEntity();
        expect(recycled).toEqual({ entity: 1, archetypeId: 'EMPTY' });
        expect(store.entityCount).toBe(2);
        expect(store.freeEntityCount).toBe(0);
        expect(store.nextEntityId).toBe(3);
    });
});