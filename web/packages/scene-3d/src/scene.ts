import { Actor, type ActorConfig } from '../../core/src/component-system/core/actor';
import type { ComponentRegistry } from '../../core/src/component-system/types/core';
import type { World } from '../../core/src/component-system/core/world';
import type { CameraConfig } from '../../core/src/scene/components/camera';
import type { MeshRendererConfig } from '../../core/src/scene/components/mesh-renderer';
import { SceneAssetFacade } from '../../core/src/scene/scene-asset-facade';
import type { SceneOptions, SceneRegistry } from '../../core/src/scene/types';
import { Scene3DActorRuntime } from './scene-3d-actor-runtime';

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