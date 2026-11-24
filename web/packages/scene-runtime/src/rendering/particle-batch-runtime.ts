import { Mat4 } from '@axrone/numeric';
import { Transform, type EntityId } from '@axrone/ecs-runtime';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { ParticleSystem } from '../components/particle-system';
import type { ParticleRenderData } from '../components/particle-system';
import { SceneMeshError } from '../errors';
import { SceneDirectGlPassGuard } from './internal/render-state-guard';
import { createParticleShaderDefinition } from '../particle-shader';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderStateApplier } from './render-state-applier';
import { SceneShaderFactory } from '../scene-shader-factory';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneUniformWriteTarget } from '../uniform-writer';

/**
 * Interleaved point-sprite vertex layout (10 floats / 40 bytes):
 *   [0..2]  position (vec3)  -> attribute location 0
 *   [3]     rotation (float) -> attribute location 1
 *   [4..5]  size, seed (vec2)-> attribute location 2 (uv0)
 *   [6..9]  color rgba (vec4)-> attribute location 3 (color0)
 */
const PARTICLE_VERTEX_FLOATS = 10;
const PARTICLE_VERTEX_STRIDE_BYTES = PARTICLE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const MAX_POINT_SIZE = 256;
const ALPHA_EPSILON = 0.001;

const SPRITE_MODE_INDEX: Readonly<Record<string, number>> = Object.freeze({
    glow: 0,
    disc: 1,
    star: 2,
    spark: 3,
});

export interface SceneParticleBatchRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly uniformWriter: SceneUniformWriteTarget;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'reset'>;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
}

