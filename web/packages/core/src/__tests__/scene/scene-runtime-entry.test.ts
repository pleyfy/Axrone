import { describe, expect, it } from 'vitest';
import * as sceneRuntime from '../../scene-runtime';

describe('scene-runtime entry', () => {
    it('surfaces runtime kernel and profile primitives without re-exporting 3d component classes', () => {
        expect(sceneRuntime.Scene).toBeDefined();
        expect(sceneRuntime.SceneRuntimeKernel).toBeDefined();
        expect(sceneRuntime.getCoreSceneRuntimeProfile).toBeDefined();
        expect(sceneRuntime.SCENE_CORE_BUILT_IN_MANIFEST).toBeDefined();
        expect('Camera' in sceneRuntime).toBe(false);
        expect('MeshRenderer' in sceneRuntime).toBe(false);
        expect('DirectionalLight' in sceneRuntime).toBe(false);
    });
});
