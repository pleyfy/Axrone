import { Mat4, Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import type { RenderPrimitiveInstance } from '@axrone/render-core/types';
import { MeshRenderer } from '../components/mesh-renderer';
import { ScenePrimitiveCache } from '../rendering/render-cache';
import type { SceneRenderItem } from '../rendering/render-item-collector';

const createCacheSetup = () => {
    const transform = new Transform();
    const renderer = new MeshRenderer({ meshId: 'mesh:cube', materialId: 'material:cube' });
    const items: SceneRenderItem[] = [{ transform, renderer }];
    const renderPass = { id: 'main', rendererPassId: 'main' };
    const cache = new ScenePrimitiveCache();

    const build = vi.fn(
        (primitives: RenderPrimitiveInstance[], lookup: Map<string, SceneRenderItem>): void => {
            primitives.push({
                id: 'scene-primitive:renderer',
                meshId: 'mesh:cube',
                material: { id: 'material:cube' },
                worldMatrix: transform.worldMatrix,
            } as unknown as RenderPrimitiveInstance);
            lookup.set('scene-primitive:renderer', items[0]!);
        }
    );
    const update = vi.fn(
        (
            primitives: readonly RenderPrimitiveInstance[],
            renderItems: readonly SceneRenderItem[]
        ): void => {
            for (let index = 0; index < primitives.length; index += 1) {
                (primitives[index] as unknown as { worldMatrix: Mat4 }).worldMatrix =
                    renderItems[index]!.transform.worldMatrix;
            }
        }
    );

    const resolve = (
        overrides: {
            materialRevision?: number;
            meshRevision?: number;
            shaderRevision?: number;
            withUpdate?: boolean;
        } = {}
    ) =>
        cache.resolve({
            rendererPassId: 'main',
            renderPass,
            renderItems: items,
            viewportWidth: 800,
            viewportHeight: 600,
            materialRevision: overrides.materialRevision ?? 1,
            meshRevision: overrides.meshRevision ?? 1,
            shaderRevision: overrides.shaderRevision ?? 0,
            build,
            ...(overrides.withUpdate === false ? {} : { update }),
        });

    return { transform, renderer, items, renderPass, build, update, resolve };
};

describe('ScenePrimitiveCache incremental update', () => {
    it('refreshes primitives in place when only transforms changed', () => {
        const { transform, build, update, resolve } = createCacheSetup();

        const first = resolve();
        const primitives = first.primitives;

        transform.position = new Vec3(2, 0, 0);
        const second = resolve();

        expect(build).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(second.hit).toBe(false);
        expect(second.primitives).toBe(primitives);
        expect(second.lookup).toBe(first.lookup);
        // Retained primitive points at the transform's live world matrix.
        expect(primitives[0]!.worldMatrix).toBe(transform.worldMatrix);
    });

    it('falls back to a full rebuild without an update callback', () => {
        const { transform, build, update, resolve } = createCacheSetup();

        resolve({ withUpdate: false });
        transform.position = new Vec3(1, 1, 0);
        resolve({ withUpdate: false });

        expect(update).not.toHaveBeenCalled();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('rebuilds when a renderer revision changes', () => {
        const { renderer, build, update, resolve } = createCacheSetup();

        resolve();
        renderer.visible = false;
        resolve();

        expect(update).not.toHaveBeenCalled();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('rebuilds when registry revisions change even if transforms did not', () => {
        const { build, update, resolve } = createCacheSetup();

        resolve();
        resolve({ materialRevision: 2 });
        resolve({ meshRevision: 2 });
        resolve({ shaderRevision: 1 });

        expect(update).not.toHaveBeenCalled();
        expect(build).toHaveBeenCalledTimes(4);
    });

    it('keeps hitting without rebuilds or updates while nothing changes', () => {
        const { build, update, resolve } = createCacheSetup();

        resolve();
        const second = resolve();

        expect(second.hit).toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect(build).toHaveBeenCalledTimes(1);
    });
});
