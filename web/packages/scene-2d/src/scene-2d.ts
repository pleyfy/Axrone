import type { ComponentRegistry } from '../../core/src/component-system/types/core';
import { SceneAssetFacade } from '../../core/src/scene/scene-asset-facade';
import { get2DSceneRuntimeProfile } from '../../scene-runtime/src/scene-profile';
import type { SceneOptions } from '../../core/src/scene/types';

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
        });
    }
}