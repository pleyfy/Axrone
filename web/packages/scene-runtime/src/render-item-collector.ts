import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
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
    readonly isBlended?: (renderer: MeshRenderer) => boolean;
}

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
}
