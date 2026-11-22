import { beforeAll, describe, expect, it } from 'vitest';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

let root: typeof import('@axrone/scene-3d');
let lean: typeof import('@axrone/scene-3d/lean');

const createOptions = () => {
    const canvas = document.createElement('canvas');
    return {
        canvas,
        options: createSceneOptions(new ManualScheduler(), canvas),
    };
};

const kernelOf = (scene: unknown) =>
    (scene as {
        _kernel: import('@axrone/scene-runtime/scene-facade').SceneRuntimeKernel;
    })._kernel;

describe('scene-3d root vs lean composition', () => {
    beforeAll(async () => {
        installWebGL2Constants();
        root = await import('@axrone/scene-3d');
        lean = await import('@axrone/scene-3d/lean');
    });

    it('keeps the root Scene on the full registry and 3D physics bridge', () => {
        const { options } = createOptions();
        const scene = new root.Scene(options);

        try {
            const names = scene.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'MeshRenderer',
                    'Terrain',
                    'Animator',
                ])
            );
            // Default full profile selects the 3D bridge only.
            expect(kernelOf(scene).physicsBridge3D).not.toBeNull();
            expect(kernelOf(scene).physicsBridge2D).toBeNull();
        } finally {
            scene.dispose();
        }
    });

    it('boots the lean Scene with only its surface registry and no physics', () => {
        const { options } = createOptions();
        const scene = new lean.Scene(options);

        try {
            const names = scene.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'MeshRenderer',
                ])
            );
            for (const excluded of [
                'Terrain',
                'Animator',
                'DirectionalLight',
                'PointLight',
                'UIHost',
                'SpriteRenderer',
            ]) {
                expect(names).not.toContain(excluded);
            }
            expect(kernelOf(scene).physicsBridge3D).toBeNull();
            expect(kernelOf(scene).physicsBridge2D).toBeNull();
            expect(kernelOf(scene).renderCapabilities.meshRenderers).toBe(true);
            expect(kernelOf(scene).renderCapabilities.sprites).toBe(false);
        } finally {
            scene.dispose();
        }
    });

    it('lets a lean scene opt into a custom profile while staying physics-free', () => {
        const { options } = createOptions();
        const scene = new lean.Scene({
            ...options,
            profile: root.get3DSceneRuntimeProfile(),
        });

        try {
            const names = scene.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining(['Camera', 'MeshRenderer', 'Terrain'])
            );
            expect(names).not.toContain('Animator');
            expect(kernelOf(scene).physicsBridge3D).toBeNull();
        } finally {
            scene.dispose();
        }
    });

    it('honours a caller-supplied composition on the root Scene', () => {
        const { options } = createOptions();
        const bridge = { id: 'custom.physics' };
        const scene = new root.Scene({
            ...options,
            composition: {
                createPhysicsBridges: () => ({ bridge3D: bridge, bridge2D: null }),
            },
        });

        try {
            expect(kernelOf(scene).physicsBridge3D).toBe(bridge);
        } finally {
            scene.dispose();
        }
    });
});
