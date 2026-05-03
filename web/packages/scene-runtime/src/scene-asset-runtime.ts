import { Vec4 } from '@axrone/numeric';
import {
    createBox,
    createCapsule,
    createCone,
    createCylinder,
    createPlane,
    createQuad,
    createSphere,
    createTorus,
} from '@axrone/geometry';
import {
    FilterMode,
    TextureFormat,
    TextureFormatInfo,
    WrapMode,
    WebGLTextureManager,
} from '@axrone/render-webgl2';
import {
    SceneMaterialError,
} from './errors';
import { SceneGeometryMeshBuilder } from './scene-geometry-mesh-builder';
import { SceneMeshFactory } from './scene-mesh-factory';
import type { SceneMeshResource } from './mesh-registry';
import type { SceneShaderResource } from './shader-registry';
import { SceneShaderFactory } from './scene-shader-factory';
import {
    SceneResourceRuntime,
    type SceneResourceRuntimeSerializationResult,
} from './scene-resource-runtime';
import { SceneTextureFactory } from './scene-texture-factory';
import type {
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialTextureBindingHandle,
    SceneMeshDefinition,
    SceneMeshHandle,
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

export interface SceneAssetRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly defaultPassId: string;
    readonly defaultClearColor: Vec4;
    readonly releaseBaseMesh: (meshId: string) => void;
    readonly clearRenderRuntime: () => void;
}

export class SceneAssetRuntime {
    readonly resources: SceneResourceRuntime;

    private readonly _geometryMeshBuilder = new SceneGeometryMeshBuilder();
    private readonly _meshFactory: SceneMeshFactory;
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _textureManager: WebGLTextureManager;
    private readonly _textureFactory: SceneTextureFactory;

    constructor(private readonly _options: SceneAssetRuntimeOptions) {
        this._meshFactory = new SceneMeshFactory({ gl: _options.gl });
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
        this._textureManager = new WebGLTextureManager(_options.gl);
        this._textureFactory = new SceneTextureFactory({
            textureManager: this._textureManager,
        });

        const defaultSampler = this._textureManager.getDefaultSampler(
            FilterMode.LINEAR,
            WrapMode.REPEAT
        );
        this.resources = new SceneResourceRuntime({
            defaultPassId: _options.defaultPassId,
            defaultClearColor: _options.defaultClearColor,
            defaultSampler,
        });
    }

    registerShader(definition: SceneShaderDefinition): SceneShaderHandle {
        const resource = this._shaderFactory.create(definition);
        const result = this.resources.shaders.register(definition, resource);
        if (result.previous) {
            this._shaderFactory.delete(result.previous);
        }

        return result.handle;
    }

    getShader(id: string): SceneShaderHandle | null {
        return this.resources.shaders.getHandle(id);
    }

    createMaterial(definition: SceneMaterialDefinition): SceneMaterialHandle {
        if (!this.resources.shaders.get(definition.shaderId)) {
            throw new SceneMaterialError(
                `Cannot create material '${definition.id}' because shader '${definition.shaderId}' is not registered`
            );
        }

        return this.resources.materials.create(definition);
    }

    setMaterialUniform(materialId: string, name: string, value: SceneUniformValue): boolean {
        return this.resources.materials.setUniform(materialId, name, value);
    }

    setMaterialTexture(
        materialId: string,
        name: string,
        binding: SceneTextureBindingDefinition
    ): boolean {
        return this.resources.materials.setTexture(materialId, name, binding);
    }

    getMaterial(materialId: string): SceneMaterialHandle | null {
        return this.resources.materials.getHandle(materialId);
    }

    getMaterialTextureBindings(
        materialId: string
    ): readonly SceneMaterialTextureBindingHandle[] {
        return this.resources.getMaterialTextureBindings(materialId);
    }

    getMaterialTextureBinding(
        materialId: string,
        uniformName?: string
    ): SceneMaterialTextureBindingHandle | null {
        const bindings = this.getMaterialTextureBindings(materialId);
        if (bindings.length === 0) {
            return null;
        }
        if (!uniformName) {
            return bindings[0] ?? null;
        }

        return bindings.find((binding) => binding.uniformName === uniformName) ?? null;
    }

    registerMesh(definition: SceneMeshDefinition): SceneMeshHandle {
        this._options.releaseBaseMesh(definition.id);
        const resource = this._meshFactory.create(definition);
        const result = this.resources.meshes.register(definition, resource);
        if (result.previous) {
            this._meshFactory.dispose(result.previous);
        }

        return result.handle;
    }

    getMesh(id: string): SceneMeshHandle | null {
        return this.resources.meshes.getHandle(id);
    }

    createBoxMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        depth: number = 1
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createBox({
                    width,
                    height,
                    depth,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createPlaneMesh(id: string, width: number = 1, height: number = 1): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createPlane({
                    width,
                    height,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createSphereMesh(id: string, radius: number = 1, segments: number = 24): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createSphere({
                    radius,
                    widthSegments: segments,
                    heightSegments: segments,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: true,
                })
            )
        );
    }

    createQuadMesh(
        id: string,
        width: number = 1,
        height: number = 1,
        orientation: 'xy' | 'xz' | 'yz' = 'xy'
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createQuad({
                    width,
                    height,
                    orientation,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createCylinderMesh(
        id: string,
        radiusTop: number = 0.5,
        radiusBottom: number = 0.5,
        height: number = 1,
        radialSegments: number = 24,
        heightSegments: number = 1
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createCylinder({
                    radiusTop,
                    radiusBottom,
                    height,
                    radialSegments,
                    heightSegments,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createConeMesh(
        id: string,
        radius: number = 0.5,
        height: number = 1,
        radialSegments: number = 24,
        heightSegments: number = 1
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createCone({
                    radius,
                    height,
                    radialSegments,
                    heightSegments,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createCapsuleMesh(
        id: string,
        radius: number = 0.5,
        length: number = 1,
        capSegments: number = 12,
        radialSegments: number = 24
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createCapsule({
                    radius,
                    length,
                    capSegments,
                    radialSegments,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    createTorusMesh(
        id: string,
        radius: number = 0.56,
        tube: number = 0.18,
        radialSegments: number = 20,
        tubularSegments: number = 32
    ): SceneMeshHandle {
        return this.registerMesh(
            this._geometryMeshBuilder.createDefinition(
                id,
                createTorus({
                    radius,
                    tube,
                    radialSegments,
                    tubularSegments,
                    generateNormals: true,
                    generateTexCoords: true,
                    generateTangents: false,
                })
            )
        );
    }

    registerSampler(definition: SceneSamplerDefinition): SceneSamplerHandle {
        const sampler = this._textureManager.createSampler({
            minFilter: definition.minFilter ?? FilterMode.LINEAR,
            magFilter: definition.magFilter ?? FilterMode.LINEAR,
            wrapS: definition.wrapS ?? WrapMode.REPEAT,
            wrapT: definition.wrapT ?? WrapMode.REPEAT,
            wrapR: definition.wrapR,
            maxAnisotropy: definition.maxAnisotropy,
        });

        const result = this.resources.samplers.register(definition, {
            id: definition.id,
            sampler,
        });
        if (result.previous && !result.previous.sampler.isDisposed) {
            result.previous.sampler.dispose();
        }

        return result.handle;
    }

    getSampler(id: string): SceneSamplerHandle | null {
        return this.resources.samplers.getHandle(id);
    }

    async registerTexture(definition: SceneTextureDefinition): Promise<SceneTextureHandle> {
        const resource = await this._textureFactory.create(definition);
        const result = this.resources.textures.register(definition, resource);
        if (result.previous && !result.previous.texture.isDisposed) {
            result.previous.texture.dispose();
        }

        return result.handle;
    }

    getTexture(id: string): SceneTextureHandle | null {
        return this.resources.textures.getHandle(id);
    }

    getTextureResource(id: string): SceneTextureResourceHandle | null {
        return this.resources.getTextureResourceHandle(id);
    }

    getSupportedCompressedTextureFormats(
        preferredFormats?: readonly TextureFormat[]
    ): readonly TextureFormat[] {
        return TextureFormatInfo.getContextSupportedCompressedFormats(
            this._options.gl,
            preferredFormats
        );
    }

    registerRenderPass(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        return this.resources.renderPasses.register(definition);
    }

    getRenderPass(id: string): SceneRenderPassHandle | null {
        return this.resources.renderPasses.getHandle(id);
    }

    getRenderPasses(): readonly SceneRenderPassHandle[] {
        return this.resources.renderPasses.getHandles();
    }

    serializeDefinitions(): SceneResourceRuntimeSerializationResult {
        return this.resources.serializeDefinitions();
    }

    clearRenderPasses(): void {
        this.resources.renderPasses.clear();
    }

    clear(): void {
        this._options.clearRenderRuntime();
        this.resources.clear({
            deleteProgram: (shader: SceneShaderResource) => {
                this._shaderFactory.delete(shader);
            },
            disposeMesh: (mesh: SceneMeshResource) => {
                this._meshFactory.dispose(mesh);
            },
            disposeSampler: (sampler) => {
                if (!sampler.sampler.isDisposed) {
                    sampler.sampler.dispose();
                }
            },
            disposeTexture: (texture) => {
                if (!texture.texture.isDisposed) {
                    texture.texture.dispose();
                }
            },
        });
    }

    dispose(): void {
        this.clear();
        this._textureManager.dispose();
    }

    createMeshResource(definition: SceneMeshDefinition): SceneMeshResource {
        return this._meshFactory.create(definition);
    }

    disposeMesh(mesh: SceneMeshResource): void {
        this._meshFactory.dispose(mesh);
    }

    applyMissingVertexAttributeDefaults(mesh: Pick<SceneMeshResource, 'attributes'>): void {
        this._meshFactory.applyMissingVertexAttributeDefaults(mesh);
    }
}
