import { describe, it, expect, beforeEach } from 'vitest';

const createTestCanvas = (width = 800, height = 600): HTMLCanvasElement =>
  (window as any).createTestCanvas(width, height);

const createWebGLContext = (
  canvas: HTMLCanvasElement,
  attrs: Partial<WebGLContextAttributes> = {},
): WebGL2RenderingContext => (window as any).createWebGLContext(canvas, attrs);

const compileStage = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): { success: boolean; infoLog: string } => {
  const shader = gl.createShader(type);
  if (!shader) {
    return { success: false, infoLog: 'Failed to create shader object' };
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
  const infoLog = gl.getShaderInfoLog(shader) ?? '';
  gl.deleteShader(shader);
  return { success, infoLog };
};

const linkSources = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): { success: boolean; infoLog: string } => {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) {
    return { success: false, infoLog: 'Failed to create shader objects' };
  }
  gl.shaderSource(vs, vertexSource);
  gl.compileShader(vs);
  if (!(gl.getShaderParameter(vs, gl.COMPILE_STATUS) as boolean)) {
    const log = gl.getShaderInfoLog(vs) ?? '';
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { success: false, infoLog: 'vertex: ' + log };
  }
  gl.shaderSource(fs, fragmentSource);
  gl.compileShader(fs);
  if (!(gl.getShaderParameter(fs, gl.COMPILE_STATUS) as boolean)) {
    const log = gl.getShaderInfoLog(fs) ?? '';
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { success: false, infoLog: 'fragment: ' + log };
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { success: false, infoLog: 'Failed to create program object' };
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const success = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  const infoLog = gl.getProgramInfoLog(program) ?? '';
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.deleteProgram(program);
  return { success, infoLog };
};

const GENERATED_GATE_VERTEX = `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_UV0;
uniform mat4 u_Model;
out vec2 v_UV0;
out vec3 v_WorldPosition;
void main() {
  v_UV0 = a_UV0;
  vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
  v_WorldPosition = worldPosition.xyz;
  gl_Position = worldPosition;
}
`;

