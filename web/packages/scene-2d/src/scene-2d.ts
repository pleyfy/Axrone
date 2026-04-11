import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type { SceneOptions } from '@axrone/scene-runtime';
import { get2DSceneRuntimeProfile } from '@axrone/scene-runtime/scene-profile';
import { SceneAssetFacade } from '@axrone/scene-runtime/scene-facade';

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
        });
    }
}