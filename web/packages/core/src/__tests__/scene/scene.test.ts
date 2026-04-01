import { Vec3 } from '@axrone/numeric';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '../../component-system/core/component';
import { Transform } from '../../component-system/components/transform';
import { Camera, MeshRenderer, Scene, type SceneOptions } from '../../scene';

class ManualScheduler {
    readonly kind = 'manual';
    private _now = 0;
    private _nextHandle = 1;
    private readonly _callbacks = new Map<number, (timestamp: number) => void>();

    now(): number {
        return this._now;
    }

    request(callback: (timestamp: number) => void): number {
        const handle = this._nextHandle++;
        this._callbacks.set(handle, callback);
        return handle;
    }

    cancel(handle: number): void {
        this._callbacks.delete(handle);
    }

    flush(timestamp: number): void {
        this._now = timestamp;
        const callbacks = [...this._callbacks.values()];
        this._callbacks.clear();

        for (const callback of callbacks) {
            callback(timestamp);
        }
    }
}

class PulseComponent extends Component {
    fixedCalls = 0;
    updateCalls = 0;
    lateCalls = 0;

    fixedUpdate(): void {
        this.fixedCalls += 1;
    }

    update(): void {
        this.updateCalls += 1;
    }

    lateUpdate(): void {
        this.lateCalls += 1;
    }
}

const createMockGL = (canvas: HTMLCanvasElement) => {
    const shaders = new Set<object>();
    const programs = new Set<object>();
    const buffers = new Set<object>();
    const vertexArrays = new Set<object>();

    const gl = {
        canvas,
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        UNSIGNED_BYTE: 0x1401,
        UNSIGNED_SHORT: 0x1403,
        UNSIGNED_INT: 0x1405,
        TRIANGLES: 0x0004,
        LINES: 0x0001,
        POINTS: 0x0000,
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        COLOR_BUFFER_BIT: 0x4000,
        DEPTH_BUFFER_BIT: 0x0100,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        BACK: 0x0405,
        SRC_ALPHA: 0x0302,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        createShader: vi.fn((type: number) => {
            const shader = { type };
            shaders.add(shader);
            return shader as unknown as WebGLShader;
        }),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        deleteShader: vi.fn((shader: object) => {
            shaders.delete(shader);
        }),
        createProgram: vi.fn(() => {
            const program = {};
            programs.add(program);
            return program as WebGLProgram;
        }),
        bindAttribLocation: vi.fn(),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        getProgramInfoLog: vi.fn(() => ''),
        deleteProgram: vi.fn((program: object) => {
            programs.delete(program);
        }),
        getUniformLocation: vi.fn((_: WebGLProgram, name: string) => ({ name }) as WebGLUniformLocation),
        useProgram: vi.fn(),
        createVertexArray: vi.fn(() => {
            const vao = {};
            vertexArrays.add(vao);
            return vao as WebGLVertexArrayObject;
        }),
        bindVertexArray: vi.fn(),
        deleteVertexArray: vi.fn((vao: object) => {
            vertexArrays.delete(vao);
        }),
        createBuffer: vi.fn(() => {
            const buffer = {};
            buffers.add(buffer);
            return buffer as WebGLBuffer;
        }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        deleteBuffer: vi.fn((buffer: object) => {
            buffers.delete(buffer);
        }),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        cullFace: vi.fn(),
        blendFunc: vi.fn(),
        depthMask: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        uniform4f: vi.fn(),
        uniform3f: vi.fn(),
        uniform2f: vi.fn(),
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        uniform4fv: vi.fn(),
        uniform3fv: vi.fn(),
        uniform2fv: vi.fn(),
        uniform1fv: vi.fn(),
        uniform4iv: vi.fn(),
        uniform3iv: vi.fn(),
        uniform2iv: vi.fn(),
        uniform1iv: vi.fn(),
        uniform4uiv: vi.fn(),
        uniform3uiv: vi.fn(),
        uniform2uiv: vi.fn(),
        uniform1uiv: vi.fn(),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
    };

    return gl as unknown as WebGL2RenderingContext;
};

const createSceneOptions = (scheduler: ManualScheduler, canvas: HTMLCanvasElement): SceneOptions => {
    const gl = createMockGL(canvas);
    Object.defineProperty(canvas, 'getContext', {
        value: vi.fn(() => gl),
        configurable: true,
    });

    return {
        scheduler: scheduler as any,
        autoStart: false,
        createCanvas: () => canvas,
        width: 640,
        height: 360,
        fixedDelta: 16,
    };
};

describe('Scene', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('creates and attaches a canvas when one is not provided', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));

        expect(scene.canvas).toBe(canvas);
        expect(document.body.contains(canvas)).toBe(true);
        expect(scene.canvas.width).toBe(640);
        expect(scene.canvas.height).toBe(360);

        scene.dispose();
    });

    it('runs registered custom components through fixed, update, and late phases', () => {
        const canvas = document.createElement('canvas');
        const scene = new Scene(createSceneOptions(scheduler, canvas));
        scene.registerComponent(PulseComponent);

        const actor = scene.createActor({ name: 'PulseActor' });
        const component = actor.addComponent(PulseComponent);

        scene.start(0);
        scheduler.flush(16);

        expect(component.fixedCalls).toBe(1);
        expect(component.updateCalls).toBe(1);
        expect(component.lateCalls).toBe(1);

        scene.dispose();
    });

    it('registers shader, mesh, material, and issues a draw call', () => {
        const canvas = document.createElement('canvas');
        const options = createSceneOptions(scheduler, canvas);
        const scene = new Scene(options);
        const gl = scene.gl as unknown as ReturnType<typeof createMockGL>;

        scene.registerShader({
            id: 'test/solid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
out vec4 o_Color;
void main() {
    o_Color = u_Color;
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection', 'u_Color'],
        });

        scene.registerMesh({
            id: 'triangle',
            vertices: new Float32Array([0, 0.5, -2, -0.5, -0.5, -2, 0.5, -0.5, -2]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
            vertexCount: 3,
        });

        scene.createMaterial({
            id: 'triangle-material',
            shaderId: 'test/solid',
            uniforms: {
                u_Color: [1, 0.4, 0.2, 1],
            },
        });

        const cameraActor = scene.createCameraActor({ name: 'Camera' }, { primary: true });
        cameraActor.requireComponent(Transform).position = Vec3.ZERO.clone();

        const meshActor = scene.createRenderableActor(
            { name: 'Triangle' },
            { meshId: 'triangle', materialId: 'triangle-material' }
        );
        meshActor.requireComponent(Transform).position = new Vec3(0, 0, 0);

        scene.start(0);
        scheduler.flush(16);

        expect(gl.drawArrays).toHaveBeenCalledTimes(1);

        scene.dispose();
    });
});