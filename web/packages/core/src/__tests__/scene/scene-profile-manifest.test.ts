import { describe, expect, it } from 'vitest';
import { Component } from '../../component-system/core/component';
import {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    SCENE_2D_RUNTIME_PROFILE_ID,
    createSceneManifestRuntimeProfile,
    get2DSceneRuntimeProfile,
    get3DSceneRuntimeProfile,
    getCoreSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
} from '../../scene/profile';
import { SceneCapabilityError } from '../../scene/errors';
import { SCENE_CORE_BUILT_IN_MANIFEST } from '../../scene/registry';
import { ManualScheduler, createSceneOptions, installWebGL2Constants } from './test-harness';

class PulseComponent extends Component {}

describe('Scene runtime profile manifests', () => {
    it('builds a core profile without 3d defaults', () => {
        const registry = getCoreSceneRuntimeProfile().resolveRegistry({});

        expect(registry.Hierarchy).toBeDefined();
        expect(registry.Transform).toBeDefined();
        expect(registry.PrefabNodeBinding).toBeDefined();
        expect('Camera' in registry).toBe(false);
        expect('MeshRenderer' in registry).toBe(false);
    });

    it('keeps the default profile mapped to the full 3d manifest set', () => {
        const profile = getDefaultSceneRuntimeProfile();
        const registry = profile.resolveRegistry({});

        expect(profile.id).toBe(DEFAULT_SCENE_RUNTIME_PROFILE_ID);
        expect(registry.Camera).toBeDefined();
        expect(registry.MeshRenderer).toBeDefined();
    });

    it('keeps the 2d profile limited to cross-cutting and 2d-safe defaults', () => {
        const profile = get2DSceneRuntimeProfile();
        const registry = profile.resolveRegistry({});

        expect(profile.id).toBe(SCENE_2D_RUNTIME_PROFILE_ID);
        expect(registry.Animator).toBeDefined();
        expect(registry.Camera).toBeDefined();
        expect('MeshRenderer' in registry).toBe(false);
        expect('DirectionalLight' in registry).toBe(false);
        expect('OrbitCameraController' in registry).toBe(false);
    });

    it('creates custom manifest profiles that merge external registries', () => {
        const profile = createSceneManifestRuntimeProfile({
            id: 'scene/custom-core',
            manifests: [SCENE_CORE_BUILT_IN_MANIFEST],
        });
        const registry = profile.resolveRegistry({
            registry: {
                PulseComponent,
            },
        });

        expect(profile.id).toBe('scene/custom-core');
        expect(registry.PulseComponent).toBe(PulseComponent);
        expect('Camera' in registry).toBe(false);
    });

    it('exposes the documented core profile identifier', () => {
        expect(getCoreSceneRuntimeProfile().id).toBe(CORE_SCENE_RUNTIME_PROFILE_ID);
    });

    it('keeps the 3d profile narrower than the full profile', () => {
        const profile = get3DSceneRuntimeProfile();
        const registry = profile.resolveRegistry({});

        expect(profile.id).toBe('scene/3d-default');
        expect(registry.Camera).toBeDefined();
        expect(registry.MeshRenderer).toBeDefined();
        expect('Animator' in registry).toBe(false);
    });

    it('fails fast with a capability error when 3d actor helpers are used in a core profile', async () => {
        installWebGL2Constants();
        const { Scene } = await import('../../scene/scene');
        const scheduler = new ManualScheduler();
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

        const canvas =
            typeof document !== 'undefined'
                ? (document.createElement('canvas') as HTMLCanvasElement)
                : (new root.HTMLCanvasElement() as HTMLCanvasElement);
        const scene = new Scene({
            ...createSceneOptions(scheduler, canvas),
            profile: getCoreSceneRuntimeProfile(),
        });

        try {
            expect(() => scene.createCameraActor({ name: 'Camera' })).toThrow(SceneCapabilityError);
            expect(() =>
                scene.createRenderableActor(
                    { name: 'Mesh' },
                    { meshId: 'mesh', materialId: 'material' }
                )
            ).toThrow(SceneCapabilityError);
        } finally {
            scene.dispose();
        }
    });
});
