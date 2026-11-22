import { Mat4, Vec3 } from '@axrone/numeric';
import { Transform, type Actor } from '@axrone/ecs-runtime';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { BillboardRenderer } from '../components/billboard-renderer';
import { SceneMeshError } from '../errors';
import { SceneDirectGlPassGuard } from './internal/render-state-guard';
import { createBillboardShaderDefinition } from '../billboard-shader';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderStateApplier } from './render-state-applier';
import { SceneShaderFactory } from '../scene-shader-factory';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneUniformWriteTarget } from '../uniform-writer';

export interface SceneBillboardBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'reset'>;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
}

export interface SceneBillboardBatchRuntimeRenderParams {
    readonly actors: readonly Actor[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly frameState: SceneRenderFrameState;
}

export interface SceneBillboardBatchRuntimeRenderStats {
    readonly drawnBillboardCount: number;
    readonly totalVertexCount: number;
    readonly totalIndexCount: number;
}

const EMPTY_STATS: SceneBillboardBatchRuntimeRenderStats = Object.freeze({
    drawnBillboardCount: 0,
    totalVertexCount: 0,
    totalIndexCount: 0,
});

/**
 * Number of floats per billboard vertex: position (3) + uv (2) + color (4) = 9.
 * Same layout as the line/ribbon renderer.
 */
const BILLBOARD_VERTEX_FLOATS = 9;

/**
 * Number of indices per billboard quad: 2 triangles × 3 indices = 6.
 */
const BILLBOARD_INDICES_PER_QUAD = 6;

/**
 * Number of vertices per billboard quad.
 */
const BILLBOARD_VERTICES_PER_QUAD = 4;

const _identityMatrix = Mat4.IDENTITY;

// Module-level scratch vectors — reused across billboard draws to avoid
// per-billboard per-frame heap allocations on the hot path.
const _scratchRight = new Vec3();
const _scratchUp = new Vec3();
const _scratchViewDir = new Vec3();

const BILLBOARD_MODE_SPHERICAL = 0;
const BILLBOARD_MODE_CYLINDRICAL = 1;
const BILLBOARD_MODE_VELOCITY_ORIENTED = 2;

/**
 * Max quads per draw: 4 vertices per quad must stay inside the Uint16
 * index range (65536 vertices).
 */
const MAX_QUADS_PER_RUN = 16383;

// Corner offsets in unit-quad order: bottom-left, bottom-right,
// top-right, top-left. Shared constants — never allocated per frame.
const CORNER_OFFSET_X = [-0.5, 0.5, 0.5, -0.5];
const CORNER_OFFSET_Y = [-0.5, -0.5, 0.5, 0.5];

interface BillboardRunKey {
    readonly mode: number;
    readonly alphaTest: number;
    readonly depthWrite: boolean;
}

const resolveBillboardModeValue = (mode: string): number => {
    switch (mode) {
        case 'spherical':
            return BILLBOARD_MODE_SPHERICAL;
        case 'cylindrical':
            return BILLBOARD_MODE_CYLINDRICAL;
        case 'velocity-oriented':
            return BILLBOARD_MODE_VELOCITY_ORIENTED;
        default:
            return BILLBOARD_MODE_SPHERICAL;
    }
};

interface BillboardSubject {
    readonly actor: Actor;
    readonly renderer: BillboardRenderer;
}

/**
 * Renders every active {@link BillboardRenderer} in the scene as camera-facing
 * quads.
 *
 * Follows the {@link SceneLineBatchRuntime} pattern: owns a dynamic vertex
 * buffer + index buffer plus a self-managed shader, rebuilds quad geometry
 * each frame, and draws with alpha blending.
 */
export class SceneBillboardBatchRuntime {
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _guard: SceneDirectGlPassGuard;
    private _shader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _indexBuffer: WebGLBuffer | null = null;
    private _vertexData: Float32Array;
    private _indexData: Uint16Array;
    private _vertexCapacity: number;
    private _indexCapacity: number;
    private readonly _subjects: BillboardSubject[] = [];

