import { Actor, type ActorConfig } from '../component-system/core/actor';
import type { ComponentRegistry } from '../component-system/types/core';
import type { World } from '../component-system/core/world';
import type { CameraConfig } from './components/camera';
import type { MeshRendererConfig } from './components/mesh-renderer';
import { Scene3DActorRuntime } from './scene-3d-actor-runtime';
import { SceneAssetFacade } from './scene-asset-facade';
import type { SceneOptions, SceneRegistry } from './types';

export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _actors3d: Scene3DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        super(options);
        this._actors3d = new Scene3DActorRuntime({
            actors: this._kernel.actors,
        });
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this.assertNotDisposed();
        return this._actors3d.createCameraActor(actorConfig, cameraConfig);
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this.assertNotDisposed();
        return this._actors3d.createRenderableActor(actorConfig, rendererConfig);
    }
}
