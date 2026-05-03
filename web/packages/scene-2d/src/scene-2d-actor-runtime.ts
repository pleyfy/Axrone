import { Transform, type Actor, type ActorConfig, type ComponentConstructor } from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import {
    SceneCapabilityError,
    type SceneActorRuntime,
    type SceneRegistry,
} from '@axrone/scene-runtime';
import { Camera, type CameraConfig } from '@axrone/scene-runtime/scene-facade';
import {
    SpriteAnimator,
    type SpriteAnimatorConfig,
    SpriteMask,
    type SpriteMaskConfig,
    SpriteRenderer,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-2d-support';

export interface Scene2DActorRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly actors: SceneActorRuntime<R>;
}

export class Scene2DActorRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _actors: SceneActorRuntime<R>;

    constructor(options: Scene2DActorRuntimeOptions<R>) {
        this._actors = options.actors;
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            Camera,
            'camera actor creation requires the 2D scene capability/profile'
        );
        const isOrthographic = cameraConfig.orthographic ?? true;
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(Camera, {
            ...cameraConfig,
            orthographic: isOrthographic,
            ...(isOrthographic
                ? {
                      near: cameraConfig.near ?? -1000,
                      far: cameraConfig.far ?? 1000,
                  }
                : {}),
        });

        if (isOrthographic) {
            const transform = actor.getComponent(Transform);
            if (transform) {
                transform.position = new Vec3(0, 0, 1);
            }
        }

        return actor;
    }

    createSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            SpriteRenderer,
            'sprite actor creation requires the 2D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(SpriteRenderer, spriteConfig);
        return actor;
    }

    createAnimatedSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {},
        animatorConfig: SpriteAnimatorConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            SpriteRenderer,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        this._requireRegisteredComponent(
            SpriteAnimator,
            'animated sprite creation requires the 2D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(SpriteRenderer, spriteConfig);
        actor.addComponent(SpriteAnimator, animatorConfig);
        return actor;
    }

    createMaskActor(
        actorConfig: ActorConfig = {},
        maskConfig: SpriteMaskConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            SpriteMask,
            'mask actor creation requires the 2D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(SpriteMask, maskConfig);
        return actor;
    }

    private _requireRegisteredComponent(
        componentType: ComponentConstructor,
        message: string
    ): void {
        if (this._actors.isComponentRegistered(componentType)) {
            return;
        }

        throw new SceneCapabilityError(message);
    }
}