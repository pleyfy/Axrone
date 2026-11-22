import {
    Actor as EcsActor,
    Hierarchy,
    Transform,
    runWithinCreationBatch,
    type Actor,
    type ActorComponentEntry,
    type ActorConfig,
} from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { ComponentConstructor, ComponentRegistry } from '@axrone/ecs-runtime';
import { Quat, Vec3 } from '@axrone/numeric';
import {
    type SceneActorRuntime,
    type SceneRegistry,
} from '@axrone/scene-runtime';
import { SceneCapabilityError } from '@axrone/scene-runtime/errors';
import { Camera, type CameraConfig } from '@axrone/scene-runtime/scene-camera';
import { requireRegisteredComponent } from '@axrone/scene-runtime/scene-capability-guard';
import {
    SpriteRenderer,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-sprite-renderer';
import type {
    SpriteAnimatorConfig,
    SpriteMaskConfig,
} from '@axrone/scene-runtime/scene-2d-support';
import type {
    Scene2DAnimationRuntime,
} from './scene-2d-animation-runtime';

export interface Scene2DActorRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly actors: SceneActorRuntime<R>;
    /**
     * Scene world, used by the bulk sprite path to resolve one archetype for
     * the whole batch. Optional: without it bulk creation falls back to the
     * per-actor incremental path.
     */
    readonly world?: World<SceneRegistry<R>>;
    /**
     * Animated/mask factories. Root `Scene2D` installs them; a lean sprite-only
     * scene omits them so `SpriteAnimator`/`SpriteMask` stay out of the graph.
     */
    readonly animation?: Scene2DAnimationRuntime<R>;
}

export interface Scene2DBulkSpriteConfig {
    readonly actorConfig?: ActorConfig;
    readonly spriteConfig?: SpriteRendererConfig;
    /** Initial world position; omitted fields keep the default transform. */
    readonly position?: readonly [number, number, number];
    /** Initial local rotation quaternion (x, y, z, w). */
    readonly rotation?: readonly [number, number, number, number];
    /**
     * Initial rotation about +Z in radians. Equivalent to `rotation` set to
     * `Quat.fromAxisAngle((0, 0, 1), rotationZ)`; wins over `rotation`.
     */
    readonly rotationZ?: number;
    readonly scale?: readonly [number, number, number];
}

const scratchPosition = new Vec3();
const scratchRotation = new Quat(0, 0, 0, 1);
const scratchScale = new Vec3(1, 1, 1);

/**
 * Writes a bulk config's optional initial transform, mirroring the documented
 * defaults: omitted fields keep zero position, identity rotation and unit
 * scale. The `rotationZ` form is a single atomic 2D write (XY translation, +Z
 * rotation, XY scale; Z keeps its rest value), matching the incremental path.
 */
const applyInitialTransform = (transform: Transform, config: Scene2DBulkSpriteConfig): void => {
    const hasPosition = config.position !== undefined;
    const hasRotation = config.rotation !== undefined;
    const hasScale = config.scale !== undefined;
    const hasRotationZ = config.rotationZ !== undefined;
    if (!hasPosition && !hasRotation && !hasRotationZ && !hasScale) {
        return;
    }

    const x = hasPosition ? config.position![0] : 0;
    const y = hasPosition ? config.position![1] : 0;

    if (hasRotationZ) {
        transform.setLocalTRS2D(
            x,
            y,
            config.rotationZ!,
            hasScale ? config.scale![0] : 1,
            hasScale ? config.scale![1] : 1
        );
        return;
    }

    if (hasPosition) {
        scratchPosition.x = x;
        scratchPosition.y = y;
        scratchPosition.z = config.position![2];
    } else {
        scratchPosition.x = 0;
        scratchPosition.y = 0;
        scratchPosition.z = 0;
    }

    if (hasScale) {
        scratchScale.x = config.scale![0];
        scratchScale.y = config.scale![1];
        scratchScale.z = config.scale![2];
    } else {
        scratchScale.x = 1;
        scratchScale.y = 1;
        scratchScale.z = 1;
    }

    if (hasRotation) {
        scratchRotation.x = config.rotation![0];
        scratchRotation.y = config.rotation![1];
        scratchRotation.z = config.rotation![2];
        scratchRotation.w = config.rotation![3];
    } else {
        scratchRotation.x = 0;
        scratchRotation.y = 0;
        scratchRotation.z = 0;
        scratchRotation.w = 1;
    }

    if (hasPosition && hasRotation && hasScale) {
        transform.setLocalTRS(scratchPosition, scratchRotation, scratchScale);
        return;
    }

    if (hasPosition) {
        transform.position = scratchPosition;
    }
    if (hasRotation) {
        transform.rotation = scratchRotation;
    }
    if (hasScale) {
        transform.scale = scratchScale;
    }
};

