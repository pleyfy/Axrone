import type {
    CustomRenderCommand,
    FontGlyphBitmapFormat,
    GlyphAtlasEntry,
    ImageRenderCommand,
    QuadRenderCommand,
    RectLike,
    TextGlyphPlacement,
    TextRenderCommand,
    UIFrame,
    UIFrameSink,
} from '@axrone/ui';
import { DisposedUIError } from '@axrone/ui';
import type {
    WebGL2UICustomCommandContext,
    WebGL2UIMaterialImageContext,
    WebGL2UIResolvedImageResource,
    WebGL2UIRendererOptions,
    WebGL2UIRendererStatistics,
} from './types';

const QUAD_FLOATS_PER_INSTANCE = 23;
const IMAGE_FLOATS_PER_INSTANCE = 22;
const TEXT_FLOATS_PER_INSTANCE = 26;

const QUAD_VERTEX_SOURCE = `#version 300 es
precision mediump float;
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_FillColor;
layout(location = 3) in vec4 a_BorderColor;
layout(location = 4) in vec4 a_Radius;
layout(location = 5) in float a_BorderWidth;
layout(location = 6) in vec3 a_TransformRow0;
layout(location = 7) in vec3 a_TransformRow1;
uniform vec2 u_Viewport;
out vec2 v_Local;
out vec2 v_Size;
out vec4 v_FillColor;
out vec4 v_BorderColor;
out vec4 v_Radius;
out float v_BorderWidth;
void main() {
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    pixel = vec2(
        a_TransformRow0.x * pixel.x + a_TransformRow0.y * pixel.y + a_TransformRow0.z,
        a_TransformRow1.x * pixel.x + a_TransformRow1.y * pixel.y + a_TransformRow1.z
    );
    vec2 ndc = vec2((pixel.x / u_Viewport.x) * 2.0 - 1.0, 1.0 - (pixel.y / u_Viewport.y) * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Local = a_Unit * a_Rect.zw;
    v_Size = a_Rect.zw;
    v_FillColor = a_FillColor;
    v_BorderColor = a_BorderColor;
    v_Radius = a_Radius;
    v_BorderWidth = a_BorderWidth;
}`;

