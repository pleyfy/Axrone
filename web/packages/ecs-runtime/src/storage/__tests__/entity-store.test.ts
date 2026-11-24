import { describe, expect, it } from 'vitest';
import { EntityStore } from '../index';

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
        expect(store.getAllEntityIds()).toEqual([second.entity]);

        const recycled = store.createEntity();
        expect(recycled).toEqual({ entity: 1, archetypeId: 'EMPTY' });
        expect(store.entityCount).toBe(2);
        expect(store.freeEntityCount).toBe(0);
        expect(store.nextEntityId).toBe(3);
    });

    // ─── Error cases ────────────────────────────────────────────────

    describe('error cases', () => {
        it('throws when creating entity without empty archetype configured', () => {
            const store = new EntityStore();
            expect(() => store.createEntity()).toThrow('Empty archetype not configured');
        });

        it('returns undefined when destroying non-existent entity', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');
            expect(store.destroyEntity(999)).toBeUndefined();
        });
    });

    // ─── getAllEntityIds ─────────────────────────────────────────────

    describe('getAllEntityIds', () => {
        it('returns all live entities', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');

            const e1 = store.createEntity();
            const e2 = store.createEntity();
            const e3 = store.createEntity();

            expect(store.getAllEntityIds()).toEqual([e1.entity, e2.entity, e3.entity]);

            store.destroyEntity(e2.entity);
            expect(store.getAllEntityIds()).toEqual([e1.entity, e3.entity]);
        });

        it('returns empty array when no entities exist', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');
            expect(store.getAllEntityIds()).toEqual([]);
        });
    });

    // ─── setEntityArchetype / getEntityArchetypeId ──────────────────

    describe('setEntityArchetype / getEntityArchetypeId', () => {
        it('set/get round-trip works correctly', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');

            const { entity } = store.createEntity();
            store.setEntityArchetype(entity, 'NewArchetype');

            expect(store.getEntityArchetypeId(entity)).toBe('NewArchetype');
        });

        it('returns undefined for non-existent entity', () => {
            const store = new EntityStore();
            expect(store.getEntityArchetypeId(999)).toBeUndefined();
        });
    });

    // ─── reset ──────────────────────────────────────────────────────

    describe('reset', () => {
        it('clears all state and resets counters', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');

            const e1 = store.createEntity();
            const e2 = store.createEntity();
            store.destroyEntity(e1.entity);

            expect(store.entityCount).toBe(1);
            expect(store.freeEntityCount).toBe(1);
            expect(store.nextEntityId).toBe(3);

            store.reset();

            expect(store.entityCount).toBe(0);
            expect(store.freeEntityCount).toBe(0);
            expect(store.nextEntityId).toBe(1);
            expect(store.getAllEntityIds()).toEqual([]);
        });

        it('requires setEmptyArchetypeId after reset before creating entities', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');
            store.createEntity();

            store.reset();

            expect(() => store.createEntity()).toThrow('Empty archetype not configured');
        });
    });

    // ─── Getter accuracy ────────────────────────────────────────────

    describe('getter accuracy through lifecycle', () => {
        it('tracks entityCount, freeEntityCount, nextEntityId correctly', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');

            expect(store.entityCount).toBe(0);
            expect(store.freeEntityCount).toBe(0);
            expect(store.nextEntityId).toBe(1);

            const e1 = store.createEntity();
            expect(store.entityCount).toBe(1);
            expect(store.nextEntityId).toBe(2);

            const e2 = store.createEntity();
            expect(store.entityCount).toBe(2);
            expect(store.nextEntityId).toBe(3);

            store.destroyEntity(e1.entity);
            expect(store.entityCount).toBe(1);
            expect(store.freeEntityCount).toBe(1);
            expect(store.nextEntityId).toBe(3); // doesn't decrease

            // Recycled entity doesn't increment nextEntityId
            const recycled = store.createEntity();
            expect(recycled.entity).toBe(e1.entity);
            expect(store.entityCount).toBe(2);
            expect(store.freeEntityCount).toBe(0);
            expect(store.nextEntityId).toBe(3);
        });
    });

    // ─── Multiple recycle cycles ────────────────────────────────────

    describe('multiple recycle cycles', () => {
        it('correctly recycles through create->destroy->create->destroy->create', () => {
            const store = new EntityStore();
            store.setEmptyArchetypeId('EMPTY');

            // First cycle
            const e1 = store.createEntity();
            expect(e1.entity).toBe(1);
            store.destroyEntity(e1.entity);

            // Second cycle - should reuse entity 1
            const e2 = store.createEntity();
            expect(e2.entity).toBe(1);
            store.destroyEntity(e2.entity);

            // Third cycle - should still reuse entity 1
            const e3 = store.createEntity();
            expect(e3.entity).toBe(1);

            expect(store.entityCount).toBe(1);
            expect(store.freeEntityCount).toBe(0);
            expect(store.nextEntityId).toBe(2); // never incremented past 2
        });
    });
});
