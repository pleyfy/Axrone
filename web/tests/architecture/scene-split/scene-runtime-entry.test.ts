import { describe, expect, it } from 'vitest';
import * as sceneRuntime from '@axrone/scene-runtime';

describe('scene-runtime entry', () => {
    it('surfaces core runtime primitives without re-exporting 3d facade types', () => {
        expect(sceneRuntime.createSceneRuntimeRegistry).toBeDefined();
        expect(sceneRuntime.getCoreSceneRuntimeProfile).toBeDefined();
        expect(sceneRuntime.SCENE_RUNTIME_CORE_BUILT_IN_MANIFEST).toBeDefined();
        expect(sceneRuntime.SceneActorRuntime).toBeDefined();
        expect(sceneRuntime.SceneSnapshotRuntime).toBeDefined();
        expect('SceneRuntimeKernel' in sceneRuntime).toBe(false);
        expect('Scene' in sceneRuntime).toBe(false);
        expect('Camera' in sceneRuntime).toBe(false);
        expect('MeshRenderer' in sceneRuntime).toBe(false);
        expect('DirectionalLight' in sceneRuntime).toBe(false);
    });
});
