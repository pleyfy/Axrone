import { Transform, type Actor } from '@axrone/ecs-runtime';
import {
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    Render2DSpriteBatchBuilder,
    type Render2DRectLike,
    type Render2DSpriteMask,
    type Render2DSpriteBatchBuildResult,
    type Render2DSpriteBatchRange,
    type Render2DSpriteSource,
    type Render2DSpriteSubmission,
} from '@axrone/render-2d';
import type { SceneCameraFrameState } from './camera-frame-state';
import { SpriteMask } from './components/sprite-mask';
import { SceneMeshError } from './errors';
import { resolveSceneMaterialPass } from './material-registry';
import type { SceneMaterialTextureUniformSetter } from './material-texture-binder';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from './scene-resource-runtime';
import { SceneShaderFactory } from './scene-shader-factory';
import type { SceneShaderResource } from './shader-registry';
import { createSprite2DShaderDefinition } from './sprite-2d-shader';
import { SceneSpriteRenderItemCollector } from './sprite-render-item-collector';
import type { SceneUniformWriteTarget } from './uniform-writer';

const MIN_CLIP_W = 1e-6;

const areClipRectsEqual = (
    left: Render2DRectLike | null,
    right: Render2DRectLike | null
): boolean => {
    if (!left || !right) {
        return left == null && right == null;
    }

    return (
        left.x === right.x &&
        left.y === right.y &&
        left.width === right.width &&
        left.height === right.height
    );
};

const intersectClipRects = (
    left: Render2DRectLike,
    right: Render2DRectLike
): Render2DRectLike | null => {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const maxX = Math.min(left.x + left.width, right.x + right.width);
    const maxY = Math.min(left.y + left.height, right.y + right.height);
    const width = maxX - x;
    const height = maxY - y;

    if (width <= 0 || height <= 0) {
        return null;
    }

    return { x, y, width, height };
};

const transformWorldPoint = (
    matrix: ArrayLike<number>,
    localX: number,
    localY: number,
    out: Float32Array
): Float32Array => {
    out[0] = (matrix[0] ?? 0) * localX + (matrix[1] ?? 0) * localY + (matrix[3] ?? 0);
    out[1] = (matrix[4] ?? 0) * localX + (matrix[5] ?? 0) * localY + (matrix[7] ?? 0);
    out[2] = (matrix[8] ?? 0) * localX + (matrix[9] ?? 0) * localY + (matrix[11] ?? 0);
    return out;
};

