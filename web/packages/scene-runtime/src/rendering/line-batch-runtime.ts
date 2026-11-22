import { Mat4, Vec4 } from '@axrone/numeric';
import { Transform, type Actor } from '@axrone/ecs-runtime';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { LineRenderer } from '../components/line-renderer';
import { TrailRenderer } from '../components/trail-renderer';
import { SceneMeshError } from '../errors';
import { SceneDirectGlPassGuard } from './internal/render-state-guard';
import { createLineShaderDefinition } from '../line-shader';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderStateApplier } from './render-state-applier';
import { SceneShaderFactory } from '../scene-shader-factory';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneUniformWriteTarget } from '../uniform-writer';
import {
    buildLineRibbon,
    buildTrailRibbon,
    LINE_VERTEX_FLOATS,
    type LineRibbonResult,
} from './line-geometry-builder';

export interface SceneLineBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'reset'>;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
}

export interface SceneLineBatchRuntimeRenderParams {
    readonly actors: readonly Actor[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly frameState: SceneRenderFrameState;
}

export interface SceneLineBatchRuntimeRenderStats {
    readonly drawnLineCount: number;
    readonly drawnTrailCount: number;
    readonly totalVertexCount: number;
    readonly totalIndexCount: number;
}

const EMPTY_STATS: SceneLineBatchRuntimeRenderStats = Object.freeze({
    drawnLineCount: 0,
    drawnTrailCount: 0,
    totalVertexCount: 0,
    totalIndexCount: 0,
});

interface LineSubject {
    readonly actor: Actor;
    readonly renderer: LineRenderer;
}

interface TrailSubject {
    readonly actor: Actor;
    readonly renderer: TrailRenderer;
}

const _identityMatrix = Mat4.IDENTITY;

/**
 * Renders every active {@link LineRenderer} and {@link TrailRenderer} in the
 * scene as ribbon triangle meshes.
 *
 * Follows the {@link SceneParticleBatchRuntime} pattern: owns a dynamic vertex
 * buffer + index buffer plus a self-managed shader, rebuilds ribbon geometry
 * each frame, and draws with alpha blending.
 */
export class SceneLineBatchRuntime {
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _guard: SceneDirectGlPassGuard;
    private _shader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _indexBuffer: WebGLBuffer | null = null;
    private readonly _lineSubjects: LineSubject[] = [];
    private readonly _trailSubjects: TrailSubject[] = [];

    constructor(private readonly _options: SceneLineBatchRuntimeOptions) {
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
        this._guard = new SceneDirectGlPassGuard({
            gl: _options.gl,
            renderStateApplier: _options.renderStateApplier,
            stateCache: _options.stateCache,
            label: 'line-batch',
        });
    }

    render(params: SceneLineBatchRuntimeRenderParams): SceneLineBatchRuntimeRenderStats {
        if (this._guard.isDisabled) {
            return EMPTY_STATS;
        }

        this._lineSubjects.length = 0;
        this._trailSubjects.length = 0;

        for (const actor of params.actors) {
            if (!actor.active) {
                continue;
            }

            const lineRenderer = actor.getComponent(LineRenderer);
            if (lineRenderer && lineRenderer.enabled && lineRenderer.positionCount >= 2) {
                this._lineSubjects.push({ actor, renderer: lineRenderer });
            }

            const trailRenderer = actor.getComponent(TrailRenderer);
            if (trailRenderer && trailRenderer.enabled && trailRenderer.pointCount >= 2) {
                this._trailSubjects.push({ actor, renderer: trailRenderer });
            }
        }

        if (this._lineSubjects.length === 0 && this._trailSubjects.length === 0) {
            return EMPTY_STATS;
        }

        const gl = this._options.gl;

        return this._guard.run(EMPTY_STATS, () => {
            let drawnLineCount = 0;
            let drawnTrailCount = 0;
            let totalVertexCount = 0;
            let totalIndexCount = 0;

            this._ensureResources();

            const shader = this._shader!;

            gl.useProgram(shader.program);
            gl.bindVertexArray(this._vertexArray);

            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(false);
            gl.disable(gl.CULL_FACE);

            this._options.uniformWriter.write(
                shader,
                'u_ViewProjection',
                params.cameraFrame.viewProjectionMatrix
            );

            for (const subject of this._lineSubjects) {
                const result = this._drawLineSubject(gl, shader, subject, params);
                if (result) {
                    drawnLineCount++;
                    totalVertexCount += result.vertexCount;
                    totalIndexCount += result.indexCount;
                }
            }

            for (const subject of this._trailSubjects) {
                const result = this._drawTrailSubject(gl, shader, subject, params);
                if (result) {
                    drawnTrailCount++;
                    totalVertexCount += result.vertexCount;
                    totalIndexCount += result.indexCount;
                }
            }

            return { drawnLineCount, drawnTrailCount, totalVertexCount, totalIndexCount };
        });
    }

