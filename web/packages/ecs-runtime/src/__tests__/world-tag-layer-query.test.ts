import { Entity } from '@axrone/ecs-runtime/entity';
import { Component, Transform, World } from '@axrone/ecs-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

class TestComponent extends Component {
    value: number = 0;
}

describe('World tag and layer queries', () => {
    let world: World<any>;

    beforeEach(() => {
        const registry = {
            Transform,
            TestComponent,
        };
        world = new World(registry);
    });

    afterEach(() => {
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    const createEntityWithTag = (name: string, tag: string): EntityId => {
        return new Entity(world, { name, tag: tag as any });
    };

    const createEntityWithLayer = (name: string, layer: number): EntityId => {
        return new Entity(world, { name, layer: layer as any });
    };

    const createEntityWithTagAndLayer = (name: string, tag: string, layer: number): EntityId => {
        return new Entity(world, { name, tag: tag as any, layer: layer as any });
    };

    // ─── getEntitiesByTag ──────────────────────────────────────────────

    describe('getEntitiesByTag', () => {
        it('returns entities matching the given tag', () => {
            const enemy1 = createEntityWithTag('Enemy1', 'Enemy');
            const enemy2 = createEntityWithTag('Enemy2', 'Enemy');
            createEntityWithTag('Player', 'Player');

            const enemies = world.getEntitiesByTag('Enemy');
            expect(enemies).toHaveLength(2);
            expect(enemies).toContain(enemy1);
            expect(enemies).toContain(enemy2);
        });

        it('returns empty array for unknown tag', () => {
            createEntityWithTag('Entity1', 'SomeTag');
            const result = world.getEntitiesByTag('NonExistentTag');
            expect(result).toEqual([]);
        });

        it('returns empty array when no entities exist', () => {
            const result = world.getEntitiesByTag('AnyTag');
            expect(result).toEqual([]);
        });

        it('returns all entities with the Default tag when none specified', () => {
            const entity1 = new Entity(world, { name: 'Default1' });
            const entity2 = new Entity(world, { name: 'Default2' });

            const defaults = world.getEntitiesByTag('Default');
            expect(defaults).toHaveLength(2);
            expect(defaults).toContain(entity1);
            expect(defaults).toContain(entity2);
        });

        it('updates results when entity tag changes', () => {
            const entity = createEntityWithTag('Entity1', 'TagA');

            expect(world.getEntitiesByTag('TagA')).toHaveLength(1);
            expect(world.getEntitiesByTag('TagB')).toHaveLength(0);

            entity.tag = 'TagB' as any;

            expect(world.getEntitiesByTag('TagA')).toHaveLength(0);
            expect(world.getEntitiesByTag('TagB')).toHaveLength(1);
            expect(world.getEntitiesByTag('TagB')).toContain(entity);
        });

        it('updates results when entity is unregistered', () => {
            const entity = createEntityWithTag('Entity1', 'SomeTag');
            expect(world.getEntitiesByTag('SomeTag')).toHaveLength(1);

            entity.destroy();

            expect(world.getEntitiesByTag('SomeTag')).toHaveLength(0);
        });
    });

    // ─── getEntitiesByLayer ────────────────────────────────────────────

    describe('getEntitiesByLayer', () => {
        it('returns entities matching the given layer', () => {
            const bg1 = createEntityWithLayer('Background1', 0);
            const bg2 = createEntityWithLayer('Background2', 0);
            createEntityWithLayer('Foreground', 1);

            const backgrounds = world.getEntitiesByLayer(0);
            expect(backgrounds).toHaveLength(2);
            expect(backgrounds).toContain(bg1);
            expect(backgrounds).toContain(bg2);
        });

        it('returns empty array for unknown layer', () => {
            createEntityWithLayer('Entity1', 5);
            const result = world.getEntitiesByLayer(99);
            expect(result).toEqual([]);
        });

        it('returns empty array when no entities exist', () => {
            const result = world.getEntitiesByLayer(0);
            expect(result).toEqual([]);
        });

        it('returns entities on default layer 0 when none specified', () => {
            const entity1 = new Entity(world, { name: 'Layer0-1' });
            const entity2 = new Entity(world, { name: 'Layer0-2' });

            const layer0 = world.getEntitiesByLayer(0);
            expect(layer0).toHaveLength(2);
            expect(layer0).toContain(entity1);
            expect(layer0).toContain(entity2);
        });

        it('updates results when entity layer changes', () => {
            const entity = createEntityWithLayer('Entity1', 1);

            expect(world.getEntitiesByLayer(1)).toHaveLength(1);
            expect(world.getEntitiesByLayer(2)).toHaveLength(0);

            entity.layer = 2 as any;

            expect(world.getEntitiesByLayer(1)).toHaveLength(0);
            expect(world.getEntitiesByLayer(2)).toHaveLength(1);
            expect(world.getEntitiesByLayer(2)).toContain(entity);
        });

        it('updates results when entity is unregistered', () => {
            const entity = createEntityWithLayer('Entity1', 3);
            expect(world.getEntitiesByLayer(3)).toHaveLength(1);

            entity.destroy();

            expect(world.getEntitiesByLayer(3)).toHaveLength(0);
        });
    });

    // ─── Combined tag and layer queries ──────────────────────────────

    describe('combined tag and layer', () => {
        it('supports entities with different tags and layers independently', () => {
            const enemyGround = createEntityWithTagAndLayer('EnemyGround', 'Enemy', 1);
            const enemyAir = createEntityWithTagAndLayer('EnemyAir', 'Enemy', 2);
            const playerGround = createEntityWithTagAndLayer('PlayerGround', 'Player', 1);

            const enemies = world.getEntitiesByTag('Enemy');
            expect(enemies).toHaveLength(2);
            expect(enemies).toContain(enemyGround);
            expect(enemies).toContain(enemyAir);

            const groundUnits = world.getEntitiesByLayer(1);
            expect(groundUnits).toHaveLength(2);
            expect(groundUnits).toContain(enemyGround);
            expect(groundUnits).toContain(playerGround);

            const airEnemies = world.getEntitiesByTag('Enemy');
            expect(airEnemies).toHaveLength(2);
        });
    });

    // ─── WorldEntityRegistry direct tests ─────────────────────────────

    describe('WorldEntityRegistry indices', () => {
        it('clear removes all index entries', () => {
            createEntityWithTagAndLayer('Entity1', 'TagA', 1);
            createEntityWithTagAndLayer('Entity2', 'TagA', 2);

            expect(world.getEntitiesByTag('TagA')).toHaveLength(2);
            expect(world.getEntitiesByLayer(1)).toHaveLength(1);

            world.clear();

            // After clear, world is disposed, so we create a new one
            const newRegistry = { Transform, TestComponent };
            const newWorld = new World(newRegistry);

            expect(newWorld.getEntitiesByTag('TagA')).toEqual([]);
            expect(newWorld.getEntitiesByLayer(1)).toEqual([]);

            newWorld.clear();
        });

        it('handles multiple entities with same tag and layer', () => {
            const entities = [];
            for (let i = 0; i < 5; i++) {
                entities.push(createEntityWithTagAndLayer(`Entity${i}`, 'Shared', 0));
            }

            const shared = world.getEntitiesByTag('Shared');
            expect(shared).toHaveLength(5);

            const layer0 = world.getEntitiesByLayer(0);
            expect(layer0).toHaveLength(5);
        });

        it('unregistering one entity does not affect others with same tag', () => {
            const entity1 = createEntityWithTag('Entity1', 'Shared');
            const entity2 = createEntityWithTag('Entity2', 'Shared');
            const entity3 = createEntityWithTag('Entity3', 'Shared');

            expect(world.getEntitiesByTag('Shared')).toHaveLength(3);

            entity2.destroy();

            const remaining = world.getEntitiesByTag('Shared');
            expect(remaining).toHaveLength(2);
            expect(remaining).toContain(entity1);
            expect(remaining).toContain(entity3);
        });
    });
});
