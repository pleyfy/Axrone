import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { type ActorConfig } from '@axrone/ecs-runtime';
import type { SceneOptions } from '@axrone/scene-runtime';
import { get2DSceneRuntimeProfile } from '@axrone/scene-runtime/scene-profile';
import { SceneAssetFacade } from '@axrone/scene-runtime/scene-facade';
import { type CameraConfig } from '@axrone/scene-runtime/scene-facade';
import { type SpriteRendererConfig } from '@axrone/scene-runtime/scene-2d-support';
import { Scene2DActorRuntime } from './scene-2d-actor-runtime';

export class Scene2D<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _actors2d: Scene2DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        super({
            ...options,
            profile: options.profile ?? get2DSceneRuntimeProfile<R>(),
        });
        this._actors2d = new Scene2DActorRuntime({
            actors: this._kernel.actors,
        });
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createCameraActor(actorConfig, cameraConfig);
    }

    createSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors2d.createSpriteActor(actorConfig, spriteConfig);
    }
}