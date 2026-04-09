import { Actor, type ActorConfig } from '../component-system/core/actor';
import type { ComponentRegistry } from '../component-system/types/core';
import type { CameraConfig } from './components/camera';
import type { MeshRendererConfig } from './components/mesh-renderer';
import { SceneMaterialError } from './errors';
import { Scene3DActorRuntime } from './scene-3d-actor-runtime';
import { SceneRuntimeFacade } from './scene-runtime-facade';
import type {
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialTextureBindingHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneOptions,
    SceneRenderPassDefinition,
    SceneRenderPassHandle,
    SceneSamplerDefinition,
    SceneSamplerHandle,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
    SceneTextureBindingDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
    SceneTextureResourceHandle,
    SceneUniformValue,
} from './types';

export const createUnlitColorShaderDefinition = (
    id: string = 'Scene/UnlitColor'
): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
out vec2 v_UV0;
void main() {
    v_UV0 = a_UV0;
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
    fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
in vec2 v_UV0;
out vec4 o_Color;
void main() {
    o_Color = u_Color;
}`,
    uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color'],
    depthTest: true,
    cull: true,
    blend: false,
});

export class Scene<R extends ComponentRegistry = Record<string, never>> extends SceneRuntimeFacade<R> {
    private readonly _actors3d: Scene3DActorRuntime<R>;

    constructor(options: SceneOptions<R> = {}) {
        super(options);
        this._actors3d = new Scene3DActorRuntime({
            actors: this._kernel.actors,
        });
    }

    registerShader(definition: SceneShaderDefinition): SceneShaderHandle {
        this.assertNotDisposed();
        return this._kernel.assets.registerShader(definition);
    }

    getShader(id: string): SceneShaderHandle | null {
        return this._kernel.assets.getShader(id);
    }

    createMaterial(definition: SceneMaterialDefinition): SceneMaterialHandle {
        this.assertNotDisposed();
        try {
            return this._kernel.assets.createMaterial(definition);
        } catch (error) {
            if (error instanceof SceneMaterialError) {
                throw error;
            }
            throw new SceneMaterialError(
                `Failed to create material '${definition.id}'`,
                error instanceof Error ? error : undefined
            );
        }
    }

    setMaterialUniform(materialId: string, name: string, value: SceneUniformValue): this {
        this.assertNotDisposed();
        if (!this._kernel.assets.setMaterialUniform(materialId, name, value)) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        return this;
    }

    setMaterialTexture(
        materialId: string,
        name: string,
        binding: SceneTextureBindingDefinition
    ): this {
        this.assertNotDisposed();
        if (!this._kernel.assets.setMaterialTexture(materialId, name, binding)) {
            throw new SceneMaterialError(`Material '${materialId}' is not registered`);
        }

        return this;
    }

    getMaterial(materialId: string): SceneMaterialHandle | null {
        return this._kernel.assets.getMaterial(materialId);
    }

    createCameraActor(actorConfig: ActorConfig = {}, cameraConfig: CameraConfig = {}) {
        this.assertNotDisposed();
        return this._actors3d.createCameraActor(actorConfig, cameraConfig);
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ) {
        this.assertNotDisposed();
        return this._actors3d.createRenderableActor(actorConfig, rendererConfig);
    }

    registerMesh(definition: SceneMeshDefinition): SceneMeshHandle {
        this.assertNotDisposed();
        return this._kernel.assets.registerMesh(definition);
    }

    getMesh(id: string): SceneMeshHandle | null {
        return this._kernel.assets.getMesh(id);
    }

    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle {
        this.assertNotDisposed();
        return this._kernel.assets.registerSampler(definition);
    }

    getSampler(id: string): SceneSamplerHandle | null {
        return this._kernel.assets.getSampler(id);
    }

    async registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle> {
        this.assertNotDisposed();
        return await this._kernel.assets.registerTexture(definition);
    }

    getTexture(id: string): SceneTextureHandle | null {
        return this._kernel.assets.getTexture(id);
    }

    getTextureResource(id: string): SceneTextureResourceHandle | null {
        return this._kernel.assets.getTextureResource(id);
    }

    getMaterialTextureBindings(materialId: string): readonly SceneMaterialTextureBindingHandle[] {
        return this._kernel.assets.getMaterialTextureBindings(materialId);
    }

    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null {
        return this._kernel.assets.getMaterialTextureBinding(materialId, uniformName);
    }

    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        this.assertNotDisposed();
        return this._kernel.assets.registerRenderPass(definition);
    }

    getRenderPass(id: string): SceneRenderPassHandle | null {
        return this._kernel.assets.getRenderPass(id);
    }

    getRenderPasses(): readonly SceneRenderPassHandle[] {
        return this._kernel.assets.getRenderPasses();
    }

    createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): SceneMeshHandle {
        this.assertNotDisposed();
        return this._kernel.assets.createBoxMesh(id, width, height, depth);
    }

    createPlaneMesh(id: string, width: number = 1, height: number = 1): SceneMeshHandle {
        this.assertNotDisposed();
        return this._kernel.assets.createPlaneMesh(id, width, height);
    }

    createSphereMesh(id: string, radius: number = 1, segments: number = 24): SceneMeshHandle {
        this.assertNotDisposed();
        return this._kernel.assets.createSphereMesh(id, radius, segments);
    }
}

export const createScene = <R extends ComponentRegistry = Record<string, never>>(
    options: SceneOptions<R> = {}
): Scene<R> => new Scene(options);
