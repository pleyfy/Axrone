import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import { createSceneOptions, installWebGL2Constants, ManualScheduler } from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;

const SPRITE_COUNT = 2050;
const Z_AXIS = new Vec3(0, 0, 1);

const registerTexture = (scene: InstanceType<typeof Scene2D>, id: string): Promise<void> =>
    scene.registerTexture({
        id,
        source: { kind: 'data', width: 1, height: 1, channels: 4, data: [255, 255, 255, 255] },
        generateMipmaps: false,
    });

describe('Scene2D direct instance path with the atomic 2D TRS API', () => {
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

    it('drives a dynamic frame through one draw call and re-uploads the transform stream', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        try {
            await registerTexture(scene, 'hero');
            scene.createCameraActor(
                { name: 'Camera' },
                { primary: true, orthographic: true, orthographicSize: 100 }
            );
            const actors = scene.createSpriteActors(
                Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                    actorConfig: { name: `Hero${index}` },
                    spriteConfig: { textureId: 'hero' },
                }))
            );
            const transforms = actors.map((actor) => actor.getComponent(Transform)!);

            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCount).toBe(1);
            const uploadsAfterBuild = gl.bufferSubData.mock.calls.length;
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(1);

            // Dynamic frame: every sprite moves through the atomic TRS path.
            for (let index = 0; index < transforms.length; index += 1) {
                const angle = (index % 100) * 0.01;
                transforms[index]!.setLocalTRS2D((index % 90) - 45, Math.floor(index / 90) % 90 - 45, angle, 2, 2);
            }

            scene.renderNow();

            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(false);
            expect(gl.bufferSubData.mock.calls.length).toBeGreaterThan(uploadsAfterBuild);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(2);
            expect(gl.drawElementsInstanced).toHaveBeenLastCalledWith(
                gl.TRIANGLES,
                6,
                gl.UNSIGNED_SHORT,
                0,
                SPRITE_COUNT
            );
            expect(gl.drawElements).not.toHaveBeenCalled();

            const expectedQuaternion = Quat.fromAxisAngle(Z_AXIS, 0.01, new Quat());
            expect(transforms[1]!.rotation.z).toBe(expectedQuaternion.z);
            expect(transforms[1]!.rotation.w).toBe(expectedQuaternion.w);
            expect(transforms[1]!.position.x).toBe(1 - 45);
            expect(transforms[1]!.scale.x).toBe(2);

            // A settled frame after the update is cacheable again.
            scene.renderNow();
            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(3);
            expect(scene.renderStats.drawCalls).toBe(1);
        } finally {
            scene.dispose();
        }
    });

    it('keeps a static bulk-created scene on the cached direct path', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        try {
            await registerTexture(scene, 'hero');
            scene.createCameraActor(
                { name: 'Camera' },
                { primary: true, orthographic: true, orthographicSize: 100 }
            );
            scene.createSpriteActors(
                Array.from({ length: SPRITE_COUNT }, (_, index) => ({
                    actorConfig: { name: `Hero${index}` },
                    spriteConfig: { textureId: 'hero' },
                    position: [index % 10, Math.floor(index / 10), 0] as const,
                    rotationZ: index % 7 === 0 ? 0.3 : undefined,
                }))
            );

            scene.renderNow();
            const uploadsAfterBuild = gl.bufferSubData.mock.calls.length;

            scene.renderNow();
            scene.renderNow();

            expect(scene.renderStats.planning.spriteBatchCacheHit).toBe(true);
            expect(gl.bufferSubData).toHaveBeenCalledTimes(uploadsAfterBuild);
            expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(3);
            expect(scene.renderStats.drawCalls).toBe(1);
        } finally {
            scene.dispose();
        }
    });
});
