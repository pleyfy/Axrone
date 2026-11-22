import { Camera3D } from '@axrone/geometry';
import { Hierarchy, Transform, type Actor } from '@axrone/ecs-runtime';
import { Vec3, Quat } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { SpriteMask } from '../components/sprite-mask';
import { SpriteRenderer } from '../components/sprite-renderer';
import type { SceneCameraFrameState } from '../camera-frame-state';
import {
    SPRITE_STATIC_FLOATS_PER_INSTANCE,
    SPRITE_TRANSFORM_FLOATS_PER_INSTANCE,
} from '../rendering/sprite-instance-buffer-renderer';
import { SceneSpriteInstanceRegistry } from '../rendering/sprite-instance-registry';

interface MockActorOptions {
    readonly transform: Transform;
    readonly renderer: SpriteRenderer;
    readonly hierarchy?: Hierarchy | null;
    readonly parent?: Actor;
    readonly mask?: SpriteMask;
}

const createMockActor = (options: MockActorOptions): Actor => {
    const actor = {
        active: true,
        revision: 0,
        parent: options.parent,
        world: undefined,
        getComponent(componentType: unknown) {
            if (componentType === Transform) return options.transform;
            if (componentType === SpriteRenderer) return options.renderer;
            if (componentType === Hierarchy) return options.hierarchy ?? undefined;
            if (componentType === SpriteMask) return options.mask;
            return undefined;
        },
    };
    return actor as unknown as Actor;
};

const createCameraFrame = (camera: Camera3D): SceneCameraFrameState =>
    ({
        camera3D: camera,
        viewProjectionMatrix: camera.viewProjectionMatrix,
    }) as unknown as SceneCameraFrameState;

const createOrthoCamera = (
    halfExtent = 6
): Camera3D =>
    Camera3D.orthographic({
        id: 'test-ortho',
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
            position: [0, 0, 10],
            target: [0, 0, 0],
        },
    }) as Camera3D;

const createSprite = (
    x: number,
    y: number,
    textureId = 'tex',
    size: readonly [number, number] = [1, 1]
): { transform: Transform; renderer: SpriteRenderer; actor: Actor } => {
    const transform = new Transform();
    transform.position = new Vec3(x, y, 0);
    const renderer = new SpriteRenderer({ textureId, size, anchor: [0.5, 0.5] });
    const actor = createMockActor({ transform, renderer });
    return { transform, renderer, actor };
};

const readTranslation = (registry: SceneSpriteInstanceRegistry, slot: number): [number, number] => {
    const offset = slot * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE;
    const data = registry.transformData;
    return [data[offset + 4]!, data[offset + 5]!];
};

const readTextureSlot = (registry: SceneSpriteInstanceRegistry, slot: number): number => {
    const offset = slot * SPRITE_STATIC_FLOATS_PER_INSTANCE + 12;
    return registry.staticData[offset]!;
};

const groupSlices = (registry: SceneSpriteInstanceRegistry): Array<{
    start: number;
    count: number;
    ids: string[];
}> => {
    const slices: Array<{ start: number; count: number; ids: string[] }> = [];
    for (let group = 0; group < registry.groupCount; group += 1) {
        const start = registry.groupRanges[group * 2]!;
        const count = registry.groupRanges[group * 2 + 1]!;
        const idStart = registry.groupTextureOffsets[group]!;
        const idEnd = registry.groupTextureOffsets[group + 1]!;
        slices.push({
            start,
            count,
            ids: registry.groupTextureIds.slice(idStart, idEnd) as string[],
        });
    }
    return slices;
};

