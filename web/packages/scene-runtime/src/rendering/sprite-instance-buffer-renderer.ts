import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneMeshSemantic } from '../types';
import { compileSpriteMultiTextureProgram } from './sprite-instanced-renderer';

/** Per-instance transform stream: [a, b, c, d, tx, ty]. */
export const SPRITE_TRANSFORM_FLOATS_PER_INSTANCE = 6;
/** Per-instance static stream: [w, h, ax, ay, u0, v0, du, dv, r, g, b, a, textureSlot]. */
export const SPRITE_STATIC_FLOATS_PER_INSTANCE = 13;
const TRANSFORM_STRIDE = SPRITE_TRANSFORM_FLOATS_PER_INSTANCE * 4;
const STATIC_STRIDE = SPRITE_STATIC_FLOATS_PER_INSTANCE * 4;
const TEXTURE_SLOT_OFFSET = 12 * 4;
const INSTANCE_INDEX_COUNT = 6;

export interface SpriteInstanceBufferRendererOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
    /**
     * Number of simultaneously bindable texture slots for the multi-texture
     * path. Resolved from `MAX_TEXTURE_IMAGE_UNITS` by the caller and clamped
     * to [1, 32].
     */
    readonly textureSlotBudget: number;
}

/**
 * Order-preserving group view produced by the sprite instance registry.
 * `groupRanges` holds `[start, count]` pairs over the draw-ordered instance
 * stream; `groupTextureOffsets` indexes into `groupTextureIds`, one contiguous
 * slice of slot-bound texture ids per group. Groups never overlap or reorder
 * the stream, so replaying them in order reproduces painter order exactly.
 */
export interface SceneSpriteInstanceDrawView {
    readonly drawCount: number;
    readonly groupRanges: Int32Array;
    readonly groupTextureOffsets: Int32Array;
    readonly groupTextureIds: readonly string[];
    readonly groupCount: number;
}

/**
 * Homogeneous sprite renderer backed by two persistent instance streams:
 *
 *  - a transform stream that only changes for moving sprites, and
 *  - a static stream (size / anchor / uv / tint / texture slot) that only
 *    changes when the `SpriteRenderer` mutates.
 *
 * A static pass re-uses both GPU buffers untouched and issues its group draws;
 * a dynamic pass re-uploads the transform stream only. Sprites with different
 * textures are batched through a bound sampler array: consecutive sprites in
 * the ordered stream share one draw until the texture-slot budget is
 * exhausted, so painter order is preserved exactly and no alpha-mode gating is
 * required. This replaces the per-frame submission collection, sort and single
 * interleaved upload used by the legacy instanced path. The scene/actor model
 * is unchanged — the registry feeding these arrays is a derived render cache,
 * not a second scene.
 */
export class SpriteInstanceBufferRenderer {
    private readonly _gl: WebGL2RenderingContext;
    private readonly _resources: SceneResourceRuntime;
    private readonly _renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    private readonly _stateCache: import('@axrone/render-webgl2').IGLStateCache | undefined;
    private readonly _program: WebGLProgram;
    private readonly _vertexArray: WebGLVertexArrayObject;
    private readonly _quadBuffer: WebGLBuffer;
    private readonly _indexBuffer: WebGLBuffer;
    private readonly _transformBuffer: WebGLBuffer;
    private readonly _staticBuffer: WebGLBuffer;
    private readonly _viewProjectionLocation: WebGLUniformLocation | null;
    private readonly _textureSlotsLocation: WebGLUniformLocation | null;
    private readonly _textureSlotBudget: number;
    private readonly _slotUnits: Int32Array;
    private _texturesUniformWritten = false;
    private _shader: SceneShaderResource;
    private _transformCapacityBytes = 0;
    private _staticCapacityBytes = 0;

