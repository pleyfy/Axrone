import { Mat4, Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import type { RenderPrimitiveInstance } from '@axrone/render-core/types';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { MeshRenderer } from '../components/mesh-renderer';
import { ScenePrimitiveCache, SceneRenderListCache } from '../rendering/render-cache';
import type { SceneRenderItem } from '../rendering/render-item-collector';

interface MockEntityState {
    active: boolean;
    revision: number;
    transform: Transform | null;
    renderer: MeshRenderer | null;
}

const createMockEntity = (state: MockEntityState): EntityId =>
    ({
        get active() {
            return state.active;
        },
        set active(value: boolean) {
            if (state.active !== value) {
                state.active = value;
                state.revision += 1;
            }
        },
        get revision() {
            return state.revision;
        },
        getComponent(componentType: unknown) {
            if (componentType === Transform) {
                return state.transform ?? undefined;
            }
            if (componentType === MeshRenderer) {
                return state.renderer ?? undefined;
            }
            return undefined;
        },
    }) as unknown as EntityId;

const createCameraFrame = (): SceneCameraFrameState =>
    ({
        camera: { id: 'camera:main' },
        viewMatrix: new Mat4(),
        projectionMatrix: new Mat4(),
        viewProjectionMatrix: new Mat4(),
        camera3D: { frustum: {} },
        position: new Vec3(0, 0, 0),
    }) as unknown as SceneCameraFrameState;

describe('SceneRenderListCache', () => {
    const setup = () => {
        const transform = new Transform();
        const renderer = new MeshRenderer({ meshId: 'mesh:cube', passId: 'main' });
        const state: MockEntityState = {
            active: true,
            revision: 0,
            transform,
            renderer,
        };
        const entity = createMockEntity(state);
        const entities = [entity];
        const cameraFrame = createCameraFrame();
        const renderPass = { id: 'main' };
        const collect = vi.fn<() => readonly SceneRenderItem[]>(() => [{ transform, renderer }]);
        const cache = new SceneRenderListCache();

        const resolve = (overrides: { materialRevision?: number; meshRevision?: number } = {}) =>
            cache.resolve({
                rendererPassId: 'main',
                renderPass,
                entities,
                cameraFrame,
                viewportWidth: 800,
                viewportHeight: 600,
                materialRevision: overrides.materialRevision ?? 1,
                meshRevision: overrides.meshRevision ?? 1,
                collect,
            });

        return {
            transform,
            renderer,
            state,
            entity,
            entities,
            cameraFrame,
            renderPass,
            collect,
            cache,
            resolve,
        };
    };

    it('hits for unchanged entities, camera and registry revisions without collecting again', () => {
        const { collect, resolve } = setup();

        const first = resolve();
        const firstHit = first.hit;
        const second = resolve();

        expect(firstHit).toBe(false);
        expect(second.hit).toBe(true);
        expect(collect).toHaveBeenCalledTimes(1);
        expect(second.items).toBe(first.items);
    });

    it('misses when a transform revision changes', () => {
        const { transform, collect, resolve } = setup();

        resolve();
        transform.position = new Vec3(1, 0, 0);
        const result = resolve();

        expect(result.hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(2);
    });

    it('misses when an entity becomes inactive and when its components change', () => {
        const { entity, state, collect, resolve } = setup();

        resolve();
        entity.active = false;
        expect(resolve().hit).toBe(false);

        // Re-activating must invalidate again even though the component set is
        // the same — the cached list was collected while the entity was hidden.
        entity.active = true;
        expect(resolve().hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(3);

        // Stable again — same entity, same revisions.
        expect(resolve().hit).toBe(true);
        expect(collect).toHaveBeenCalledTimes(3);

        // Component add/remove bumps the entity revision on a real Entity.
        state.renderer = new MeshRenderer({ meshId: 'mesh:next', passId: 'main' });
        state.revision += 1;
        expect(resolve().hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(4);
    });

    it('misses when the camera moves', () => {
        const { cameraFrame, collect, resolve } = setup();

        resolve();
        cameraFrame.viewMatrix.data[12] = 5;
        expect(resolve().hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(2);
    });

    it('misses when the viewport, material registry or mesh registry revision changes', () => {
        const { entities, cameraFrame, renderPass, cache, collect, resolve } = setup();

        resolve();
        expect(resolve({ materialRevision: 2 }).hit).toBe(false);
        expect(resolve({ materialRevision: 2, meshRevision: 2 }).hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(3);

        const viewportResult = cache.resolve({
            rendererPassId: 'main',
            renderPass,
            entities,
            cameraFrame,
            viewportWidth: 1024,
            viewportHeight: 600,
            materialRevision: 2,
            meshRevision: 2,
            collect,
        });
        expect(viewportResult.hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(4);
    });

    it('misses when the entities array identity or length changes', () => {
        const { entity, entities, cameraFrame, collect, resolve } = setup();

        resolve();
        entities.push(entity);
        expect(resolve().hit).toBe(false);
        expect(collect).toHaveBeenCalledTimes(2);

        const replacement = [...entities];
        replacement.pop();
        expect(createListCacheResolve(replacement, cameraFrame, collect).hit).toBe(false);
    });

    it('treats a re-registered render pass as a cache miss', () => {
        const { entities, cameraFrame, collect } = setup();
        const cache = new SceneRenderListCache();
        const params = (renderPass: object) => ({
            rendererPassId: 'main',
            renderPass,
            entities,
            cameraFrame,
            viewportWidth: 800,
            viewportHeight: 600,
            materialRevision: 1,
            meshRevision: 1,
            collect,
        });

        expect(cache.resolve(params({ id: 'main' })).hit).toBe(false);
        expect(cache.resolve(params({ id: 'main' })).hit).toBe(false);
    });
});

const createListCacheResolve = (
    entities: readonly EntityId[],
    cameraFrame: SceneCameraFrameState,
    collect: () => readonly SceneRenderItem[]
) =>
    new SceneRenderListCache().resolve({
        rendererPassId: 'main',
        renderPass: { id: 'main' },
        entities,
        cameraFrame,
        viewportWidth: 800,
        viewportHeight: 600,
        materialRevision: 1,
        meshRevision: 1,
        collect,
    });

describe('ScenePrimitiveCache', () => {
    const setup = () => {
        const transform = new Transform();
        const renderer = new MeshRenderer({ meshId: 'mesh:cube', materialId: 'material:cube' });
        const items: SceneRenderItem[] = [{ transform, renderer }];
        const renderPass = { id: 'main', rendererPassId: 'main' };
        const cache = new ScenePrimitiveCache();
        const build = vi.fn(
            (primitives: RenderPrimitiveInstance[], lookup: Map<string, SceneRenderItem>): void => {
                primitives.push({
                    id: 'scene-primitive:1',
                    meshId: 'mesh:cube',
                    material: { id: 'material:cube' },
                    worldMatrix: transform.worldMatrix,
                    sortBias: 0,
                    visible: true,
                    receivesLighting: true,
                } as unknown as RenderPrimitiveInstance);
                lookup.set('scene-primitive:1', items[0]!);
            }
        );

        const resolve = (materialRevision = 1, meshRevision = 1) =>
            cache.resolve({
                rendererPassId: 'main',
                renderPass,
                renderItems: items,
                viewportWidth: 800,
                viewportHeight: 600,
                materialRevision,
                meshRevision,
                build,
            });

        return { transform, renderer, items, build, resolve };
    };

    it('reuses the primitive array and lookup while the scene is static', () => {
        const { build, resolve } = setup();

        const first = resolve();
        const firstHit = first.hit;
        const second = resolve();

        expect(firstHit).toBe(false);
        expect(second.hit).toBe(true);
        expect(build).toHaveBeenCalledTimes(1);
        expect(second.primitives).toBe(first.primitives);
        expect(second.lookup).toBe(first.lookup);
    });

    it('rebuilds when a renderer or transform revision changes', () => {
        const { renderer, transform, build, resolve } = setup();

        resolve();
        renderer.visible = false;
        expect(resolve().hit).toBe(false);
        expect(build).toHaveBeenCalledTimes(2);

        transform.position = new Vec3(0, 2, 0);
        expect(resolve().hit).toBe(false);
        expect(build).toHaveBeenCalledTimes(3);
    });

    it('rebuilds when the material or mesh registry revision changes', () => {
        const { build, resolve } = setup();

        resolve();
        expect(resolve(2).hit).toBe(false);
        expect(resolve(2, 2).hit).toBe(false);
        expect(build).toHaveBeenCalledTimes(3);
    });

    it('rebuilds when the item list contents change', () => {
        const { items, build, resolve } = setup();

        resolve();
        items.push({ transform: new Transform(), renderer: new MeshRenderer({ meshId: 'm2' }) });
        expect(resolve().hit).toBe(false);
        expect(build).toHaveBeenCalledTimes(2);
    });
});
