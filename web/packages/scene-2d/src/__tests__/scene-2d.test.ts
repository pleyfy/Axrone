import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from './test-harness';

let Scene2D: typeof import('@axrone/scene-2d').Scene2D;
let Camera: typeof import('@axrone/scene-2d').Camera;
let Color: typeof import('@axrone/scene-2d').Color;
let SpriteAnimator: typeof import('@axrone/scene-2d').SpriteAnimator;
let SpriteMask: typeof import('@axrone/scene-2d').SpriteMask;
let SpriteRenderer: typeof import('@axrone/scene-2d').SpriteRenderer;
let SceneCapabilityError: typeof import('@axrone/scene-2d').SceneCapabilityError;
let SceneError: typeof import('@axrone/scene-2d').SceneError;
let SceneLifecycleError: typeof import('@axrone/scene-2d').SceneLifecycleError;
let createSpriteAtlas: typeof import('@axrone/scene-2d').createSpriteAtlas;
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
        SpriteAnimator = sceneModule.SpriteAnimator;
        SpriteMask = sceneModule.SpriteMask;
        SpriteRenderer = sceneModule.SpriteRenderer;
        SceneCapabilityError = sceneModule.SceneCapabilityError;
        SceneError = sceneModule.SceneError;
        SceneLifecycleError = sceneModule.SceneLifecycleError;
        createSpriteAtlas = sceneModule.createSpriteAtlas;
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
        expect(registry.SpriteAnimator).toBeDefined();
        expect(registry.SpriteMask).toBeDefined();
        expect('MeshRenderer' in registry).toBe(false);
    });

    it('creates orthographic cameras and sprite entities through the 2d facade', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));

        const cameraEntity = scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        const spriteEntity = scene.createSpriteEntity(
            { name: 'Sprite' },
            {
                textureId: 'hero',
                size: [2, 3],
                anchor: [0.25, 0.75],
                color: Color.fromHex('#ff8040cc'),
            }
        );

        const camera = cameraEntity.getComponent(Camera);
        const cameraTransform = cameraEntity.getComponent(Transform);
        const sprite = spriteEntity.getComponent(SpriteRenderer);

        expect(camera?.orthographic).toBe(true);
        expect(camera?.near).toBe(0.1);
        expect(camera?.far).toBe(1000);
        expect(cameraTransform?.position.z).toBe(1);
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

    it('creates animated sprites that resolve atlas frames through the 2d facade', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        const atlas = createSpriteAtlas({
            id: 'atlas/hero',
            textureId: 'hero',
            textureSize: { width: 32, height: 16 },
            frames: [
                {
                    id: 'hero/idle-0',
                    region: { x: 0, y: 0, width: 16, height: 16 },
                    sourceSize: { width: 2, height: 2 },
                    pivot: { x: 0.25, y: 0.75 },
                },
                {
                    id: 'hero/idle-1',
                    region: { x: 16, y: 0, width: 16, height: 16 },
                    sourceSize: { width: 2, height: 2 },
                },
            ],
            animations: [
                {
                    id: 'idle',
                    frames: [
                        { frameId: 'hero/idle-0', durationMs: 100 },
                        { frameId: 'hero/idle-1', durationMs: 100 },
                    ],
                },
            ],
        });

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        const entity = scene.createAnimatedSpriteEntity(
            { name: 'Hero' },
            { color: Color.WHITE },
            { atlas, clipId: 'idle' }
        );

        const sprite = entity.getComponent(SpriteRenderer);
        const animator = entity.getComponent(SpriteAnimator);

        expect(animator).toBeInstanceOf(SpriteAnimator);
        expect(sprite?.textureId).toBe('hero');
        expect(sprite?.size.x).toBe(2);
        expect(sprite?.anchor.x).toBe(0.25);
        expect(sprite?.uvRect.x).toBe(0);

        scene.start(0);
        scheduler.flush(16);
        scheduler.flush(140);

        expect(sprite?.uvRect.x).toBeCloseTo(0.5);

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

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.createSpriteEntity({ name: 'HeroA' }, { textureId: 'hero', size: [1, 1] });
        scene.createSpriteEntity({ name: 'HeroB' }, { textureId: 'hero', size: [2, 1] });

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawElements).toHaveBeenCalledTimes(1);
        expect(scene.renderStats.drawCalls).toBe(1);
        expect(scene.renderStats.trianglesSubmitted).toBe(4);

        scene.dispose();
    });

    it('splits masked sprite batches by scissor state', async () => {
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

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });

        const leftMask = scene.createMaskEntity(
            { name: 'LeftMask' },
            { size: [2, 2], shape: 'rounded-rect', cornerRadius: 0.35 }
        );
        leftMask.getComponent(Transform)!.position = new Vec3(-2, 0, 0);
        const rightMask = scene.createMaskEntity(
            { name: 'RightMask' },
            { size: [2, 2], shape: 'circle' }
        );
        rightMask.getComponent(Transform)!.position = new Vec3(2, 0, 0);

        const leftSprite = scene.createSpriteEntity({ name: 'LeftSprite' }, { textureId: 'hero' });
        leftSprite.setParent(leftMask);
        const rightSprite = scene.createSpriteEntity(
            { name: 'RightSprite' },
            { textureId: 'hero' }
        );
        rightSprite.setParent(rightMask);

        expect(leftMask.getComponent(SpriteMask)).toBeInstanceOf(SpriteMask);
        expect(leftMask.getComponent(SpriteMask)?.shape).toBe('rounded-rect');
        expect(rightMask.getComponent(SpriteMask)?.shape).toBe('circle');

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawElements).toHaveBeenCalledTimes(2);
        expect(gl.enable).toHaveBeenCalledWith(gl.SCISSOR_TEST);
        expect(gl.scissor).toHaveBeenCalledTimes(2);

        scene.dispose();
    });

    it('enforces transparent sprite budgets through the 2d facade render planning surface', async () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D({
            ...createSceneOptions(scheduler, canvas),
            renderPlanning: {
                maxTransparentPrimitives: 1,
            },
        });
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

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.createSpriteEntity(
            { name: 'HeroA' },
            { textureId: 'hero', size: [1, 1], renderOrder: 0 }
        );
        scene.createSpriteEntity(
            { name: 'HeroB' },
            { textureId: 'hero', size: [2, 1], renderOrder: 1 }
        );

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawElements).toHaveBeenCalledTimes(1);
        expect(scene.renderStats.drawCalls).toBe(1);
        expect(scene.renderStats.trianglesSubmitted).toBe(2);
        expect(scene.renderStats.planning.transparentCount).toBe(1);
        expect(scene.renderStats.planning.meshTransparentCount).toBe(0);
        expect(scene.renderStats.planning.spriteTransparentCount).toBe(1);
        expect(scene.renderStats.planning.spriteBatchCount).toBe(1);
        expect(scene.renderStats.planning.skippedSpriteCount).toBe(1);
        expect(scene.renderStats.planning.warnings).toEqual([
            'transparent primitive budget exceeded at 1; skipped 1 sprite submissions',
        ]);

        scene.dispose();
    });

    it('throws capability errors when sprite helpers are used outside the 2d profile', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D({
            ...createSceneOptions(scheduler, canvas),
            profile: getCoreSceneRuntimeProfile(),
        });

        try {
            expect(() => scene.createSpriteEntity({ name: 'Sprite' })).toThrow(
                SceneCapabilityError
            );
        } finally {
            scene.dispose();
        }
    });

    it('throws SceneLifecycleError when creating entities after dispose', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D(createSceneOptions(scheduler, canvas));
        scene.dispose();

        expect(() => scene.createCameraEntity({ name: 'Camera' })).toThrow(
            SceneLifecycleError
        );
        expect(() => scene.createSpriteEntity({ name: 'Sprite' })).toThrow(
            SceneLifecycleError
        );
        expect(() =>
            scene.createAnimatedSpriteEntity({ name: 'Animated' })
        ).toThrow(SceneLifecycleError);
        expect(() => scene.createMaskEntity({ name: 'Mask' })).toThrow(
            SceneLifecycleError
        );
    });

    it('throws SceneCapabilityError for mask and animated sprite under core profile', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene2D({
            ...createSceneOptions(scheduler, canvas),
            profile: getCoreSceneRuntimeProfile(),
        });

        try {
            expect(() => scene.createMaskEntity({ name: 'Mask' })).toThrow(
                SceneCapabilityError
            );
            expect(() =>
                scene.createAnimatedSpriteEntity({ name: 'Animated' })
            ).toThrow(SceneCapabilityError);
        } finally {
            scene.dispose();
        }
    });

    it('re-exports error classes from the errors entry point', async () => {
        const errors = await import('@axrone/scene-2d/errors');

        expect(errors.SceneCanvasError).toBeDefined();
        expect(errors.SceneCapabilityError).toBeDefined();
        expect(errors.SceneError).toBeDefined();
        expect(errors.SceneLifecycleError).toBeDefined();
        expect(errors.ScenePrefabConflictError).toBeDefined();
        expect(errors.ScenePrefabError).toBeDefined();
        expect(errors.ScenePrefabResolutionError).toBeDefined();
        expect(errors.ScenePrefabValidationError).toBeDefined();

        expect(() => {
            throw new errors.SceneError('test');
        }).toThrowError(SceneError);
    });
});