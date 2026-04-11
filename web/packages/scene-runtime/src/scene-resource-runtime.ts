import { Vec4 } from '@axrone/numeric';
import type { ITextureSampler } from '@axrone/render-webgl2';
import { SceneMaterialRegistry } from './material-registry';
import { SceneMeshRegistry, type SceneMeshResource } from './mesh-registry';
import { SceneRenderPassRegistry } from './render-pass-registry';
import { SceneSamplerRegistry, type SceneSamplerResource } from './sampler-registry';
import { SceneShaderRegistry, type SceneShaderResource } from './shader-registry';
import { SceneTextureRegistry, type SceneTextureResource } from './texture-registry';
import type {
    SceneMaterialTextureBindingHandle,
    SceneRenderPassDefinition,
    SceneSamplerDefinition,
    SceneShaderDefinition,
    SceneMeshDefinition,
    SceneTextureDefinition,
    SceneTextureResourceHandle,
} from './types';

export interface SceneResourceRuntimeOptions {
    readonly defaultPassId: string;
    readonly defaultClearColor: Vec4;
    readonly defaultSampler: ITextureSampler;
}

export interface SceneResourceRuntimeSerializationResult {
    readonly shaders: readonly SceneShaderDefinition[];
    readonly meshes: readonly SceneMeshDefinition[];
    readonly materials: ReturnType<SceneMaterialRegistry['getDefinitions']>;
    readonly textures: readonly SceneTextureDefinition[];
    readonly samplers: readonly SceneSamplerDefinition[];
    readonly renderPasses: readonly SceneRenderPassDefinition[];
}

export interface SceneResourceRuntimeClearCallbacks {
    readonly deleteProgram: (shader: SceneShaderResource) => void;
    readonly disposeMesh: (mesh: SceneMeshResource) => void;
    readonly disposeSampler: (sampler: SceneSamplerResource) => void;
    readonly disposeTexture: (texture: SceneTextureResource) => void;
}

export class SceneResourceRuntime {
    readonly shaders = new SceneShaderRegistry();
    readonly materials = new SceneMaterialRegistry();
    readonly meshes = new SceneMeshRegistry();
    readonly samplers: SceneSamplerRegistry;
    readonly textures = new SceneTextureRegistry();
    readonly renderPasses: SceneRenderPassRegistry;

    private readonly _defaultSampler: ITextureSampler;

    constructor(options: SceneResourceRuntimeOptions) {
        this._defaultSampler = options.defaultSampler;
        this.samplers = new SceneSamplerRegistry();
        this.renderPasses = new SceneRenderPassRegistry({
            defaultPassId: options.defaultPassId,
            defaultClearColor: options.defaultClearColor,
        });
    }

    resolveSampler(id: string | null): ITextureSampler {
        return this.samplers.resolve(id, this._defaultSampler);
    }

    getTextureResourceHandle(id: string): SceneTextureResourceHandle | null {
        const texture = this.textures.get(id);
        if (!texture) {
            return null;
        }

        const sampler = this.resolveSampler(texture.samplerId);
        return {
            id: texture.id,
            width: texture.width,
            height: texture.height,
            samplerId: texture.samplerId,
            nativeTexture: texture.texture.nativeHandle,
            nativeSampler: sampler.nativeHandle,
        };
    }

    getMaterialTextureBindings(
        materialId: string
    ): readonly SceneMaterialTextureBindingHandle[] {
        if (!this.materials.get(materialId)) {
            return [];
        }

        const bindings: SceneMaterialTextureBindingHandle[] = [];
        for (const slot of this.materials.getTextureSlots(materialId)) {
            const texture = this.textures.get(slot.binding.textureId);
            if (!texture) {
                continue;
            }

            const sampler = this.resolveSampler(slot.binding.samplerId ?? texture.samplerId);
            bindings.push({
                materialId,
                uniformName: slot.uniformName,
                textureId: slot.binding.textureId,
                samplerId: slot.binding.samplerId ?? texture.samplerId,
                unit: slot.resolvedUnit,
                width: texture.width,
                height: texture.height,
                nativeTexture: texture.texture.nativeHandle,
                nativeSampler: sampler.nativeHandle,
            });
        }

        return bindings;
    }

    serializeDefinitions(): SceneResourceRuntimeSerializationResult {
        return {
            shaders: this.shaders.getDefinitions(),
            meshes: this.meshes.getDefinitions(),
            materials: this.materials.getDefinitions(),
            textures: this.textures.getDefinitions(),
            samplers: this.samplers.getDefinitions(),
            renderPasses: this.renderPasses.getDefinitions(),
        };
    }

    clear(callbacks: SceneResourceRuntimeClearCallbacks): void {
        for (const shader of this.shaders.clear()) {
            callbacks.deleteProgram(shader);
        }

        for (const mesh of this.meshes.clear()) {
            callbacks.disposeMesh(mesh);
        }

        for (const sampler of this.samplers.clear()) {
            callbacks.disposeSampler(sampler);
        }

        for (const texture of this.textures.clear()) {
            callbacks.disposeTexture(texture);
        }

        this.materials.clear();
        this.renderPasses.clear();
    }
}
