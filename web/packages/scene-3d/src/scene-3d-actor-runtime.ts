import type { Actor, ActorConfig } from '@axrone/ecs';
import type { World } from '@axrone/ecs';
import type { ComponentRegistry } from '@axrone/ecs';
import { SceneCapabilityError } from '../../scene-runtime/src/errors';
import type { SceneRegistry } from '../../scene-runtime/src/types';
import type { SceneActorRuntime } from '../../scene-runtime/src/scene-actor-runtime';
import { Camera, type CameraConfig } from '../../scene-runtime/src/components/camera';
import { MeshRenderer, type MeshRendererConfig } from '../../scene-runtime/src/components/mesh-renderer';

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