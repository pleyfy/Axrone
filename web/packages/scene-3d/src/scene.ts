import { Actor, type ActorConfig } from '@axrone/ecs';
import type { ComponentRegistry } from '@axrone/ecs';
import type { World } from '@axrone/ecs';
import type { SceneOptions, SceneRegistry } from '@axrone/scene-runtime';
import { getDefaultSceneRuntimeProfile } from '@axrone/scene-runtime/scene-profile';
import {
    SceneAssetFacade,
    type CameraConfig,
} from '@axrone/scene-runtime/scene-facade';
import { type MeshRendererConfig } from '@axrone/scene-runtime/scene-3d-support';
import { Scene3DActorRuntime } from './scene-3d-actor-runtime';

export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _actors3d: Scene3DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? getDefaultSceneRuntimeProfile<R>(),
        });
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