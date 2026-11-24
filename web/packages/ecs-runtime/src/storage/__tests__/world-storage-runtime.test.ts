import { describe, expect, it } from 'vitest';
import { Component } from '../../index';
import { WorldStorageRuntime } from '../index';

class TestComponent extends Component {
    value = 42;
}
class AnotherComponent extends Component {
    name = 'test';
}

describe('WorldStorageRuntime', () => {
    it('should cache add/remove archetype transitions on edges', () => {
        const storage = new WorldStorageRuntime({
            TestComponent,
            AnotherComponent,
        });

        const base = storage.getOrCreateArchetype(['TestComponent']).archetype;
        const added = storage.resolveAddComponentArchetype(base, 'AnotherComponent');

        expect(added.created).toBe(true);
        expect(base.edges.get('add:AnotherComponent')).toBe(added.archetype.id);
        expect(added.archetype.edges.get('remove:AnotherComponent')).toBe(base.id);

        const addedAgain = storage.resolveAddComponentArchetype(base, 'AnotherComponent');
        expect(addedAgain.created).toBe(false);
        expect(addedAgain.archetype).toBe(added.archetype);

        const removed = storage.resolveRemoveComponentArchetype(
            added.archetype,
            'AnotherComponent'
        );
        expect(removed.created).toBe(false);
        expect(removed.archetype).toBe(base);
    });

    it('should preserve sorted signatures when creating add transitions', () => {
        const storage = new WorldStorageRuntime({
            TestComponent,
            AnotherComponent,
        });

        const base = storage.getOrCreateArchetype(['TestComponent']).archetype;
        const added = storage.resolveAddComponentArchetype(base, 'AnotherComponent');

        expect(added.archetype.signature).toEqual(['AnotherComponent', 'TestComponent']);
    });

    // ─── createEntity ───────────────────────────────────────────────

    describe('createEntity', () => {
        it('creates entity in empty archetype and increments entityCount', () => {
            const storage = new WorldStorageRuntime({ TestComponent });

            expect(storage.entityCount).toBe(0);

            const entity = storage.createEntity();
            expect(entity).toBeDefined();
            expect(typeof entity).toBe('number');
            expect(storage.entityCount).toBe(1);
        });

        it('creates multiple entities with incrementing ids', () => {
            const storage = new WorldStorageRuntime({ TestComponent });

            const e1 = storage.createEntity();
            const e2 = storage.createEntity();

            expect(e2).toBe(e1 + 1);
            expect(storage.entityCount).toBe(2);
        });
    });

    // ─── createEntityWithComponents ─────────────────────────────────

    describe('createEntityWithComponents', () => {
        it('creates entity with correct archetype resolution', () => {
            const storage = new WorldStorageRuntime({
                TestComponent,
                AnotherComponent,
            });

            const result = storage.createEntityWithComponents({
                TestComponent: new TestComponent(),
            });

            expect(result.entity).toBeDefined();
            expect(result.archetypeId).toBe('TestComponent');
            expect(result.createdArchetype).toBe(true);
            expect(storage.entityCount).toBe(1);
        });

        it('places entity in correct archetype', () => {
            const storage = new WorldStorageRuntime({
                TestComponent,
                AnotherComponent,
            });

            const result = storage.createEntityWithComponents({
                TestComponent: new TestComponent(),
                AnotherComponent: new AnotherComponent(),
            });

            expect(result.archetypeId).toBe('AnotherComponent|TestComponent');
            expect(storage.getEntityArchetypeId(result.entity)).toBe(
                'AnotherComponent|TestComponent'
            );
        });

        it('reuses existing archetype on second call', () => {
            const storage = new WorldStorageRuntime({ TestComponent });

            const first = storage.createEntityWithComponents({
                TestComponent: new TestComponent(),
            });
            const second = storage.createEntityWithComponents({
                TestComponent: new TestComponent(),
            });

            expect(first.createdArchetype).toBe(true);
            expect(second.createdArchetype).toBe(false);
            expect(first.archetypeId).toBe(second.archetypeId);
        });
    });

    // ─── destroyEntity ──────────────────────────────────────────────

    describe('destroyEntity', () => {
        it('returns archetype and removed components', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            const entity = storage.createEntity();
            storage.createEntityWithComponents({ TestComponent: new TestComponent() });

            // Move entity to TestComponent archetype
            const emptyArch = storage.getArchetype('EMPTY')!;
            const targetArch = storage.getArchetype('TestComponent')!;
            targetArch.addEntity(entity, { TestComponent: new TestComponent() });
            storage.setEntityArchetype(entity, 'TestComponent');
            emptyArch.entities.length = 0; // clean up from empty

            const result = storage.destroyEntity(entity);
            expect(result).toBeDefined();
            expect(result!.archetype).toBe(targetArch);
            expect(result!.removedComponents).toHaveProperty('TestComponent');
        });

        it('returns undefined for non-existent entity', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            expect(storage.destroyEntity(999)).toBeUndefined();
        });

        it('removes entity from store', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            const entity = storage.createEntity();

            expect(storage.entityCount).toBe(1);
            storage.destroyEntity(entity);
            expect(storage.entityCount).toBe(0);
        });
    });

    // ─── getAllEntityIds ─────────────────────────────────────────────

    describe('getAllEntityIds', () => {
        it('delegates to entity store', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            const e1 = storage.createEntity();
            const e2 = storage.createEntity();

            expect(storage.getAllEntityIds()).toEqual([e1, e2]);
        });
    });

    // ─── getComponent ───────────────────────────────────────────────

    describe('getComponent', () => {
        it('retrieves component from archetype', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            const instance = new TestComponent();
            instance.value = 99;

            const result = storage.createEntityWithComponents({ TestComponent: instance });
            const component = storage.getComponent<TestComponent>(
                result.entity,
                'TestComponent'
            );

            expect(component).toBe(instance);
            expect(component!.value).toBe(99);
        });

        it('returns undefined for missing entity', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            expect(storage.getComponent(999, 'TestComponent')).toBeUndefined();
        });

        it('returns undefined for wrong component name', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            const result = storage.createEntityWithComponents({ TestComponent: new TestComponent() });

            expect(storage.getComponent(result.entity, 'NonExistent')).toBeUndefined();
        });
    });

    // ─── reset ──────────────────────────────────────────────────────

    describe('reset', () => {
        it('resets storage and re-bootstraps empty archetype', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            storage.createEntity();
            storage.createEntityWithComponents({ TestComponent: new TestComponent() });

            expect(storage.entityCount).toBe(2);
            expect(storage.archetypeCount).toBe(2);

            storage.reset();

            expect(storage.entityCount).toBe(0);
            expect(storage.archetypeCount).toBe(1); // empty archetype re-bootstrapped
            expect(storage.getArchetype('EMPTY')).toBeDefined();
        });
    });

    // ─── getDebugInfo ───────────────────────────────────────────────

    describe('getDebugInfo', () => {
        it('returns correct debug information', () => {
            const storage = new WorldStorageRuntime({ TestComponent });
            storage.createEntity();
            storage.createEntity();

            const debug = storage.getDebugInfo();

            expect(debug.freeEntityCount).toBe(0);
            expect(debug.nextEntityId).toBe(3);
            expect(debug.archetypes).toHaveLength(1);
            expect(debug.archetypes[0]!.id).toBe('EMPTY');
            expect(debug.archetypes[0]!.entityCount).toBe(2);
        });
    });

    // ─── Getters ────────────────────────────────────────────────────

    describe('getters', () => {
        it('entityCount / archetypeCount / freeEntityCount / nextEntityId accuracy', () => {
            const storage = new WorldStorageRuntime({ TestComponent });

            expect(storage.entityCount).toBe(0);
            expect(storage.archetypeCount).toBe(1); // EMPTY
            expect(storage.freeEntityCount).toBe(0);
            expect(storage.nextEntityId).toBe(1);

            const e1 = storage.createEntity();
            expect(storage.entityCount).toBe(1);
            expect(storage.nextEntityId).toBe(2);

            storage.destroyEntity(e1);
            expect(storage.entityCount).toBe(0);
            expect(storage.freeEntityCount).toBe(1);
        });
    });
});
