import type { ComponentRegistry } from '../component-system/types/core';
import { SceneAssetFacade } from './scene-asset-facade';
import { get2DSceneRuntimeProfile } from './profile';
import type { SceneOptions } from './types';

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
        });
    }
}