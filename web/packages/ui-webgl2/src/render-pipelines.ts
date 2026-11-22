import type { RectLike } from '@axrone/ui/types';
import {
    IMAGE_INSTANCE_ATTRIBUTES,
    IMAGE_FLOATS_PER_INSTANCE,
    QUAD_INSTANCE_ATTRIBUTES,
    QUAD_FLOATS_PER_INSTANCE,
    TEXT_INSTANCE_ATTRIBUTES,
    TEXT_FLOATS_PER_INSTANCE,
    type InstanceAttributeLayout,
} from './batch-layout';
import type { FrameGLState } from './frame-gl-state';
import { GL_STATE_ARRAY_BUFFER, GL_STATE_PROGRAM, GL_STATE_VERTEX_ARRAY } from './gl-state';
import { createProgram } from './shader-source';
import {
    IMAGE_FRAGMENT_SOURCE,
    IMAGE_VERTEX_SOURCE,
    QUAD_FRAGMENT_SOURCE,
    QUAD_VERTEX_SOURCE,
    TEXT_FRAGMENT_SOURCE,
    TEXT_VERTEX_SOURCE,
} from './shaders';
import { UNIT_QUAD } from './webgl-utils';

export interface RenderPipelinesInput {
    readonly gl: WebGL2RenderingContext;
    readonly quadBatchByteLength: number;
    readonly imageBatchByteLength: number;
    readonly textBatchByteLength: number;
}

export interface InstancedBatchDraw {
    readonly state: FrameGLState;
    readonly clip: RectLike | null;
    readonly clipViewportHeight: number;
    readonly frameViewportWidth: number;
    readonly frameViewportHeight: number;
    readonly program: WebGLProgram;
    readonly viewportUniform: WebGLUniformLocation | null;
    readonly vao: WebGLVertexArrayObject | null;
    readonly instanceBuffer: WebGLBuffer | null;
    readonly data: Float32Array;
    readonly instanceCount: number;
    readonly floatsPerInstance: number;
    readonly bindTextureResources?: () => void;
}

export class RenderPipelines {
    readonly quadProgram!: WebGLProgram;
    readonly imageProgram!: WebGLProgram;
    readonly textProgram!: WebGLProgram;
    readonly quadViewportUniform!: WebGLUniformLocation | null;
    readonly imageViewportUniform!: WebGLUniformLocation | null;
    readonly imageTextureUniform!: WebGLUniformLocation | null;
    readonly textViewportUniform!: WebGLUniformLocation | null;
    readonly textAtlasUniform!: WebGLUniformLocation | null;
    readonly quadVao!: WebGLVertexArrayObject | null;
    readonly imageVao!: WebGLVertexArrayObject | null;
    readonly textVao!: WebGLVertexArrayObject | null;
    readonly quadInstanceBuffer!: WebGLBuffer | null;
    readonly imageInstanceBuffer!: WebGLBuffer | null;
    readonly textInstanceBuffer!: WebGLBuffer | null;
    private readonly gl: WebGL2RenderingContext;
    private readonly quadStaticBuffer!: WebGLBuffer | null;
    private readonly imageStaticBuffer!: WebGLBuffer | null;
    private readonly textStaticBuffer!: WebGLBuffer | null;

