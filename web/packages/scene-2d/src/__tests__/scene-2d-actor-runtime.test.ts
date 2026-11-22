import { describe, expect, it } from 'vitest';
import { Transform, World } from '@axrone/ecs-runtime';
import {
    get2DSceneRuntimeProfile,
    createSceneRegistry,
    SceneActorRuntime,
    Camera,
    SpriteRenderer,
    SpriteAnimator,
    SpriteMask,
    SceneCapabilityError,
} from '@axrone/scene-2d';
import { SceneComponentCatalog } from '@axrone/scene-runtime/scene-3d-support';
import { Scene2DActorRuntime } from '../scene-2d-actor-runtime';
import { createScene2DAnimationRuntime } from '../scene-2d-animation-runtime';

const create2DActorRuntime = (
    registry = get2DSceneRuntimeProfile().resolveRegistry({})
) => {
    const world = new World(registry);
    const actors = new SceneActorRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });

    return new Scene2DActorRuntime({
        actors,
        animation: createScene2DAnimationRuntime(actors),
    });
};

describe('Scene2DActorRuntime', () => {
    it('creates camera with orthographic defaults', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createCameraActor({ name: 'Camera' });
        const camera = actor.getComponent(Camera);
        const transform = actor.getComponent(Transform);

        expect(camera).toBeInstanceOf(Camera);
        expect(camera?.orthographic).toBe(true);
        expect(camera?.near).toBe(0.1);
        expect(camera?.far).toBe(1000);
        expect(transform?.position.z).toBe(1);
    });

    it('creates perspective camera without orthographic overrides', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createCameraActor(
            { name: 'Camera' },
            { orthographic: false }
        );
        const camera = actor.getComponent(Camera);
        const transform = actor.getComponent(Transform);

        expect(camera?.orthographic).toBe(false);
        expect(transform?.position.x).toBe(0);
        expect(transform?.position.y).toBe(0);
        expect(transform?.position.z).toBe(0);
    });

    it('creates sprite actor with default config', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createSpriteActor({ name: 'Sprite' });
        const sprite = actor.getComponent(SpriteRenderer);

        expect(sprite).toBeInstanceOf(SpriteRenderer);
    });

    it('creates animated sprite with both renderer and animator', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createAnimatedSpriteActor({ name: 'Animated' });
        const sprite = actor.getComponent(SpriteRenderer);
        const animator = actor.getComponent(SpriteAnimator);

        expect(sprite).toBeInstanceOf(SpriteRenderer);
        expect(animator).toBeInstanceOf(SpriteAnimator);
    });

    it('creates mask actor with shape config', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createMaskActor(
            { name: 'Mask' },
            { size: [3, 4], shape: 'circle' }
        );
        const mask = actor.getComponent(SpriteMask);

        expect(mask).toBeInstanceOf(SpriteMask);
        expect(mask?.shape).toBe('circle');
    });

    it('throws SceneCapabilityError for unregistered components', () => {
        const coreRegistry = createSceneRegistry({
            builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
        });
        const runtime = create2DActorRuntime(coreRegistry);

        expect(() =>
            runtime.createCameraActor({ name: 'Camera' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createSpriteActor({ name: 'Sprite' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createAnimatedSpriteActor({ name: 'Animated' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createMaskActor({ name: 'Mask' })
        ).toThrow(SceneCapabilityError);
    });

    it('passes actor config through to actor creation', () => {
        const runtime = create2DActorRuntime();

        const actor = runtime.createSpriteActor(
            { name: 'NamedSprite' },
            { textureId: 'hero', size: [2, 3] }
        );
        const sprite = actor.getComponent(SpriteRenderer);

        expect(actor.name).toBe('NamedSprite');
        expect(sprite?.textureId).toBe('hero');
        expect(sprite?.size.x).toBe(2);
        expect(sprite?.size.y).toBe(3);
    });
});
