import type { Actor } from '@axrone/ecs-runtime';
import {
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    Render2DSpriteBatchBuilder,
    type Render2DSpriteBatchBuildResult,
    type Render2DSpriteBatchRange,
    type Render2DSpriteSource,
    type Render2DSpriteSubmission,
} from '@axrone/render-2d';
import { SceneMeshError } from './errors';
import type { SceneCameraFrameState } from './camera-frame-state';
import type { SceneMaterialTextureUniformSetter } from './material-texture-binder';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from './scene-resource-runtime';
import { SceneShaderFactory } from './scene-shader-factory';
import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformWriteTarget } from './uniform-writer';
import { createSprite2DShaderDefinition } from './sprite-2d-shader';
import { SceneSpriteRenderItemCollector } from './sprite-render-item-collector';

export interface SceneSpriteBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly materialTextureBinder: Pick<
        import('./material-texture-binder').SceneMaterialTextureBinder,
        'bind' | 'unbind'
    >;
    readonly textureUniformSetter: SceneMaterialTextureUniformSetter;
}

export interface SceneSpriteBatchRuntimeRenderParams {
    readonly actors: readonly Actor[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly renderPass: SceneRenderPassResource;
    readonly frameState: SceneRenderFrameState;
}

export class SceneSpriteBatchRuntime {
    private readonly _collector = new SceneSpriteRenderItemCollector();
    private readonly _builder = new Render2DSpriteBatchBuilder();
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _submissions: Render2DSpriteSubmission[] = [];
    private _defaultShader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _indexBuffer: WebGLBuffer | null = null;

    constructor(private readonly _options: SceneSpriteBatchRuntimeOptions) {
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
    }

    render(params: SceneSpriteBatchRuntimeRenderParams): void {
        const items = this._collector.collect(params.actors, params.renderPass.rendererPassId);
        if (items.length === 0) {
            return;
        }

        this._ensureResources();

        this._submissions.length = 0;
        for (const item of items) {
            const source = this._resolveSource(item.renderer);
            if (!source) {
                continue;
            }

            params.frameState.markActiveRenderer(item.renderer.id);
            this._submissions.push({
                source,
                worldMatrix: item.transform.worldMatrix.data,
                size: {
                    width: item.renderer.size.x,
                    height: item.renderer.size.y,
                },
                anchor: item.renderer.anchor,
                uvRect: item.renderer.uvRect,
                color: item.renderer.color,
                visible: item.renderer.visible,
                flipX: item.renderer.flipX,
                flipY: item.renderer.flipY,
            });
        }

        if (this._submissions.length === 0) {
            return;
        }

        const buildResult = this._builder.build(this._submissions);
        if (buildResult.indexCount === 0) {
            return;
        }

        const indexType =
            buildResult.indexData instanceof Uint32Array
                ? this._options.gl.UNSIGNED_INT
                : this._options.gl.UNSIGNED_SHORT;

        this._upload(buildResult);

        this._options.gl.bindVertexArray(this._vertexArray);
        for (const batch of buildResult.batches) {
            this._drawBatch(batch, indexType, params);
        }
        this._options.gl.bindVertexArray(null);
    }

    clear(): void {
        if (this._defaultShader) {
            this._shaderFactory.delete(this._defaultShader);
            this._defaultShader = null;
        }

        if (this._vertexArray) {
            this._options.gl.deleteVertexArray(this._vertexArray);
            this._vertexArray = null;
        }

        if (this._vertexBuffer) {
            this._options.gl.deleteBuffer(this._vertexBuffer);
            this._vertexBuffer = null;
        }

        if (this._indexBuffer) {
            this._options.gl.deleteBuffer(this._indexBuffer);
            this._indexBuffer = null;
        }

        this._submissions.length = 0;
    }

    private _resolveSource(
        renderer: import('./components/sprite-renderer').SpriteRenderer
    ): Render2DSpriteSource | null {
        if (renderer.materialId) {
            return {
                kind: 'material',
                materialId: renderer.materialId,
            };
        }

        if (renderer.textureId) {
            return {
                kind: 'texture',
                textureId: renderer.textureId,
            };
        }

        return null;
    }

