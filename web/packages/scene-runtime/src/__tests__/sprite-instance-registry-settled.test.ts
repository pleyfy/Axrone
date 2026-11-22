import { Camera3D } from '@axrone/geometry';
import { Actor, Hierarchy, Transform, World } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpriteMask } from '../components/sprite-mask';
import { SpriteRenderer } from '../components/sprite-renderer';
import type { SceneCameraFrameState } from '../camera-frame-state';
import {
    SPRITE_TRANSFORM_FLOATS_PER_INSTANCE,
} from '../rendering/sprite-instance-buffer-renderer';
import { SceneSpriteInstanceRegistry } from '../rendering/sprite-instance-registry';

const createCameraFrame = (camera: Camera3D): SceneCameraFrameState =>
    ({
        camera3D: camera,
        viewProjectionMatrix: camera.viewProjectionMatrix,
    }) as unknown as SceneCameraFrameState;

const createOrthoCamera = (
    halfExtent = 6,
    x = 0
): Camera3D =>
    Camera3D.orthographic({
        id: `test-ortho-${halfExtent}-${x}`,
        projection: {
            kind: 'orthographic',
            left: -halfExtent,
            right: halfExtent,
            bottom: -halfExtent,
            top: halfExtent,
            near: 0.1,
            far: 100,
        },
        pose: {
            position: [x, 0, 10],
            target: [x, 0, 0],
        },
    }) as Camera3D;

const readTranslation = (
    registry: SceneSpriteInstanceRegistry,
    slot: number
): [number, number] => {
    const offset = slot * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE;
    const data = registry.transformData;
    return [data[offset + 4]!, data[offset + 5]!];
};

describe('SceneSpriteInstanceRegistry settled-frame skip', () => {
    let world: World<any>;
    let actors: Actor[];

    const spawn = (x: number, textureId = 'tex'): Actor => {
        const actor = new Actor(world, { name: `Sprite${actors.length}` });
        actor.addComponent(SpriteRenderer, { textureId, size: [1, 1] });
        actor.requireComponent(Transform).position = new Vec3(x, 0, 0);
        actors.push(actor);
        return actor;
    };

    const prime = (registry: SceneSpriteInstanceRegistry, frame: SceneCameraFrameState): void => {
        expect(registry.sync(actors, 'main')).toBe('ready');
        expect(registry.refresh(frame)).toBe(true);
        registry.commit();
    };

    beforeEach(() => {
        world = new World({ Hierarchy, Transform, SpriteRenderer, SpriteMask } as any);
        actors = [];
    });

    afterEach(() => {
        if (world && !world.isDisposed) {
            world.clear();
        }
    });

    it('does zero per-entry work on frames where nothing changed', () => {
        spawn(-1);
        spawn(0);
        spawn(1);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);

        expect(registry.lastRefreshScanCount).toBe(3);

        for (let frameIndex = 0; frameIndex < 5; frameIndex += 1) {
            const transformsBefore = Array.from(registry.transformData);

            expect(registry.refresh(frame)).toBe(true);
            expect(registry.lastRefreshScanCount).toBe(0);
            expect(registry.cacheHit).toBe(true);
            expect(registry.transformDirty).toBe(false);
            expect(registry.staticsDirty).toBe(false);
            expect(registry.drawCount).toBe(3);
            expect(Array.from(registry.transformData)).toEqual(transformsBefore);

            registry.commit();
        }
    });

    it('rescans and rewrites transforms when a sprite moves', () => {
        const first = spawn(0);
        spawn(1);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);

        first.requireComponent(Transform).position = new Vec3(4, 5, 0);

        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(2);
        expect(registry.transformDirty).toBe(true);
        expect(registry.staticsDirty).toBe(false);
        expect(readTranslation(registry, 0)).toEqual([4, 5]);

        registry.commit();
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(0);
    });

    it('rescans when only the sprite renderer mutates (static stream)', () => {
        const sprite = spawn(0);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);

        sprite.requireComponent(SpriteRenderer).color = { r: 0, g: 1, b: 0, a: 1 };

        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(1);
        expect(registry.staticsDirty).toBe(true);
        expect(registry.staticData[9]).toBeCloseTo(1);
    });

    it('rebuilds when an actor is deactivated and recovers when it returns', () => {
        const sprite = spawn(0);
        spawn(1);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);
        expect(registry.drawCount).toBe(2);

        sprite.active = false;
        expect(registry.refresh(frame)).toBe(false);
        expect(registry.sync(actors, 'main')).toBe('ready');
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.drawCount).toBe(1);

        sprite.active = true;
        expect(registry.refresh(frame)).toBe(false);
        registry.sync(actors, 'main');
        registry.refresh(frame);
        expect(registry.drawCount).toBe(2);
    });

    it('still re-culls on camera-only changes with no world mutation', () => {
        spawn(0);
        const far = spawn(500);
        const frame = createCameraFrame(createOrthoCamera(5));
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);
        expect(registry.drawCount).toBe(1);

        const revisionBefore = world.renderRevision;
        expect(registry.refresh(createCameraFrame(createOrthoCamera(5, 1000)))).toBe(true);
        expect(world.renderRevision).toBe(revisionBefore);
        expect(registry.lastRefreshScanCount).toBe(2);
        expect(registry.drawCount).toBe(0);

        void far;
    });

    it('adopts a pass-wide texture change without a rebuild and settles again', () => {
        const sprite = spawn(0);
        spawn(1);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);
        expect(registry.textureId).toBe('tex');

        for (const actor of actors) {
            actor.requireComponent(SpriteRenderer).textureId = 'atlas-b';
        }
        // Texture swaps are reclassified in place now: the sweep settles in
        // one refresh and the group layout collapses to the new texture.
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.staticsDirty).toBe(true);
        expect(registry.textureId).toBe('atlas-b');

        registry.commit();
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(0);

        void sprite;
    });

    it('declines the pass when a mask is added after the registry was primed', () => {
        const sprite = spawn(0);
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();
        prime(registry, frame);
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(0);
        registry.commit();

        sprite.addComponent(SpriteMask, { size: [4, 4], shape: 'circle' });

        // The added component bumps the actor revision, which asks for a
        // rebuild; the rebuild then sees the mask and declines the pass.
        expect(registry.refresh(frame)).toBe(false);
        expect(registry.sync(actors, 'main')).toBe('ineligible');
        // Ineligible results stay cached for the same actor set + pass.
        expect(registry.sync(actors, 'main')).toBe('ineligible');
    });

    it('falls back to the full sweep when actors have no world clock', () => {
        const transform = new Transform();
        const renderer = new SpriteRenderer({ textureId: 'tex' });
        const detached = {
            active: true,
            revision: 0,
            parent: undefined,
            world: undefined,
            getComponent(componentType: unknown) {
                if (componentType === Transform) return transform;
                if (componentType === SpriteRenderer) return renderer;
                return undefined;
            },
        } as unknown as Actor;
        const frame = createCameraFrame(createOrthoCamera());
        const registry = new SceneSpriteInstanceRegistry();

        expect(registry.sync([detached], 'main')).toBe('ready');
        registry.refresh(frame);
        registry.commit();

        // No clock means no proof: the sweep must run every frame.
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.lastRefreshScanCount).toBe(1);
    });
});