    constructor(input: RenderPipelinesInput) {
        const gl = input.gl;
        this.gl = gl;
        this.quadProgram = createProgram(gl, QUAD_VERTEX_SOURCE, QUAD_FRAGMENT_SOURCE, 'quad');
        this.imageProgram = createProgram(gl, IMAGE_VERTEX_SOURCE, IMAGE_FRAGMENT_SOURCE, 'image');
        this.textProgram = createProgram(gl, TEXT_VERTEX_SOURCE, TEXT_FRAGMENT_SOURCE, 'text');
        this.quadViewportUniform = gl.getUniformLocation(this.quadProgram, 'u_Viewport');
        this.imageViewportUniform = gl.getUniformLocation(this.imageProgram, 'u_Viewport');
        this.imageTextureUniform = gl.getUniformLocation(this.imageProgram, 'u_Image');
        this.textViewportUniform = gl.getUniformLocation(this.textProgram, 'u_Viewport');
        this.textAtlasUniform = gl.getUniformLocation(this.textProgram, 'u_Atlas');
        this.quadStaticBuffer = gl.createBuffer();
        this.quadInstanceBuffer = gl.createBuffer();
        this.imageStaticBuffer = gl.createBuffer();
        this.imageInstanceBuffer = gl.createBuffer();
        this.textStaticBuffer = gl.createBuffer();
        this.textInstanceBuffer = gl.createBuffer();
        this.quadVao = gl.createVertexArray();
        this.imageVao = gl.createVertexArray();
        this.textVao = gl.createVertexArray();
        this.initializeInstancePipeline(
            this.quadVao,
            this.quadStaticBuffer,
            this.quadInstanceBuffer,
            input.quadBatchByteLength,
            QUAD_FLOATS_PER_INSTANCE * 4,
            QUAD_INSTANCE_ATTRIBUTES
        );
        this.initializeInstancePipeline(
            this.imageVao,
            this.imageStaticBuffer,
            this.imageInstanceBuffer,
            input.imageBatchByteLength,
            IMAGE_FLOATS_PER_INSTANCE * 4,
            IMAGE_INSTANCE_ATTRIBUTES
        );
        this.initializeInstancePipeline(
            this.textVao,
            this.textStaticBuffer,
            this.textInstanceBuffer,
            input.textBatchByteLength,
            TEXT_FLOATS_PER_INSTANCE * 4,
            TEXT_INSTANCE_ATTRIBUTES
        );
    }

    private initializeInstancePipeline(
        vao: WebGLVertexArrayObject | null,
        staticBuffer: WebGLBuffer | null,
        instanceBuffer: WebGLBuffer | null,
        batchByteLength: number,
        instanceStrideBytes: number,
        attributes: readonly InstanceAttributeLayout[]
    ): void {
        const gl = this.gl;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, batchByteLength, gl.DYNAMIC_DRAW);
        for (const attribute of attributes) {
            gl.enableVertexAttribArray(attribute.location);
            gl.vertexAttribPointer(
                attribute.location,
                attribute.size,
                gl.FLOAT,
                false,
                instanceStrideBytes,
                attribute.floatOffset * 4
            );
            gl.vertexAttribDivisor(attribute.location, 1);
        }
        gl.bindVertexArray(null);
    }

    drawBatch(input: InstancedBatchDraw): void {
        const gl = this.gl;
        const state = input.state;
        state.applyClip(input.clip, input.clipViewportHeight);
        state.capture(GL_STATE_PROGRAM);
        state.touch(GL_STATE_PROGRAM);
        gl.useProgram(input.program);
        gl.uniform2f(input.viewportUniform, input.frameViewportWidth, input.frameViewportHeight);
        input.bindTextureResources?.();
        state.capture(GL_STATE_VERTEX_ARRAY | GL_STATE_ARRAY_BUFFER);
        state.touch(GL_STATE_VERTEX_ARRAY | GL_STATE_ARRAY_BUFFER);
        gl.bindVertexArray(input.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, input.instanceBuffer);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            input.data.subarray(0, input.instanceCount * input.floatsPerInstance)
        );
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, input.instanceCount);
        gl.bindVertexArray(null);
    }

    delete(): void {
        const gl = this.gl;
        gl.deleteBuffer(this.quadStaticBuffer);
        gl.deleteBuffer(this.quadInstanceBuffer);
        gl.deleteBuffer(this.imageStaticBuffer);
        gl.deleteBuffer(this.imageInstanceBuffer);
        gl.deleteBuffer(this.textStaticBuffer);
        gl.deleteBuffer(this.textInstanceBuffer);
        gl.deleteVertexArray(this.quadVao);
        gl.deleteVertexArray(this.imageVao);
        gl.deleteVertexArray(this.textVao);
        gl.deleteProgram(this.quadProgram);
        gl.deleteProgram(this.imageProgram);
        gl.deleteProgram(this.textProgram);
    }
}
