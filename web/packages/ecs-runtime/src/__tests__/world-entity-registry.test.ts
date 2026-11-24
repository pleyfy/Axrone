import { describe, expect, it } from 'vitest';
import { WorldEntityRegistry } from '@axrone/ecs-runtime';

describe('WorldEntityRegistry', () => {
    it('reuses cached entity snapshots until the registry structure changes', () => {
        const registry = new WorldEntityRegistry();
        const entityA = { id: 'entity-a' } as any;
        const entityB = { id: 'entity-b' } as any;

        registry.register(1 as any, entityA);
        const first = registry.getAll();
        const second = registry.getAll();

        expect(second).toBe(first);
        expect(second).toEqual([entityA]);

        registry.register(2 as any, entityB);
        const third = registry.getAll();

        expect(third).not.toBe(first);
        expect(third).toEqual([entityA, entityB]);

        registry.unregister(1 as any);
        const fourth = registry.getAll();

        expect(fourth).not.toBe(third);
        expect(fourth).toEqual([entityB]);
    });

    // ─── get ────────────────────────────────────────────────────────

    describe('get', () => {
        it('returns registered entity', () => {
            const registry = new WorldEntityRegistry();
            const entity = { name: 'TestEntity' } as any;

            registry.register(1 as any, entity);
            expect(registry.get(1 as any)).toBe(entity);
        });

        it('returns undefined for unknown entity', () => {
            const registry = new WorldEntityRegistry();
            expect(registry.get(999 as any)).toBeUndefined();
        });
    });

    // ─── unregister ─────────────────────────────────────────────────

    describe('unregister', () => {
        it('returns the removed entity', () => {
            const registry = new WorldEntityRegistry();
            const entity = { name: 'TestEntity' } as any;

            registry.register(1 as any, entity);
            const removed = registry.unregister(1 as any);

            expect(removed).toBe(entity);
            expect(registry.get(1 as any)).toBeUndefined();
        });

        it('returns undefined for non-existent entity', () => {
            const registry = new WorldEntityRegistry();
            expect(registry.unregister(999 as any)).toBeUndefined();
        });
    });

    // ─── clear ──────────────────────────────────────────────────────

    describe('clear', () => {
        it('removes all entries and invalidates cache', () => {
            const registry = new WorldEntityRegistry();
            registry.register(1 as any, { name: 'A' } as any);
            registry.register(2 as any, { name: 'B' } as any);

            // Populate cache
            const cached = registry.getAll();
            expect(cached).toHaveLength(2);

            registry.clear();

            expect(registry.size).toBe(0);
            expect(registry.getAll()).toEqual([]);
        });

        it('is a no-op on empty registry', () => {
            const registry = new WorldEntityRegistry();
            expect(() => registry.clear()).not.toThrow();
            expect(registry.size).toBe(0);
        });
    });

    // ─── size ───────────────────────────────────────────────────────

    describe('size', () => {
        it('tracks correctly through register/unregister/clear', () => {
            const registry = new WorldEntityRegistry();
            expect(registry.size).toBe(0);

            registry.register(1 as any, { name: 'A' } as any);
            expect(registry.size).toBe(1);

            registry.register(2 as any, { name: 'B' } as any);
            expect(registry.size).toBe(2);

            registry.unregister(1 as any);
            expect(registry.size).toBe(1);

            registry.clear();
            expect(registry.size).toBe(0);
        });
    });

    // ─── getAll immutability ────────────────────────────────────────

    describe('getAll immutability', () => {
        it('returned array is frozen', () => {
            const registry = new WorldEntityRegistry();
            registry.register(1 as any, { name: 'A' } as any);

            const all = registry.getAll();
            expect(Object.isFrozen(all)).toBe(true);
        });

        it('modifying returned array does not affect registry', () => {
            const registry = new WorldEntityRegistry();
            registry.register(1 as any, { name: 'A' } as any);

            const all = registry.getAll();
            // Since it's frozen, push would throw in strict mode
            expect(() => (all as any).push({ name: 'B' })).toThrow();
        });
    });
});
