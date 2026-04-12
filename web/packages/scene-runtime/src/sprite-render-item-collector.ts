import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { SpriteRenderer } from './components/sprite-renderer';

export interface SceneSpriteRenderItem {
    transform: Transform;
    renderer: SpriteRenderer;
    sequence: number;
    depth: number;
}

export class SceneSpriteRenderItemCollector {
    private readonly _items: SceneSpriteRenderItem[] = [];

    collect(actors: readonly Actor[], passId: string): readonly SceneSpriteRenderItem[] {
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

            const item = this._items[count] ?? {
                transform,
                renderer,
                sequence: count,
                depth: transform.worldPosition.z,
            };
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
}