const QUAD_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_Local;
in vec2 v_Size;
in vec4 v_FillColor;
in vec4 v_BorderColor;
in vec4 v_Radius;
in float v_BorderWidth;
out vec4 o_Color;
float selectRadius(vec2 local, vec2 size, vec4 radii) {
    bool left = local.x <= size.x * 0.5;
    bool top = local.y <= size.y * 0.5;
    if (left && top) return radii.x;
    if (!left && top) return radii.y;
    if (!left && !top) return radii.z;
    return radii.w;
}
float roundedRectSdf(vec2 local, vec2 size, vec4 radii) {
    float radius = selectRadius(local, size, radii);
    vec2 center = size * 0.5;
    vec2 halfSize = max(center - vec2(radius), vec2(0.0));
    vec2 delta = abs(local - center) - halfSize;
    return length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - radius;
}
void main() {
    float outer = roundedRectSdf(v_Local, v_Size, v_Radius);
    float aa = max(fwidth(outer), 0.75);
    float outerAlpha = 1.0 - smoothstep(-aa, aa, outer);
    vec4 color = v_FillColor;
    if (v_BorderWidth > 0.0 && v_BorderColor.a > 0.0) {
        vec2 innerSize = max(v_Size - vec2(v_BorderWidth * 2.0), vec2(0.0));
        vec2 innerLocal = clamp(v_Local - vec2(v_BorderWidth), vec2(0.0), innerSize);
        vec4 innerRadii = max(v_Radius - vec4(v_BorderWidth), vec4(0.0));
        float inner = roundedRectSdf(innerLocal, innerSize, innerRadii);
        float innerAlpha = innerSize.x <= 0.0 || innerSize.y <= 0.0 ? 0.0 : 1.0 - smoothstep(-aa, aa, inner);
        float borderAlpha = max(0.0, outerAlpha - innerAlpha);
        color = mix(v_BorderColor * borderAlpha, v_FillColor * innerAlpha, step(0.0001, innerAlpha));
        color.a = borderAlpha * v_BorderColor.a + innerAlpha * v_FillColor.a;
    } else {
        color *= outerAlpha;
    }
    if (color.a <= 0.0) {
        discard;
    }
    o_Color = color;
}`;

const TEXT_VERTEX_SOURCE = `#version 300 es
precision mediump float;
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_UvRect;
layout(location = 3) in vec4 a_Color;
layout(location = 4) in vec4 a_OutlineColor;
layout(location = 5) in vec4 a_SdfParams;
layout(location = 6) in vec3 a_TransformRow0;
layout(location = 7) in vec3 a_TransformRow1;
uniform vec2 u_Viewport;
out vec2 v_Uv;
out vec4 v_Color;
out vec4 v_OutlineColor;
out vec4 v_SdfParams;
void main() {
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    pixel = vec2(
        a_TransformRow0.x * pixel.x + a_TransformRow0.y * pixel.y + a_TransformRow0.z,
        a_TransformRow1.x * pixel.x + a_TransformRow1.y * pixel.y + a_TransformRow1.z
    );
    vec2 ndc = vec2((pixel.x / u_Viewport.x) * 2.0 - 1.0, 1.0 - (pixel.y / u_Viewport.y) * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Uv = a_UvRect.xy + a_Unit * a_UvRect.zw;
    v_Color = a_Color;
    v_OutlineColor = a_OutlineColor;
    v_SdfParams = a_SdfParams;
}`;

const TEXT_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_Atlas;
in vec2 v_Uv;
in vec4 v_Color;
in vec4 v_OutlineColor;
in vec4 v_SdfParams;
out vec4 o_Color;
void main() {
    float alpha = texture(u_Atlas, v_Uv).r;
    vec4 color;
    if (v_SdfParams.x > 0.5) {
        float distanceRange = max(v_SdfParams.y, 1.0);
        float smoothing = max(fwidth(alpha) * max(1.0, v_SdfParams.w) * distanceRange, 0.0001);
        float fillAlpha = smoothstep(0.5 - smoothing, 0.5 + smoothing, alpha);
        float outlineThreshold = 0.5 - (v_SdfParams.z / distanceRange);
        float outlineAlpha = smoothstep(outlineThreshold - smoothing, outlineThreshold + smoothing, alpha);
        vec4 fill = vec4(v_Color.rgb, v_Color.a * fillAlpha);
        vec4 outline = vec4(v_OutlineColor.rgb, v_OutlineColor.a * max(0.0, outlineAlpha - fillAlpha));
        color = fill + outline;
    } else {
        color = vec4(v_Color.rgb, v_Color.a * alpha);
    }
    if (color.a <= 0.0) {
        discard;
    }
    o_Color = color;
}`;

const IMAGE_VERTEX_SOURCE = `#version 300 es
precision mediump float;
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_UvRect;
layout(location = 3) in vec4 a_Tint;
layout(location = 4) in vec4 a_Radius;
layout(location = 5) in vec3 a_TransformRow0;
layout(location = 6) in vec3 a_TransformRow1;
uniform vec2 u_Viewport;
out vec2 v_Local;
out vec2 v_Size;
out vec2 v_Uv;
out vec4 v_Tint;
out vec4 v_Radius;
void main() {
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    pixel = vec2(
        a_TransformRow0.x * pixel.x + a_TransformRow0.y * pixel.y + a_TransformRow0.z,
        a_TransformRow1.x * pixel.x + a_TransformRow1.y * pixel.y + a_TransformRow1.z
    );
    vec2 ndc = vec2((pixel.x / u_Viewport.x) * 2.0 - 1.0, 1.0 - (pixel.y / u_Viewport.y) * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Local = a_Unit * a_Rect.zw;
    v_Size = a_Rect.zw;
    v_Uv = a_UvRect.xy + a_Unit * a_UvRect.zw;
    v_Tint = a_Tint;
    v_Radius = a_Radius;
}`;

const IMAGE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_Image;
in vec2 v_Local;
in vec2 v_Size;
in vec2 v_Uv;
in vec4 v_Tint;
in vec4 v_Radius;
out vec4 o_Color;
float selectRadius(vec2 local, vec2 size, vec4 radii) {
    bool left = local.x <= size.x * 0.5;
    bool top = local.y <= size.y * 0.5;
    if (left && top) return radii.x;
    if (!left && top) return radii.y;
    if (!left && !top) return radii.z;
    return radii.w;
}
float roundedRectSdf(vec2 local, vec2 size, vec4 radii) {
    float radius = selectRadius(local, size, radii);
    vec2 center = size * 0.5;
    vec2 halfSize = max(center - vec2(radius), vec2(0.0));
    vec2 delta = abs(local - center) - halfSize;
    return length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - radius;
}
void main() {
    float sdf = roundedRectSdf(v_Local, v_Size, v_Radius);
    float aa = max(fwidth(sdf), 0.75);
    float mask = 1.0 - smoothstep(-aa, aa, sdf);
    vec4 color = texture(u_Image, v_Uv) * v_Tint;
    color *= mask;
    if (color.a <= 0.0) {
        discard;
    }
    o_Color = color;
}`;

interface ClipState {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface TexturePage {
    readonly texture: WebGLTexture;
    readonly width: number;
    readonly height: number;
    readonly format: FontGlyphBitmapFormat;
    readonly uploadedGlyphs: Set<number>;
}

const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const clipKey = (clip: RectLike | null): string =>
    clip === null ? 'none' : `${clip.x}|${clip.y}|${clip.width}|${clip.height}`;

const toClipState = (clip: RectLike | null): ClipState | null =>
    clip === null ? null : { x: clip.x, y: clip.y, width: clip.width, height: clip.height };

const toUint8Array = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

const multiplyAlpha = (alpha: number, opacity: number): number => alpha * opacity;

const blendColor = (
    color: QuadRenderCommand['color'] | TextRenderCommand['color'],
    opacity: number
): readonly [number, number, number, number] => [color.r, color.g, color.b, multiplyAlpha(color.a, opacity)];

const IDENTITY_TRANSFORM = [1, 0, 0, 1, 0, 0] as const;

const sameClip = (left: ClipState | null, right: RectLike | null): boolean => {
    if (left === null || right === null) {
        return left === null && right === null;
    }
    return (
        left.x === right.x &&
        left.y === right.y &&
        left.width === right.width &&
        left.height === right.height
    );
};

const createShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create UI shader.');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile failure.';
        gl.deleteShader(shader);
        throw new Error(message);
    }
    return shader;
};

const createProgram = (
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string
): WebGLProgram => {
    const program = gl.createProgram();
    if (!program) {
        throw new Error('Failed to create UI program.');
    }
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) ?? 'Unknown program link failure.';
        gl.deleteProgram(program);
        throw new Error(message);
    }
    return program;
};

export class WebGL2UIRenderer<TPayload = unknown> implements UIFrameSink<TPayload> {
    private readonly gl: WebGL2RenderingContext;
    private readonly quadProgram: WebGLProgram;
    private readonly imageProgram: WebGLProgram;
    private readonly textProgram: WebGLProgram;
    private readonly quadViewportUniform: WebGLUniformLocation | null;
    private readonly imageViewportUniform: WebGLUniformLocation | null;
    private readonly imageTextureUniform: WebGLUniformLocation | null;
    private readonly textViewportUniform: WebGLUniformLocation | null;
    private readonly textAtlasUniform: WebGLUniformLocation | null;
    private readonly quadVao: WebGLVertexArrayObject | null;
    private readonly imageVao: WebGLVertexArrayObject | null;
    private readonly textVao: WebGLVertexArrayObject | null;
    private readonly quadStaticBuffer: WebGLBuffer | null;
    private readonly quadInstanceBuffer: WebGLBuffer | null;
    private readonly imageStaticBuffer: WebGLBuffer | null;
    private readonly imageInstanceBuffer: WebGLBuffer | null;
    private readonly textStaticBuffer: WebGLBuffer | null;
    private readonly textInstanceBuffer: WebGLBuffer | null;
    private readonly pages = new Map<string, TexturePage>();
    private readonly quadBatch: Float32Array;
    private readonly imageBatch: Float32Array;
    private readonly textBatch: Float32Array;
    private readonly resolveImageResource?: WebGL2UIRendererOptions<TPayload>['resolveImageResource'];
    private readonly customCommandRenderer?: WebGL2UIRendererOptions<TPayload>['customCommandRenderer'];
    private readonly atlasFilter: 'nearest' | 'linear';
    private readonly statisticsState = {
        drawCalls: 0,
        quadCount: 0,
        imageCount: 0,
        materialImageCount: 0,
        glyphCount: 0,
        customCommandCount: 0,
        uploadedGlyphCount: 0,
    };
    private quadCount = 0;
    private imageCount = 0;
    private textCount = 0;
    private activeImageTexture: WebGLTexture | null = null;
    private activeImageSampler: WebGLSampler | null = null;
    private activeTextPageKey: string | null = null;
    private activeQuadClip: ClipState | null = null;
    private activeImageClip: ClipState | null = null;
    private activeTextClip: ClipState | null = null;
    private currentFrame: UIFrame<TPayload> | null = null;
    private disposed = false;

    constructor(options: WebGL2UIRendererOptions<TPayload>) {
        this.gl = options.gl;
        this.resolveImageResource = options.resolveImageResource;
        this.customCommandRenderer = options.customCommandRenderer;
        this.atlasFilter = options.atlasFilter ?? 'linear';
        this.quadProgram = createProgram(this.gl, QUAD_VERTEX_SOURCE, QUAD_FRAGMENT_SOURCE);
        this.imageProgram = createProgram(this.gl, IMAGE_VERTEX_SOURCE, IMAGE_FRAGMENT_SOURCE);
        this.textProgram = createProgram(this.gl, TEXT_VERTEX_SOURCE, TEXT_FRAGMENT_SOURCE);
        this.quadViewportUniform = this.gl.getUniformLocation(this.quadProgram, 'u_Viewport');
        this.imageViewportUniform = this.gl.getUniformLocation(this.imageProgram, 'u_Viewport');
        this.imageTextureUniform = this.gl.getUniformLocation(this.imageProgram, 'u_Image');
        this.textViewportUniform = this.gl.getUniformLocation(this.textProgram, 'u_Viewport');
        this.textAtlasUniform = this.gl.getUniformLocation(this.textProgram, 'u_Atlas');
        this.quadBatch = new Float32Array((options.quadBatchCapacity ?? 1024) * QUAD_FLOATS_PER_INSTANCE);
        this.imageBatch = new Float32Array((options.imageBatchCapacity ?? 1024) * IMAGE_FLOATS_PER_INSTANCE);
        this.textBatch = new Float32Array((options.glyphBatchCapacity ?? 4096) * TEXT_FLOATS_PER_INSTANCE);
        this.quadStaticBuffer = this.gl.createBuffer();
        this.quadInstanceBuffer = this.gl.createBuffer();
        this.imageStaticBuffer = this.gl.createBuffer();
        this.imageInstanceBuffer = this.gl.createBuffer();
        this.textStaticBuffer = this.gl.createBuffer();
        this.textInstanceBuffer = this.gl.createBuffer();
        this.quadVao = this.gl.createVertexArray();
        this.imageVao = this.gl.createVertexArray();
        this.textVao = this.gl.createVertexArray();
        this.initializeQuadPipeline();
        this.initializeImagePipeline();
        this.initializeTextPipeline();
    }

    getStats(): WebGL2UIRendererStatistics {
        return {
            drawCalls: this.statisticsState.drawCalls,
            quadCount: this.statisticsState.quadCount,
            imageCount: this.statisticsState.imageCount,
            materialImageCount: this.statisticsState.materialImageCount,
            glyphCount: this.statisticsState.glyphCount,
            customCommandCount: this.statisticsState.customCommandCount,
            uploadedGlyphCount: this.statisticsState.uploadedGlyphCount,
            atlasPageCount: this.pages.size,
        };
    }

    render(frame: Readonly<UIFrame<TPayload>>): void {
        this.ensureActive();
        this.currentFrame = frame as UIFrame<TPayload>;
        this.statisticsState.drawCalls = 0;
        this.statisticsState.quadCount = 0;
        this.statisticsState.imageCount = 0;
        this.statisticsState.materialImageCount = 0;
        this.statisticsState.glyphCount = 0;
        this.statisticsState.customCommandCount = 0;
        this.statisticsState.uploadedGlyphCount = 0;
        this.quadCount = 0;
        this.imageCount = 0;
        this.textCount = 0;
        this.activeQuadClip = null;
        this.activeImageClip = null;
        this.activeImageSampler = null;
        this.activeTextClip = null;
        this.activeImageTexture = null;
        this.activeTextPageKey = null;

        this.prepareFrame(frame.viewportWidth, frame.viewportHeight);

        for (const command of frame.commands) {
            if (command.kind === 'quad') {
                this.flushImageBatch(frame.viewportHeight);
                this.flushTextBatch(frame.viewportHeight);
                if (!sameClip(this.activeQuadClip, command.clip)) {
                    this.flushQuadBatch(frame.viewportHeight);
                    this.activeQuadClip = toClipState(command.clip);
                }
                this.pushQuad(command);
                continue;
            }
            if (command.kind === 'image') {
                this.flushQuadBatch(frame.viewportHeight);
                this.flushTextBatch(frame.viewportHeight);
                this.pushImageCommand(command, frame);
                continue;
            }
            if (command.kind === 'text') {
                this.flushQuadBatch(frame.viewportHeight);
                this.flushImageBatch(frame.viewportHeight);
                this.pushTextCommand(command, frame.viewportHeight);
                continue;
            }
            this.flushQuadBatch(frame.viewportHeight);
            this.flushImageBatch(frame.viewportHeight);
            this.flushTextBatch(frame.viewportHeight);
            if (this.customCommandRenderer) {
                this.statisticsState.customCommandCount += 1;
                this.customCommandRenderer(command as CustomRenderCommand<TPayload>, {
                    gl: this.gl,
                    frame,
                    clip: command.clip,
                    viewport: {
                        width: frame.viewportWidth,
                        height: frame.viewportHeight,
                    },
                });
            }
        }

        this.flushQuadBatch(frame.viewportHeight);
        this.flushImageBatch(frame.viewportHeight);
        this.flushTextBatch(frame.viewportHeight);
        this.currentFrame = null;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        for (const page of this.pages.values()) {
            this.gl.deleteTexture(page.texture);
        }
        this.pages.clear();
        this.gl.deleteBuffer(this.quadStaticBuffer);
        this.gl.deleteBuffer(this.quadInstanceBuffer);
        this.gl.deleteBuffer(this.imageStaticBuffer);
        this.gl.deleteBuffer(this.imageInstanceBuffer);
        this.gl.deleteBuffer(this.textStaticBuffer);
        this.gl.deleteBuffer(this.textInstanceBuffer);
        this.gl.deleteVertexArray(this.quadVao);
        this.gl.deleteVertexArray(this.imageVao);
        this.gl.deleteVertexArray(this.textVao);
        this.gl.deleteProgram(this.quadProgram);
        this.gl.deleteProgram(this.imageProgram);
        this.gl.deleteProgram(this.textProgram);
        this.disposed = true;
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private initializeQuadPipeline(): void {
        const stride = QUAD_FLOATS_PER_INSTANCE * 4;
        this.gl.bindVertexArray(this.quadVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadStaticBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, UNIT_QUAD, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 8, 0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadInstanceBuffer);
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, stride, 0);
        this.gl.vertexAttribDivisor(1, 1);
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, stride, 16);
        this.gl.vertexAttribDivisor(2, 1);
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, 32);
        this.gl.vertexAttribDivisor(3, 1);
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 4, this.gl.FLOAT, false, stride, 48);
        this.gl.vertexAttribDivisor(4, 1);
        this.gl.enableVertexAttribArray(5);
        this.gl.vertexAttribPointer(5, 1, this.gl.FLOAT, false, stride, 64);
        this.gl.vertexAttribDivisor(5, 1);
        this.gl.enableVertexAttribArray(6);
        this.gl.vertexAttribPointer(6, 3, this.gl.FLOAT, false, stride, 68);
        this.gl.vertexAttribDivisor(6, 1);
        this.gl.enableVertexAttribArray(7);
        this.gl.vertexAttribPointer(7, 3, this.gl.FLOAT, false, stride, 80);
        this.gl.vertexAttribDivisor(7, 1);
        this.gl.bindVertexArray(null);
    }

    private initializeImagePipeline(): void {
        const stride = IMAGE_FLOATS_PER_INSTANCE * 4;
        this.gl.bindVertexArray(this.imageVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.imageStaticBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, UNIT_QUAD, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 8, 0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.imageInstanceBuffer);
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, stride, 0);
        this.gl.vertexAttribDivisor(1, 1);
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, stride, 16);
        this.gl.vertexAttribDivisor(2, 1);
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, 32);
        this.gl.vertexAttribDivisor(3, 1);
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 4, this.gl.FLOAT, false, stride, 48);
        this.gl.vertexAttribDivisor(4, 1);
        this.gl.enableVertexAttribArray(5);
        this.gl.vertexAttribPointer(5, 3, this.gl.FLOAT, false, stride, 64);
        this.gl.vertexAttribDivisor(5, 1);
        this.gl.enableVertexAttribArray(6);
        this.gl.vertexAttribPointer(6, 3, this.gl.FLOAT, false, stride, 76);
        this.gl.vertexAttribDivisor(6, 1);
        this.gl.bindVertexArray(null);
    }

    private initializeTextPipeline(): void {
        const stride = TEXT_FLOATS_PER_INSTANCE * 4;
        this.gl.bindVertexArray(this.textVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textStaticBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, UNIT_QUAD, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 8, 0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textInstanceBuffer);
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, stride, 0);
        this.gl.vertexAttribDivisor(1, 1);
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, stride, 16);
        this.gl.vertexAttribDivisor(2, 1);
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, 32);
        this.gl.vertexAttribDivisor(3, 1);
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 4, this.gl.FLOAT, false, stride, 48);
        this.gl.vertexAttribDivisor(4, 1);
        this.gl.enableVertexAttribArray(5);
        this.gl.vertexAttribPointer(5, 4, this.gl.FLOAT, false, stride, 64);
        this.gl.vertexAttribDivisor(5, 1);
        this.gl.enableVertexAttribArray(6);
        this.gl.vertexAttribPointer(6, 3, this.gl.FLOAT, false, stride, 80);
        this.gl.vertexAttribDivisor(6, 1);
        this.gl.enableVertexAttribArray(7);
        this.gl.vertexAttribPointer(7, 3, this.gl.FLOAT, false, stride, 92);
        this.gl.vertexAttribDivisor(7, 1);
        this.gl.bindVertexArray(null);
    }

    private prepareFrame(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);
        this.gl.disable(this.gl.CULL_FACE);
        this.gl.disable(this.gl.DEPTH_TEST);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    private pushQuad(command: QuadRenderCommand): void {
        const base = this.quadCount * QUAD_FLOATS_PER_INSTANCE;
        if (base + QUAD_FLOATS_PER_INSTANCE > this.quadBatch.length) {
            throw new Error('Quad batch capacity exceeded.');
        }
        const fill = blendColor(command.color, command.opacity);
        const border = blendColor(command.borderColor, command.opacity);
        this.quadBatch[base] = command.x;
        this.quadBatch[base + 1] = command.y;
        this.quadBatch[base + 2] = command.width;
        this.quadBatch[base + 3] = command.height;
        this.quadBatch.set(fill, base + 4);
        this.quadBatch.set(border, base + 8);
        this.quadBatch[base + 12] = command.radius.topLeft;
        this.quadBatch[base + 13] = command.radius.topRight;
        this.quadBatch[base + 14] = command.radius.bottomRight;
        this.quadBatch[base + 15] = command.radius.bottomLeft;
        this.quadBatch[base + 16] = command.borderWidth;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        this.quadBatch[base + 17] = transform[0];
        this.quadBatch[base + 18] = transform[1];
        this.quadBatch[base + 19] = transform[4];
        this.quadBatch[base + 20] = transform[2];
        this.quadBatch[base + 21] = transform[3];
        this.quadBatch[base + 22] = transform[5];
        this.quadCount += 1;
        this.statisticsState.quadCount += 1;
    }

    private pushTextCommand(command: TextRenderCommand, viewportHeight: number): void {
        const color = blendColor(command.color, command.opacity);
        const outlineColor = blendColor(command.outlineColor, command.opacity);
        for (const glyph of command.layout.glyphs) {
            if (!this.pushGlyph(command, glyph, color, outlineColor, viewportHeight)) {
                this.flushTextBatch(viewportHeight);
                if (!this.pushGlyph(command, glyph, color, outlineColor, viewportHeight)) {
                    throw new Error('Glyph batch capacity exceeded.');
                }
            }
        }
    }

    private pushImageCommand(command: ImageRenderCommand, frame: Readonly<UIFrame<TPayload>>): void {
        const resource = this.resolveImageResource?.(command.source, {
            gl: this.gl,
            frame,
            command,
        });
        if (!resource) {
            return;
        }
        this.statisticsState.imageCount += 1;
        if (resource.kind === 'material') {
            this.flushImageBatch(frame.viewportHeight);
            this.statisticsState.materialImageCount += 1;
            this.applyClip(toClipState(command.clip), frame.viewportHeight);
            resource.render({
                gl: this.gl,
                frame,
                command,
                clip: command.clip,
                viewport: { width: frame.viewportWidth, height: frame.viewportHeight },
            } satisfies WebGL2UIMaterialImageContext<TPayload>);
            return;
        }
        if (
            (this.activeImageTexture !== null && this.activeImageTexture !== resource.texture) ||
            (this.activeImageSampler !== (resource.sampler ?? null)) ||
            (this.activeImageClip !== null && !sameClip(this.activeImageClip, command.clip))
        ) {
            this.flushImageBatch(frame.viewportHeight);
        }
        const base = this.imageCount * IMAGE_FLOATS_PER_INSTANCE;
        if (base + IMAGE_FLOATS_PER_INSTANCE > this.imageBatch.length) {
            this.flushImageBatch(frame.viewportHeight);
            return this.pushImageCommand(command, frame);
        }
        this.activeImageTexture = resource.texture;
        this.activeImageSampler = resource.sampler ?? null;
        this.activeImageClip = toClipState(command.clip);
        const tint = [
            command.tint.r,
            command.tint.g,
            command.tint.b,
            multiplyAlpha(command.tint.a, command.opacity),
        ] as const;
        this.imageBatch[base] = command.x;
        this.imageBatch[base + 1] = command.y;
        this.imageBatch[base + 2] = command.width;
        this.imageBatch[base + 3] = command.height;
        this.imageBatch[base + 4] = command.uvRect.x;
        this.imageBatch[base + 5] = command.uvRect.y;
        this.imageBatch[base + 6] = command.uvRect.width;
        this.imageBatch[base + 7] = command.uvRect.height;
        this.imageBatch.set(tint, base + 8);
        this.imageBatch[base + 12] = command.radius.topLeft;
        this.imageBatch[base + 13] = command.radius.topRight;
        this.imageBatch[base + 14] = command.radius.bottomRight;
        this.imageBatch[base + 15] = command.radius.bottomLeft;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        this.imageBatch[base + 16] = transform[0];
        this.imageBatch[base + 17] = transform[1];
        this.imageBatch[base + 18] = transform[4];
        this.imageBatch[base + 19] = transform[2];
        this.imageBatch[base + 20] = transform[3];
        this.imageBatch[base + 21] = transform[5];
        this.imageCount += 1;
    }

    private pushGlyph(
        command: TextRenderCommand,
        glyph: TextGlyphPlacement,
        color: readonly [number, number, number, number],
        outlineColor: readonly [number, number, number, number],
        viewportHeight: number
    ): boolean {
        const entry = glyph.atlasEntry;
        if (!entry) {
            return true;
        }
        const pageKey = `${entry.faceId as number}:${entry.page as number}`;
        if (this.activeTextPageKey !== null && this.activeTextPageKey !== pageKey) {
            return false;
        }
        if (this.activeTextClip !== null && !sameClip(this.activeTextClip, command.clip)) {
            return false;
        }
        const page = this.ensureGlyphPage(entry);
        if (page === null) {
            return true;
        }
        const base = this.textCount * TEXT_FLOATS_PER_INSTANCE;
        if (base + TEXT_FLOATS_PER_INSTANCE > this.textBatch.length) {
            return false;
        }
        this.activeTextPageKey = pageKey;
        this.activeTextClip = toClipState(command.clip);
        this.textBatch[base] = command.x + glyph.x;
        this.textBatch[base + 1] = command.y + glyph.y;
        this.textBatch[base + 2] = glyph.width;
        this.textBatch[base + 3] = glyph.height;
        this.textBatch[base + 4] = entry.u0;
        this.textBatch[base + 5] = entry.v0;
        this.textBatch[base + 6] = entry.u1 - entry.u0;
        this.textBatch[base + 7] = entry.v1 - entry.v0;
        this.textBatch.set(color, base + 8);
        this.textBatch.set(outlineColor, base + 12);
        this.textBatch[base + 16] = entry.format === 'sdf8' ? 1 : 0;
        this.textBatch[base + 17] = entry.distanceRange;
        this.textBatch[base + 18] = command.outlineWidth;
        this.textBatch[base + 19] = command.edgeSoftness;
        const transform = command.transform ?? IDENTITY_TRANSFORM;
        this.textBatch[base + 20] = transform[0];
        this.textBatch[base + 21] = transform[1];
        this.textBatch[base + 22] = transform[4];
        this.textBatch[base + 23] = transform[2];
        this.textBatch[base + 24] = transform[3];
        this.textBatch[base + 25] = transform[5];
        this.textCount += 1;
        this.statisticsState.glyphCount += 1;
        void page;
        void viewportHeight;
        return true;
    }

    private flushQuadBatch(viewportHeight: number): void {
        if (this.quadCount === 0 || !this.currentFrame) {
            return;
        }
        this.applyClip(this.activeQuadClip, viewportHeight);
        this.gl.useProgram(this.quadProgram);
        this.gl.uniform2f(this.quadViewportUniform, this.currentFrame.viewportWidth, this.currentFrame.viewportHeight);
        this.gl.bindVertexArray(this.quadVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadInstanceBuffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            this.quadBatch.subarray(0, this.quadCount * QUAD_FLOATS_PER_INSTANCE),
            this.gl.DYNAMIC_DRAW
        );
        this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, this.quadCount);
        this.gl.bindVertexArray(null);
        this.statisticsState.drawCalls += 1;
        this.quadCount = 0;
    }

    private flushImageBatch(viewportHeight: number): void {
        if (this.imageCount === 0 || !this.currentFrame || !this.activeImageTexture) {
            this.imageCount = 0;
            this.activeImageTexture = null;
            return;
        }
        this.applyClip(this.activeImageClip, viewportHeight);
        this.gl.useProgram(this.imageProgram);
        this.gl.uniform2f(this.imageViewportUniform, this.currentFrame.viewportWidth, this.currentFrame.viewportHeight);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.activeImageTexture);
        this.gl.bindSampler?.(0, this.activeImageSampler);
        this.gl.uniform1i(this.imageTextureUniform, 0);
        this.gl.bindVertexArray(this.imageVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.imageInstanceBuffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            this.imageBatch.subarray(0, this.imageCount * IMAGE_FLOATS_PER_INSTANCE),
            this.gl.DYNAMIC_DRAW
        );
        this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, this.imageCount);
        this.gl.bindVertexArray(null);
        this.statisticsState.drawCalls += 1;
        this.imageCount = 0;
        this.activeImageTexture = null;
        this.activeImageSampler = null;
    }

    private flushTextBatch(viewportHeight: number): void {
        if (this.textCount === 0 || !this.currentFrame || this.activeTextPageKey === null) {
            return;
        }
        const page = this.pages.get(this.activeTextPageKey);
        if (!page) {
            this.textCount = 0;
            this.activeTextPageKey = null;
            return;
        }
        this.applyClip(this.activeTextClip, viewportHeight);
        this.gl.useProgram(this.textProgram);
        this.gl.uniform2f(this.textViewportUniform, this.currentFrame.viewportWidth, this.currentFrame.viewportHeight);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, page.texture);
        this.gl.uniform1i(this.textAtlasUniform, 0);
        this.gl.bindVertexArray(this.textVao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textInstanceBuffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            this.textBatch.subarray(0, this.textCount * TEXT_FLOATS_PER_INSTANCE),
            this.gl.DYNAMIC_DRAW
        );
        this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, this.textCount);
        this.gl.bindVertexArray(null);
        this.statisticsState.drawCalls += 1;
        this.textCount = 0;
        this.activeTextPageKey = null;
    }

    private applyClip(clip: ClipState | null, viewportHeight: number): void {
        if (clip === null) {
            this.gl.disable(this.gl.SCISSOR_TEST);
            return;
        }
        this.gl.enable(this.gl.SCISSOR_TEST);
        const x = Math.max(0, Math.floor(clip.x));
        const y = Math.max(0, Math.floor(viewportHeight - (clip.y + clip.height)));
        const width = Math.max(0, Math.ceil(clip.width));
        const height = Math.max(0, Math.ceil(clip.height));
        this.gl.scissor(x, y, width, height);
    }

    private ensureGlyphPage(entry: GlyphAtlasEntry): TexturePage | null {
        const key = `${entry.faceId as number}:${entry.page as number}`;
        let page = this.pages.get(key);
        if (!page) {
            const texture = this.gl.createTexture();
            if (!texture) {
                return null;
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            const internalFormat = entry.format === 'rgba8' ? this.gl.RGBA8 : this.gl.R8;
            const format = entry.format === 'rgba8' ? this.gl.RGBA : this.gl.RED;
            this.gl.texParameteri(
                this.gl.TEXTURE_2D,
                this.gl.TEXTURE_MIN_FILTER,
                this.atlasFilter === 'linear' ? this.gl.LINEAR : this.gl.NEAREST
            );
            this.gl.texParameteri(
                this.gl.TEXTURE_2D,
                this.gl.TEXTURE_MAG_FILTER,
                this.atlasFilter === 'linear' ? this.gl.LINEAR : this.gl.NEAREST
            );
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.pixelStorei?.(this.gl.UNPACK_ALIGNMENT, 1);
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                internalFormat,
                entry.pageWidth,
                entry.pageHeight,
                0,
                format,
                this.gl.UNSIGNED_BYTE,
                null
            );
            page = {
                texture,
                width: entry.pageWidth,
                height: entry.pageHeight,
                format: entry.format,
                uploadedGlyphs: new Set<number>(),
            };
            this.pages.set(key, page);
        }
        if (!page.uploadedGlyphs.has(entry.codePoint)) {
            if (!entry.data) {
                return null;
            }
            const packed = this.packGlyphData(entry);
            this.gl.bindTexture(this.gl.TEXTURE_2D, page.texture);
            this.gl.pixelStorei?.(this.gl.UNPACK_ALIGNMENT, 1);
            this.gl.texSubImage2D(
                this.gl.TEXTURE_2D,
                0,
                entry.x,
                entry.y,
                entry.width,
                entry.height,
                entry.format === 'rgba8' ? this.gl.RGBA : this.gl.RED,
                this.gl.UNSIGNED_BYTE,
                packed
            );
            page.uploadedGlyphs.add(entry.codePoint);
            this.statisticsState.uploadedGlyphCount += 1;
        }
        return page;
    }

    private packGlyphData(entry: GlyphAtlasEntry): Uint8Array {
        const bytesPerPixel = entry.format === 'rgba8' ? 4 : 1;
        const expectedStride = entry.width * bytesPerPixel;
        const source = toUint8Array(entry.data!);
        if (entry.rowStride === expectedStride) {
            return source;
        }
        const packed = new Uint8Array(expectedStride * entry.height);
        for (let row = 0; row < entry.height; row += 1) {
            const sourceOffset = row * entry.rowStride;
            const targetOffset = row * expectedStride;
            packed.set(source.subarray(sourceOffset, sourceOffset + expectedStride), targetOffset);
        }
        return packed;
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('WebGL2UIRenderer');
        }
    }
}

export type { WebGL2UICustomCommandContext, WebGL2UIRendererOptions, WebGL2UIRendererStatistics };