    clear(): void {
        const gl = this._options.gl;
        if (this._shader) {
            this._shaderFactory.delete(this._shader);
            this._shader = null;
        }
        if (this._vertexArray) {
            gl.deleteVertexArray(this._vertexArray);
            this._vertexArray = null;
        }
        if (this._vertexBuffer) {
            gl.deleteBuffer(this._vertexBuffer);
            this._vertexBuffer = null;
        }
        if (this._indexBuffer) {
            gl.deleteBuffer(this._indexBuffer);
            this._indexBuffer = null;
        }
        this._lineSubjects.length = 0;
        this._trailSubjects.length = 0;
    }

    private _drawLineSubject(
        gl: WebGL2RenderingContext,
        shader: SceneShaderResource,
        subject: LineSubject,
        params: SceneLineBatchRuntimeRenderParams
    ): { vertexCount: number; indexCount: number } | null {
        const renderer = subject.renderer;
        const positions = renderer.getPositions();

        if (positions.length < 2) {
            return null;
        }

        const gradientStops: { position: number; color: Vec4 }[] = [];
        for (const stop of renderer.colorGradient) {
            const c = stop.color;
            const color = c instanceof Vec4 ? c : Vec4.fromArray(c as readonly [number, number, number, number]);
            gradientStops.push({ position: stop.position, color });
        }

        const worldMatrix = renderer.useWorldSpace
            ? null
            : (subject.actor.getComponent(Transform)?.worldMatrix ?? null);

        const ribbon = buildLineRibbon({
            positions,
            startWidth: renderer.startWidth,
            endWidth: renderer.endWidth,
            widthCurve: renderer.widthCurve,
            startColor: renderer.startColor,
            endColor: renderer.endColor,
            colorGradientStops: gradientStops,
            textureMode: renderer.textureMode,
            alignment: renderer.alignment,
            textureScaleX: renderer.textureScale[0],
            textureScaleY: renderer.textureScale[1],
            loop: renderer.loop,
            useWorldSpace: renderer.useWorldSpace,
            worldMatrix,
        }, params.cameraFrame.position);

        if (ribbon.vertexCount === 0) {
            return null;
        }

        this._uploadRibbon(gl, ribbon);

        const modelMatrix = worldMatrix ?? _identityMatrix;
        this._options.uniformWriter.write(shader, 'u_Model', modelMatrix);
        this._options.uniformWriter.write(shader, 'u_UseTexture', 0);

        gl.drawElements(gl.TRIANGLES, ribbon.indexCount, gl.UNSIGNED_SHORT, 0);

        params.frameState.recordDraw({
            topology: 'triangles',
            indexCount: ribbon.indexCount,
            vertexCount: ribbon.vertexCount,
        });

        return { vertexCount: ribbon.vertexCount, indexCount: ribbon.indexCount };
    }