    constructor(private readonly _options: SceneBillboardBatchRuntimeOptions) {
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
        this._guard = new SceneDirectGlPassGuard({
            gl: _options.gl,
            renderStateApplier: _options.renderStateApplier,
            stateCache: _options.stateCache,
            label: 'billboard-batch',
        });
        this._vertexCapacity = 256;
        this._indexCapacity = 384;
        this._vertexData = new Float32Array(this._vertexCapacity * BILLBOARD_VERTEX_FLOATS);
        this._indexData = new Uint16Array(this._indexCapacity);
    }

    render(params: SceneBillboardBatchRuntimeRenderParams): SceneBillboardBatchRuntimeRenderStats {
        if (this._guard.isDisabled) {
            return EMPTY_STATS;
        }

        this._subjects.length = 0;

        for (const actor of params.actors) {
            if (!actor.active) {
                continue;
            }

            const billboardRenderer = actor.getComponent(BillboardRenderer);
            if (billboardRenderer && billboardRenderer.enabled && billboardRenderer.visible) {
                this._subjects.push({ actor, renderer: billboardRenderer });
            }
        }

        if (this._subjects.length === 0) {
            return EMPTY_STATS;
        }

        const gl = this._options.gl;

        return this._guard.run(EMPTY_STATS, () => {
            let drawnBillboardCount = 0;
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
            gl.disable(gl.CULL_FACE);

            this._options.uniformWriter.write(
                shader,
                'u_ViewProjection',
                params.cameraFrame.viewProjectionMatrix
            );

            this._options.uniformWriter.write(shader, 'u_Model', _identityMatrix);
            this._options.uniformWriter.write(shader, 'u_UseTexture', 0);

            const cameraPosition = params.cameraFrame.position;

            // Reserve for every subject up front so the accumulation loop
            // below never reallocates mid-frame.
            this._ensureVertexCapacity(this._subjects.length * BILLBOARD_VERTICES_PER_QUAD);
            this._ensureIndexCapacity(this._subjects.length * BILLBOARD_INDICES_PER_QUAD);

            // Accumulate quads into the shared buffers and flush one draw
            // per run of identical per-subject state (mode, alpha cutoff,
            // depth write). Runs preserve subject order, so transparent
            // blending order is unchanged. A single state key across all
            // subjects collapses N draws into 1.
            let runQuads = 0;
            let runKey: BillboardRunKey | null = null;

            const flushRun = (): void => {
                if (runQuads === 0 || !runKey) {
                    return;
                }
                const vertexFloats = runQuads * BILLBOARD_VERTICES_PER_QUAD * BILLBOARD_VERTEX_FLOATS;
                const indexCount = runQuads * BILLBOARD_INDICES_PER_QUAD;

                gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
                gl.bufferData(
                    gl.ARRAY_BUFFER,
                    this._vertexData.subarray(0, vertexFloats),
                    gl.DYNAMIC_DRAW
                );

                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);
                gl.bufferData(
                    gl.ELEMENT_ARRAY_BUFFER,
                    this._indexData.subarray(0, indexCount),
                    gl.DYNAMIC_DRAW
                );

                this._options.uniformWriter.write(shader, 'u_BillboardMode', runKey.mode);
                this._options.uniformWriter.write(shader, 'u_AlphaTest', runKey.alphaTest);
                gl.depthMask(runKey.depthWrite);

                gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

                params.frameState.recordDraw({
                    topology: 'triangles',
                    indexCount,
                    vertexCount: runQuads * BILLBOARD_VERTICES_PER_QUAD,
                });

                totalVertexCount += runQuads * BILLBOARD_VERTICES_PER_QUAD;
                totalIndexCount += indexCount;
                runQuads = 0;
            };

            for (const subject of this._subjects) {
                const key = this._resolveRunKey(subject);
                if (
                    runKey === null ||
                    runKey.mode !== key.mode ||
                    runKey.alphaTest !== key.alphaTest ||
                    runKey.depthWrite !== key.depthWrite ||
                    runQuads >= MAX_QUADS_PER_RUN
                ) {
                    flushRun();
                    runKey = key;
                }
                if (this._appendBillboard(subject, runQuads, cameraPosition)) {
                    runQuads++;
                    drawnBillboardCount++;
                }
            }
            flushRun();

            return { drawnBillboardCount, totalVertexCount, totalIndexCount };
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
        this._subjects.length = 0;
    }

    private _resolveRunKey(subject: BillboardSubject): BillboardRunKey {
        const renderer = subject.renderer;
        return {
            mode: resolveBillboardModeValue(renderer.mode),
            alphaTest: renderer.alphaTest > 0 ? renderer.alphaTest : 0.004,
            depthWrite: renderer.depthWrite,
        };
    }

    private _appendBillboard(
        subject: BillboardSubject,
        quadIndex: number,
        cameraPosition: Vec3
    ): boolean {
        const renderer = subject.renderer;
        const transform = subject.actor.getComponent(Transform);

        if (!transform) {
            return false;
        }

        const worldPos = transform.worldPosition;
        const width = renderer.width;
        const height = renderer.height;

        if (width <= 0 || height <= 0) {
            return false;
        }

        const pivot = renderer.pivot;
        const mode = renderer.mode;

        // Compute billboard orientation vectors using module-level scratch
        // vectors — zero allocations on the hot path.
        const right = _scratchRight;
        const up = _scratchUp;

        if (mode === 'spherical') {
            // Spherical: quad always faces camera
            Vec3.subtract(worldPos, cameraPosition, _scratchViewDir);
            const viewLen = Vec3.len(_scratchViewDir);
            if (viewLen < 1e-6) {
                // Billboard at camera position, use default orientation
                right.set(1, 0, 0);
                up.set(0, 1, 0);
            } else {
                Vec3.normalize(_scratchViewDir, _scratchViewDir);

                // right = normalize(cross(Vec3.UP, viewDir))
                Vec3.cross(Vec3.UP, _scratchViewDir, _scratchRight);
                const rightLen = Vec3.len(_scratchRight);
                if (rightLen < 1e-6) {
                    // viewDir is parallel to Vec3.UP, pick arbitrary right
                    right.set(1, 0, 0);
                } else {
                    Vec3.normalize(_scratchRight, _scratchRight);
                }

                // up = cross(viewDir, right)
                Vec3.cross(_scratchViewDir, _scratchRight, _scratchUp);
            }
        } else if (mode === 'cylindrical') {
            // Cylindrical: only rotate around Y axis
            Vec3.subtract(worldPos, cameraPosition, _scratchViewDir);
            _scratchViewDir.y = 0;
            const viewDirYLen = Vec3.len(_scratchViewDir);
            if (viewDirYLen < 1e-6) {
                right.set(1, 0, 0);
            } else {
                Vec3.normalize(_scratchViewDir, _scratchViewDir);

                // right = normalize(cross(Vec3.UP, viewDirY))
                Vec3.cross(Vec3.UP, _scratchViewDir, _scratchRight);
                const rightLen = Vec3.len(_scratchRight);
                if (rightLen < 1e-6) {
                    right.set(1, 0, 0);
                } else {
                    Vec3.normalize(_scratchRight, _scratchRight);
                }
            }
            // Up is always world up for cylindrical
            up.set(0, 1, 0);
        } else {
            // Velocity-oriented: use identity orientation (local axes)
            right.set(1, 0, 0);
            up.set(0, 1, 0);
        }

        // Compute adjusted UVs
        const [u0, v0, uWidth, vHeight] = renderer.getAdjustedUVs();
        const u1 = u0 + uWidth;
        const v1 = v0 + vHeight;

        // Compute vertex color from component's color + opacity
        const color = renderer.color;
        const opacity = renderer.opacity;
        const cr = color.x;
        const cg = color.y;
        const cb = color.z;
        const ca = opacity;

        // Compute corner offsets relative to pivot
        // pivot (0.5, 0.5) means center; (0, 0) means bottom-left
        const pivotOffsetX = (0.5 - pivot.x) * width;
        const pivotOffsetY = (0.5 - pivot.y) * height;

        const vertexData = this._vertexData;
        const baseFloat = quadIndex * BILLBOARD_VERTICES_PER_QUAD * BILLBOARD_VERTEX_FLOATS;
        const baseVertex = quadIndex * BILLBOARD_VERTICES_PER_QUAD;

        // 4 corners: bottom-left, bottom-right, top-right, top-left.
        // Each corner: position = worldPos + (cornerOffset + pivotOffset) * right/up.
        // UVs selected branch-free from the corner index — no tuples allocated.
        for (let i = 0; i < BILLBOARD_VERTICES_PER_QUAD; i++) {
            const offset = baseFloat + i * BILLBOARD_VERTEX_FLOATS;
            const cx = CORNER_OFFSET_X[i]! * width + pivotOffsetX;
            const cy = CORNER_OFFSET_Y[i]! * height + pivotOffsetY;

            // position = worldPos + cx * right + cy * up
            vertexData[offset + 0] = worldPos.x + cx * right.x + cy * up.x;
            vertexData[offset + 1] = worldPos.y + cx * right.y + cy * up.y;
            vertexData[offset + 2] = worldPos.z + cx * right.z + cy * up.z;

            // uv
            vertexData[offset + 3] = i === 0 || i === 3 ? u0 : u1;
            vertexData[offset + 4] = i < 2 ? v1 : v0;

            // color
            vertexData[offset + 5] = cr;
            vertexData[offset + 6] = cg;
            vertexData[offset + 7] = cb;
            vertexData[offset + 8] = ca;
        }

        // Indices: two triangles (0,1,2) and (0,2,3), biased by baseVertex
        const indexData = this._indexData;
        const baseIndex = quadIndex * BILLBOARD_INDICES_PER_QUAD;
        indexData[baseIndex + 0] = baseVertex + 0;
        indexData[baseIndex + 1] = baseVertex + 1;
        indexData[baseIndex + 2] = baseVertex + 2;
        indexData[baseIndex + 3] = baseVertex + 0;
        indexData[baseIndex + 4] = baseVertex + 2;
        indexData[baseIndex + 5] = baseVertex + 3;

        return true;
    }

    private _ensureVertexCapacity(vertexCount: number): void {
        const requiredFloats = vertexCount * BILLBOARD_VERTEX_FLOATS;
        if (requiredFloats <= this._vertexData.length) {
            return;
        }
        let capacity = Math.max(this._vertexCapacity, 1);
        while (capacity * BILLBOARD_VERTEX_FLOATS < requiredFloats) {
            capacity *= 2;
        }
        this._vertexCapacity = capacity;
        const grown = new Float32Array(capacity * BILLBOARD_VERTEX_FLOATS);
        grown.set(this._vertexData);
        this._vertexData = grown;
    }

    private _ensureIndexCapacity(indexCount: number): void {
        if (indexCount <= this._indexData.length) {
            return;
        }
        let capacity = Math.max(this._indexCapacity, 1);
        while (capacity < indexCount) {
            capacity *= 2;
        }
        this._indexCapacity = capacity;
        const grown = new Uint16Array(capacity);
        grown.set(this._indexData);
        this._indexData = grown;
    }

    private _ensureResources(): void {
        const gl = this._options.gl;

        if (!this._shader) {
            this._shader = this._shaderFactory.create(createBillboardShaderDefinition());
        }

        if (this._vertexArray && this._vertexBuffer && this._indexBuffer) {
            return;
        }

        this._vertexArray = gl.createVertexArray();
        if (!this._vertexArray) {
            throw new SceneMeshError('Failed to create billboard vertex array');
        }

        this._vertexBuffer = gl.createBuffer();
        if (!this._vertexBuffer) {
            throw new SceneMeshError('Failed to create billboard vertex buffer');
        }

        this._indexBuffer = gl.createBuffer();
        if (!this._indexBuffer) {
            throw new SceneMeshError('Failed to create billboard index buffer');
        }

        gl.bindVertexArray(this._vertexArray);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._indexBuffer);

        const strideBytes = BILLBOARD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

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
