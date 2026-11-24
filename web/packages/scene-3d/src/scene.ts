import { Entity, type EntityConfig } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { TextureFormat } from '@axrone/render-webgl2';
import {
    type SceneOptions,
    type SceneRegistry,
} from '@axrone/scene-runtime';
import { SceneAssetFacade } from '@axrone/scene-runtime/scene-asset-facade';
import type { CameraConfig } from '@axrone/scene-runtime/scene-camera';
import type { MeshRendererConfig } from '@axrone/scene-runtime/scene-mesh-renderer';
import {
    Scene3DActorRuntime,
    type SceneProfilerProbe,
    type SceneRenderableEntityCreateOptions,
    type SceneRenderableEntityInstance,
} from './scene-3d-entity-runtime';

/**
 * Base 3D scene facade.
 *
 * The base class installs no default profile and no runtime composition, so it
 * stays free of physics packages and the full built-in manifest chain. The
 * root entry exports the full-composition subclass from `./scene-full`; the
 * lean entry exports the lean-profile subclass from `./scene-lean`.
 */
export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneAssetFacade<R> {
    private readonly _entitys3d: Scene3DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        super(options);
        this._entitys3d = new Scene3DActorRuntime({
            entities: this._kernel.entities,
        });
    }

    createCameraEntity(
        entityConfig: EntityConfig = {},
        cameraConfig: CameraConfig = {}
    ): EntityId<World<SceneRegistry<R>>> {
        this.assertNotDisposed();
        return this._entitys3d.createCameraEntity(entityConfig, cameraConfig);
    }

    createRenderableEntity(
        entityConfig: EntityConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): EntityId<World<SceneRegistry<R>>> {
        this.assertNotDisposed();
        return this._entitys3d.createRenderableEntity(entityConfig, rendererConfig);
    }

    createRenderableEntities(
        configs: readonly SceneRenderableEntityCreateOptions[],
        profiling?: SceneProfilerProbe
    ): readonly SceneRenderableEntityInstance<R>[] {
        this.assertNotDisposed();
        return this._entitys3d.createRenderableEntities(configs, profiling);
    }

    getSupportedCompressedTextureFormats(
        preferredFormats?: readonly TextureFormat[]
    ): readonly TextureFormat[] {
        return super.getSupportedCompressedTextureFormats(preferredFormats);
    }
}