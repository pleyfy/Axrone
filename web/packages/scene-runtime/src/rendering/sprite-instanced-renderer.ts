import type { Render2DSpriteSubmission } from '@axrone/render-2d';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneMeshSemantic } from '../types';

const FLOATS_PER_INSTANCE = 18;
const INSTANCE_STRIDE = FLOATS_PER_INSTANCE * 4;
const INSTANCE_INDEX_COUNT = 6;

export const SPRITE_INSTANCED_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_Corner;
layout(location = 1) in vec4 a_Affine;
layout(location = 2) in vec2 a_Translation;
layout(location = 3) in vec4 a_Geometry;
layout(location = 4) in vec4 a_UvRect;
layout(location = 5) in vec4 a_Color;

uniform mat4 u_ViewProjection;

out vec2 v_UV;
out vec4 v_Color;

void main() {
    vec2 local = (a_Corner - a_Geometry.zw) * a_Geometry.xy;
    vec2 world = vec2(
        a_Affine.x * local.x + a_Affine.y * local.y + a_Translation.x,
        a_Affine.z * local.x + a_Affine.w * local.y + a_Translation.y
    );
    v_UV = a_UvRect.xy + a_Corner * a_UvRect.zw;
    v_Color = a_Color;
    gl_Position = u_ViewProjection * vec4(world, 0.0, 1.0);
}
`;

export const SPRITE_INSTANCED_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_MainTex;

in vec2 v_UV;
in vec4 v_Color;
out vec4 o_Color;

void main() {
    o_Color = texture(u_MainTex, v_UV) * v_Color;
}
`;

/**
 * Compiles the shared instanced-sprite program. Both the legacy
 * submission-driven renderer and the registry-backed buffer renderer use it so
 * the vertex layout stays a single contract.
 */
export const compileSpriteInstancedProgram = (gl: WebGL2RenderingContext): WebGLProgram =>
    compileSpriteProgram(
        gl,
        SPRITE_INSTANCED_VERTEX_SOURCE,
        SPRITE_INSTANCED_FRAGMENT_SOURCE,
        'instanced sprite'
    );

const compileSpriteProgram = (
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    label: string
): WebGLProgram => {
    const compile = (type: number, source: string): WebGLShader => {
        const shader = gl.createShader(type);
        if (!shader) {
            throw new Error(`Failed to create ${label} shader`);
        }
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
            gl.deleteShader(shader);
            throw new Error(`${label} shader compile failed: ${info}`);
        }
        return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        throw new Error(`Failed to create ${label} program`);
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program) ?? 'unknown link error';
        gl.deleteProgram(program);
        throw new Error(`${label} program link failed: ${info}`);
    }

    return program;
};

/**
 * Multi-texture instanced sprite program. Identical to the single-texture
 * program except that each instance carries a texture-slot index
 * (`a_TextureSlot`, the 13th float of the static stream) and the fragment
 * shader selects from that slot's sampler instead of `u_MainTex`.
 *
 * ANGLE only accepts constant-index-expression sampler access (WebGL's
 * sampler-indexing rule is stricter than raw GLSL ES 3.00), so the selection
 * is compiled as a fixed ladder of constant-indexed samples — the same
 * approach PixiJS v8's batcher uses. The ladder length is a compile-time
 * `SPRITE_TEXTURE_SLOTS` macro matched to the runtime sampler budget, so a
 * device that only guarantees 16 fragment units never pays for 32 branches.
 * The slot is passed as a `flat` int because it varies per-instance, never
 * per-fragment.
 */
export const compileSpriteMultiTextureProgram = (
    gl: WebGL2RenderingContext,
    slotCount: number
): WebGLProgram => {
    const slots = Math.max(1, Math.min(32, Math.floor(slotCount)));
    const vertexSource = `#version 300 es
layout(location = 0) in vec2 a_Corner;
layout(location = 1) in vec4 a_Affine;
layout(location = 2) in vec2 a_Translation;
layout(location = 3) in vec4 a_Geometry;
layout(location = 4) in vec4 a_UvRect;
layout(location = 5) in vec4 a_Color;
layout(location = 6) in float a_TextureSlot;

uniform mat4 u_ViewProjection;

out vec2 v_UV;
out vec4 v_Color;
flat out int v_TextureSlot;

void main() {
    vec2 local = (a_Corner - a_Geometry.zw) * a_Geometry.xy;
    vec2 world = vec2(
        a_Affine.x * local.x + a_Affine.y * local.y + a_Translation.x,
        a_Affine.z * local.x + a_Affine.w * local.y + a_Translation.y
    );
    v_UV = a_UvRect.xy + a_Corner * a_UvRect.zw;
    v_Color = a_Color;
    v_TextureSlot = int(a_TextureSlot + 0.5);
    gl_Position = u_ViewProjection * vec4(world, 0.0, 1.0);
}
`;
    const ladder: string[] = [
        `#version 300 es
precision highp float;
#define SPRITE_TEXTURE_SLOTS ${String(slots)}

uniform sampler2D u_Textures[SPRITE_TEXTURE_SLOTS];

in vec2 v_UV;
in vec4 v_Color;
flat in int v_TextureSlot;
out vec4 o_Color;

void main() {
    vec4 sampled = vec4(0.0);`,
    ];
    for (let slot = 0; slot < slots; slot += 1) {
        const keyword = slot === 0 ? 'if' : 'else if';
        ladder.push(
            `    ${keyword} (v_TextureSlot == ${String(slot)}) { sampled = texture(u_Textures[${String(slot)}], v_UV); }`
        );
    }
    ladder.push(`    o_Color = sampled * v_Color;
}
`);
    return compileSpriteProgram(
        gl,
        vertexSource,
        ladder.join('\n'),
        `sprite multi-texture program (${String(slots)} slots)`
    );
};

