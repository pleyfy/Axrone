import { describe, expect, it } from 'vitest';
import {
    SCENE_3D_BUILT_IN_MANIFEST,
    SCENE_ANIMATION_BUILT_IN_MANIFEST,
    SCENE_CORE_BUILT_IN_MANIFEST,
    createSceneRegistryFromBuiltInManifests,
    resolveSceneBuiltInComponents,
} from '@axrone/scene-3d';

describe('SceneRegistry manifests', () => {
    it('resolves manifest-built component sets with stable order and no duplicates', () => {
        const builtIns = resolveSceneBuiltInComponents([
            SCENE_CORE_BUILT_IN_MANIFEST,
            SCENE_3D_BUILT_IN_MANIFEST,
            SCENE_CORE_BUILT_IN_MANIFEST,
            SCENE_ANIMATION_BUILT_IN_MANIFEST,
        ]);

        expect(builtIns).toEqual([
            'Hierarchy',
            'Transform',
            'PrefabNodeBinding',
            'Camera',
            'MeshRenderer',
            'DirectionalLight',
            'PointLight',
            'SpotLight',
            'OrbitCameraController',
            'FollowCameraController',
            'Animator',
        ]);
    });

    it('creates core-only registries without pulling 3d defaults', () => {
        const registry = createSceneRegistryFromBuiltInManifests({
            manifests: [SCENE_CORE_BUILT_IN_MANIFEST],
        });

        expect(registry.Hierarchy).toBeDefined();
        expect(registry.Transform).toBeDefined();
        expect(registry.PrefabNodeBinding).toBeDefined();
        expect('Camera' in registry).toBe(false);
        expect('MeshRenderer' in registry).toBe(false);
    });
});
