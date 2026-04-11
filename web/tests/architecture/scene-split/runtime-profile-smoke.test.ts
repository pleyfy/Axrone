import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Scene2D } from '@axrone/scene-2d';
import { Scene, SceneCapabilityError } from '@axrone/scene-3d';
import { coreSceneRuntimeProfile } from '@axrone/runtime-profile-core';
import { scene2DRuntimeProfile } from '@axrone/runtime-profile-2d';
import { scene3DRuntimeProfile } from '@axrone/runtime-profile-3d';
import { fullSceneRuntimeProfile } from '@axrone/runtime-profile-full';
import {
    ManualScheduler,
    createSceneOptions,
    installWebGL2Constants,
} from '../../../packages/scene-3d/src/__tests__/test-harness';

const testDir = path.dirname(fileURLToPath(import.meta.url));

const ensureCanvas = (): HTMLCanvasElement => {
    const root = globalThis as typeof globalThis & {
        HTMLCanvasElement?: typeof HTMLCanvasElement;
    };

    if (!root.HTMLCanvasElement) {
        root.HTMLCanvasElement = class HTMLCanvasElement {
            width = 0;
            height = 0;
            clientWidth = 640;
            clientHeight = 360;
            style = {
                width: '',
                height: '',
            };
        } as typeof HTMLCanvasElement;
    }

    return typeof document !== 'undefined'
        ? (document.createElement('canvas') as HTMLCanvasElement)
        : (new root.HTMLCanvasElement() as HTMLCanvasElement);
};

const createHarnessOptions = () => {
    const scheduler = new ManualScheduler();
    return createSceneOptions(scheduler, ensureCanvas());
};

describe('runtime profile smoke', () => {
    it('keeps the public runtime-profile packages on the expected capability matrix', () => {
        const coreRegistry = coreSceneRuntimeProfile().resolveRegistry({});
        const scene2DRegistry = scene2DRuntimeProfile().resolveRegistry({});
        const scene3DRegistry = scene3DRuntimeProfile().resolveRegistry({});
        const fullRegistry = fullSceneRuntimeProfile().resolveRegistry({});

        expect(coreRegistry.Hierarchy).toBeDefined();
        expect(coreRegistry.Transform).toBeDefined();
        expect('Camera' in coreRegistry).toBe(false);
        expect('MeshRenderer' in coreRegistry).toBe(false);

        expect(scene2DRegistry.Camera).toBeDefined();
        expect(scene2DRegistry.Animator).toBeDefined();
        expect('MeshRenderer' in scene2DRegistry).toBe(false);
        expect('DirectionalLight' in scene2DRegistry).toBe(false);

        expect(scene3DRegistry.Camera).toBeDefined();
        expect(scene3DRegistry.MeshRenderer).toBeDefined();
        expect('Animator' in scene3DRegistry).toBe(false);

        expect(fullRegistry.Camera).toBeDefined();
        expect(fullRegistry.MeshRenderer).toBeDefined();
        expect(fullRegistry.Animator).toBeDefined();
        expect(fullRegistry.DirectionalLight).toBeDefined();
    });

    it('boots public scene facades with split profiles and enforces runtime capability seams', () => {
        installWebGL2Constants();

        const coreScene = new Scene({
            ...createHarnessOptions(),
            profile: coreSceneRuntimeProfile(),
        });
        const scene2D = new Scene2D({
            ...createHarnessOptions(),
            profile: scene2DRuntimeProfile(),
        });
        const scene3D = new Scene({
            ...createHarnessOptions(),
            profile: scene3DRuntimeProfile(),
        });
        const fullScene = new Scene({
            ...createHarnessOptions(),
            profile: fullSceneRuntimeProfile(),
        });

        try {
            expect(coreScene.getRegisteredComponentNames()).toEqual(
                expect.arrayContaining(['Hierarchy', 'Transform', 'PrefabNodeBinding'])
            );
            expect(coreScene.getRegisteredComponentNames()).not.toContain('Camera');
            expect(() => coreScene.createActor({ name: 'Core Actor' })).not.toThrow();
            expect(() => coreScene.createCameraActor({ name: 'Core Camera' })).toThrow(
                SceneCapabilityError
            );

            expect(scene2D.getRegisteredComponentNames()).toEqual(
                expect.arrayContaining(['Hierarchy', 'Transform', 'PrefabNodeBinding', 'Camera', 'Animator'])
            );
            expect(scene2D.getRegisteredComponentNames()).not.toContain('MeshRenderer');
            expect(() => scene2D.createActor({ name: 'Scene2D Actor' })).not.toThrow();

            expect(scene3D.getRegisteredComponentNames()).toEqual(
                expect.arrayContaining(['Hierarchy', 'Transform', 'PrefabNodeBinding', 'Camera', 'MeshRenderer'])
            );
            expect(scene3D.getRegisteredComponentNames()).not.toContain('Animator');
            expect(() => scene3D.createCameraActor({ name: 'Scene3D Camera' })).not.toThrow();

            expect(fullScene.getRegisteredComponentNames()).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'MeshRenderer',
                    'Animator',
                    'DirectionalLight',
                ])
            );
            expect(() => fullScene.createCameraActor({ name: 'Full Camera' })).not.toThrow();
        } finally {
            fullScene.dispose();
            scene3D.dispose();
            scene2D.dispose();
            coreScene.dispose();
        }
    });
});