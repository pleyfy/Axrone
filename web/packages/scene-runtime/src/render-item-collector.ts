import type { Actor } from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer } from './components/mesh-renderer';

export interface SceneRenderItem {
    transform: Transform;
    renderer: MeshRenderer;
}

export class SceneRenderItemCollector {
    private readonly _items: SceneRenderItem[] = [];

    collect(actors: readonly Actor[], passId: string): readonly SceneRenderItem[] {
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
        this._items.sort((left, right) => left.renderer.renderOrder - right.renderer.renderOrder);
        return this._items;
    }
}
