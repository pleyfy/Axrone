import { describe, expect, it } from 'vitest';
import { Transform, World } from '@axrone/ecs-runtime';
import {
    get2DSceneRuntimeProfile,
    createSceneRegistry,
    SceneEntityRuntime,
    Camera,
    SpriteRenderer,
    SpriteAnimator,
    SpriteMask,
    SceneCapabilityError,
} from '@axrone/scene-2d';
import { SceneComponentCatalog } from '@axrone/scene-runtime/scene-3d-support';
import { Scene2DActorRuntime } from '../scene-2d-entity-runtime';
import { createScene2DAnimationRuntime } from '../scene-2d-animation-runtime';

const create2DActorRuntime = (
    registry = get2DSceneRuntimeProfile().resolveRegistry({})
) => {
    const world = new World(registry);
    const entities = new SceneEntityRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });

    return new Scene2DActorRuntime({
        entities,
        animation: createScene2DAnimationRuntime(entities),
    });
};

describe('Scene2DActorRuntime', () => {
    it('creates camera with orthographic defaults', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createCameraEntity({ name: 'Camera' });
        const camera = entity.getComponent(Camera);
        const transform = entity.getComponent(Transform);

        expect(camera).toBeInstanceOf(Camera);
        expect(camera?.orthographic).toBe(true);
        expect(camera?.near).toBe(0.1);
        expect(camera?.far).toBe(1000);
        expect(transform?.position.z).toBe(1);
    });

    it('creates perspective camera without orthographic overrides', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createCameraEntity(
            { name: 'Camera' },
            { orthographic: false }
        );
        const camera = entity.getComponent(Camera);
        const transform = entity.getComponent(Transform);

        expect(camera?.orthographic).toBe(false);
        expect(transform?.position.x).toBe(0);
        expect(transform?.position.y).toBe(0);
        expect(transform?.position.z).toBe(0);
    });

    it('creates sprite entity with default config', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createSpriteEntity({ name: 'Sprite' });
        const sprite = entity.getComponent(SpriteRenderer);

        expect(sprite).toBeInstanceOf(SpriteRenderer);
    });

    it('creates animated sprite with both renderer and animator', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createAnimatedSpriteEntity({ name: 'Animated' });
        const sprite = entity.getComponent(SpriteRenderer);
        const animator = entity.getComponent(SpriteAnimator);

        expect(sprite).toBeInstanceOf(SpriteRenderer);
        expect(animator).toBeInstanceOf(SpriteAnimator);
    });

    it('creates mask entity with shape config', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createMaskEntity(
            { name: 'Mask' },
            { size: [3, 4], shape: 'circle' }
        );
        const mask = entity.getComponent(SpriteMask);

        expect(mask).toBeInstanceOf(SpriteMask);
        expect(mask?.shape).toBe('circle');
    });

    it('throws SceneCapabilityError for unregistered components', () => {
        const coreRegistry = createSceneRegistry({
            builtIns: ['Hierarchy', 'Transform', 'PrefabNodeBinding'] as const,
        });
        const runtime = create2DActorRuntime(coreRegistry);

        expect(() =>
            runtime.createCameraEntity({ name: 'Camera' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createSpriteEntity({ name: 'Sprite' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createAnimatedSpriteEntity({ name: 'Animated' })
        ).toThrow(SceneCapabilityError);
        expect(() =>
            runtime.createMaskEntity({ name: 'Mask' })
        ).toThrow(SceneCapabilityError);
    });

    it('passes entity config through to entity creation', () => {
        const runtime = create2DActorRuntime();

        const entity = runtime.createSpriteEntity(
            { name: 'NamedSprite' },
            { textureId: 'hero', size: [2, 3] }
        );
        const sprite = entity.getComponent(SpriteRenderer);

        expect(entity.name).toBe('NamedSprite');
        expect(sprite?.textureId).toBe('hero');
        expect(sprite?.size.x).toBe(2);
        expect(sprite?.size.y).toBe(3);
    });
});
