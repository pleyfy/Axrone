import type { CameraFrustum } from '@axrone/geometry';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { SpriteRenderer } from './components/sprite-renderer';

export interface SceneSpriteRenderItem {
    actor: Actor;
    transform: Transform;
    renderer: SpriteRenderer;
    sequence: number;
    depth: number;
}

export interface SceneSpriteRenderItemCollectOptions {
    readonly cameraFrustum?: Readonly<CameraFrustum>;
}

export class SceneSpriteRenderItemCollector {
    private readonly _items: SceneSpriteRenderItem[] = [];
    private readonly _cullingSphereCenter = new Vec3();
    private readonly _cullingSphereOffset = new Vec3();
    private readonly _cullingSphere = {
        kind: 'sphere' as const,
        center: this._cullingSphereCenter,
        radius: 0,
    };

    collect(
        actors: readonly Actor[],
        passId: string,
        options: SceneSpriteRenderItemCollectOptions = {}
    ): readonly SceneSpriteRenderItem[] {
        let count = 0;

        for (const actor of actors) {
            if (!actor.active) {
                continue;
            }

            const transform = actor.getComponent(Transform);
            const renderer = actor.getComponent(SpriteRenderer);

            if (
                !transform ||
                !renderer ||
                !renderer.enabled ||
                !renderer.visible ||
                !renderer.hasRenderableSource ||
                renderer.passId !== passId
            ) {
                continue;
            }

            if (options.cameraFrustum && !this._intersectsCameraFrustum(transform, renderer, options.cameraFrustum)) {
                continue;
            }

            const item = this._items[count] ?? {
                actor,
                transform,
                renderer,
                sequence: count,
                depth: transform.worldPosition.z,
            };
            item.actor = actor;
            item.transform = transform;
            item.renderer = renderer;
            item.sequence = count;
            item.depth = transform.worldPosition.z;
            this._items[count] = item;
            count += 1;
        }

        this._items.length = count;
        this._items.sort((left, right) => {
            const sortingLayerDelta = left.renderer.sortingLayer - right.renderer.sortingLayer;
            if (sortingLayerDelta !== 0) {
                return sortingLayerDelta;
            }

            const renderOrderDelta = left.renderer.renderOrder - right.renderer.renderOrder;
            if (renderOrderDelta !== 0) {
                return renderOrderDelta;
            }

            const depthDelta = left.depth - right.depth;
            if (depthDelta !== 0) {
                return depthDelta;
            }

            return left.sequence - right.sequence;
        });
        return this._items;
    }

    private _intersectsCameraFrustum(
        transform: Transform,
        renderer: SpriteRenderer,
        frustum: Readonly<CameraFrustum>
    ): boolean {
        const localCenterX = (0.5 - renderer.anchor.x) * renderer.size.x;
        const localCenterY = (0.5 - renderer.anchor.y) * renderer.size.y;
        const localRadius = 0.5 * Math.hypot(renderer.size.x, renderer.size.y);
        const worldScale = transform.worldScale;

        this._cullingSphereOffset.x = localCenterX * worldScale.x;
        this._cullingSphereOffset.y = localCenterY * worldScale.y;
        this._cullingSphereOffset.z = 0;
        transform.worldRotation.rotateVector(this._cullingSphereOffset, this._cullingSphereOffset);
        Vec3.add(transform.worldPosition, this._cullingSphereOffset, this._cullingSphereCenter);
        this._cullingSphere.radius =
            localRadius * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));

        return frustum.intersectsSphere(this._cullingSphere);
    }
}