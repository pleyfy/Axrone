import { beforeAll, describe, expect, it } from 'vitest';
import { installWebGL2Constants } from './test-harness';

describe('scene-2d entry', () => {
    beforeAll(() => {
        installWebGL2Constants();
    });

    it('surfaces the 2d facade without 3d-only capability exports', async () => {
        const scene2D = await import('../../scene-2d');

        expect(scene2D.Scene2D).toBeDefined();
        expect(scene2D.Camera).toBeDefined();
        expect(scene2D.Animator).toBeDefined();
        expect(scene2D.SceneAssetFacade).toBeDefined();
        expect(scene2D.SceneLifecycleFacade).toBeDefined();
        expect(scene2D.SceneRuntimeFacade).toBeDefined();
        expect(scene2D.SceneSnapshotFacade).toBeDefined();
        expect(scene2D.SceneRuntimeKernel).toBeDefined();
        expect(scene2D.SceneAssetRuntime).toBeDefined();
        expect(scene2D.SCENE_2D_BUILT_IN_MANIFEST).toBeDefined();
        expect(scene2D.get2DSceneRuntimeProfile).toBeDefined();
        expect(scene2D.createScene2D).toBeDefined();
        expect('MeshRenderer' in scene2D).toBe(false);
        expect('DirectionalLight' in scene2D).toBe(false);
        expect('OrbitCameraController' in scene2D).toBe(false);
        expect('Scene' in scene2D).toBe(false);
    });
});