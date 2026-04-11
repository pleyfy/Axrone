import { describe, expect, it } from 'vitest';
import { Component } from '@axrone/ecs-runtime';
import { ArchetypeStore } from '@axrone/ecs-storage';

class TestComponent extends Component {}
class AnotherComponent extends Component {}

describe('ArchetypeStore', () => {
    it('reuses sorted-signature archetypes', () => {
        const store = new ArchetypeStore({
            TestComponent,
            AnotherComponent,
        });

        const first = store.getOrCreateArchetype(['TestComponent', 'AnotherComponent']);
        const second = store.getOrCreateArchetype(['AnotherComponent', 'TestComponent']);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.archetype).toBe(first.archetype);
        expect(first.archetype.signature).toEqual(['AnotherComponent', 'TestComponent']);
    });

    it('caches add and remove transitions on archetype edges', () => {
        const store = new ArchetypeStore({
            TestComponent,
            AnotherComponent,
        });

        const base = store.getOrCreateArchetype(['TestComponent']).archetype;
        const added = store.resolveAddComponentArchetype(base, 'AnotherComponent');

        expect(added.created).toBe(true);
        expect(base.edges.get('add:AnotherComponent')).toBe(added.archetype.id);
        expect(added.archetype.edges.get('remove:AnotherComponent')).toBe(base.id);

        const removed = store.resolveRemoveComponentArchetype(added.archetype, 'AnotherComponent');
        expect(removed.created).toBe(false);
        expect(removed.archetype).toBe(base);
    });
});