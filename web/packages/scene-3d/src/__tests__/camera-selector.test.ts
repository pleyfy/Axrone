import { describe, expect, it } from 'vitest';
import { Entity } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { createSceneRegistry } from '@axrone/scene-3d';
import { selectSceneCamera } from '@axrone/scene-3d';
import { Camera } from '@axrone/scene-3d';

describe('selectSceneCamera', () => {
    it('prefers primary enabled cameras on active entities', () => {
        const world = new World(createSceneRegistry());
        const first = new Entity(world);
        const second = new Entity(world);

        const fallback = first.addComponent(Camera, { primary: false });
        const primary = second.addComponent(Camera, { primary: true });

        expect(selectSceneCamera(world.getAllEntities())).toBe(primary);
        expect(selectSceneCamera(world.getAllEntities())).not.toBe(fallback);
    });

    it('falls back to the first enabled camera when no primary exists', () => {
        const world = new World(createSceneRegistry());
        const disabledEntity = new Entity(world);
        const disabledCamera = disabledEntity.addComponent(Camera);
        disabledCamera.enabled = false;

        const inactiveEntity = new Entity(world);
        const inactiveCamera = inactiveEntity.addComponent(Camera, { primary: true });
        inactiveEntity.active = false;

        const fallbackEntity = new Entity(world);
        const fallback = fallbackEntity.addComponent(Camera, { primary: false });

        expect(selectSceneCamera(world.getAllEntities())).toBe(fallback);
        expect(selectSceneCamera([disabledEntity, inactiveEntity, fallbackEntity])).toBe(fallback);
        expect(disabledCamera.enabled).toBe(false);
        expect(inactiveCamera.primary).toBe(true);
    });
});