    constructor(options: SpriteInstanceBufferRendererOptions) {
        const gl = options.gl;
        this._gl = gl;
        this._resources = options.resources;
        this._renderStateApplier = options.renderStateApplier;
        this._stateCache = options.stateCache;
        this._textureSlotBudget = Math.max(1, Math.min(32, Math.floor(options.textureSlotBudget)));
        this._slotUnits = new Int32Array(this._textureSlotBudget);
        for (let index = 0; index < this._slotUnits.length; index += 1) {
            this._slotUnits[index] = index;
        }
        this._program = compileSpriteMultiTextureProgram(gl, this._textureSlotBudget);

        this._viewProjectionLocation = gl.getUniformLocation(this._program, 'u_ViewProjection');
        this._textureSlotsLocation = gl.getUniformLocation(this._program, 'u_Textures[0]');

        this._shader = {
            id: '__scene/runtime-sprite-instance-registry',
            program: this._program,
            uniformLocations: new Map(
                [
                    ['u_ViewProjection', this._viewProjectionLocation],
                    ['u_Textures[0]', this._textureSlotsLocation],
                ].filter((entry): entry is [string, WebGLUniformLocation] => entry[1] !== null)
            ),
            uniformTypes: new Map(),
            uniformNames: ['u_ViewProjection', 'u_Textures[0]'],
            attributeNames: {} as Record<SceneMeshSemantic, string>,
            depthTest: false,
            cull: false,
            blend: true,
        };

        const vertexArray = gl.createVertexArray();
        const quadBuffer = gl.createBuffer();
        const indexBuffer = gl.createBuffer();
        const transformBuffer = gl.createBuffer();
        const staticBuffer = gl.createBuffer();
        if (!vertexArray || !quadBuffer || !indexBuffer || !transformBuffer || !staticBuffer) {
            throw new Error('Failed to create sprite instance-registry GL resources');
        }
        this._vertexArray = vertexArray;
        this._quadBuffer = quadBuffer;
        this._indexBuffer = indexBuffer;
        this._transformBuffer = transformBuffer;
        this._staticBuffer = staticBuffer;
        this._setupBuffers();
    }

    /**
     * Uploads the instance streams. `count` is the number of instances in draw
     * order. `staticsDirty` forces a static-stream upload (skipped for pure
     * transform-only frames so static scenes never touch that buffer).
     */
    upload(
        transformData: Float32Array,
        staticData: Float32Array,
        count: number,
        staticsDirty: boolean
    ): void {
        if (count <= 0) {
            return;
        }

        const gl = this._gl;
        const transformBytes = count * TRANSFORM_STRIDE;
        const staticBytes = count * STATIC_STRIDE;
        let staticsCapacityGrew = false;

        gl.bindBuffer(gl.ARRAY_BUFFER, this._transformBuffer);
        if (transformBytes > this._transformCapacityBytes) {
            this._transformCapacityBytes = Math.max(transformBytes, this._transformCapacityBytes * 2);
            gl.bufferData(gl.ARRAY_BUFFER, this._transformCapacityBytes, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            transformData,
            0,
            count * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE
        );

        gl.bindBuffer(gl.ARRAY_BUFFER, this._staticBuffer);
        if (staticBytes > this._staticCapacityBytes) {
            this._staticCapacityBytes = Math.max(staticBytes, this._staticCapacityBytes * 2);
            gl.bufferData(gl.ARRAY_BUFFER, this._staticCapacityBytes, gl.DYNAMIC_DRAW);
            staticsCapacityGrew = true;
        }
        if (staticsDirty || staticsCapacityGrew) {
            gl.bufferSubData(
                gl.ARRAY_BUFFER,
                0,
                staticData,
                0,
                count * SPRITE_STATIC_FLOATS_PER_INSTANCE
            );
        }
    }

    /**
     * Draws the registry's ordered group view. Each group is a contiguous
     * instance range with up to `textureSlotBudget` distinct textures bound to
     * sampler units 0..k-1; groups are issued in stream order, so the
     * resulting image matches the general batch path exactly. Returns the
     * number of sprites drawn, or 0 when any group texture is unavailable
     * (caller falls back to the general path for that frame).
     */
    draw(
        view: SceneSpriteInstanceDrawView,
        limit: number,
        params: {
            readonly renderPass: SceneRenderPassResource;
            readonly cameraFrame: SceneCameraFrameState;
            readonly frameState: SceneRenderFrameState;
        }
    ): number {
        const total = Math.min(view.drawCount, limit);
        if (total <= 0 || view.groupCount <= 0) {
            return 0;
        }

        const gl = this._gl;
        const resources = this._resources;

        // Resolve every group's textures up front: a partially-resolvable
        // stream must not draw half a frame through the fast path.
        const textureCount = view.groupTextureIds.length;
        for (let index = 0; index < textureCount; index += 1) {
            if (!resources.textures.get(view.groupTextureIds[index]!)) {
                return 0;
            }
        }

        this._renderStateApplier.apply(this._shader, params.renderPass, null);
        gl.useProgram(this._program);
        gl.uniformMatrix4fv(
            this._viewProjectionLocation,
            false,
            params.cameraFrame.viewProjectionMatrix.data
        );
        if (!this._texturesUniformWritten) {
            if (this._textureSlotsLocation) {
                gl.uniform1iv(this._textureSlotsLocation, this._slotUnits);
            }
            this._texturesUniformWritten = true;
        }
        gl.bindVertexArray(this._vertexArray);

        let drawn = 0;
        let maxSlotsBound = 0;
        for (let group = 0; group < view.groupCount; group += 1) {
            const start = view.groupRanges[group * 2]!;
            let count = view.groupRanges[group * 2 + 1]!;
            if (start >= total) {
                break;
            }
            if (start + count > total) {
                count = total - start;
            }

            const slotsBound = this._bindGroupTextures(view, group);
            if (slotsBound > maxSlotsBound) {
                maxSlotsBound = slotsBound;
            }
            this._bindInstanceRanges(start, count);

            gl.drawElementsInstanced(
                gl.TRIANGLES,
                INSTANCE_INDEX_COUNT,
                gl.UNSIGNED_SHORT,
                0,
                count
            );
            params.frameState.recordDraw({
                topology: 'triangles',
                indexCount: count * INSTANCE_INDEX_COUNT,
                vertexCount: 0,
            });
            drawn += count;
        }

        gl.bindVertexArray(null);
        this._unbindTextureUnits(maxSlotsBound);
        return drawn;
    }

    clear(): void {
        const gl = this._gl;
        gl.deleteBuffer(this._quadBuffer);
        gl.deleteBuffer(this._indexBuffer);
        gl.deleteBuffer(this._transformBuffer);
        gl.deleteBuffer(this._staticBuffer);
        gl.deleteVertexArray(this._vertexArray);
        gl.deleteProgram(this._program);
        this._transformCapacityBytes = 0;
        this._staticCapacityBytes = 0;
        this._texturesUniformWritten = false;
    }

    private _bindGroupTextures(view: SceneSpriteInstanceDrawView, group: number): number {
        const gl = this._gl;
        const idStart = view.groupTextureOffsets[group]!;
        const idEnd = view.groupTextureOffsets[group + 1]!;
        for (let slot = idStart; slot < idEnd; slot += 1) {
            const texture = this._resources.textures.get(view.groupTextureIds[slot]!)!;
            const sampler = this._resources.resolveSampler(texture.samplerId);
            const unit = slot - idStart;
            if (this._stateCache) {
                this._stateCache.activeTexture(unit);
                this._stateCache.bindTexture(gl.TEXTURE_2D, texture.texture.nativeHandle);
                this._stateCache.bindSampler(unit, sampler.nativeHandle);
            } else {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, texture.texture.nativeHandle);
                gl.bindSampler(unit, sampler.nativeHandle);
            }
        }
        return idEnd - idStart;
    }

