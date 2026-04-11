import type { Actor, ActorConfig } from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import {
    SceneCapabilityError,
    type SceneActorRuntime,
    type SceneRegistry,
} from '@axrone/scene-runtime';
import { Camera, type CameraConfig } from '@axrone/scene-runtime/scene-facade';
import { MeshRenderer, type MeshRendererConfig } from '@axrone/scene-runtime/scene-3d-support';

export interface Scene3DActorRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly actors: SceneActorRuntime<R>;
}

export class Scene3DActorRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _actors: SceneActorRuntime<R>;

    constructor(options: Scene3DActorRuntimeOptions<R>) {
        this._actors = options.actors;
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            Camera,
            'camera actor creation requires the 3D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(Camera, cameraConfig);
        return actor;
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            MeshRenderer,
            'renderable actor creation requires the 3D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(MeshRenderer, rendererConfig);
        return actor;
    }

    private _requireRegisteredComponent(
        componentType: typeof Camera | typeof MeshRenderer,
        message: string
    ): void {
        if (this._actors.isComponentRegistered(componentType)) {
            return;
        }

        throw new SceneCapabilityError(message);
    }
}