import { Camera3D } from '@axrone/geometry';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { SpriteRenderer } from '../components/sprite-renderer';
import { SceneSpriteRenderItemCollector } from '../sprite-render-item-collector';

const createMockActor = (transform: Transform, renderer: SpriteRenderer): Actor =>
    ({
        active: true,
        getComponent(componentType: unknown) {
            if (componentType === Transform) {
                return transform;
            }
            if (componentType === SpriteRenderer) {
                return renderer;
            }
            return undefined;
        },
    } as unknown as Actor);

describe('SceneSpriteRenderItemCollector', () => {
    it('culls sprites outside the active camera frustum before batching', () => {
        const insideTransform = new Transform();
        insideTransform.position = new Vec3(0, 0, -3);
        const insideRenderer = new SpriteRenderer({
            textureId: 'tex',
            passId: 'main',
            size: [1, 1],
        });

        const outsideTransform = new Transform();
        outsideTransform.position = new Vec3(20, 0, -3);
        const outsideRenderer = new SpriteRenderer({
            textureId: 'tex',
            passId: 'main',
            size: [1, 1],
        });

        const camera = Camera3D.perspective({
            id: 'camera:sprite-collector',
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

        const collector = new SceneSpriteRenderItemCollector();
        const items = collector.collect(
            [
                createMockActor(insideTransform, insideRenderer),
                createMockActor(outsideTransform, outsideRenderer),
            ],
            'main',
            { cameraFrustum: camera.frustum }
        );

        expect(items.map((item) => item.renderer)).toEqual([insideRenderer]);
    });
});