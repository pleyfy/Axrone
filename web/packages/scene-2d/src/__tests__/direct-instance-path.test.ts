import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;

const SPRITE_COUNT = 2050;

const registerTexture = (scene: InstanceType<typeof Scene2D>, id: string, data = [255, 255, 255, 255]) =>
    scene.registerTexture({
        id,
        source: {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data,
        },
        generateMipmaps: false,
    });

describe('Scene2D direct sprite instance path', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        Scene2D = (await import('@axrone/scene-2d')).Scene2D;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('draws a large homogeneous pass with one instanced call and replays static frames', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerTexture(scene, 'hero');
        scene.createCameraActor(
            { name: 'Camera' },
            { primary: true, orthographic: true, orthographicSize: 100 }
        );
        const sprites = scene.createSpriteActors(
            Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                actorConfig: { name: `Hero${index}` },
                spriteConfig: { textureId: 'hero' },
                position: [0, 0, 0] as const,
            }))
        );

        try {
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCount).toBe(1);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(1);
            expect(gl.drawElementsInstanced).toHaveBeenCalledWith(
                gl.TRIANGLES,
                6,
                gl.UNSIGNED_SHORT,
                0,
                SPRITE_COUNT
            );
            expect(gl.drawElements).not.toHaveBeenCalled();

            // A settled static frame re-uses the uploaded instance streams.
            const uploadsAfterFirstFrame = gl.bufferSubData.mock.calls.length;
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.bufferSubData).toHaveBeenCalledTimes(uploadsAfterFirstFrame);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(2);

            // Moving a sprite invalidates the transform stream again.
            sprites[0]!.getComponent(Transform)!.position = new Vec3(1, 2, 0);
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            expect(gl.bufferSubData.mock.calls.length).toBeGreaterThan(uploadsAfterFirstFrame);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(3);
        } finally {
            scene.dispose();
        }
    });

    it('batches a multi-texture pass into ordered groups without falling back', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerTexture(scene, 'hero-a');
        await registerTexture(scene, 'hero-b');
        scene.createCameraActor(
            { name: 'Camera' },
            { primary: true, orthographic: true, orthographicSize: 100 }
        );
        scene.createSpriteActors(
            Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                actorConfig: { name: `Hero${index}` },
                spriteConfig: { textureId: index % 2 === 0 ? 'hero-a' : 'hero-b' },
                position: [0, 0, 0] as const,
            }))
        );

        // Report a 16-unit sampler budget so both textures share one group;
        // the default mock answer of 1 keeps the degenerate fallback path.
        gl.getParameter.mockImplementation(() => 16);

        try {
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCount).toBe(1);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(1);
            expect(gl.drawElements).not.toHaveBeenCalled();

            // A settled multi-texture frame replays without re-uploading.
            const uploadsAfterFirstFrame = gl.bufferSubData.mock.calls.length;
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.bufferSubData.mock.calls.length).toBe(uploadsAfterFirstFrame);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(2);
        } finally {
            scene.dispose();
        }
    });
});
