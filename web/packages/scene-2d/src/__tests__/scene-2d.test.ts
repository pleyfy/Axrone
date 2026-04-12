import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;
let Camera: typeof import('@axrone/scene-2d').Camera;
let Color: typeof import('@axrone/scene-2d').Color;
let SpriteRenderer: typeof import('@axrone/scene-2d').SpriteRenderer;
let SceneCapabilityError: typeof import('@axrone/scene-2d').SceneCapabilityError;
let get2DSceneRuntimeProfile: typeof import('@axrone/scene-2d').get2DSceneRuntimeProfile;
let getCoreSceneRuntimeProfile: typeof import('@axrone/scene-2d').getCoreSceneRuntimeProfile;

describe('Scene2D', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-2d');
        Scene2D = sceneModule.Scene2D;
        Camera = sceneModule.Camera;
        Color = sceneModule.Color;
        SpriteRenderer = sceneModule.SpriteRenderer;
        SceneCapabilityError = sceneModule.SceneCapabilityError;
        get2DSceneRuntimeProfile = sceneModule.get2DSceneRuntimeProfile;
        getCoreSceneRuntimeProfile = sceneModule.getCoreSceneRuntimeProfile;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('maps the 2d runtime profile to camera and sprite defaults', () => {
        const registry = get2DSceneRuntimeProfile().resolveRegistry({});

        expect(registry.Camera).toBeDefined();
        expect(registry.SpriteRenderer).toBeDefined();
        expect('MeshRenderer' in registry).toBe(false);
    });

    it('creates orthographic cameras and sprite actors through the 2d facade', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        const spriteActor = scene.createSpriteActor(
            { name: 'Sprite' },
            {
                textureId: 'hero',
                size: [2, 3],
                anchor: [0.25, 0.75],
                color: Color.fromHex('#ff8040cc'),
            }
        );

        const camera = cameraActor.getComponent(Camera);
        const sprite = spriteActor.getComponent(SpriteRenderer);

        expect(camera?.orthographic).toBe(true);
        expect(sprite?.textureId).toBe('hero');
        expect(sprite?.color).toBeInstanceOf(Color);
        expect(sprite?.color.r).toBeCloseTo(1);
        expect(sprite?.color.g).toBeCloseTo(0.5019607843137255);
        expect(sprite?.color.b).toBeCloseTo(0.25098039215686274);
        expect(sprite?.color.a).toBeCloseTo(0.8);
        expect(sprite?.size.x).toBe(2);
        expect(sprite?.anchor.y).toBe(0.75);

        scene.dispose();
    });

    it('batches texture-backed sprites into a single draw call', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as any;

        await scene.registerTexture({
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

        scene.createCameraActor({ name: 'Camera' }, { primary: true });
        scene.createSpriteActor({ name: 'HeroA' }, { textureId: 'hero', size: [1, 1] });
        scene.createSpriteActor({ name: 'HeroB' }, { textureId: 'hero', size: [2, 1] });

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawElements).toHaveBeenCalledTimes(1);
        expect(scene.renderStats.drawCalls).toBe(1);
        expect(scene.renderStats.trianglesSubmitted).toBe(4);

        scene.dispose();
    });

    it('throws capability errors when sprite helpers are used outside the 2d profile', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D({
            ...createSceneOptions(scheduler, canvas),
            profile: getCoreSceneRuntimeProfile(),
        });

        try {
            expect(() => scene.createSpriteActor({ name: 'Sprite' })).toThrow(
                SceneCapabilityError
            );
        } finally {
            scene.dispose();
        }
    });
});