export interface SpriteInstancedDrawParams {
    readonly renderPass: SceneRenderPassResource;
    readonly cameraFrame: SceneCameraFrameState;
    readonly frameState: SceneRenderFrameState;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export interface SpriteInstancedRendererOptions {
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    readonly stateCache?: import('@axrone/render-webgl2').IGLStateCache;
}

/**
 * One-draw instanced path for a homogeneous sprite pass (one texture, no
 * mask/clip/slice). Per-instance attributes carry the affine transform,
 * geometry, UV rect and tint; the static quad/index buffers never change.
 *
 * This is a renderer execution path, not a second scene model: submissions
 * still come from the actor/component scan and existing sprite batching.
 */
export class SpriteInstancedRenderer {
    private readonly _gl: WebGL2RenderingContext;
    private readonly _resources: SceneResourceRuntime;
    private readonly _renderStateApplier: Pick<SceneRenderStateApplier, 'apply'>;
    private readonly _stateCache: import('@axrone/render-webgl2').IGLStateCache | undefined;
    private readonly _shader: SceneShaderResource;
    private readonly _program: WebGLProgram;
    private readonly _vertexArray: WebGLVertexArrayObject;
    private readonly _quadBuffer: WebGLBuffer;
    private readonly _indexBuffer: WebGLBuffer;
    private readonly _instanceBuffer: WebGLBuffer;
    private _instanceData = new Float32Array(0);
    private _instanceCapacity = 0;
    private readonly _viewProjectionLocation: WebGLUniformLocation | null;
    private readonly _mainTextureLocation: WebGLUniformLocation | null;

    constructor(options: SpriteInstancedRendererOptions) {
        const gl = options.gl;
        this._gl = gl;
        this._resources = options.resources;
        this._renderStateApplier = options.renderStateApplier;
        this._stateCache = options.stateCache;
        this._program = compileSpriteInstancedProgram(gl);

        this._viewProjectionLocation = gl.getUniformLocation(this._program, 'u_ViewProjection');
        this._mainTextureLocation = gl.getUniformLocation(this._program, 'u_MainTex');

        this._shader = {
            id: '__scene/runtime-sprite-instanced',
            program: this._program,
            uniformLocations: new Map(
                [
                    ['u_ViewProjection', this._viewProjectionLocation],
                    ['u_MainTex', this._mainTextureLocation],
                ].filter((entry): entry is [string, WebGLUniformLocation] => entry[1] !== null)
            ),
            uniformTypes: new Map(),
            uniformNames: ['u_ViewProjection', 'u_MainTex'],
            attributeNames: {} as Record<SceneMeshSemantic, string>,
            depthTest: false,
            cull: false,
            blend: true,
        };

        const vertexArray = gl.createVertexArray();
        const quadBuffer = gl.createBuffer();
        const indexBuffer = gl.createBuffer();
        const instanceBuffer = gl.createBuffer();
        if (!vertexArray || !quadBuffer || !indexBuffer || !instanceBuffer) {
            throw new Error('Failed to create instanced sprite GL resources');
        }

        this._vertexArray = vertexArray;
        this._quadBuffer = quadBuffer;
        this._indexBuffer = indexBuffer;
        this._instanceBuffer = instanceBuffer;
        this._setupBuffers();
    }