    private _unbindTextureUnits(count: number): void {
        if (count <= 0) {
            return;
        }
        const gl = this._gl;
        for (let unit = 0; unit < count; unit += 1) {
            if (this._stateCache) {
                this._stateCache.bindSampler(unit, null);
                this._stateCache.activeTexture(unit);
                this._stateCache.bindTexture(gl.TEXTURE_2D, null);
            } else {
                gl.bindSampler(unit, null);
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);
            }
        }
        // Leave unit 0 active, matching the previous single-texture contract.
        if (this._stateCache) {
            this._stateCache.activeTexture(0);
        } else {
            gl.activeTexture(gl.TEXTURE0);
        }
    }

    private _bindInstanceRanges(start: number, _count: number): void {
        const gl = this._gl;
        const transformBase = start * TRANSFORM_STRIDE;
        const staticBase = start * STATIC_STRIDE;

        gl.bindBuffer(gl.ARRAY_BUFFER, this._transformBuffer);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, TRANSFORM_STRIDE, transformBase);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, TRANSFORM_STRIDE, transformBase + 16);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._staticBuffer);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STATIC_STRIDE, staticBase);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, STATIC_STRIDE, staticBase + 16);
        gl.vertexAttribPointer(5, 4, gl.FLOAT, false, STATIC_STRIDE, staticBase + 32);
        gl.vertexAttribPointer(6, 1, gl.FLOAT, false, STATIC_STRIDE, staticBase + TEXTURE_SLOT_OFFSET);
    }

    private _setupBuffers(): void {
        const gl = this._gl;
        gl.bindVertexArray(this._vertexArray);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._transformBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, TRANSFORM_STRIDE, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, TRANSFORM_STRIDE, 16);
        gl.vertexAttribDivisor(2, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._staticBuffer);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STATIC_STRIDE, 0);
        gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, STATIC_STRIDE, 16);
        gl.vertexAttribDivisor(4, 1);
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 4, gl.FLOAT, false, STATIC_STRIDE, 32);
        gl.vertexAttribDivisor(5, 1);
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 1, gl.FLOAT, false, STATIC_STRIDE, TEXTURE_SLOT_OFFSET);
        gl.vertexAttribDivisor(6, 1);

        gl.bindVertexArray(null);
    }
}
