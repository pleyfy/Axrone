import { vi } from 'vitest';
import type { SceneOptions } from '@axrone/scene-2d';

export const installWebGL2Constants = (): void => {
    const root = globalThis as typeof globalThis & {
        WebGL2RenderingContext?: typeof WebGL2RenderingContext;
    };

    if (root.WebGL2RenderingContext) {
        return;
    }

    let nextConstant = 0x2000;
    root.WebGL2RenderingContext = new Proxy(class WebGL2RenderingContext {}, {
        get(target, property, receiver) {
            if (typeof property === 'string' && !(property in target)) {
                Reflect.set(target, property, nextConstant++);
            }

            return Reflect.get(target, property, receiver);
        },
    }) as typeof WebGL2RenderingContext;
};

export class ManualScheduler {
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

export const createMockGL = (canvas: HTMLCanvasElement) => {
    const shaders = new Set<object>();
    const programs = new Set<object>();
    const buffers = new Set<object>();
    const vertexArrays = new Set<object>();
    const textures = new Set<object>();
    const samplers = new Set<object>();

    const gl = {
        canvas,
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88e4,
        DYNAMIC_DRAW: 0x88e8,
        FLOAT: 0x1406,
        FLOAT_VEC2: 0x8b50,
        FLOAT_VEC3: 0x8b51,
        FLOAT_VEC4: 0x8b52,
        FLOAT_MAT4: 0x8b5c,
        INT: 0x1404,
        INT_VEC2: 0x8b53,
        INT_VEC3: 0x8b54,
        INT_VEC4: 0x8b55,
        BOOL: 0x8b56,
        BOOL_VEC2: 0x8b57,
        BOOL_VEC3: 0x8b58,
        BOOL_VEC4: 0x8b59,
        UNSIGNED_BYTE: 0x1401,
        UNSIGNED_SHORT: 0x1403,
        UNSIGNED_INT: 0x1405,
        UNSIGNED_INT_VEC2: 0x8dc6,
        UNSIGNED_INT_VEC3: 0x8dc7,
        UNSIGNED_INT_VEC4: 0x8dc8,
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
        TEXTURE_2D: 0x0de1,
        TEXTURE_3D: 0x806f,
        TEXTURE_CUBE_MAP: 0x8513,
        TEXTURE_2D_ARRAY: 0x8c1a,
        TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
        TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
        TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517,
        TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
        TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519,
        TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,
        TEXTURE0: 0x84c0,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_WRAP_R: 0x8072,
        TEXTURE_COMPARE_MODE: 0x884c,
        TEXTURE_COMPARE_FUNC: 0x884d,
        TEXTURE_MIN_LOD: 0x813a,
        TEXTURE_MAX_LOD: 0x813b,
        COMPARE_REF_TO_TEXTURE: 0x884e,
        NONE: 0,
        REPEAT: 0x2901,
        CLAMP_TO_EDGE: 0x812f,
        CLAMP_TO_BORDER: 0x812d,
        MIRRORED_REPEAT: 0x8370,
        NEAREST: 0x2600,
        LINEAR: 0x2601,
        NEAREST_MIPMAP_NEAREST: 0x2700,
        LINEAR_MIPMAP_NEAREST: 0x2701,
        NEAREST_MIPMAP_LINEAR: 0x2702,
        LINEAR_MIPMAP_LINEAR: 0x2703,
        NEVER: 0x0200,
        LESS: 0x0201,
        EQUAL: 0x0202,
        LEQUAL: 0x0203,
        GREATER: 0x0204,
        NOTEQUAL: 0x0205,
        GEQUAL: 0x0206,
        ALWAYS: 0x0207,
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
        getUniformLocation: vi.fn(
            (_: WebGLProgram, name: string) => ({ name }) as WebGLUniformLocation
        ),
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
        vertexAttribIPointer: vi.fn(),
        vertexAttribI4ui: vi.fn(),
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
        createTexture: vi.fn(() => {
            const texture = {};
            textures.add(texture);
            return texture as WebGLTexture;
        }),
        bindTexture: vi.fn(),
        activeTexture: vi.fn(),
        deleteTexture: vi.fn((texture: object) => {
            textures.delete(texture);
        }),
        texImage2D: vi.fn(),
        texImage3D: vi.fn(),
        compressedTexImage2D: vi.fn(),
        texSubImage2D: vi.fn(),
        texSubImage3D: vi.fn(),
        generateMipmap: vi.fn(),
        createSampler: vi.fn(() => {
            const sampler = {};
            samplers.add(sampler);
            return sampler as WebGLSampler;
        }),
        bindSampler: vi.fn(),
        deleteSampler: vi.fn((sampler: object) => {
            samplers.delete(sampler);
        }),
        samplerParameteri: vi.fn(),
        samplerParameterf: vi.fn(),
        getExtension: vi.fn(() => null),
        getParameter: vi.fn(() => 1),
    };

    return gl as unknown as WebGL2RenderingContext;
};

export const createSceneOptions = (
    scheduler: ManualScheduler,
    canvas: HTMLCanvasElement,
    registry: SceneOptions<any>['registry'] = {}
): SceneOptions<any> => {
    const gl = createMockGL(canvas);
    Object.defineProperty(canvas, 'getContext', {
        value: vi.fn(() => gl),
        configurable: true,
    });

    return {
        registry,
        scheduler: scheduler as any,
        autoStart: false,
        createCanvas: () => canvas,
        width: 640,
        height: 360,
        fixedDelta: 16,
    };
};