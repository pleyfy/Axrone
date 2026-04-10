import { describe, expect, it } from 'vitest';
import { Actor } from '@axrone/ecs';
import { World } from '@axrone/ecs';
import { createSceneRegistry } from '@axrone/scene-3d';
import { MeshRenderer } from '@axrone/scene-3d';
import { SceneRenderItemCollector } from '@axrone/scene-3d';

describe('SceneRenderItemCollector', () => {
    it('filters actors by pass and renderability and sorts by render order', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneRenderItemCollector();

        const actorA = new Actor(world);
        actorA.addComponent(MeshRenderer, { passId: 'main', renderOrder: 10 });

        const actorB = new Actor(world);
        actorB.addComponent(MeshRenderer, { passId: 'overlay', renderOrder: 0 });

        const actorC = new Actor(world);
        actorC.addComponent(MeshRenderer, { passId: 'main', renderOrder: 1 });

        const items = collector.collect(world.getAllActors(), 'main');

        expect(items).toHaveLength(2);
        expect(items.map((item) => item.renderer.renderOrder)).toEqual([1, 10]);
    });

    it('reuses the backing array and pooled item objects across frames', () => {
        const world = new World(createSceneRegistry());
        const collector = new SceneRenderItemCollector();

        const actor = new Actor(world);
        actor.addComponent(MeshRenderer, { passId: 'main', renderOrder: 0 });

        const first = collector.collect(world.getAllActors(), 'main');
        const firstItem = first[0];
        const second = collector.collect(world.getAllActors(), 'main');
        const secondItem = second[0];

        expect(second).toBe(first);
        expect(secondItem).toBe(firstItem);
    });
});