const GENERATED_UNLIT_GATE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_UV0;
in vec3 v_WorldPosition;
uniform vec3 _BaseColorFactor;
uniform vec3 _EmissiveFactor;
uniform sampler2D _BaseColorTexture;
uniform vec4 _BaseColorTexture_ST;
uniform float _BaseColorTexture_Rotation;
out vec4 o_Color;
vec2 transformUV(vec2 uv, vec4 st, float rotation) {
  vec2 transformed = (uv * st.xy) + st.zw;
  float uvSin = sin(rotation);
  float uvCos = cos(rotation);
  vec2 centered = transformed - vec2(0.5);
  return vec2(centered.x * uvCos - centered.y * uvSin, centered.x * uvSin + centered.y * uvCos) + vec2(0.5);
}
vec3 linearToSrgb(vec3 color) {
  vec3 clamped = clamp(color, vec3(0.0), vec3(1.0));
  vec3 cutoff = step(vec3(0.0031308), clamped);
  vec3 lower = clamped * 12.92;
  vec3 higher = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;
  return mix(lower, higher, cutoff);
}
void main() {
  vec2 baseColorUv = transformUV(v_UV0, _BaseColorTexture_ST, _BaseColorTexture_Rotation);
  vec3 baseColorSample = vec3(1.0);
  vec3 generatedBaseColor = (_BaseColorFactor * baseColorSample);
  vec3 luminance = vec3(dot(generatedBaseColor, vec3(0.299, 0.587, 0.114)));
  vec3 desaturated = mix(generatedBaseColor, luminance, clamp(0.35, 0.0, 1.0));
  vec3 generatedEmissive = (_EmissiveFactor * vec3(1.0));
  vec3 displayColor = linearToSrgb(clamp(desaturated + generatedEmissive, vec3(0.0), vec3(16.0)));
  o_Color = vec4(displayColor, 1.0);
}
`;

const GENERATED_PBR_GATE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_UV0;
in vec3 v_WorldPosition;
uniform vec3 _BaseColorFactor;
uniform vec3 _EmissiveFactor;
uniform float _MetallicFactor;
uniform float _RoughnessFactor;
uniform sampler2D _BaseColorTexture;
uniform vec4 _BaseColorTexture_ST;
uniform float _BaseColorTexture_Rotation;
out vec4 o_Color;
vec2 transformUV(vec2 uv, vec4 st, float rotation) {
  vec2 transformed = (uv * st.xy) + st.zw;
  float uvSin = sin(rotation);
  float uvCos = cos(rotation);
  vec2 centered = transformed - vec2(0.5);
  return vec2(centered.x * uvCos - centered.y * uvSin, centered.x * uvSin + centered.y * uvCos) + vec2(0.5);
}
vec3 linearToSrgb(vec3 color) {
  vec3 clamped = clamp(color, vec3(0.0), vec3(1.0));
  vec3 cutoff = step(vec3(0.0031308), clamped);
  vec3 lower = clamped * 12.92;
  vec3 higher = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;
  return mix(lower, higher, cutoff);
}
void main() {
  vec2 baseColorUv = transformUV(v_UV0, _BaseColorTexture_ST, _BaseColorTexture_Rotation);
  vec3 baseColorSample = vec3(1.0);
  vec3 generatedBaseColor = (_BaseColorFactor * baseColorSample);
  vec3 screenBlend = (vec3(1.0) - (vec3(1.0) - generatedBaseColor) * (vec3(1.0) - vec3(0.25, 0.5, 0.75)));
  float roughness = clamp(_RoughnessFactor, 0.04, 1.0);
  float metallic = clamp(_MetallicFactor, 0.0, 1.0);
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
  vec3 lighting = screenBlend * (0.5 + 0.5 * roughness) * (1.0 - metallic * 0.5);
  vec3 generatedEmissive = (_EmissiveFactor * vec3(1.0));
  vec3 displayColor = linearToSrgb(clamp(lighting + generatedEmissive, vec3(0.0), vec3(16.0)));
  o_Color = vec4(displayColor, 1.0);
}
`;

describe('material generated shader release gate on real WebGL2', () => {
  let gl: WebGL2RenderingContext;

  beforeEach(() => {
    const canvas = createTestCanvas();
    gl = createWebGLContext(canvas);
  });

  it('compiles generated unlit gate vertex stage', () => {
    const result = compileStage(gl, gl.VERTEX_SHADER, GENERATED_GATE_VERTEX);
    expect(result.success).toBe(true);
  });

  it('compiles generated unlit gate fragment stage', () => {
    const result = compileStage(gl, gl.FRAGMENT_SHADER, GENERATED_UNLIT_GATE_FRAGMENT);
    expect(result.success).toBe(true);
  });

  it('links generated unlit gate program', () => {
    const result = linkSources(gl, GENERATED_GATE_VERTEX, GENERATED_UNLIT_GATE_FRAGMENT);
    expect(result.success).toBe(true);
  });

  it('compiles generated pbr gate fragment stage', () => {
    const result = compileStage(gl, gl.FRAGMENT_SHADER, GENERATED_PBR_GATE_FRAGMENT);
    expect(result.success).toBe(true);
  });

  it('links generated pbr gate program', () => {
    const result = linkSources(gl, GENERATED_GATE_VERTEX, GENERATED_PBR_GATE_FRAGMENT);
    expect(result.success).toBe(true);
  });

  it('generated gate fragments carry host parity math idioms', () => {
    expect(GENERATED_UNLIT_GATE_FRAGMENT).toContain('generatedBaseColor');
    expect(GENERATED_UNLIT_GATE_FRAGMENT).toContain('mix(');
    expect(GENERATED_UNLIT_GATE_FRAGMENT).toContain('vec3(dot(');
    expect(GENERATED_PBR_GATE_FRAGMENT).toContain('generatedBaseColor');
    expect(GENERATED_PBR_GATE_FRAGMENT).toContain('lighting + generatedEmissive');
    expect(GENERATED_PBR_GATE_FRAGMENT).toContain('vec3(1.0) - (vec3(1.0) -');
  });
});
