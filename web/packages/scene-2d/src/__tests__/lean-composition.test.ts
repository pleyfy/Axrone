import { beforeAll, describe, expect, it } from 'vitest';
import { SceneCapabilityError } from '@axrone/scene-runtime/errors';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let root: typeof import('@axrone/scene-2d');
let lean: typeof import('@axrone/scene-2d/lean');

const createOptions = () => {
    const canvas = document.createElement('canvas');
    return createSceneOptions(new ManualScheduler(), canvas);
};

const kernelOf = (scene: unknown) =>
    (scene as {
        _kernel: import('@axrone/scene-runtime/scene-facade').SceneRuntimeKernel;
    })._kernel;

describe('scene-2d root vs lean composition', () => {
    beforeAll(async () => {
        installWebGL2Constants();
        root = await import('@axrone/scene-2d');
        lean = await import('@axrone/scene-2d/lean');
    });

    it('keeps the root Scene2D on the animated registry and 2D physics bridge', () => {
        const scene = new root.Scene2D(createOptions());

        try {
            const names = scene.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'SpriteRenderer',
                    'SpriteAnimator',
                    'SpriteMask',
                    'Animator',
                ])
            );
            expect(kernelOf(scene).physicsBridge3D).toBeNull();
            expect(kernelOf(scene).physicsBridge2D).not.toBeNull();
        } finally {
            scene.dispose();
        }
    });

    it('boots the lean Scene2D as sprite-only without physics or animation', () => {
        const scene = new lean.Scene2D(createOptions());

        try {
            const names = scene.getRegisteredComponentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'Hierarchy',
                    'Transform',
                    'PrefabNodeBinding',
                    'Camera',
                    'SpriteRenderer',
                ])
            );
            for (const excluded of ['SpriteAnimator', 'SpriteMask', 'Animator', 'UIHost']) {
                expect(names).not.toContain(excluded);
            }
            expect(kernelOf(scene).physicsBridge3D).toBeNull();
            expect(kernelOf(scene).physicsBridge2D).toBeNull();

            const capabilities = kernelOf(scene).renderCapabilities;
            expect(capabilities.sprites).toBe(true);
            expect(capabilities.meshRenderers).toBe(false);
            expect(capabilities.lights).toBe(false);
        } finally {
            scene.dispose();
        }
    });

    it('keeps animated/mask actor creation on the root entry', () => {
        const scene = new root.Scene2D(createOptions());

        try {
            const animated = scene.createAnimatedSpriteActor({ name: 'Animated' });
            expect(animated.getComponent(root.SpriteAnimator)).toBeDefined();

            const masked = scene.createMaskActor({ name: 'Masked' });
            expect(masked.getComponent(root.SpriteMask)).toBeDefined();
        } finally {
            scene.dispose();
        }
    });

    it('fails animated/mask creation on the lean entry with a capability error', () => {
        const scene = new lean.Scene2D(createOptions());

        try {
            expect(() => scene.createAnimatedSpriteActor({ name: 'Animated' })).toThrow(
                SceneCapabilityError
            );
            expect(() => scene.createMaskActor({ name: 'Masked' })).toThrow(
                SceneCapabilityError
            );
            // Sprite actors remain available on the lean surface.
            expect(() => scene.createSpriteActor({ name: 'Sprite' })).not.toThrow();
        } finally {
            scene.dispose();
        }
    });
});
