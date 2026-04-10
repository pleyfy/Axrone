import { describe, expect, it } from 'vitest';
import { Actor } from '../../component-system/core/actor';
import { World } from '../../component-system/core/world';
import { createSceneRegistry } from '@axrone/scene-3d';
import { selectSceneCamera } from '@axrone/scene-3d';
import { Camera } from '@axrone/scene-3d';

describe('selectSceneCamera', () => {
    it('prefers primary enabled cameras on active actors', () => {
        const world = new World(createSceneRegistry());
        const first = new Actor(world);
        const second = new Actor(world);

        const fallback = first.addComponent(Camera, { primary: false });
        const primary = second.addComponent(Camera, { primary: true });

        expect(selectSceneCamera(world.getAllActors())).toBe(primary);
        expect(selectSceneCamera(world.getAllActors())).not.toBe(fallback);
    });

    it('falls back to the first enabled camera when no primary exists', () => {
        const world = new World(createSceneRegistry());
        const disabledActor = new Actor(world);
        const disabledCamera = disabledActor.addComponent(Camera);
        disabledCamera.enabled = false;

        const inactiveActor = new Actor(world);
        const inactiveCamera = inactiveActor.addComponent(Camera, { primary: true });
        inactiveActor.active = false;

        const fallbackActor = new Actor(world);
        const fallback = fallbackActor.addComponent(Camera, { primary: false });

        expect(selectSceneCamera(world.getAllActors())).toBe(fallback);
        expect(selectSceneCamera([disabledActor, inactiveActor, fallbackActor])).toBe(fallback);
        expect(disabledCamera.enabled).toBe(false);
        expect(inactiveCamera.primary).toBe(true);
    });
});
