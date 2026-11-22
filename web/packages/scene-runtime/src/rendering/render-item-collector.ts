import type { BoundingSphere, CameraFrustum } from '@axrone/geometry';
import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { MeshRenderer } from '../components/mesh-renderer';
import { isBoundingSphereCenterTuple } from '../scene-mesh-bounds';

export interface SceneRenderItem {
    transform: Transform;
    renderer: MeshRenderer;
}

/**
 * Cached sort keys stored on the retained item objects. Keeping them on the
 * item (instead of re-deriving them inside the comparator) turns a
 * callback-heavy `O(n log n)` walk into plain numeric comparisons and lets the
 * collector skip sorting entirely when every key is equal.
 */
interface SceneRenderItemSortKeys {
    renderOrder: number;
    blended: boolean;
    distanceSq: number;
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

type MutableBoundingSphere = {
    readonly kind: 'sphere';
    center: Vec3;
    radius: number;
};

const readCenterX = (bounds: Readonly<BoundingSphere>): number =>
    isBoundingSphereCenterTuple(bounds.center) ? bounds.center[0] : bounds.center.x;

const readCenterY = (bounds: Readonly<BoundingSphere>): number =>
    isBoundingSphereCenterTuple(bounds.center) ? bounds.center[1] : bounds.center.y;

const readCenterZ = (bounds: Readonly<BoundingSphere>): number =>
    isBoundingSphereCenterTuple(bounds.center) ? bounds.center[2] : bounds.center.z;

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

/**
 * Sorts by render order, then opaque before blended, then blended back-to-front.
 * Distances are precomputed per item, so this stays a pure numeric comparison.
 */
const compareSceneRenderItems = (left: SceneRenderItem, right: SceneRenderItem): number => {
    const leftKeys = left as SceneRenderItem & SceneRenderItemSortKeys;
    const rightKeys = right as SceneRenderItem & SceneRenderItemSortKeys;

    const renderOrderDelta = leftKeys.renderOrder - rightKeys.renderOrder;
    if (renderOrderDelta !== 0) {
        return renderOrderDelta;
    }

    if (leftKeys.blended !== rightKeys.blended) {
        return leftKeys.blended ? 1 : -1;
    }

    return rightKeys.distanceSq - leftKeys.distanceSq;
};

export class SceneRenderItemCollector {
    private readonly _items: SceneRenderItem[] = [];
    private readonly _cullingSphereCenter = new Vec3();
    private readonly _cullingSphereOffset = new Vec3();
    private readonly _cullingSphere: MutableBoundingSphere = {
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
        let firstRenderOrder = 0;
        let renderOrderVaries = false;
        let blendedCount = 0;
        const cameraPosition = sortOptions.cameraPosition;
        const evaluateBlended = sortOptions.isBlended;
        const cullingEnabled = Boolean(sortOptions.cameraFrustum && sortOptions.resolveBounds);

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
                cullingEnabled &&
                !this._intersectsCameraFrustum(
                    transform,
                    sortOptions.resolveBounds!(renderer),
                    sortOptions.cameraFrustum!
                )
            ) {
                continue;
            }

            const existing = this._items[count] as
                | (SceneRenderItem & SceneRenderItemSortKeys)
                | undefined;
            const item =
                existing ??
                ({
                    transform,
                    renderer,
                    renderOrder: 0,
                    blended: false,
                    distanceSq: 0,
                } as SceneRenderItem & SceneRenderItemSortKeys);
            item.transform = transform;
            item.renderer = renderer;

            const renderOrder = renderer.renderOrder;
            const blended = evaluateBlended ? evaluateBlended(renderer) : false;
            item.renderOrder = renderOrder;
            item.blended = blended;
            item.distanceSq =
                blended && cameraPosition ? distanceSquaredToCamera(transform, cameraPosition) : 0;

            if (count === 0) {
                firstRenderOrder = renderOrder;
            } else if (renderOrder !== firstRenderOrder) {
                renderOrderVaries = true;
            }
            if (blended) {
                blendedCount += 1;
            }

            this._items[count] = item;
            count += 1;
        }

        this._items.length = count;

        if (count > 1 && this._needsSort(renderOrderVaries, blendedCount, count, cameraPosition)) {
            this._items.sort(compareSceneRenderItems);
        }

        return this._items;
    }

    private _needsSort(
        renderOrderVaries: boolean,
        blendedCount: number,
        count: number,
        cameraPosition: SceneRenderItemSortOptions['cameraPosition']
    ): boolean {
        if (renderOrderVaries) {
            return true;
        }
        if (blendedCount === 0) {
            return false;
        }
        // Mixed opaque/blended items must be reordered so blended items trail.
        if (blendedCount !== count) {
            return true;
        }
        // All blended: only camera distance can reorder them.
        return cameraPosition !== undefined;
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
