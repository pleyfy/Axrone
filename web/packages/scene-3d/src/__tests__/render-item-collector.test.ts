import { describe, expect, it } from 'vitest';
import { Entity } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { MeshRenderer } from '@axrone/scene-3d';
import { SceneRenderItemCollector } from '@axrone/scene-3d';

describe('SceneRenderItemCollector', () => {
    it('filters entities by pass and renderability and sorts by render order', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneRenderItemCollector();

        const entityA = new Entity(world);
        entityA.addComponent(MeshRenderer, { passId: 'main', renderOrder: 10 });

        const entityB = new Entity(world);
        entityB.addComponent(MeshRenderer, { passId: 'overlay', renderOrder: 0 });

        const entityC = new Entity(world);
        entityC.addComponent(MeshRenderer, { passId: 'main', renderOrder: 1 });

        const items = collector.collect(world.getAllEntities(), 'main');

        expect(items).toHaveLength(2);
        expect(items.map((item) => item.renderer.renderOrder)).toEqual([1, 10]);
    });

    it('reuses the backing array and pooled item objects across frames', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneRenderItemCollector();

        const entity = new Entity(world);
        entity.addComponent(MeshRenderer, { passId: 'main', renderOrder: 0 });

        const first = collector.collect(world.getAllEntities(), 'main');
        const firstItem = first[0];
        const second = collector.collect(world.getAllEntities(), 'main');
        const secondItem = second[0];

        expect(second).toBe(first);
        expect(secondItem).toBe(firstItem);
    });
});