    private _ensureResources(): void {
        if (!this._defaultShader) {
            this._defaultShader = this._shaderFactory.create(
                createSprite2DShaderDefinition('__scene/runtime-sprite-2d')
            );
        }

        if (!this._vertexArray) {
            this._vertexArray = this._options.gl.createVertexArray();
            if (!this._vertexArray) {
                throw new SceneMeshError('Failed to create 2D sprite vertex array');
            }
        }

        if (!this._vertexBuffer) {
            this._vertexBuffer = this._options.gl.createBuffer();
            if (!this._vertexBuffer) {
                throw new SceneMeshError('Failed to create 2D sprite vertex buffer');
            }
        }

        if (!this._indexBuffer) {
            this._indexBuffer = this._options.gl.createBuffer();
            if (!this._indexBuffer) {
                throw new SceneMeshError('Failed to create 2D sprite index buffer');
            }
        }

        this._options.gl.bindVertexArray(this._vertexArray);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, this._vertexBuffer);
        this._options.gl.bindBuffer(
            this._options.gl.ELEMENT_ARRAY_BUFFER,
            this._indexBuffer
        );
        this._options.gl.enableVertexAttribArray(0);
        this._options.gl.vertexAttribPointer(
            0,
            3,
            this._options.gl.FLOAT,
            false,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            0
        );
        this._options.gl.enableVertexAttribArray(2);
        this._options.gl.vertexAttribPointer(
            2,
            2,
            this._options.gl.FLOAT,
            false,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            12
        );
        this._options.gl.enableVertexAttribArray(3);
        this._options.gl.vertexAttribPointer(
            3,
            4,
            this._options.gl.UNSIGNED_BYTE,
            true,
            RENDER_2D_SPRITE_VERTEX_STRIDE,
            20
        );
        this._options.gl.bindVertexArray(null);
    }

    private _upload(buildResult: Render2DSpriteBatchBuildResult): void {
        this._options.gl.bindVertexArray(this._vertexArray);
        this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, this._vertexBuffer);
        this._options.gl.bufferData(
            this._options.gl.ARRAY_BUFFER,
            buildResult.vertexData,
            this._options.gl.DYNAMIC_DRAW
        );
        this._options.gl.bindBuffer(
            this._options.gl.ELEMENT_ARRAY_BUFFER,
            this._indexBuffer
        );
        this._options.gl.bufferData(
            this._options.gl.ELEMENT_ARRAY_BUFFER,
            buildResult.indexData,
            this._options.gl.DYNAMIC_DRAW
        );
    }

    private _drawBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams
    ): void {
        if (batch.key.source.kind === 'material') {
            this._drawMaterialBatch(batch, indexType, params);
            return;
        }

        this._drawTextureBatch(batch, indexType, params);
    }

    private _drawMaterialBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams
    ): void {
        if (batch.key.source.kind !== 'material') {
            return;
        }

        const material = this._options.resources.materials.get(batch.key.source.materialId);
        if (!material) {
            return;
        }

        const shader = this._options.resources.shaders.get(material.shaderId);
        if (!shader || !this._isSpriteShader(shader)) {
            return;
        }

        this._options.renderStateApplier.apply(shader, params.renderPass);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        this._options.materialTextureBinder.bind(
            shader,
            material,
            this._options.resources,
            this._options.textureUniformSetter
        );

        for (const [name, value] of material.uniforms) {
            this._options.uniformWriter.write(shader, name, value);
        }

        this._options.gl.drawElements(
            this._options.gl.TRIANGLES,
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordTriangles(batch.quadCount * 2);
        this._options.materialTextureBinder.unbind();
    }

    private _drawTextureBatch(
        batch: Render2DSpriteBatchRange,
        indexType: number,
        params: SceneSpriteBatchRuntimeRenderParams
    ): void {
        if (batch.key.source.kind !== 'texture') {
            return;
        }

        const texture = this._options.resources.textures.get(batch.key.source.textureId);
        const shader = this._defaultShader;
        if (!texture || !shader) {
            return;
        }

        this._options.renderStateApplier.apply(shader, params.renderPass);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        texture.texture.bind(0);
        this._options.resources.resolveSampler(texture.samplerId).bind(0);
        this._options.uniformWriter.write(shader, 'u_MainTex', 0);
        this._options.gl.drawElements(
            this._options.gl.TRIANGLES,
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordTriangles(batch.quadCount * 2);
        this._options.gl.bindSampler(0, null);
        this._options.gl.activeTexture(this._options.gl.TEXTURE0);
        this._options.gl.bindTexture(this._options.gl.TEXTURE_2D, null);
    }

    private _isSpriteShader(shader: SceneShaderResource): boolean {
        return shader.uniformNames.includes('u_ViewProjection');
    }

    private _resolveIndexByteSize(indexType: number): number {
        return indexType === this._options.gl.UNSIGNED_INT
            ? Uint32Array.BYTES_PER_ELEMENT
            : Uint16Array.BYTES_PER_ELEMENT;
    }
}