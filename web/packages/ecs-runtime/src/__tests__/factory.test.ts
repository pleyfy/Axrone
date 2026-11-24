import {
    createWorld,
    createSystem,
    createEntity,
    createEntityId,
    createEntity,
    createEntityId,
    createSystemId,
    createComponentId,
    createEntityUid,
} from './factory-helpers';
import { Component } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import type {
    ComponentRegistry,
    EntityId,
    SystemId,
    ComponentId,
    EntityUid,
} from '@axrone/ecs-runtime';
import { describe, expect, it, vi } from 'vitest';

class TestComponent extends Component {
    value: number = 0;
    constructor(value: number = 0) {
        super();
        this.value = value;
    }
}

class PositionComponent extends Component {
    x: number = 0;
    y: number = 0;
    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

describe('Factory Utilities', () => {
    const registry = {
        TestComponent,
        PositionComponent,
        Transform,
    };

    describe('createWorld', () => {
        it('should create a world with given registry', () => {
            const world = createWorld(registry);

            expect(world).toBeDefined();
            expect(world.registry).toBe(registry);
        });

        it('should create multiple worlds independently', () => {
            const world1 = createWorld(registry);
            const world2 = createWorld(registry);

            expect(world1).not.toBe(world2);
            expect(world1.registry).toBe(registry);
            expect(world2.registry).toBe(registry);
        });
    });

    describe('createSystem', () => {
        it('should create a system with correct properties', () => {
            const systemId = 'TestSystem' as SystemId;
            const query = ['TestComponent'] as const;
            const execute = vi.fn();
            const priority = 100;
            const enabled = true;

            const system = createSystem(systemId, query, execute, priority, enabled);

            expect(system.id).toBe(systemId);
            expect(system.query).toBe(query);
            expect(system.execute).toBe(execute);
            expect(system.priority).toBe(priority);
            expect(system.enabled).toBe(enabled);
        });

        it('should create system with default values', () => {
            const systemId = 'TestSystem' as SystemId;
            const query = ['TestComponent'] as const;
            const execute = vi.fn();

            const system = createSystem(systemId, query, execute);

            expect(system.id).toBe(systemId);
            expect(system.query).toBe(query);
            expect(system.execute).toBe(execute);
            expect(system.priority).toBe(0);
            expect(system.enabled).toBe(true);
        });

        it('should create system with partial options', () => {
            const systemId = 'TestSystem' as SystemId;
            const query = ['TestComponent'] as const;
            const execute = vi.fn();
            const priority = 50;

            const system = createSystem(systemId, query, execute, priority);

            expect(system.priority).toBe(priority);
            expect(system.enabled).toBe(true);
        });
    });

    describe('createEntity', () => {
        it('should create an entity with given world', () => {
            const world = createWorld(registry);
            const entity = createEntity(world);

            expect(entity).toBeDefined();
            expect(entity.world).toBe(world);
        });

        it('should create an entity with name', () => {
            const world = createWorld(registry);
            const entityName = 'TestEntity';
            const entity = createEntity(world, entityName);

            expect(entity.name).toBe(entityName);
        });

        it('should create multiple entities independently', () => {
            const world = createWorld(registry);
            const entity1 = createEntity(world, 'Entity1');
            const entity2 = createEntity(world, 'Entity2');

            expect(entity1).not.toBe(entity2);
            expect(entity1.name).toBe('Entity1');
            expect(entity2.name).toBe('Entity2');
        });
    });

    describe('createEntity', () => {
        it('should create entity from number', () => {
            const entityId = 123;
            const created = createEntityId(entityId);

            expect(created).toBe(entityId);
            expect(typeof created).toBe('number');
        });

        it('should handle different entity IDs', () => {
            const entity1 = createEntityId(1);
            const entity2 = createEntityId(999);

            expect(entity1).toBe(1);
            expect(entity2).toBe(999);
            expect(entity1).not.toBe(entity2);
        });

        it('should handle zero entity ID', () => {
            const entityId = createEntityId(0);
            expect(entityId).toBe(0);
        });
    });

    describe('createSystemId', () => {
        it('should create system ID from string', () => {
            const idString = 'MySystem';
            const systemId = createSystemId(idString);

            expect(systemId).toBe(idString);
            expect(typeof systemId).toBe('string');
        });

        it('should preserve string type', () => {
            const systemId = createSystemId('TestSystem');
            expect(systemId).toBe('TestSystem');
        });

        it('should handle empty string', () => {
            const systemId = createSystemId('');
            expect(systemId).toBe('');
        });
    });

    describe('createComponentId', () => {
        it('should create component ID from string', () => {
            const idString = 'MyComponent';
            const componentId = createComponentId(idString);

            expect(componentId).toBe(idString);
            expect(typeof componentId).toBe('string');
        });

        it('should preserve string type', () => {
            const componentId = createComponentId('TestComponent');
            expect(componentId).toBe('TestComponent');
        });

        it('should handle empty string', () => {
            const componentId = createComponentId('');
            expect(componentId).toBe('');
        });
    });

    describe('createEntityUid', () => {
        it('should create entity ID from string', () => {
            const idString = 'MyEntity';
            const entityUid = createEntityUid(idString);

            expect(entityUid).toBe(idString);
            expect(typeof entityUid).toBe('string');
        });

        it('should preserve string type', () => {
            const entityUid = createEntityUid('TestEntity');
            expect(entityUid).toBe('TestEntity');
        });

        it('should handle empty string', () => {
            const entityUid = createEntityUid('');
            expect(entityUid).toBe('');
        });
    });

    describe('integration tests', () => {
        it('should work together to create a complete ECS setup', () => {
            const world = createWorld(registry);

            const entity = createEntity(world, 'TestEntity');

            const entityId = createEntityId(1);

            const systemId = createSystemId('TestSystem');
            const execute = vi.fn();
            const system = createSystem(systemId, ['TestComponent'], execute);

            expect(world).toBeDefined();
            expect(entity).toBeDefined();
            expect(entityId).toBe(1);
            expect(system.id).toBe('TestSystem');
        });

        it('should handle multiple entities and systems', () => {
            const world = createWorld(registry);

            const entities = [createEntityId(1), createEntityId(2), createEntityId(3)];

            const systems = [
                createSystem(createSystemId('System1'), ['TestComponent'], vi.fn()),
                createSystem(createSystemId('System2'), ['PositionComponent'], vi.fn()),
                createSystem(createSystemId('System3'), ['Transform'], vi.fn()),
            ];

            expect(entities).toHaveLength(3);
            expect(systems).toHaveLength(3);
            expect(systems.map((s) => s.id)).toEqual(['System1', 'System2', 'System3']);
        });
    });
});
