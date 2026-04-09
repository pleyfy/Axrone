import { SceneMaterialError } from './errors';
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
    SceneTextureBindingDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
    SceneTextureResourceHandle,
    SceneUniformValue,
} from './types';
import type { ComponentRegistry } from '../component-system/types/core';

export class SceneAssetFacade<
    R extends ComponentRegistry = Record<string, never>,
> extends SceneRuntimeFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super(options);
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
