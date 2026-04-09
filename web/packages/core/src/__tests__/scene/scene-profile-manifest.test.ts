import { describe, expect, it } from 'vitest';
import { Component } from '../../component-system/core/component';
import {
    CORE_SCENE_RUNTIME_PROFILE_ID,
    DEFAULT_SCENE_RUNTIME_PROFILE_ID,
    SCENE_CORE_BUILT_IN_MANIFEST,
    createSceneManifestRuntimeProfile,
    getCoreSceneRuntimeProfile,
    getDefaultSceneRuntimeProfile,
} from '../../scene';

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
});