    draw(
        submissions: readonly Render2DSpriteSubmission[],
        count: number,
        params: SpriteInstancedDrawParams,
        textureId: string
    ): number {
        if (count <= 0) {
            return 0;
        }

        const texture = this._resources.textures.get(textureId);
        if (!texture) {
            return 0;
        }

        this._writeInstances(submissions, count);
        this._renderStateApplier.apply(this._shader, params.renderPass, null);
        this._gl.useProgram(this._program);
        this._gl.uniformMatrix4fv(
            this._viewProjectionLocation,
            false,
            params.cameraFrame.viewProjectionMatrix.data
        );
        const sampler = this._resources.resolveSampler(texture.samplerId);
        if (this._stateCache) {
            this._stateCache.activeTexture(0);
            this._stateCache.bindTexture(this._gl.TEXTURE_2D, texture.texture.nativeHandle);
            this._stateCache.bindSampler(0, sampler.nativeHandle);
        } else {
            this._gl.activeTexture(this._gl.TEXTURE0);
            this._gl.bindTexture(this._gl.TEXTURE_2D, texture.texture.nativeHandle);
            this._gl.bindSampler(0, sampler.nativeHandle);
        }
        this._gl.uniform1i(this._mainTextureLocation, 0);
        this._gl.bindVertexArray(this._vertexArray);
        this._gl.drawElementsInstanced(
            this._gl.TRIANGLES,
            INSTANCE_INDEX_COUNT,
            this._gl.UNSIGNED_SHORT,
            0,
            count
        );
        this._gl.bindVertexArray(null);
        params.frameState.recordDraw({
            topology: 'triangles',
            indexCount: count * INSTANCE_INDEX_COUNT,
            vertexCount: 0,
        });

        if (this._stateCache) {
            this._stateCache.bindSampler(0, null);
            this._stateCache.activeTexture(0);
            this._stateCache.bindTexture(this._gl.TEXTURE_2D, null);
        } else {
            this._gl.bindSampler(0, null);
            this._gl.activeTexture(this._gl.TEXTURE0);
            this._gl.bindTexture(this._gl.TEXTURE_2D, null);
        }
        return count;
    }

    clear(): void {
        const gl = this._gl;
        gl.deleteBuffer(this._quadBuffer);
        gl.deleteBuffer(this._indexBuffer);
        gl.deleteBuffer(this._instanceBuffer);
        gl.deleteVertexArray(this._vertexArray);
        gl.deleteProgram(this._program);
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

        gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
        const attributes: ReadonlyArray<readonly [number, number, number]> = [
            [1, 4, 0],
            [2, 2, 16],
            [3, 4, 24],
            [4, 4, 40],
            [5, 4, 56],
        ];
        for (const [location, size, offset] of attributes) {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, INSTANCE_STRIDE, offset);
            gl.vertexAttribDivisor(location, 1);
        }

        gl.bindVertexArray(null);
    }

    private _writeInstances(submissions: readonly Render2DSpriteSubmission[], count: number): void {
        this._ensureInstanceCapacity(count);
        const data = this._instanceData;

        for (let index = 0; index < count; index += 1) {
            const submission = submissions[index]!;
            const matrix = submission.worldMatrix;
            const offset = index * FLOATS_PER_INSTANCE;

            data[offset] = matrix[0] ?? 0;
            data[offset + 1] = matrix[1] ?? 0;
            data[offset + 2] = matrix[4] ?? 0;
            data[offset + 3] = matrix[5] ?? 0;
            data[offset + 4] = matrix[3] ?? 0;
            data[offset + 5] = matrix[7] ?? 0;

            data[offset + 6] = submission.size.width;
            data[offset + 7] = submission.size.height;
            data[offset + 8] = submission.anchor.x;
            data[offset + 9] = submission.anchor.y;

            let u0 = submission.uvRect.x;
            let v0 = submission.uvRect.y;
            let u1 = submission.uvRect.x + submission.uvRect.width;
            let v1 = submission.uvRect.y + submission.uvRect.height;
            if (submission.flipX) {
                [u0, u1] = [u1, u0];
            }
            if (submission.flipY) {
                [v0, v1] = [v1, v0];
            }
            data[offset + 10] = u0;
            data[offset + 11] = v0;
            data[offset + 12] = u1 - u0;
            data[offset + 13] = v1 - v0;

            data[offset + 14] = submission.color.r;
            data[offset + 15] = submission.color.g;
            data[offset + 16] = submission.color.b;
            data[offset + 17] = submission.color.a ?? 1;
        }

        const gl = this._gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS_PER_INSTANCE);
    }

    private _ensureInstanceCapacity(count: number): void {
        if (count <= this._instanceCapacity) {
            return;
        }

        let capacity = Math.max(64, this._instanceCapacity);
        while (capacity < count) {
            capacity *= 2;
        }
        this._instanceCapacity = capacity;
        this._instanceData = new Float32Array(capacity * FLOATS_PER_INSTANCE);
        const gl = this._gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.byteLength, gl.DYNAMIC_DRAW);
    }
}
