import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from '@axrone/numeric';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer } from '../components/mesh-renderer';
import { SceneRenderItemCollector } from '../rendering/render-item-collector';

const createActor = (transform: Transform, renderer: MeshRenderer): Actor =>
    ({
        active: true,
        getComponent(componentType: unknown) {
            if (componentType === Transform) {
                return transform;
            }
            if (componentType === MeshRenderer) {
                return renderer;
            }
            return undefined;
        },
    }) as unknown as Actor;

const createRenderer = (
    materialId: string,
    renderOrder = 0,
    position: [number, number, number] = [0, 0, 0]
) => {
    const transform = new Transform();
    transform.position = new Vec3(position[0], position[1], position[2]);
    const renderer = new MeshRenderer({ materialId, renderOrder, passId: 'main' });
    return { transform, renderer, actor: createActor(transform, renderer) };
};

describe('SceneRenderItemCollector sort keys', () => {
    it('evaluates the blend predicate once per collected item', () => {
        const collector = new SceneRenderItemCollector();
        const entries = Array.from({ length: 64 }, (_, index) =>
            createRenderer(`material-${index}`, 0, [index, 0, 0])
        );
        const isBlended = vi.fn(() => false);

        collector.collect(
            entries.map((entry) => entry.actor),
            'main',
            { isBlended }
        );

        expect(isBlended).toHaveBeenCalledTimes(entries.length);
    });

    it('preserves traversal order when render order and blending are uniform', () => {
        const collector = new SceneRenderItemCollector();
        const entries = [
            createRenderer('c', 0, [0, 0, 9]),
            createRenderer('a', 0, [0, 0, 1]),
            createRenderer('b', 0, [0, 0, 5]),
        ];

        const items = collector.collect(
            entries.map((entry) => entry.actor),
            'main',
            { isBlended: () => false, cameraPosition: new Vec3() }
        );

        expect(items.map((item) => item.renderer.materialId)).toEqual(['c', 'a', 'b']);
    });

    it('still sorts by render order when it varies', () => {
        const collector = new SceneRenderItemCollector();
        const entries = [
            createRenderer('late', 10),
            createRenderer('early', -5),
            createRenderer('default', 0),
        ];

        const items = collector.collect(
            entries.map((entry) => entry.actor),
            'main',
            { isBlended: () => false }
        );

        expect(items.map((item) => item.renderer.materialId)).toEqual([
            'early',
            'default',
            'late',
        ]);
    });

    it('sorts blended items back-to-front using precomputed distances', () => {
        const collector = new SceneRenderItemCollector();
        const entries = [
            createRenderer('near', 0, [0, 0, 2]),
            createRenderer('far', 0, [0, 0, 8]),
            createRenderer('middle', 0, [0, 0, 4]),
        ];

        const items = collector.collect(
            entries.map((entry) => entry.actor),
            'main',
            { isBlended: () => true, cameraPosition: new Vec3(0, 0, 0) }
        );

        expect(items.map((item) => item.renderer.materialId)).toEqual([
            'far',
            'middle',
            'near',
        ]);
    });

    it('keeps opaque items before blended items at the same render order', () => {
        const collector = new SceneRenderItemCollector();
        const entries = [
            createRenderer('blend', 0, [0, 0, 1]),
            createRenderer('opaque', 0, [0, 0, 30]),
        ];

        const items = collector.collect(
            entries.map((entry) => entry.actor),
            'main',
            {
                isBlended: (renderer) => renderer.materialId === 'blend',
                cameraPosition: new Vec3(0, 0, 0),
            }
        );

        expect(items.map((item) => item.renderer.materialId)).toEqual(['opaque', 'blend']);
    });
});