const projectWorldPoint = (
    matrix: ArrayLike<number>,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportWidth: number,
    viewportHeight: number,
    out: Float32Array
): Float32Array => {
    const clipX =
        (matrix[0] ?? 0) * worldX +
        (matrix[1] ?? 0) * worldY +
        (matrix[2] ?? 0) * worldZ +
        (matrix[3] ?? 0);
    const clipY =
        (matrix[4] ?? 0) * worldX +
        (matrix[5] ?? 0) * worldY +
        (matrix[6] ?? 0) * worldZ +
        (matrix[7] ?? 0);
    const clipW =
        (matrix[12] ?? 0) * worldX +
        (matrix[13] ?? 0) * worldY +
        (matrix[14] ?? 0) * worldZ +
        (matrix[15] ?? 0);

    if (!Number.isFinite(clipW) || Math.abs(clipW) <= MIN_CLIP_W) {
        out[0] = NaN;
        out[1] = NaN;
        return out;
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    out[0] = (ndcX * 0.5 + 0.5) * viewportWidth;
    out[1] = (ndcY * 0.5 + 0.5) * viewportHeight;
    return out;
};

interface SceneResolvedSpriteMaskState {
    readonly clipRect: Render2DRectLike | null;
    readonly mask: Render2DSpriteMask | null;
}

export interface SceneSpriteBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<
        SceneRenderStateApplier,
        'apply' | 'resolvePrimitiveMode' | 'resolvePrimitiveTopology'
    >;
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
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export class SceneSpriteBatchRuntime {
    private readonly _collector = new SceneSpriteRenderItemCollector();
    private readonly _builder = new Render2DSpriteBatchBuilder();
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _submissions: Render2DSpriteSubmission[] = [];
    private readonly _worldPointScratch = new Float32Array(3);
    private readonly _screenPointScratch = new Float32Array(2);
    private _defaultShader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _indexBuffer: WebGLBuffer | null = null;
    private _scissorEnabled = false;
    private _activeClipRect: Render2DRectLike | null = null;
    private _activeMask: Render2DSpriteMask | null = null;

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

            const maskState = this._resolveMaskState(
                item.actor,
                params.cameraFrame,
                params.viewportWidth,
                params.viewportHeight
            );
            if (maskState === null) {
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
                clipRect: maskState.clipRect ?? undefined,
                mask: maskState.mask ?? undefined,
                slice: item.renderer.sliceBorder
                    ? {
                          sourceSize: {
                              width: item.renderer.sourceSize.x,
                              height: item.renderer.sourceSize.y,
                          },
                          border: item.renderer.sliceBorder,
                      }
                    : undefined,
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
            this._applyClipRect(batch.key.clipRect, params.viewportWidth, params.viewportHeight);
            this._drawBatch(batch, indexType, params);
        }
        this._options.gl.bindVertexArray(null);
        this._resetClipRect();
        this._resetMaskState();
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
        this._resetClipRect();
        this._resetMaskState();
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

        const materialPass = resolveSceneMaterialPass(material, params.renderPass.materialPassId);
        if (params.renderPass.materialPassId !== null && !materialPass) {
            return;
        }

        const shader = this._options.resources.shaders.get(material.shaderId);
        if (!shader || !this._isSpriteShader(shader)) {
            return;
        }

        this._options.renderStateApplier.apply(shader, params.renderPass, materialPass);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        this._applyMaskUniforms(shader, batch.key.mask);
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
            this._options.renderStateApplier.resolvePrimitiveMode(
                this._options.gl.TRIANGLES,
                materialPass
            ),
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordDraw({
            topology: materialPass?.primitive
                ? this._options.renderStateApplier.resolvePrimitiveTopology(
                      materialPass.primitive
                  )
                : 'triangles',
            indexCount: batch.indexCount,
            vertexCount: 0,
        });
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

        this._options.renderStateApplier.apply(shader, params.renderPass, null);
        this._options.gl.useProgram(shader.program);
        this._options.uniformWriter.write(
            shader,
            'u_ViewProjection',
            params.cameraFrame.viewProjectionMatrix
        );
        this._applyMaskUniforms(shader, batch.key.mask);
        texture.texture.bind(0);
        this._options.resources.resolveSampler(texture.samplerId).bind(0);
        this._options.uniformWriter.write(shader, 'u_MainTex', 0);
        this._options.gl.drawElements(
            this._options.gl.TRIANGLES,
            batch.indexCount,
            indexType,
            batch.indexOffset * this._resolveIndexByteSize(indexType)
        );
        params.frameState.recordDraw({
            topology: 'triangles',
            indexCount: batch.indexCount,
            vertexCount: 0,
        });
        this._options.gl.bindSampler(0, null);
        this._options.gl.activeTexture(this._options.gl.TEXTURE0);
        this._options.gl.bindTexture(this._options.gl.TEXTURE_2D, null);
    }

    private _resolveMaskState(
        actor: Actor,
        cameraFrame: SceneCameraFrameState,
        viewportWidth: number,
        viewportHeight: number
    ): SceneResolvedSpriteMaskState | null {
        let clipRect: Render2DRectLike | undefined;
        let shapeMask: Render2DSpriteMask | undefined;
        let current: Actor | undefined = actor;

        while (current) {
            const mask = current.getComponent(SpriteMask);
            if (mask?.enabled) {
                const transform = current.getComponent(Transform);
                if (!transform) {
                    return null;
                }

                const maskClipRect = this._projectMaskClipRect(
                    transform,
                    mask,
                    cameraFrame,
                    viewportWidth,
                    viewportHeight
                );
                if (!maskClipRect) {
                    return null;
                }

                const nextClipRect = clipRect
                    ? intersectClipRects(clipRect, maskClipRect)
                    : maskClipRect;
                if (!nextClipRect) {
                    return null;
                }

                clipRect = nextClipRect;

                if (!shapeMask && mask.shape !== 'rect') {
                    shapeMask = this._createMaskState(transform, mask);
                    if (!shapeMask) {
                        return null;
                    }
                }
            }

            current = current.parent;
        }

        return {
            clipRect: clipRect ?? null,
            mask: shapeMask ?? null,
        };
    }

    private _createMaskState(
        transform: Transform,
        mask: SpriteMask
    ): Render2DSpriteMask | undefined {
        if (mask.size.x <= 0 || mask.size.y <= 0) {
            return undefined;
        }

        const inverseWorldMatrix = transform.worldMatrix.clone().invert().data;

        return {
            shape: mask.shape === 'circle' ? 'circle' : 'rounded-rect',
            inverseWorldMatrix: Array.from(inverseWorldMatrix, (entry) => Number(entry ?? 0)),
            size: {
                width: mask.size.x,
                height: mask.size.y,
            },
            anchor: {
                x: mask.anchor.x,
                y: mask.anchor.y,
            },
            ...(mask.cornerRadius !== null && mask.cornerRadius !== undefined
                ? { cornerRadius: mask.cornerRadius }
                : {
                      cornerRadius:
                          mask.shape === 'rounded-rect'
                              ? Math.min(mask.size.x, mask.size.y) * 0.125
                              : undefined,
                  }),
        };
    }

    private _projectMaskClipRect(
        transform: Transform,
        mask: SpriteMask,
        cameraFrame: SceneCameraFrameState,
        viewportWidth: number,
        viewportHeight: number
    ): Render2DRectLike | null {
        if (mask.size.x <= 0 || mask.size.y <= 0) {
            return null;
        }

        const worldMatrix = transform.worldMatrix.data;
        const viewProjectionMatrix = cameraFrame.viewProjectionMatrix.data;
        const minX = -mask.anchor.x * mask.size.x;
        const minY = -mask.anchor.y * mask.size.y;
        const maxX = minX + mask.size.x;
        const maxY = minY + mask.size.y;

        let screenMinX = Number.POSITIVE_INFINITY;
        let screenMinY = Number.POSITIVE_INFINITY;
        let screenMaxX = Number.NEGATIVE_INFINITY;
        let screenMaxY = Number.NEGATIVE_INFINITY;

        const corners = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
        ] as const;

        for (let index = 0; index < corners.length; index += 1) {
            const corner = corners[index]!;
            const worldPoint = transformWorldPoint(
                worldMatrix,
                corner[0],
                corner[1],
                this._worldPointScratch
            );
            const screenPoint = projectWorldPoint(
                viewProjectionMatrix,
                worldPoint[0]!,
                worldPoint[1]!,
                worldPoint[2]!,
                viewportWidth,
                viewportHeight,
                this._screenPointScratch
            );

            if (!Number.isFinite(screenPoint[0]) || !Number.isFinite(screenPoint[1])) {
                return null;
            }

            screenMinX = Math.min(screenMinX, screenPoint[0]!);
            screenMinY = Math.min(screenMinY, screenPoint[1]!);
            screenMaxX = Math.max(screenMaxX, screenPoint[0]!);
            screenMaxY = Math.max(screenMaxY, screenPoint[1]!);
        }

        const clipX = Math.max(0, Math.floor(screenMinX));
        const clipY = Math.max(0, Math.floor(screenMinY));
        const clipMaxX = Math.min(viewportWidth, Math.ceil(screenMaxX));
        const clipMaxY = Math.min(viewportHeight, Math.ceil(screenMaxY));
        const width = clipMaxX - clipX;
        const height = clipMaxY - clipY;

        if (width <= 0 || height <= 0) {
            return null;
        }

        return { x: clipX, y: clipY, width, height };
    }

    private _applyClipRect(
        clipRect: Render2DRectLike | null,
        viewportWidth: number,
        viewportHeight: number
    ): void {
        if (!clipRect) {
            if (this._scissorEnabled) {
                this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
                this._scissorEnabled = false;
                this._activeClipRect = null;
            }
            return;
        }

        if (!this._scissorEnabled) {
            this._options.gl.enable?.(this._options.gl.SCISSOR_TEST);
            this._scissorEnabled = true;
        }

        const clampedClipRect = {
            x: Math.max(0, Math.floor(clipRect.x)),
            y: Math.max(0, Math.floor(clipRect.y)),
            width: 0,
            height: 0,
        };
        const clipMaxX = Math.min(viewportWidth, Math.ceil(clipRect.x + clipRect.width));
        const clipMaxY = Math.min(viewportHeight, Math.ceil(clipRect.y + clipRect.height));
        clampedClipRect.width = Math.max(0, clipMaxX - clampedClipRect.x);
        clampedClipRect.height = Math.max(0, clipMaxY - clampedClipRect.y);

        if (clampedClipRect.width === 0 || clampedClipRect.height === 0) {
            if (this._scissorEnabled) {
                this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
                this._scissorEnabled = false;
            }
            this._activeClipRect = null;
            return;
        }

        if (areClipRectsEqual(this._activeClipRect, clampedClipRect)) {
            return;
        }

        this._options.gl.scissor?.(
            clampedClipRect.x,
            clampedClipRect.y,
            clampedClipRect.width,
            clampedClipRect.height
        );
        this._activeClipRect = clampedClipRect;
    }

    private _applyMaskUniforms(
        shader: SceneShaderResource,
        mask: Render2DSpriteMask | null | undefined
    ): void {
        if (!mask) {
            this._options.uniformWriter.write(shader, 'u_MaskShape', 0);
            this._activeMask = null;
            return;
        }

        this._options.uniformWriter.write(
            shader,
            'u_MaskShape',
            mask.shape === 'circle' ? 1 : 2
        );
        this._options.uniformWriter.write(
            shader,
            'u_MaskWorldToLocal',
            Array.from(mask.inverseWorldMatrix, (entry) => Number(entry ?? 0))
        );
        this._options.uniformWriter.write(shader, 'u_MaskSize', [mask.size.width, mask.size.height]);
        this._options.uniformWriter.write(shader, 'u_MaskAnchor', [mask.anchor.x, mask.anchor.y]);
        this._options.uniformWriter.write(
            shader,
            'u_MaskCornerRadius',
            mask.cornerRadius ?? 0
        );
        this._activeMask = mask;
    }

    private _resetClipRect(): void {
        if (this._scissorEnabled) {
            this._options.gl.disable?.(this._options.gl.SCISSOR_TEST);
            this._scissorEnabled = false;
        }

        this._activeClipRect = null;
    }

    private _resetMaskState(): void {
        this._activeMask = null;
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
