import { Actor, type ActorConfig } from '@axrone/ecs';
import type { ComponentRegistry } from '@axrone/ecs';
import type { World } from '@axrone/ecs';
import type { CameraConfig } from '../../scene-runtime/src/components/camera';
import type { MeshRendererConfig } from '../../scene-runtime/src/components/mesh-renderer';
import type { SceneOptions, SceneRegistry } from '../../scene-runtime/src/types';
import { SceneAssetFacade } from '../../scene-runtime/src/scene-asset-facade';
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