    private _drawTrailSubject(
        gl: WebGL2RenderingContext,
        shader: SceneShaderResource,
        subject: TrailSubject,
        params: SceneLineBatchRuntimeRenderParams
    ): { vertexCount: number; indexCount: number } | null {
        const renderer = subject.renderer;
        const trailPoints = renderer.getPoints();

        if (trailPoints.length < 2) {
            return null;
        }

        const positions: { x: number; y: number; z: number }[] = [];
        for (const point of trailPoints) {
            positions.push(point.position);
        }

        const gradientStops: { position: number; color: Vec4 }[] = [];
        for (const stop of renderer.colorGradient) {
            const c = stop.color;
            const color = c instanceof Vec4 ? c : Vec4.fromArray(c as readonly [number, number, number, number]);
            gradientStops.push({ position: stop.position, color });
        }

        const worldMatrix = subject.actor.getComponent(Transform)?.worldMatrix ?? null;

        const ribbon = buildTrailRibbon({
            positions: positions as any,
            startWidth: renderer.startWidth,
            endWidth: renderer.endWidth,
            widthCurve: renderer.widthCurve,
            colorGradientStops: gradientStops,
            textureMode: renderer.textureMode,
            alignment: renderer.alignment,
            textureScaleX: renderer.textureScale[0],
            textureScaleY: renderer.textureScale[1],
            worldMatrix,
        }, params.cameraFrame.position);

        if (ribbon.vertexCount === 0) {
            return null;
        }

        this._uploadRibbon(gl, ribbon);

        this._options.uniformWriter.write(shader, 'u_Model', _identityMatrix);
        this._options.uniformWriter.write(shader, 'u_UseTexture', 0);

        gl.drawElements(gl.TRIANGLES, ribbon.indexCount, gl.UNSIGNED_SHORT, 0);

        params.frameState.recordDraw({
            topology: 'triangles',
            indexCount: ribbon.indexCount,
            vertexCount: ribbon.vertexCount,
        });

        return { vertexCount: ribbon.vertexCount, indexCount: ribbon.indexCount };
    }

    /**
     * Uploads a freshly built ribbon straight to the dynamic buffers.
     * The builder already returns exact-fit arrays, so the previous
     * copy through persistent staging arrays (build → .set() → upload)
     * only doubled per-subject memory traffic — it is gone.
     */
    private _uploadRibbon(gl: WebGL2RenderingContext, ribbon: LineRibbonResult): void {
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            ribbon.vertexData.subarray(0, ribbon.vertexCount * LINE_VERTEX_FLOATS),
            gl.DYNAMIC_DRAW
        );

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);
        gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            ribbon.indexData.subarray(0, ribbon.indexCount),
            gl.DYNAMIC_DRAW
        );
    }

    private _ensureResources(): void {
        const gl = this._options.gl;

        if (!this._shader) {
            this._shader = this._shaderFactory.create(createLineShaderDefinition());
        }

        if (this._vertexArray && this._vertexBuffer && this._indexBuffer) {
            return;
        }

        this._vertexArray = gl.createVertexArray();
        if (!this._vertexArray) {
            throw new SceneMeshError('Failed to create line ribbon vertex array');
        }

        this._vertexBuffer = gl.createBuffer();
        if (!this._vertexBuffer) {
            throw new SceneMeshError('Failed to create line ribbon vertex buffer');
        }

        this._indexBuffer = gl.createBuffer();
        if (!this._indexBuffer) {
            throw new SceneMeshError('Failed to create line ribbon index buffer');
        }

        gl.bindVertexArray(this._vertexArray);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);

        const strideBytes = LINE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

        // position (location 0) — vec3 at offset 0
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, strideBytes, 0);

        // uv0 (location 2) — vec2 at offset 12
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, strideBytes, 3 * Float32Array.BYTES_PER_ELEMENT);

        // color0 (location 3) — vec4 at offset 20
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, strideBytes, 5 * Float32Array.BYTES_PER_ELEMENT);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
}
