import type { BoundingSphere, CameraFrustum } from '@axrone/geometry';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { MeshRenderer } from './components/mesh-renderer';

export interface SceneRenderItem {
    transform: Transform;
    renderer: MeshRenderer;
}

export interface SceneRenderItemSortOptions {
    readonly cameraPosition?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    readonly cameraFrustum?: Readonly<CameraFrustum>;
    readonly resolveBounds?: (renderer: MeshRenderer) => Readonly<BoundingSphere> | null | undefined;
    readonly isBlended?: (renderer: MeshRenderer) => boolean;
}

const readCenterX = (bounds: Readonly<BoundingSphere>): number =>
    Array.isArray(bounds.center) ? bounds.center[0] : bounds.center.x;

const readCenterY = (bounds: Readonly<BoundingSphere>): number =>
    Array.isArray(bounds.center) ? bounds.center[1] : bounds.center.y;

const readCenterZ = (bounds: Readonly<BoundingSphere>): number =>
    Array.isArray(bounds.center) ? bounds.center[2] : bounds.center.z;

const distanceSquaredToCamera = (
    transform: Transform,
    cameraPosition: NonNullable<SceneRenderItemSortOptions['cameraPosition']>
): number => {
    const worldPosition = transform.worldPosition;
    const dx = worldPosition.x - cameraPosition.x;
    const dy = worldPosition.y - cameraPosition.y;
    const dz = worldPosition.z - cameraPosition.z;
    return dx * dx + dy * dy + dz * dz;
};

export class SceneRenderItemCollector {
    private readonly _items: SceneRenderItem[] = [];
    private readonly _cullingSphereCenter = new Vec3();
    private readonly _cullingSphereOffset = new Vec3();
    private readonly _cullingSphere: BoundingSphere = {
        kind: 'sphere',
        center: this._cullingSphereCenter,
        radius: 0,
    };

    collect(
        actors: readonly Actor[],
        passId: string,
        sortOptions: SceneRenderItemSortOptions = {}
    ): readonly SceneRenderItem[] {
        let count = 0;

        for (const actor of actors) {
            if (!actor.active) {
                continue;
            }

            const transform = actor.getComponent(Transform);
            const renderer = actor.getComponent(MeshRenderer);

            if (
                !transform ||
                !renderer ||
                !renderer.enabled ||
                !renderer.visible ||
                renderer.passId !== passId
            ) {
                continue;
            }

            if (
                sortOptions.cameraFrustum &&
                sortOptions.resolveBounds &&
                !this._intersectsCameraFrustum(
                    transform,
                    sortOptions.resolveBounds(renderer),
                    sortOptions.cameraFrustum
                )
            ) {
                continue;
            }

            const item = this._items[count] ?? { transform, renderer };
            item.transform = transform;
            item.renderer = renderer;
            this._items[count] = item;
            count += 1;
        }

        this._items.length = count;
        this._items.sort((left, right) => {
            const renderOrderDelta = left.renderer.renderOrder - right.renderer.renderOrder;
            if (renderOrderDelta !== 0) {
                return renderOrderDelta;
            }

            const leftBlended = sortOptions.isBlended?.(left.renderer) ?? false;
            const rightBlended = sortOptions.isBlended?.(right.renderer) ?? false;
            if (leftBlended !== rightBlended) {
                return leftBlended ? 1 : -1;
            }

            if (!leftBlended || !sortOptions.cameraPosition) {
                return 0;
            }

            return (
                distanceSquaredToCamera(right.transform, sortOptions.cameraPosition) -
                distanceSquaredToCamera(left.transform, sortOptions.cameraPosition)
            );
        });
        return this._items;
    }

    private _intersectsCameraFrustum(
        transform: Transform,
        bounds: Readonly<BoundingSphere> | null | undefined,
        frustum: Readonly<CameraFrustum>
    ): boolean {
        if (!bounds) {
            return true;
        }

        const worldScale = transform.worldScale;
        this._cullingSphereOffset.x = readCenterX(bounds) * worldScale.x;
        this._cullingSphereOffset.y = readCenterY(bounds) * worldScale.y;
        this._cullingSphereOffset.z = readCenterZ(bounds) * worldScale.z;
        transform.worldRotation.rotateVector(this._cullingSphereOffset, this._cullingSphereOffset);
        Vec3.add(transform.worldPosition, this._cullingSphereOffset, this._cullingSphereCenter);
        this._cullingSphere.radius =
            bounds.radius *
            Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));

        return frustum.intersectsSphere(this._cullingSphere);
    }
}
