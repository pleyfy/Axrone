import { describe, expect, it } from 'vitest';
import { Component } from '@axrone/ecs';
import { WorldStorageRuntime } from '@axrone/ecs-storage';

class TestComponent extends Component {}
class AnotherComponent extends Component {}

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
});