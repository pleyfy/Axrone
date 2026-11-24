import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let createScene2D: typeof import('@axrone/scene-2d').createScene2D;
let resolveSceneRegistryFromProfile: typeof import('@axrone/scene-2d').resolveSceneRegistryFromProfile;
let getCoreSceneRuntimeProfile: typeof import('@axrone/scene-2d').getCoreSceneRuntimeProfile;
let Camera: typeof import('@axrone/scene-2d').Camera;
let Scene2D: typeof import('@axrone/scene-2d').Scene2D;

describe('resolveSceneRegistryFromProfile', () => {
    beforeAll(async () => {
        installWebGL2Constants();
        const mod = await import('@axrone/scene-2d');
        createScene2D = mod.createScene2D;
        resolveSceneRegistryFromProfile = mod.resolveSceneRegistryFromProfile;
        getCoreSceneRuntimeProfile = mod.getCoreSceneRuntimeProfile;
        Camera = mod.Camera;
        Scene2D = mod.Scene2D;
    });

    it('returns 2D defaults when profile is undefined', () => {
        const registry = resolveSceneRegistryFromProfile(undefined);

        expect(registry.Camera).toBeDefined();
        expect(registry.SpriteRenderer).toBeDefined();
        expect(registry.SpriteAnimator).toBeDefined();
        expect(registry.SpriteMask).toBeDefined();
        expect('MeshRenderer' in registry).toBe(false);
    });

    it('uses provided profile over 2D default', () => {
        const coreProfile = getCoreSceneRuntimeProfile();
        const registry = resolveSceneRegistryFromProfile(coreProfile);

        expect('SpriteRenderer' in registry).toBe(false);
        expect('SpriteAnimator' in registry).toBe(false);
        expect('SpriteMask' in registry).toBe(false);
    });
});

describe('createScene2D', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const mod = await import('@axrone/scene-2d');
        createScene2D = mod.createScene2D;
        Camera = mod.Camera;
        Scene2D = mod.Scene2D;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    it('produces a working Scene2D instance', () => {
        const canvas = document.createElement('canvas');
        const scene = createScene2D(createSceneOptions(scheduler, canvas));

        expect(scene).toBeInstanceOf(Scene2D);

        const cameraEntity = scene.createCameraEntity(
            { name: 'Camera' },
            { primary: true }
        );
        expect(cameraEntity.getComponent(Camera)).toBeDefined();

        scene.dispose();
    });

    it('applies 2D profile by default', () => {
        const canvas = document.createElement('canvas');
        const scene = createScene2D(createSceneOptions(scheduler, canvas));

        const cameraEntity = scene.createCameraEntity({ name: 'Camera' });
        const camera = cameraEntity.getComponent(Camera);

        expect(camera?.orthographic).toBe(true);
        expect(camera?.near).toBe(0.1);
        expect(camera?.far).toBe(1000);

        scene.dispose();
    });
});
