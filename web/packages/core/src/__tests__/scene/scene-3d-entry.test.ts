import { beforeAll, describe, expect, it } from 'vitest';
import { installWebGL2Constants } from './test-harness';

describe('scene-3d entry', () => {
    beforeAll(() => {
        installWebGL2Constants();
    });

    it('surfaces the 3d facade and 3d capability primitives', async () => {
        const scene3D = await import('@axrone/scene-3d');

        expect(scene3D.Scene).toBeDefined();
        expect(scene3D.Camera).toBeDefined();
        expect(scene3D.MeshRenderer).toBeDefined();
        expect(scene3D.Scene3DActorRuntime).toBeDefined();
        expect(scene3D.SceneAssetFacade).toBeDefined();
        expect(scene3D.SceneLifecycleFacade).toBeDefined();
        expect(scene3D.SceneRuntimeFacade).toBeDefined();
        expect(scene3D.SceneSnapshotFacade).toBeDefined();
        expect(scene3D.SceneRuntimeKernel).toBeDefined();
        expect(scene3D.SceneAssetRuntime).toBeDefined();
        expect(scene3D.createUnlitColorShaderDefinition).toBeDefined();
        expect(scene3D.SCENE_3D_BUILT_IN_MANIFEST).toBeDefined();
        expect(scene3D.get3DSceneRuntimeProfile).toBeDefined();
    });
});
