import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;

const registerTexture = (scene: InstanceType<typeof Scene2D>, id: string) =>
    scene.registerTexture({
        id,
        source: {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [255, 255, 255, 255],
        },
        generateMipmaps: false,
    });

describe('Scene2D instanced sprite path', () => {
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

    it('uses one instanced draw for a homogeneous dynamic pass', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerTexture(scene, 'hero');
        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const sprites = Array.from({ length: 4 }, (_, index) =>
            scene.createSpriteActor({ name: `Hero${index}` }, { textureId: 'hero' })
        );

        try {
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            const batchDraws = gl.drawElements.mock.calls.length;

            const moveSprites = (frame: number): void => {
                for (let index = 0; index < sprites.length; index += 1) {
                    sprites[index]!.getComponent(Transform)!.position = new Vec3(
                        index + frame * 0.1,
                        0,
                        0
                    );
                }
            };

            // The first two dynamic misses settle the cache state; the third
            // selects the instanced execution path.
            moveSprites(0);
            scene.renderNow();
            moveSprites(1);
            scene.renderNow();
            gl.drawElementsInstanced.mockClear();
            gl.drawElements.mockClear();
            moveSprites(2);
            scene.renderNow();

            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            expect(scene.renderStats.planning.spriteBatchCount).toBe(1);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(1);
            expect(gl.drawElementsInstanced).toHaveBeenCalledWith(
                gl.TRIANGLES,
                6,
                gl.UNSIGNED_SHORT,
                0,
                4
            );
            expect(gl.drawElements).not.toHaveBeenCalled();
            expect(batchDraws).toBeGreaterThanOrEqual(1);
        } finally {
            scene.dispose();
        }
    });

    it('falls back when the pass contains more than one texture', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerTexture(scene, 'hero-a');
        await registerTexture(scene, 'hero-b');
        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const first = scene.createSpriteActor({ name: 'A' }, { textureId: 'hero-a' });
        const second = scene.createSpriteActor({ name: 'B' }, { textureId: 'hero-b' });

        try {
            scene.renderNow();
            first.getComponent(Transform)!.position = new Vec3(1, 0, 0);
            second.getComponent(Transform)!.position = new Vec3(2, 0, 0);
            scene.renderNow();
            scene.renderNow();
            gl.drawElementsInstanced.mockClear();
            gl.drawElements.mockClear();
            first.getComponent(Transform)!.position = new Vec3(3, 0, 0);
            second.getComponent(Transform)!.position = new Vec3(4, 0, 0);
            scene.renderNow();

            expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
            expect(gl.drawElements).toHaveBeenCalled();
        } finally {
            scene.dispose();
        }
    });

    it('falls back to the batch path when a mask is present', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await registerTexture(scene, 'hero');
        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const maskActor = scene.createMaskActor(
            { name: 'Mask' },
            { size: [4, 4], shape: 'circle' }
        );
        const sprite = scene.createSpriteActor({ name: 'Hero' }, { textureId: 'hero' });
        sprite.setParent(maskActor);

        try {
            scene.renderNow();
            gl.drawElementsInstanced.mockClear();
            gl.drawElements.mockClear();

            maskActor.getComponent(Transform)!.position = new Vec3(1, 0, 0);
            scene.renderNow();

            expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
            expect(gl.drawElements).toHaveBeenCalled();
        } finally {
            scene.dispose();
        }
    });
});
