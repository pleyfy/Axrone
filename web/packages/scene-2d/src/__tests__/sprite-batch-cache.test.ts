import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;
let SpriteMask: typeof import('@axrone/scene-2d').SpriteMask;
let SpriteRenderer: typeof import('@axrone/scene-2d').SpriteRenderer;

const registerHeroTexture = (scene: InstanceType<typeof Scene2D>) =>
    scene.registerTexture({
        id: 'hero',
        source: {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [255, 255, 255, 255],
        },
        generateMipmaps: false,
    });

describe('Scene2D sprite batch cache', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-2d');
        Scene2D = sceneModule.Scene2D;
        SpriteMask = sceneModule.SpriteMask;
        SpriteRenderer = sceneModule.SpriteRenderer;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('replays unchanged sprite passes and invalidates on every render-state change', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerHeroTexture(scene);
        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const spriteActor = scene.createSpriteActor({ name: 'Hero' }, { textureId: 'hero' });
        const spriteTransform = spriteActor.getComponent(Transform)!;
        const spriteRenderer = spriteActor.getComponent(SpriteRenderer)!;

        try {
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            expect(gl.drawElements).toHaveBeenCalledTimes(1);

            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            const uploadsAfterHit = gl.bufferSubData.mock.calls.length;
            const fullUploadsAfterHit = gl.bufferData.mock.calls.length;
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.bufferSubData).toHaveBeenCalledTimes(uploadsAfterHit);
            expect(gl.bufferData).toHaveBeenCalledTimes(fullUploadsAfterHit);
            expect(gl.drawElements).toHaveBeenCalledTimes(3);

            spriteTransform.position = new Vec3(0.5, 0, 0);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            // The first miss refreshes the lightweight signature; the payload
            // is stored only once the scene settles.
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            spriteRenderer.color = { r: 1, g: 0, b: 0, a: 1 };
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            spriteRenderer.setSize(2, 2);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            const cameraTransform = cameraActor.getComponent(Transform)!;
            cameraTransform.position = new Vec3(1, 0, 1);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            const extraSprite = scene.createSpriteActor({ name: 'Extra' }, { textureId: 'hero' });
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            extraSprite.destroy();
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
        } finally {
            scene.dispose();
        }
    });

    it('replays static masked passes and invalidates on mask state changes', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerHeroTexture(scene);
        scene.createCameraActor({ name: 'Camera' }, { primary: true });

        const maskActor = scene.createMaskActor(
            { name: 'Mask' },
            { size: [4, 4], shape: 'circle' }
        );
        const maskedSprite = scene.createSpriteActor({ name: 'Masked' }, { textureId: 'hero' });
        maskedSprite.setParent(maskActor);

        const maskTransform = maskActor.getComponent(Transform)!;
        const mask = maskActor.getComponent(SpriteMask)!;

        try {
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            expect(gl.drawElements).toHaveBeenCalledTimes(1);

            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.drawElements).toHaveBeenCalledTimes(3);
            expect(gl.enable).toHaveBeenCalledWith(gl.SCISSOR_TEST);

            maskTransform.position = new Vec3(1, 0, 0);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            mask.size.x = 2;
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            mask.enabled = false;
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
        } finally {
            scene.dispose();
        }
    });

    it('invalidates a cached pass when a mask appears', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        await registerHeroTexture(scene);
        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const sprite = scene.createSpriteActor({ name: 'Hero' }, { textureId: 'hero' });

        try {
            scene.renderNow();
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);

            const maskActor = scene.createMaskActor(
                { name: 'Mask' },
                { size: [4, 4], shape: 'rect' }
            );
            sprite.setParent(maskActor);

            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
        } finally {
            scene.dispose();
        }
    });
});