describe('SceneSpriteInstanceRegistry', () => {
    it('builds a homogeneous root pass and replays it untouched', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprites = [createSprite(-1, 0), createSprite(0, 0), createSprite(1, 0)];
        const registry = new SceneSpriteInstanceRegistry();

        expect(registry.sync(sprites.map((sprite) => sprite.actor), 'main')).toBe('ready');
        expect(registry.textureId).toBe('tex');
        expect(registry.drawCount).toBe(3);
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.cacheHit).toBe(false);
        expect(registry.transformDirty).toBe(true);
        expect(registry.staticsDirty).toBe(true);

        registry.commit();
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.cacheHit).toBe(true);
        expect(registry.transformDirty).toBe(false);
        expect(registry.staticsDirty).toBe(false);
    });

    it('writes updated transforms only for moved sprites', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprites = [createSprite(0, 0), createSprite(1, 0)];
        const registry = new SceneSpriteInstanceRegistry();
        const actors = sprites.map((sprite) => sprite.actor);

        registry.sync(actors, 'main');
        registry.refresh(frame);
        registry.commit();

        sprites[1]!.transform.position = new Vec3(4, 5, 0);
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.transformDirty).toBe(true);
        expect(registry.staticsDirty).toBe(false);
        expect(readTranslation(registry, 0)).toEqual([0, 0]);
        expect(readTranslation(registry, 1)).toEqual([4, 5]);
    });

    it('invalidates the static stream when the sprite renderer changes', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprite = createSprite(0, 0);
        const registry = new SceneSpriteInstanceRegistry();
        const actors = [sprite.actor];

        registry.sync(actors, 'main');
        registry.refresh(frame);
        registry.commit();

        sprite.renderer.color = { r: 0, g: 1, b: 0, a: 1 };
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.staticsDirty).toBe(true);
        const offset = 0 * SPRITE_STATIC_FLOATS_PER_INSTANCE + 8;
        expect(registry.staticData[offset]).toBeCloseTo(0);
        expect(registry.staticData[offset + 1]).toBeCloseTo(1);
    });

    it('drops hidden sprites from the draw order and restores them', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprites = [createSprite(0, 0), createSprite(1, 1)];
        const registry = new SceneSpriteInstanceRegistry();
        const actors = sprites.map((sprite) => sprite.actor);

        registry.sync(actors, 'main');
        registry.refresh(frame);
        registry.commit();
        expect(registry.drawCount).toBe(2);

        sprites[0]!.renderer.visible = false;
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.drawCount).toBe(1);

        sprites[0]!.renderer.visible = true;
        expect(registry.refresh(frame)).toBe(true);
        expect(registry.drawCount).toBe(2);
    });

    it('asks for a rebuild when an actor or component set changes', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprite = createSprite(0, 0);
        const registry = new SceneSpriteInstanceRegistry();
        const actor = sprite.actor as Actor & { revision: number };

        registry.sync([actor], 'main');
        registry.refresh(frame);

        actor.revision += 1;
        expect(registry.refresh(frame)).toBe(false);
        expect(registry.sync([actor], 'main')).toBe('ready');
    });

    it('matches Mat4.fromTRS for root rotation and scale', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const transform = new Transform();
        transform.position = new Vec3(3, 4, 0);
        transform.rotation = Quat.fromAxisAngle(new Vec3(0, 0, 1), Math.PI / 2, new Quat());
        transform.scale = new Vec3(2, 3, 1);
        const renderer = new SpriteRenderer({ textureId: 'tex', size: [1, 1] });
        const actor = createMockActor({ transform, renderer });

        const registry = new SceneSpriteInstanceRegistry();
        registry.sync([actor], 'main');
        registry.refresh(frame);

        const matrix = transform.worldMatrix.data;
        const data = registry.transformData;
        expect(data[0]).toBeCloseTo(matrix[0]!, 5);
        expect(data[1]).toBeCloseTo(matrix[1]!, 5);
        expect(data[2]).toBeCloseTo(matrix[4]!, 5);
        expect(data[3]).toBeCloseTo(matrix[5]!, 5);
        expect(data[4]).toBeCloseTo(3);
        expect(data[5]).toBeCloseTo(4);
    });

    it('bakes flipX/flipY into the static uv rect', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const sprite = createSprite(0, 0);
        sprite.renderer.flipX = true;
        const registry = new SceneSpriteInstanceRegistry();
        registry.sync([sprite.actor], 'main');
        registry.refresh(frame);

        // Static layout: [w, h, ax, ay, u0, v0, du, dv, r, g, b, a].
        const du = registry.staticData[6]!;
        const dv = registry.staticData[7]!;
        expect(du).toBeCloseTo(-1);
        expect(dv).toBeCloseTo(1);
    });

    it('culls sprites outside the camera frustum and re-culls on camera move', () => {
        const camera = createOrthoCamera(5);
        const frame = createCameraFrame(camera);
        const inside = createSprite(0, 0);
        const outside = createSprite(500, 0);
        const registry = new SceneSpriteInstanceRegistry();
        const actors = [inside.actor, outside.actor];

        registry.sync(actors, 'main');
        registry.refresh(frame);
        expect(registry.drawCount).toBe(1);

        // Moving the camera far away should cull everything.
        const moved = Camera3D.orthographic({
            id: 'test-ortho-moved',
            projection: {
                kind: 'orthographic',
                left: -5,
                right: 5,
                bottom: -5,
                top: 5,
                near: 0.1,
                far: 100,
            },
            pose: { position: [1000, 0, 10], target: [1000, 0, 0] },
        }) as Camera3D;
        expect(registry.refresh(createCameraFrame(moved))).toBe(true);
        expect(registry.drawCount).toBe(0);
    });

    it('uses the parent world transform for nested sprites', () => {
        const frame = createCameraFrame(createOrthoCamera());
        const parentTransform = new Transform();
        parentTransform.position = new Vec3(10, 20, 0);
        const parentHierarchy = new Hierarchy();
        const childTransform = new Transform();
        childTransform.position = new Vec3(1, 2, 0);
        const childHierarchy = new Hierarchy();

        const parentActor = createMockActor({
            transform: parentTransform,
            renderer: new SpriteRenderer({ textureId: 'tex' }),
            hierarchy: parentHierarchy,
        });
        (parentHierarchy as unknown as { actor: Actor }).actor = parentActor;
        childHierarchy.parent = parentHierarchy;
        const childActor = createMockActor({
            transform: childTransform,
            renderer: new SpriteRenderer({ textureId: 'tex' }),
            hierarchy: childHierarchy,
            parent: parentActor,
        });
        (childHierarchy as unknown as { actor: Actor }).actor = childActor;
        // Standalone Transforms resolve their hierarchy through the world
        // registry; give the mocks a minimal one so world matrices compose.
        const fakeWorld = { registry: { Hierarchy, Transform } };
        (parentHierarchy as unknown as { world: unknown }).world = fakeWorld;
        (childHierarchy as unknown as { world: unknown }).world = fakeWorld;
        (childTransform as unknown as { actor: Actor; world: unknown }).actor = childActor;
        (childTransform as unknown as { world: unknown }).world = fakeWorld;
        (parentTransform as unknown as { actor: Actor; world: unknown }).actor = parentActor;
        (parentTransform as unknown as { world: unknown }).world = fakeWorld;

        const registry = new SceneSpriteInstanceRegistry();
        expect(registry.sync([childActor], 'main')).toBe('ready');
        registry.refresh(frame);

        const offset = 0;
        const data = registry.transformData;
        expect(data[offset + 4]).toBeCloseTo(11);
        expect(data[offset + 5]).toBeCloseTo(22);
    });

    it('reports empty and ineligible passes', () => {
        const empty = new SceneSpriteInstanceRegistry();
        expect(empty.sync([], 'main')).toBe('empty');

        const materialSprite = createSprite(0, 0);
        const materialRenderer = new SpriteRenderer({ materialId: 'mat' });
        const materialActor = createMockActor({
            transform: materialSprite.transform,
            renderer: materialRenderer,
        });
        const materialRegistry = new SceneSpriteInstanceRegistry();
        expect(materialRegistry.sync([materialActor], 'main')).toBe('ineligible');
        // Ineligibility is cached for the same actor set/pass.
        expect(materialRegistry.sync([materialActor], 'main')).toBe('ineligible');

        const masked = createSprite(0, 0);
        const mask = new SpriteMask({ size: [4, 4], shape: 'circle' });
        const maskedActor = createMockActor({
            transform: masked.transform,
            renderer: masked.renderer,
            mask,
        });
        const maskRegistry = new SceneSpriteInstanceRegistry();
        expect(maskRegistry.sync([maskedActor], 'main')).toBe('ineligible');

        const sliced = new SpriteRenderer({
            textureId: 'tex',
            sliceBorder: [1, 1, 1, 1],
        });
        const slicedActor = createMockActor({
            transform: new Transform(),
            renderer: sliced,
        });
        const sliceRegistry = new SceneSpriteInstanceRegistry();
        expect(sliceRegistry.sync([slicedActor], 'main')).toBe('ineligible');
    });

    describe('multi-texture grouping', () => {
        it('keeps a multi-texture pass eligible and batches it into one group', () => {
            const frame = createCameraFrame(createOrthoCamera());
            const sprites = [
                createSprite(-2, 0, 'tex-a'),
                createSprite(-1, 0, 'tex-b'),
                createSprite(0, 0, 'tex-a'),
                createSprite(1, 0, 'tex-c'),
            ];
            const registry = new SceneSpriteInstanceRegistry(16);
            const actors = sprites.map((sprite) => sprite.actor);

            expect(registry.sync(actors, 'main')).toBe('ready');
            expect(registry.refresh(frame)).toBe(true);
            expect(registry.drawCount).toBe(4);
            expect(registry.groupCount).toBe(1);
            expect(registry.textureId).toBeNull();
            expect(groupSlices(registry)).toEqual([
                { start: 0, count: 4, ids: ['tex-a', 'tex-b', 'tex-c'] },
            ]);
            // Slot ids are per-group assignment order, written to the stream.
            expect(readTextureSlot(registry, 0)).toBe(0);
            expect(readTextureSlot(registry, 1)).toBe(1);
            expect(readTextureSlot(registry, 2)).toBe(0);
            expect(readTextureSlot(registry, 3)).toBe(2);
        });

        it('splits into contiguous groups when the slot budget overflows', () => {
            const frame = createCameraFrame(createOrthoCamera());
            const sprites = [
                createSprite(-3, 0, 'a'),
                createSprite(-2, 0, 'b'),
                createSprite(-1, 0, 'c'),
                createSprite(0, 0, 'a'),
                createSprite(1, 0, 'b'),
            ];
            const registry = new SceneSpriteInstanceRegistry(2);
            const actors = sprites.map((sprite) => sprite.actor);

            expect(registry.sync(actors, 'main')).toBe('ready');
            registry.refresh(frame);
            expect(groupSlices(registry)).toEqual([
                { start: 0, count: 2, ids: ['a', 'b'] },
                { start: 2, count: 2, ids: ['c', 'a'] },
                { start: 4, count: 1, ids: ['b'] },
            ]);
        });

        it('preserves the ordered stream across groups (contiguous, gapless)', () => {
            const frame = createCameraFrame(createOrthoCamera());
            const sprites: Array<{ actor: Actor }> = [];
            const palette = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
            for (let index = 0; index < 40; index += 1) {
                sprites.push(createSprite(-19 + index, 0, palette[index % palette.length]!));
            }
            const registry = new SceneSpriteInstanceRegistry(3);
            registry.sync(
                sprites.map((sprite) => sprite.actor),
                'main'
            );
            registry.refresh(frame);

            expect(registry.groupCount).toBeGreaterThan(1);
            let cursor = 0;
            for (const group of groupSlices(registry)) {
                // Contiguous ranges: groups replay the stream in order.
                expect(group.start).toBe(cursor);
                expect(group.ids.length).toBeLessThanOrEqual(3);
                cursor += group.count;
            }
            expect(cursor).toBe(registry.drawCount);
        });

        it('re-slots in place when a sprite swaps texture, without a rebuild', () => {
            const frame = createCameraFrame(createOrthoCamera());
            const first = createSprite(0, 0, 'a');
            const second = createSprite(1, 0, 'b');
            const registry = new SceneSpriteInstanceRegistry(16);
            const actors = [first.actor, second.actor];

            expect(registry.sync(actors, 'main')).toBe('ready');
            registry.refresh(frame);
            registry.commit();
            expect(registry.groupCount).toBe(1);
            expect(registry.textureId).toBeNull();

            second.renderer.textureId = 'a';
            expect(registry.refresh(frame)).toBe(true);
            expect(registry.staticsDirty).toBe(true);
            expect(registry.groupCount).toBe(1);
            expect(registry.textureId).toBe('a');
            expect(groupSlices(registry)).toEqual([{ start: 0, count: 2, ids: ['a'] }]);
            expect(readTextureSlot(registry, 1)).toBe(0);

            registry.commit();
            expect(registry.refresh(frame)).toBe(true);
            expect(registry.cacheHit).toBe(true);
        });

        it('keeps masks, materials and nine-slice on the ineligible path for mixed passes', () => {
            const frame = createCameraFrame(createOrthoCamera());
            const mixed = [createSprite(-2, 0, 'a'), createSprite(-1, 0, 'b')];
            const mask = new SpriteMask({ size: [4, 4], shape: 'rect' });
            const maskedActor = createMockActor({
                transform: createSprite(0, 0, 'a').transform,
                renderer: new SpriteRenderer({ textureId: 'a', size: [1, 1] }),
                mask,
            });
            const registry = new SceneSpriteInstanceRegistry(16);
            expect(
                registry.sync(
                    [...mixed.map((sprite) => sprite.actor), maskedActor],
                    'main'
                )
            ).toBe('ineligible');
            void frame;
        });
    });
});
