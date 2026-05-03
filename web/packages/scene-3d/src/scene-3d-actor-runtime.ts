import { Transform, type Actor, type ActorConfig } from '@axrone/ecs-runtime';
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

export interface SceneRenderableActorCreateOptions {
    readonly actorConfig?: ActorConfig;
    readonly rendererConfig?: MeshRendererConfig;
}

export interface SceneRenderableActorInstance<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly actor: Actor<World<SceneRegistry<R>>>;
    readonly transform: Transform;
    readonly renderer: MeshRenderer;
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

    createRenderableActors(
        configs: readonly SceneRenderableActorCreateOptions[],
        profiling?: Record<string, number>
    ): readonly SceneRenderableActorInstance<R>[] {
        this._requireRegisteredComponent(
            MeshRenderer,
            'renderable actor creation requires the 3D scene capability/profile'
        );

        return this._actors.runInStructureBatch(() => {
            const actors = this._actors.createActorsWithComponents(
                configs.map((config) => ({
                    actorConfig: config.actorConfig ?? {},
                    components: [
                        {
                            type: MeshRenderer,
                            args: [config.rendererConfig ?? {}],
                        },
                    ],
                })),
                profiling
            );

            const startedAt = profiling ? performance.now() : 0;
            const created = actors.map((actor) => {
                const renderer = actor.requireComponent(MeshRenderer);
                const transform = actor.requireComponent(Transform);

                return { actor, transform, renderer };
            });

            if (profiling) {
                profiling.resolveHotRefsMs =
                    (profiling.resolveHotRefsMs ?? 0) + (performance.now() - startedAt);
            }

            return created;
        });
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