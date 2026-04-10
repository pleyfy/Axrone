import type { ComponentRegistry } from '@axrone/ecs';
import { get2DSceneRuntimeProfile } from '../../scene-runtime/src/scene-profile';
import { SceneAssetFacade } from '../../scene-runtime/src/scene-asset-facade';
import type { SceneOptions } from '../../scene-runtime/src/types';

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
        });
    }
}