import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBufferFactory } from '../../renderer/webgl2/buffer';
import type { IBufferFactory, IBuffer } from '../../renderer/webgl2/buffer';

describe('WebGL Buffer - Browser Tests', () => {
    let canvas: HTMLCanvasElement;
    let gl!: WebGL2RenderingContext;
    let factory!: IBufferFactory;

    beforeEach(() => {
        canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        document.body.appendChild(canvas);

        const _gl = canvas.getContext('webgl2', {
            antialias: false,
            depth: true,
            stencil: true,
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
        });

        if (!_gl) {
            throw new Error('WebGL2 not supported in this browser');
        }

        gl = _gl;

        factory = createBufferFactory(gl);
    });

    afterEach(() => {
        try {
            (factory as any)?.dispose?.();
        } catch (e) {}

        if (canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
        }
    });

    it('should create a buffer via BufferFactory and bind it', () => {
        const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
        const buf: IBuffer = factory.createArrayBufferFromData(data, gl.STATIC_DRAW);

        buf.bind();
        const boundBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        expect(boundBuffer).toBe(buf.id as WebGLBuffer);

        buf.dispose();
    });

    it('should handle buffer operations correctly via API', () => {
        const initialData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
        const buf = factory.createArrayBufferFromData(initialData, gl.DYNAMIC_DRAW);

        expect(buf.byteLength).toBe(initialData.byteLength);

        expect(buf.usage).toBe(gl.DYNAMIC_DRAW as unknown as number);

        const updateData = new Float32Array([10.0, 20.0]);
        buf.updateRange(updateData, 8, 0);

        const out = new Float32Array(4);
        buf.getSubData(out, 0, 0, out.byteLength);
        expect(out[0]).toBeCloseTo(1.0);

        buf.dispose();
    });

    it('should verify WebGL context properties', () => {
        const version = gl.getParameter(gl.VERSION);
        expect(version).toContain('WebGL 2.0');

        const shadingVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
        expect(shadingVersion).toContain('GLSL ES 3.0');

        const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        expect(maxVertexAttribs).toBeGreaterThanOrEqual(16);

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        expect(maxTextureSize).toBeGreaterThanOrEqual(1024);
    });

    it('should handle WebGL extensions', () => {
        const extensions = gl.getSupportedExtensions() || [];
        expect(Array.isArray(extensions)).toBe(true);
        expect(extensions.length).toBeGreaterThan(0);

        const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');

        if (anisoExt) {
            expect(anisoExt).toBeDefined();
        }
    });

    it('should perform actual rendering operations', () => {
        const vertexShaderSource = `#version 300 es
      in vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

        const fragmentShaderSource = `#version 300 es
      precision mediump float;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `;

        const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);

        expect(gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)).toBe(true);
        expect(gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)).toBe(true);

        const program = gl.createProgram()!;
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(true);

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteProgram(program);
    });
});
