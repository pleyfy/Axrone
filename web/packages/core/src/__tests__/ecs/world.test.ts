import { World, WorldError, EntityError, ComponentError } from '../../component-system/core/world';
import { Transform } from '../../component-system/components/transform';
import { Component } from '../../component-system/core/component';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

            const allEntities = world.getAllEntities();
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
});
