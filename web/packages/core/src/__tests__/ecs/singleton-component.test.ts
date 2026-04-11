import { describe, it, expect, beforeEach } from 'vitest';
import { World, ComponentError } from '@axrone/ecs-runtime/world';
import { script } from '@axrone/ecs-runtime/decorators';
import { Component } from '@axrone/ecs-runtime';

@script({
    scriptName: 'GameManager',
    singleton: true,
})
class GameManager extends Component {
    score = 0;
    level = 1;

    incrementScore(points: number): void {
        this.score += points;
    }

    nextLevel(): void {
        this.level++;
    }
}

@script({
    scriptName: 'Health',
})
class Health extends Component {
    current = 100;
    max = 100;

    damage(amount: number): void {
        this.current = Math.max(0, this.current - amount);
    }
}

@script({
    scriptName: 'AudioManager',
    singleton: true,
})
class AudioManager extends Component {
    volume = 1.0;
    muted = false;

    setVolume(vol: number): void {
        this.volume = Math.max(0, Math.min(1, vol));
    }
}

type TestRegistry = {
    GameManager: typeof GameManager;
    Health: typeof Health;
    AudioManager: typeof AudioManager;
};

describe('Singleton Component Support', () => {
    let world: World<TestRegistry>;

    beforeEach(() => {
        const registry: TestRegistry = {
            GameManager,
            Health,
            AudioManager,
        };

        world = new World<TestRegistry>(registry, {
            enableMetrics: false,
            enableValidation: true,
        });
    });

    describe('Singleton Enforcement', () => {
        it('should allow adding singleton component to first entity', () => {
            const entity1 = world.createEntity();

            expect(() => {
                world.addComponent(entity1, 'GameManager', new GameManager());
            }).not.toThrow();

            expect(world.hasComponent(entity1, 'GameManager')).toBe(true);
        });

        it('should prevent adding singleton component to second entity', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            world.addComponent(entity1, 'GameManager', new GameManager());

            expect(() => {
                world.addComponent(entity2, 'GameManager', new GameManager());
            }).toThrow(ComponentError);

            expect(world.hasComponent(entity2, 'GameManager')).toBe(false);
        });

        it('should allow adding same singleton to same entity multiple times', () => {
            const entity = world.createEntity();

            world.addComponent(entity, 'GameManager', new GameManager());

            expect(() => {
                world.addComponent(entity, 'GameManager', new GameManager());
            }).not.toThrow();
        });

        it('should allow adding regular components to multiple entities', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            expect(() => {
                world.addComponent(entity1, 'Health', new Health());
                world.addComponent(entity2, 'Health', new Health());
            }).not.toThrow();

            expect(world.hasComponent(entity1, 'Health')).toBe(true);
            expect(world.hasComponent(entity2, 'Health')).toBe(true);
        });

        it('should allow different singleton components on same entity', () => {
            const entity = world.createEntity();

            expect(() => {
                world.addComponent(entity, 'GameManager', new GameManager());
                world.addComponent(entity, 'AudioManager', new AudioManager());
            }).not.toThrow();

            expect(world.hasComponent(entity, 'GameManager')).toBe(true);
            expect(world.hasComponent(entity, 'AudioManager')).toBe(true);
        });

        it('should allow different singleton components on different entities', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            expect(() => {
                world.addComponent(entity1, 'GameManager', new GameManager());
                world.addComponent(entity2, 'AudioManager', new AudioManager());
            }).not.toThrow();

            expect(world.hasComponent(entity1, 'GameManager')).toBe(true);
            expect(world.hasComponent(entity2, 'AudioManager')).toBe(true);
        });
    });

    describe('Singleton Removal', () => {
        it('should allow re-adding singleton after removal', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            world.addComponent(entity1, 'GameManager', new GameManager());
            world.removeComponent(entity1, 'GameManager');

            expect(() => {
                world.addComponent(entity2, 'GameManager', new GameManager());
            }).not.toThrow();

            expect(world.hasComponent(entity2, 'GameManager')).toBe(true);
        });

        it('should clear singleton cache when component is removed', () => {
            const entity = world.createEntity();

            world.addComponent(entity, 'GameManager', new GameManager());
            const singleton = world.getSingletonComponent('GameManager');
            expect(singleton).toBeDefined();

            world.removeComponent(entity, 'GameManager');

            expect(world.getSingletonComponent('GameManager')).toBeUndefined();
        });

        it('should allow re-adding to same entity after removal', () => {
            const entity = world.createEntity();

            world.addComponent(entity, 'GameManager', new GameManager());
            world.removeComponent(entity, 'GameManager');

            expect(() => {
                world.addComponent(entity, 'GameManager', new GameManager());
            }).not.toThrow();
        });
    });

    describe('getSingletonComponent()', () => {
        it('should retrieve singleton component regardless of entity', () => {
            const entity = world.createEntity();
            const manager = new GameManager();
            manager.score = 42;

            world.addComponent(entity, 'GameManager', manager);

            const retrieved = world.getSingletonComponent('GameManager');
            expect(retrieved).toBeDefined();
            expect(retrieved?.score).toBe(42);
        });

        it('should return undefined for non-singleton components', () => {
            const entity = world.createEntity();
            world.addComponent(entity, 'Health', new Health());

            const retrieved = world.getSingletonComponent('Health');
            expect(retrieved).toBeUndefined();
        });

        it('should return undefined when singleton not yet added', () => {
            const retrieved = world.getSingletonComponent('GameManager');
            expect(retrieved).toBeUndefined();
        });

        it('should reflect state changes in singleton component', () => {
            const entity = world.createEntity();
            world.addComponent(entity, 'GameManager', new GameManager());

            const manager = world.getSingletonComponent('GameManager');
            expect(manager?.score).toBe(0);

            manager?.incrementScore(100);

            const retrieved = world.getSingletonComponent('GameManager');
            expect(retrieved?.score).toBe(100);
        });
    });

    describe('getSingletonEntity()', () => {
        it('should return entity owning the singleton', () => {
            const entity = world.createEntity();
            world.addComponent(entity, 'GameManager', new GameManager());

            const owner = world.getSingletonEntity('GameManager');
            expect(owner).toBe(entity);
        });

        it('should return undefined for non-singleton components', () => {
            const entity = world.createEntity();
            world.addComponent(entity, 'Health', new Health());

            const owner = world.getSingletonEntity('Health');
            expect(owner).toBeUndefined();
        });

        it('should return undefined when singleton not yet added', () => {
            const owner = world.getSingletonEntity('GameManager');
            expect(owner).toBeUndefined();
        });

        it('should return updated entity after transfer', () => {
            const entity1 = world.createEntity();
            const entity2 = world.createEntity();

            world.addComponent(entity1, 'GameManager', new GameManager());
            expect(world.getSingletonEntity('GameManager')).toBe(entity1);

            world.removeComponent(entity1, 'GameManager');
            world.addComponent(entity2, 'GameManager', new GameManager());

            expect(world.getSingletonEntity('GameManager')).toBe(entity2);
        });
    });
});