export interface SceneParticleBatchRuntimeRenderParams {
    readonly entities: readonly EntityId[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly frameState: SceneRenderFrameState;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export interface SceneParticleBatchRuntimeRenderStats {
    readonly drawnParticleCount: number;
    readonly particleSystemCount: number;
}

const EMPTY_STATS: SceneParticleBatchRuntimeRenderStats = Object.freeze({
    drawnParticleCount: 0,
    particleSystemCount: 0,
});

interface SceneParticleRenderSubject {
    readonly entity: EntityId;
    readonly system: ParticleSystem;
}

/**
 * Renders every active {@link ParticleSystem} in the scene as GPU point
 * sprites in a small number of draw calls (one per system).
 *
 * The runtime mirrors {@link SceneSpriteBatchRuntime}: it owns a dynamic
 * `DYNAMIC_DRAW` vertex buffer plus a self-managed shader, rebuilds the point
 * vertex cloud from each system's simulation buffers every frame, and draws
 * with per-system blending and sprite mode.
 *
 * The vertex construction is isolated in {@link _buildPointVertices} so an
 * instanced-billboard strategy can be introduced later without changing the
 * public contract (hybrid point/billboard design).
 */
export class SceneParticleBatchRuntime {
    private readonly _shaderFactory: SceneShaderFactory;
    private readonly _guard: SceneDirectGlPassGuard;
    private _shader: SceneShaderResource | null = null;
    private _vertexArray: WebGLVertexArrayObject | null = null;
    private _vertexBuffer: WebGLBuffer | null = null;
    private _vertexData: Float32Array;
    private _vertexCapacity: number;
    private readonly _subjects: SceneParticleRenderSubject[] = [];

    constructor(private readonly _options: SceneParticleBatchRuntimeOptions) {
        this._shaderFactory = new SceneShaderFactory({ gl: _options.gl });
        this._guard = new SceneDirectGlPassGuard({
            gl: _options.gl,
            renderStateApplier: _options.renderStateApplier,
            stateCache: _options.stateCache,
            label: 'particle-batch',
        });
        this._vertexCapacity = 1024;
        this._vertexData = new Float32Array(this._vertexCapacity * PARTICLE_VERTEX_FLOATS);
    }

    render(params: SceneParticleBatchRuntimeRenderParams): SceneParticleBatchRuntimeRenderStats {
        if (this._guard.isDisabled) {
            return EMPTY_STATS;
        }

        this._subjects.length = 0;
        for (const entity of params.entities) {
            if (!entity.active) {
                continue;
            }
            const system = entity.getComponent(ParticleSystem);
            if (system && system.enabled) {
                this._subjects.push({ entity, system });
            }
        }

        if (this._subjects.length === 0) {
            return EMPTY_STATS;
        }

        const gl = this._options.gl;

        return this._guard.run(EMPTY_STATS, () => {
            let drawnParticleCount = 0;
            let particleSystemCount = 0;

            this._ensureResources();

            const shader = this._shader!;

            gl.useProgram(shader.program);
            gl.bindVertexArray(this._vertexArray);

            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(false);
            gl.disable(gl.CULL_FACE);

            this._options.uniformWriter.write(
                shader,
                'u_ViewProjection',
                params.cameraFrame.viewProjectionMatrix
            );
            this._options.uniformWriter.write(shader, 'u_PointScale', params.viewportHeight * 0.5);
            this._options.uniformWriter.write(shader, 'u_MaxPointSize', MAX_POINT_SIZE);

            for (const subject of this._subjects) {
                const vertexCount = this._drawSubject(gl, shader, subject, params);
                if (vertexCount > 0) {
                    drawnParticleCount += vertexCount;
                    particleSystemCount += 1;
                }
            }

            return { drawnParticleCount, particleSystemCount };
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
        this._subjects.length = 0;
    }

    private _drawSubject(
        gl: WebGL2RenderingContext,
        shader: SceneShaderResource,
        subject: SceneParticleRenderSubject,
        params: SceneParticleBatchRuntimeRenderParams
    ): number {
        const data = subject.system.getRenderData();
        const vertexCount = this._buildPointVertices(data);
        if (vertexCount === 0) {
            return 0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            this._vertexData.subarray(0, vertexCount * PARTICLE_VERTEX_FLOATS),
            gl.DYNAMIC_DRAW
        );

        const modelMatrix =
            subject.system.simulationSpace === 'world'
                ? Mat4.IDENTITY
                : (subject.entity.getComponent(Transform)?.worldMatrix ?? Mat4.IDENTITY);
        this._options.uniformWriter.write(shader, 'u_Model', modelMatrix);
        this._options.uniformWriter.write(
            shader,
            'u_SpriteMode',
            SPRITE_MODE_INDEX[subject.system.spriteMode] ?? 0
        );

        const blendMode = subject.system.blendMode;
        switch (blendMode) {
            case 'additive':
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                break;
            case 'premultiplied':
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                break;
            case 'multiply':
                gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
                break;
            case 'screen':
                gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
                break;
            case 'soft-additive':
                gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA);
                break;
            case 'alpha':
            default:
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                break;
        }

        const particleTexture = subject.system.particleTexture;
        if (particleTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, particleTexture);
            this._options.uniformWriter.write(shader, 'u_Texture', 0);
            this._options.uniformWriter.write(shader, 'u_UseTexture', 1);

            const sheet = subject.system.textureSheetParams;
            this._options.uniformWriter.write(
                shader,
                'u_TexSheetParams',
                sheet ?? [0, 0, 0, 0]
            );
            const region = subject.system.textureRegion;
            this._options.uniformWriter.write(
                shader,
                'u_TexRegion',
                region ?? [0, 0, 1, 1]
            );
        } else {
            this._options.uniformWriter.write(shader, 'u_UseTexture', 0);
            this._options.uniformWriter.write(shader, 'u_TexSheetParams', [0, 0, 0, 0]);
            this._options.uniformWriter.write(shader, 'u_TexRegion', [0, 0, 1, 1]);
        }

        gl.drawArrays(gl.POINTS, 0, vertexCount);
        params.frameState.recordDraw({
            topology: 'points',
            indexCount: 0,
            vertexCount,
        });

        return vertexCount;
    }

    /**
     * Packs live particles (alpha > epsilon) into the interleaved point vertex
     * buffer and returns the number of vertices written.
     */
    private _buildPointVertices(data: ParticleRenderData): number {
        if (data.aliveCount === 0) {
            return 0;
        }

        const totalCount = data.count;
        this._ensureVertexCapacity(data.aliveCount);

        const positions = data.positions;
        const colors = data.colors;
        const sizes = data.sizes;
        const alphas = data.alphas;
        const seeds = data.seeds;
        const rotations = data.rotations;
        const vertexData = this._vertexData;

        let vertexIndex = 0;
        for (let i = 0; i < totalCount; i += 1) {
            const alpha = alphas[i] ?? 0;
            if (alpha <= ALPHA_EPSILON) {
                continue;
            }

            const source = i * 3;
            const offset = vertexIndex * PARTICLE_VERTEX_FLOATS;
            vertexData[offset] = positions[source] ?? 0;
            vertexData[offset + 1] = positions[source + 1] ?? 0;
            vertexData[offset + 2] = positions[source + 2] ?? 0;
            vertexData[offset + 3] = rotations[i] ?? 0;
            vertexData[offset + 4] = sizes[i] ?? 0;
            vertexData[offset + 5] = seeds[i] ?? 0;
            vertexData[offset + 6] = colors[source] ?? 0;
            vertexData[offset + 7] = colors[source + 1] ?? 0;
            vertexData[offset + 8] = colors[source + 2] ?? 0;
            vertexData[offset + 9] = alpha;
            vertexIndex += 1;
        }

        return vertexIndex;
    }

    private _ensureVertexCapacity(particleCount: number): void {
        if (particleCount <= this._vertexCapacity) {
            return;
        }
        this._vertexCapacity = particleCount;
        this._vertexData = new Float32Array(this._vertexCapacity * PARTICLE_VERTEX_FLOATS);
    }

    private _ensureResources(): void {
        const gl = this._options.gl;

        if (!this._shader) {
            this._shader = this._shaderFactory.create(createParticleShaderDefinition());
        }

        if (this._vertexArray && this._vertexBuffer) {
            return;
        }

        this._vertexArray = gl.createVertexArray();
        if (!this._vertexArray) {
            throw new SceneMeshError('Failed to create particle vertex array');
        }

        this._vertexBuffer = gl.createBuffer();
        if (!this._vertexBuffer) {
            throw new SceneMeshError('Failed to create particle vertex buffer');
        }

        gl.bindVertexArray(this._vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vertexBuffer);

        // position (location 0) — vec3 at offset 0
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, PARTICLE_VERTEX_STRIDE_BYTES, 0);
        // rotation (location 1) — float at offset 12
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, PARTICLE_VERTEX_STRIDE_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
        // uv0 -> size, seed (location 2) — vec2 at offset 16
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(
            2,
            2,
            gl.FLOAT,
            false,
            PARTICLE_VERTEX_STRIDE_BYTES,
            4 * Float32Array.BYTES_PER_ELEMENT
        );
        // color0 -> rgba (location 3) — vec4 at offset 24
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(
            3,
            4,
            gl.FLOAT,
            false,
            PARTICLE_VERTEX_STRIDE_BYTES,
            6 * Float32Array.BYTES_PER_ELEMENT
        );

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
}
