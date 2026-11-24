import { World, WorldError, EntityError, ComponentError } from '@axrone/ecs-runtime/world';
import { Component, script, Transform } from '@axrone/ecs-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SingletonComponent from './components/SingletonComponent';
import DynamicSingletonComponent from './components/DynamicSingletonComponent';

const flushBehaviorSubject = () => new Promise((resolve) => setTimeout(resolve, 0));

class TestComponent extends Component {
    value: number = 0;

    constructor(value: number = 0) {
        super();
        this.value = value;
    }
}

class AnotherComponent extends Component {
    name: string = '';

    constructor(name: string = '') {
        super();
        this.name = name;
    }
}

describe('World', () => {
    let world: World<any>;
    let registry: any;

    beforeEach(() => {
        registry = {
            Transform: Transform,
            TestComponent: TestComponent,
            AnotherComponent: AnotherComponent,
            SingletonComponent: SingletonComponent,
        };
        world = new World(registry);
    });

    afterEach(() => {
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    describe('constructor', () => {
        it('should create world with valid registry', () => {
            expect(world).toBeDefined();
            expect(world.state).toBe('ready');
            expect(world.isReady).toBe(true);
            expect(world.isDisposed).toBe(false);
        });

        it('should throw error with invalid registry', () => {
            expect(() => new World(null as any)).toThrow(WorldError);
            expect(() => new World(undefined as any)).toThrow(WorldError);
        });

        it('should apply configuration correctly', () => {
            const config = {
                maxEntities: 500,
                enableMetrics: true,
                enableValidation: false,
            };
            const configuredWorld = new World(registry, config);
            expect(configuredWorld.state).toBe('ready');
            configuredWorld.clear();
        });
    });

    describe('entity management', () => {
        it('should create entity', () => {
            const entity = world.createEntity();
            expect(entity).toBeDefined();
            expect(typeof entity).toBe('number');
            expect(world.getEntityCount()).toBe(1);
        });

        it('should create multiple entities', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();
            const entity3 = world.createEntity();

            expect(entity1).not.toBe(entity2);
            expect(entity2).not.toBe(entity3);
            expect(world.getEntityCount()).toBe(3);
        });

        it('should destroy entity', () => {
            const entity = world.createEntity();
            expect(world.getEntityCount()).toBe(1);

            world.destroyEntity(entity);
            expect(world.getEntityCount()).toBe(0);
        });

        it('should handle destroying non-existent entity', () => {
            expect(() => world.destroyEntity(999 as any)).not.toThrow();
        });

        it('should reuse destroyed entity ids', () => {
            const entity1 = world.createEntity();
            world.destroyEntity(entity1);

            const entity2 = world.createEntity();
            expect(entity2).toBe(entity1);
        });

        it('should throw error when max entities reached', () => {
            const smallWorld = new World(registry, { maxEntities: 2 });

            smallWorld.createEntity();
            smallWorld.createEntity();

            expect(() => smallWorld.createEntity()).toThrow(WorldError);
            smallWorld.clear();
        });
    });

    describe('component management', () => {
        let entity: any;

        beforeEach(() => {
            entity = world.createEntity();
        });

        it('should add component to entity', () => {
            const component = world.addComponent(entity, 'TestComponent');

            expect(component).toBeDefined();
            expect(component).toBeInstanceOf(TestComponent);
            expect(world.hasComponent(entity, 'TestComponent')).toBe(true);
        });

        it('should add component with initial data', () => {
            const testComponent = new TestComponent(42);
            const component = world.addComponent(
                entity,
                'TestComponent',
                testComponent
            ) as TestComponent;

            expect(component.value).toBe(42);
        });

        it('should get component from entity', () => {
            world.addComponent(entity, 'TestComponent');
            const component = world.getComponent(entity, 'TestComponent') as TestComponent;

            expect(component).toBeDefined();
            expect(component).toBeInstanceOf(TestComponent);
        });

        it('should return undefined for non-existent component', () => {
            const component = world.getComponent(entity, 'TestComponent');
            expect(component).toBeUndefined();
        });

        it('should check if entity has component', () => {
            expect(world.hasComponent(entity, 'TestComponent')).toBe(false);

            world.addComponent(entity, 'TestComponent');
            expect(world.hasComponent(entity, 'TestComponent')).toBe(true);
        });

        it('should remove component from entity', () => {
            world.addComponent(entity, 'TestComponent');
            expect(world.hasComponent(entity, 'TestComponent')).toBe(true);

            world.removeComponent(entity, 'TestComponent');
            expect(world.hasComponent(entity, 'TestComponent')).toBe(false);
        });

        it('should handle removing non-existent component', () => {
            expect(() => world.removeComponent(entity, 'TestComponent')).not.toThrow();
        });

        it('should add multiple components to entity', () => {
            world.addComponent(entity, 'TestComponent');
            world.addComponent(entity, 'AnotherComponent');

            expect(world.hasComponent(entity, 'TestComponent')).toBe(true);
            expect(world.hasComponent(entity, 'AnotherComponent')).toBe(true);
        });

        it('should throw error for invalid component name', () => {
            expect(() => world.addComponent(entity, 'NonExistentComponent' as any)).toThrow(
                WorldError
            );
        });

        it('should throw error for invalid entity', () => {
            expect(() => world.addComponent(999 as any, 'TestComponent')).toThrow(ComponentError);
        });

        it('should enforce singleton components across entities', () => {
            const otherEntity = world.createEntity();

            const singleton = world.addComponent(entity, 'SingletonComponent');

            expect(singleton).toBeInstanceOf(SingletonComponent);
            expect(() => world.addComponent(otherEntity, 'SingletonComponent')).toThrow(
                ComponentError
            );
        });

        it('should expose singleton instances and owner entities', () => {
            const singleton = world.addComponent(entity, 'SingletonComponent');

            expect(world.getSingletonComponent('SingletonComponent')).toBe(singleton);
            expect(world.getSingletonEntity('SingletonComponent')).toBe(entity);
        });

        it('should clear singleton ownership when the component is removed', () => {
            world.addComponent(entity, 'SingletonComponent');

            world.removeComponent(entity, 'SingletonComponent');

            expect(world.getSingletonComponent('SingletonComponent')).toBeUndefined();
            expect(world.getSingletonEntity('SingletonComponent')).toBeUndefined();
        });

        it('should clear singleton ownership when the entity is destroyed', () => {
            world.addComponent(entity, 'SingletonComponent');

            world.destroyEntity(entity);

            expect(world.getSingletonComponent('SingletonComponent')).toBeUndefined();
            expect(world.getSingletonEntity('SingletonComponent')).toBeUndefined();
        });

        it('should respect singleton metadata for dynamically registered component types', () => {
            const otherEntity = world.createEntity();

            world.registerComponentType(DynamicSingletonComponent);
            world.addComponent(entity, 'DynamicSingletonComponent' as any);

            expect(() =>
                world.addComponent(otherEntity, 'DynamicSingletonComponent' as any)
            ).toThrow(ComponentError);
        });
    });

    describe('querying', () => {
        let entity1: any, entity2: any, entity3: any;

        beforeEach(() => {
            entity1 = world.createEntity();
            entity2 = world.createEntity();
            entity3 = world.createEntity();
        });

        it('should query entities with single component', () => {
            world.addComponent(entity1, 'TestComponent');
            world.addComponent(entity2, 'TestComponent');

            const results = world.query('TestComponent');

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.entity)).toContain(entity1);
            expect(results.map((r) => r.entity)).toContain(entity2);
        });

        it('should query entities with multiple components', () => {
            world.addComponent(entity1, 'TestComponent');
            world.addComponent(entity1, 'AnotherComponent');

            world.addComponent(entity2, 'TestComponent');

            world.addComponent(entity3, 'AnotherComponent');

            const results = world.query('TestComponent', 'AnotherComponent');

            expect(results).toHaveLength(1);
            expect(results[0].entity).toBe(entity1);
            expect(results[0].components.TestComponent).toBeInstanceOf(TestComponent);
            expect(results[0].components.AnotherComponent).toBeInstanceOf(AnotherComponent);
        });

        it('should return empty array for no matches', () => {
            const results = world.query('TestComponent');
            expect(results).toHaveLength(0);
        });

        it('should throw error for empty query', () => {
            expect(() => world.query()).toThrow(WorldError);
        });

        it('should handle query with non-existent component', () => {
            expect(() => world.query('NonExistentComponent' as any)).not.toThrow();
            const results = world.query('NonExistentComponent' as any);
            expect(results).toHaveLength(0);
        });

        it('should keep query results correct when reusing existing archetypes', () => {
            const entity = world.createEntity();

            world.addComponent(entity, 'TestComponent');
            expect(world.query('TestComponent')).toHaveLength(1);

            world.removeComponent(entity, 'TestComponent');
            expect(world.query('TestComponent')).toHaveLength(0);

            world.addComponent(entity, 'TestComponent');

            const results = world.query('TestComponent');
            expect(results).toHaveLength(1);
            expect(results[0].entity).toBe(entity);
        });
    });

    describe('state management', () => {
        it('should validate world state for operations', () => {
            world.clear();

            expect(() => world.createEntity()).toThrow(WorldError);
            expect(() => world.query('TestComponent')).toThrow(WorldError);
        });

        it('should get all entities', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            const allEntities = world.getAllEntityIds();
            expect(allEntities).toHaveLength(2);
            expect(allEntities).toContain(entity1);
            expect(allEntities).toContain(entity2);
        });

        it('should get entity count', () => {
            expect(world.getEntityCount()).toBe(0);

            world.createEntity();
            expect(world.getEntityCount()).toBe(1);

            world.createEntity();
            expect(world.getEntityCount()).toBe(2);
        });

        it('should get archetype count', () => {
            const initialCount = world.getArchetypeCount();

            const entity = world.createEntity();
            world.addComponent(entity, 'TestComponent');

            expect(world.getArchetypeCount()).toBeGreaterThan(initialCount);
        });
    });

    describe('metrics', () => {
        it('should return null metrics when disabled', () => {
            expect(world.metrics).toBeNull();
        });

        it('should return metrics when enabled', () => {
            const metricsWorld = new World(registry, { enableMetrics: true });
            const metrics = metricsWorld.metrics;

            expect(metrics).toBeDefined();
            expect(metrics).toHaveProperty('entityCount');
            expect(metrics).toHaveProperty('archetypeCount');
            expect(metrics).toHaveProperty('queryCount');

            metricsWorld.clear();
        });
    });

    describe('events', () => {
        it('should publish lifecycle events through the world event runtime', () => {
            const entityId = world.createEntity();
            const entity = { name: 'Entity', tag: 'Default', layer: 0 } as any;
            const seen: number[] = [];

            const unsubscribe = world.on('EntityCreated', ({ entityId: createdId, entity: createdEntity }) => {
                seen.push(createdId);
                expect(createdEntity).toBe(entity);
            });

            world.registerEntity(entityId, entity);

            expect(seen).toEqual([entityId]);

            unsubscribe();
        });

        it('should update reactive queries when component membership changes', async () => {
            const entity = world.createEntity();
            world.registerEntity(entity, { name: 'Reactive', tag: 'Default', layer: 0 } as any);

            const query = world.createReactiveQuery('TestComponent');
            const counts: number[] = [];
            const unsubscribe = query.addObserver((results) => {
                counts.push(results.length);
            });

            await flushBehaviorSubject();

            world.addComponent(entity, 'TestComponent');
            await flushBehaviorSubject();

            world.removeComponent(entity, 'TestComponent');
            await flushBehaviorSubject();

            unsubscribe();

            expect(counts).toContain(0);
            expect(counts).toContain(1);
            expect(counts[counts.length - 1]).toBe(0);
        });
    });

    describe('cleanup', () => {
        it('should clear all entities and components', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            world.addComponent(entity1, 'TestComponent');
            world.addComponent(entity2, 'AnotherComponent');

            expect(world.getEntityCount()).toBe(2);

            world.clear();

            expect(world.isDisposed).toBe(true);
            expect(world.getEntityCount()).toBe(0);
        });

        it('should handle multiple clear calls', () => {
            world.clear();
            expect(() => world.clear()).not.toThrow();
        });
    });

    // ─── createEntityWithComponents ─────────────────────────────────

    describe('createEntityWithComponents', () => {
        it('creates entity with initial components', () => {
            const entity = world.createEntityWithComponents({
                TestComponent: new TestComponent(42),
            });

            expect(entity).toBeDefined();
            expect(world.hasComponent(entity, 'TestComponent')).toBe(true);
            expect((world.getComponent(entity, 'TestComponent') as TestComponent).value).toBe(42);
        });

        it('validates component names', () => {
            expect(() =>
                world.createEntityWithComponents({ NonExistent: {} } as any)
            ).toThrow(WorldError);
        });
    });

    // ─── batchStructureChanges ──────────────────────────────────────

    describe('batchStructureChanges', () => {
        it('defers cache invalidation until batch completes', () => {
            const result = world.batchStructureChanges(() => {
                const entity = world.createEntity();
                world.addComponent(entity, 'TestComponent');
                return entity;
            });

            expect(result).toBeDefined();
            // Query should work after batch completes
            expect(world.query('TestComponent')).toHaveLength(1);
        });

        it('handles nested batches', () => {
            world.batchStructureChanges(() => {
                world.batchStructureChanges(() => {
                    const entity = world.createEntity();
                    world.addComponent(entity, 'TestComponent');
                });
                // Inner batch shouldn't have invalidated yet
            });

            // Outer batch completion invalidates
            expect(world.query('TestComponent')).toHaveLength(1);
        });

        it('returns the callback result', () => {
            const result = world.batchStructureChanges(() => 42);
            expect(result).toBe(42);
        });
    });

    // ─── Entity registry ─────────────────────────────────────────────

    describe('entity registry', () => {
        it('registerEntity throws EntityError for null entity', () => {
            const entity = world.createEntity();
            expect(() => world.registerEntity(entity, null as any)).toThrow(EntityError);
        });

        it('getEntity returns registered entity', () => {
            const entity = world.createEntity();
            const mockEntity = { name: 'Test' } as any;
            world.registerEntity(entity, mockEntity);

            expect(world.getEntity(entity)).toBe(mockEntity);
        });

        it('getEntity returns undefined for unknown entity', () => {
            expect(world.getEntity(999 as any)).toBeUndefined();
        });

        it('getAllEntityIds returns all registered entities', () => {
            const e1 = world.createEntity();
            const e2 = world.createEntity();
            const a1 = { name: 'A1' } as any;
            const a2 = { name: 'A2' } as any;

            world.registerEntity(e1, a1);
            world.registerEntity(e2, a2);

            const all = world.getAllEntities();
            expect(all).toHaveLength(2);
            expect(all).toContain(a1);
            expect(all).toContain(a2);
        });

        it('unregisterEntity on disposed world is a no-op', () => {
            const entity = world.createEntity();
            world.clear();

            expect(() => world.unregisterEntity(entity)).not.toThrow();
        });
    });

    // ─── registerComponentType ──────────────────────────────────────

    describe('registerComponentType', () => {
        it('dynamically registers a new component type', () => {
            class NewComp extends Component {}
            world.registerComponentType(NewComp);

            expect(world.isComponentRegistered('NewComp')).toBe(true);
        });

        it('is idempotent for same constructor', () => {
            class IdemComp extends Component {}
            world.registerComponentType(IdemComp);
            expect(() => world.registerComponentType(IdemComp)).not.toThrow();
        });

        it('throws for different constructor with same name', () => {
            class DupComp extends Component {}
            world.registerComponentType(DupComp);

            class DupComp2 extends Component {}
            Object.defineProperty(DupComp2, 'name', { value: 'DupComp' });

            expect(() => world.registerComponentType(DupComp2)).toThrow(WorldError);
        });

        it('throws for anonymous constructor', () => {
            const Anon = class extends Component {};
            Object.defineProperty(Anon, 'name', { value: '' });

            expect(() => world.registerComponentType(Anon as any)).toThrow(WorldError);
        });
    });

    // ─── isComponentRegistered / getRegisteredComponentNames ────────

    describe('component registration queries', () => {
        it('isComponentRegistered by string name', () => {
            expect(world.isComponentRegistered('TestComponent')).toBe(true);
            expect(world.isComponentRegistered('NonExistent')).toBe(false);
        });

        it('isComponentRegistered by constructor', () => {
            expect(world.isComponentRegistered(TestComponent)).toBe(true);
        });

        it('getRegisteredComponentNames returns current registry keys', () => {
            const names = world.getRegisteredComponentNames();
            expect(names).toContain('Transform');
            expect(names).toContain('TestComponent');
            expect(names).toContain('AnotherComponent');
        });
    });

    // ─── Event system extensions ────────────────────────────────────

    describe('event system extensions', () => {
        it('once fires handler exactly once', () => {
            const handler = vi.fn();
            world.once('EntityCreated' as any, handler);

            const entityId = world.createEntity();
            const entity = { name: 'OnceEntity' } as any;
            world.registerEntity(entityId, entity);

            expect(handler).toHaveBeenCalledTimes(1);

            // Second registration should not trigger handler
            const entity2 = world.createEntity();
            world.registerEntity(entity2, { name: 'Another' } as any);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('emitSync returns boolean', () => {
            const result = world.emitSync('EntityCreated' as any, { entityId: 0, entity: null });
            expect(typeof result).toBe('boolean');
        });

        it('off unsubscribes from events', () => {
            const handler = vi.fn();
            world.on('EntityCreated' as any, handler);

            const entity = world.createEntity();
            world.registerEntity(entity, { name: 'A' } as any);
            expect(handler).toHaveBeenCalledTimes(1);

            world.off('EntityCreated' as any, handler);

            const entity2 = world.createEntity();
            world.registerEntity(entity2, { name: 'B' } as any);
            expect(handler).toHaveBeenCalledTimes(1); // not called again
        });

        it('pauseEvents / resumeEvents / drainEvents do not throw', () => {
            expect(() => world.pauseEvents()).not.toThrow();
            expect(() => world.resumeEvents()).not.toThrow();
            expect(() => world.drainEvents()).not.toThrow();
        });

        it('getEventMetrics returns metrics for an event', () => {
            const metrics = world.getEventMetrics('EntityCreated' as any);
            // May be undefined or an object - just verify it doesn't throw
            expect(metrics === undefined || typeof metrics === 'object').toBe(true);
        });

        it('getAllEventMetrics returns an object', () => {
            const metrics = world.getAllEventMetrics();
            expect(typeof metrics).toBe('object');
        });
    });

    // ─── Observables ────────────────────────────────────────────────

    describe('observables', () => {
        it('getObservables returns ECSObservables instance', () => {
            const observables = world.getObservables();
            expect(observables).toBeDefined();
        });

        it('observeEntityLifecycle returns an observable', () => {
            const observable = world.observeEntityLifecycle();
            expect(observable).toBeDefined();
            expect(observable.all).toBeDefined();
        });

        it('observeComponent returns an observable for a component', () => {
            const observable = world.observeComponent('TestComponent');
            expect(observable).toBeDefined();
            expect(observable.added).toBeDefined();
            expect(observable.removed).toBeDefined();
        });
    });

    // ─── getDebugInfo / toString ────────────────────────────────────

    describe('debug and string output', () => {
        it('getDebugInfo returns complete debug snapshot', () => {
            world.createEntity();
            const debug = world.getDebugInfo();

            expect(debug).toHaveProperty('state', 'ready');
            expect(debug).toHaveProperty('entityCount', 1);
            expect(debug).toHaveProperty('archetypeCount');
            expect(debug).toHaveProperty('componentTypes');
            expect(debug).toHaveProperty('creationTime');
            expect(debug).toHaveProperty('config');
            expect(debug).toHaveProperty('archetypes');
            expect(debug).toHaveProperty('queryCache');
        });

        it('toString returns correct format', () => {
            world.createEntity();
            const str = world.toString();

            expect(str).toContain('World');
            expect(str).toContain('ready');
            expect(str).toContain('Entities: 1');
        });
    });

    // ─── Validation disabled ────────────────────────────────────────

    describe('validation disabled', () => {
        it('getComponent skips validation when enableValidation: false', () => {
            const noValidationWorld = new World(registry, { enableValidation: false });

            // Should not throw even with invalid entity
            const result = noValidationWorld.getComponent(999 as any, 'TestComponent');
            expect(result).toBeUndefined();

            noValidationWorld.clear();
        });
    });
});