import { describe, expect, it } from 'vitest';
import { Camera3D, CameraFrustum, FrustumCuller, createBoundingAabb, createBoundingSphere } from '@axrone/geometry';

describe('camera frustum culling', () => {
    it('classifies perspective spheres against the view frustum', () => {
        const camera = Camera3D.perspective({
            projection: {
                kind: 'perspective',
                verticalFieldOfView: Math.PI / 3,
                aspectRatio: 1,
                near: 0.1,
                far: 100,
            },
            pose: {
                position: [0, 0, 0],
                target: [0, 0, -1],
            },
        });

        expect(camera.classify(createBoundingSphere([0, 0, -5], 1))).toBe('inside');
        expect(camera.classify(createBoundingSphere([5, 0, -5], 0.25))).toBe('outside');
        expect(camera.classify(createBoundingSphere([0, 0, -0.05], 0.2))).toBe('intersects');
    });

    it('classifies orthographic boxes against the view frustum', () => {
        const camera = Camera3D.orthographic({
            projection: {
                kind: 'orthographic',
                left: -2,
                right: 2,
                bottom: -2,
                top: 2,
                near: 0.1,
                far: 20,
            },
            pose: {
                position: [0, 0, 5],
                target: [0, 0, 0],
            },
        });

        expect(camera.classify(createBoundingAabb([-1, -1, -1], [1, 1, 1]))).toBe('inside');
        expect(camera.classify(createBoundingAabb([3, -1, -1], [5, 1, 1]))).toBe('outside');
    });

    it('serializes and restores camera state without losing classification behavior', () => {
        const camera = Camera3D.perspective({
            id: 'main-camera',
            projection: {
                kind: 'perspective',
                verticalFieldOfView: Math.PI / 2,
                aspectRatio: 16 / 9,
                near: 0.5,
                far: 250,
            },
            pose: {
                position: [2, 3, 10],
                target: [2, 3, 0],
                up: [0, 1, 0],
            },
        });

        const serialized = camera.toJSON();
        const restored = Camera3D.fromJSON(serialized);

        expect(restored.toJSON()).toEqual(serialized);
        expect(restored.intersects(createBoundingSphere([2, 3, 1], 1))).toBe(true);
        expect(restored.intersects(createBoundingSphere([50, 3, 1], 1))).toBe(false);
    });

    it('reuses culling buffers and tracks overflow without throwing by default', () => {
        const camera = Camera3D.perspective({
            projection: {
                kind: 'perspective',
                verticalFieldOfView: Math.PI / 3,
                aspectRatio: 1,
                near: 0.1,
                far: 100,
            },
            pose: {
                position: [0, 0, 0],
                target: [0, 0, -1],
            },
        });

        const items = [
            { id: 'sphere:inside', bounds: createBoundingSphere([0, 0, -4], 0.5) },
            { id: 'sphere:outside', bounds: createBoundingSphere([10, 0, -4], 0.5) },
            { id: 'aabb:inside', bounds: createBoundingAabb([-0.5, -0.5, -3], [0.5, 0.5, -2]) },
        ] as const;

        const culler = new FrustumCuller<typeof items[number]>({
            bounds: (item) => item.bounds,
            maxResults: 1,
            trackClassifications: true,
        });

        culler.cull(items, camera.frustum);

        expect(culler.visible).toHaveLength(1);
        expect(culler.stats.visibleCount).toBe(1);
        expect(culler.stats.overflowed).toBe(true);
        expect(culler.stats.sphereCount).toBe(2);
        expect(culler.stats.aabbCount).toBe(1);
        expect(culler.classifications?.get(items[1])).toBe('outside');
    });

    it('supports async culling with batched yielding', async () => {
        const frustum = new CameraFrustum(Camera3D.perspective({
            projection: {
                kind: 'perspective',
                verticalFieldOfView: Math.PI / 3,
                aspectRatio: 1,
                near: 0.1,
                far: 100,
            },
            pose: {
                position: [0, 0, 0],
                target: [0, 0, -1],
            },
        }).viewProjectionMatrix);

        const items = [
            createBoundingSphere([0, 0, -3], 0.5),
            createBoundingSphere([0, 0, -30], 0.5),
            createBoundingSphere([30, 0, -3], 0.5),
        ];
        const culler = new FrustumCuller({
            bounds: (item: (typeof items)[number]) => item,
            trackClassifications: true,
        });

        await culler.cullAsync(items, frustum, { batchSize: 1 });

        expect(culler.visible).toHaveLength(2);
        expect(culler.stats.outsideCount).toBe(1);
        expect(culler.classifications?.get(items[2])).toBe('outside');
    });
});