export class Scene2DActorRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _actors: SceneActorRuntime<R>;
    private readonly _world: World<SceneRegistry<R>> | undefined;
    private readonly _animation: Scene2DAnimationRuntime<R> | undefined;

    constructor(options: Scene2DActorRuntimeOptions<R>) {
        this._actors = options.actors;
        this._world = options.world;
        this._animation = options.animation;
    }

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        requireRegisteredComponent(
            this._actors,
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
                      near: cameraConfig.near ?? 0.1,
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
        requireRegisteredComponent(
            this._actors,
            SpriteRenderer,
            'sprite actor creation requires the 2D scene capability/profile'
        );
        const actor = this._actors.createActor(actorConfig);
        actor.addComponent(SpriteRenderer, spriteConfig);
        return actor;
    }

    /**
     * Bulk sprite creation.
     *
     * When the scene world is available this resolves the shared
     * `Hierarchy + Transform + SpriteRenderer` archetype once and places every
     * entity in it directly (`Actor.createManyWithComponents`), instead of
     * paying three archetype transitions per actor. Every actor still gets its
     * own real `Actor`, `Hierarchy`, `Transform` and `SpriteRenderer`, the
     * same lifecycle phases run, `EntityCreated` fires per actor and the
     * `…Added` events are emitted for subscribers.
     *
     * Initial transforms are written on the detached `Transform` instances
     * before they are attached: one dirty mark, `setLocalTRS2D` for the common
     * XY/+Z-rotation/scale case, and no post-creation `getComponent` pass.
     *
     * Fallback: without a world (or when a scene re-keys the core component
     * names) creation falls back to the per-actor incremental path. Sprites
     * that need masks, clips, nine-slice or multiple textures are created here
     * either way; only the *render* fast path declines them, so this API never
     * changes scene semantics.
     */
    createSpriteActors(
        configs: readonly Scene2DBulkSpriteConfig[]
    ): readonly Actor<World<SceneRegistry<R>>>[] {
        requireRegisteredComponent(
            this._actors,
            SpriteRenderer,
            'sprite actor creation requires the 2D scene capability/profile'
        );
        if (configs.length === 0) {
            return [];
        }

        const bulk = this._createSpriteActorsBulk(configs);
        if (bulk) {
            return bulk;
        }

        return this._createSpriteActorsIncremental(configs);
    }

    private _createSpriteActorsBulk(
        configs: readonly Scene2DBulkSpriteConfig[]
    ): readonly Actor<World<SceneRegistry<R>>>[] | null {
        const world = this._world;
        if (!world) {
            return null;
        }

        const registry = world.registry as Record<string, ComponentConstructor | undefined>;
        const hierarchyType = registry.Hierarchy ?? Hierarchy;
        const transformType = registry.Transform ?? Transform;
        const spriteType = (registry.SpriteRenderer ?? SpriteRenderer) as typeof SpriteRenderer;
        if (
            !world.isComponentRegistered('Hierarchy') ||
            !world.isComponentRegistered('Transform') ||
            !world.isComponentRegistered('SpriteRenderer')
        ) {
            return null;
        }

        const hierarchyCtor = hierarchyType as unknown as new () => Hierarchy;
        const transformCtor = transformType as unknown as new () => Transform;

        const actorConfigs = new Array<ActorConfig>(configs.length);
        const componentsPerActor = new Array<readonly ActorComponentEntry[]>(configs.length);

        // One creation-batch window: every Component/Actor stamped inside
        // reads one shared clock value instead of 200k `performance.now()`
        // calls, and all actors of the batch genuinely share one instant.
        return runWithinCreationBatch(() => {
            for (let index = 0; index < configs.length; index += 1) {
                const config = configs[index]!;
                const transform = new transformCtor();
                applyInitialTransform(transform, config);

                // Explicit registry names keep the archetype signature identical
                // to the profile's keys even when a scene registers subclasses.
                const entries: ActorComponentEntry[] = [
                    {
                        componentType: hierarchyType,
                        componentName: 'Hierarchy',
                        component: new hierarchyCtor(),
                    },
                    {
                        componentType: transformType,
                        componentName: 'Transform',
                        component: transform,
                    },
                    {
                        componentType: spriteType,
                        componentName: 'SpriteRenderer',
                        component: new spriteType(config.spriteConfig ?? {}),
                    },
                ];
                componentsPerActor[index] = entries;
                actorConfigs[index] = config.actorConfig ?? {};
            }

            // One structure-batch window: the query cache invalidates once for
            // the whole batch instead of per created archetype.
            return world.batchStructureChanges(() =>
                EcsActor.createManyWithComponents(world, actorConfigs, componentsPerActor)
            );
        });
    }

    private _createSpriteActorsIncremental(
        configs: readonly Scene2DBulkSpriteConfig[]
    ): readonly Actor<World<SceneRegistry<R>>>[] {
        const actors = new Array<Actor<World<SceneRegistry<R>>>>(configs.length);

        for (let index = 0; index < configs.length; index += 1) {
            const config = configs[index]!;
            const actor = this._actors.createActor(config.actorConfig ?? {});
            actor.addComponent(SpriteRenderer, config.spriteConfig ?? {});
            actors[index] = actor;

            const transform = actor.getComponent(Transform);
            if (transform) {
                applyInitialTransform(transform, config);
            }
        }

        return actors;
    }

    createAnimatedSpriteActor(
        actorConfig: ActorConfig = {},
        spriteConfig: SpriteRendererConfig = {},
        animatorConfig: SpriteAnimatorConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        const animation = this._animation;
        if (!animation) {
            throw new SceneCapabilityError(
                'animated sprite creation requires the animated 2D scene profile; use the root @axrone/scene-2d entry or pass a custom profile'
            );
        }
        return animation.createAnimatedSpriteActor(
            actorConfig,
            spriteConfig,
            animatorConfig
        );
    }

    createMaskActor(
        actorConfig: ActorConfig = {},
        maskConfig: SpriteMaskConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        const animation = this._animation;
        if (!animation) {
            throw new SceneCapabilityError(
                'mask actor creation requires the animated 2D scene profile; use the root @axrone/scene-2d entry or pass a custom profile'
            );
        }
        return animation.createMaskActor(actorConfig, maskConfig);
    }
}