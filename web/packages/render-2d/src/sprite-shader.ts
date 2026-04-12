export const RENDER_2D_DEFAULT_SPRITE_SHADER_ID = 'Render2D/Sprite';

export const RENDER_2D_SPRITE_ATTRIBUTE_NAMES = Object.freeze({
    position: 'a_Position',
    uv0: 'a_UV0',
    color0: 'a_Color0',
} as const);

export const RENDER_2D_SPRITE_UNIFORM_NAMES = Object.freeze([
    'u_ViewProjection',
    'u_MainTex',
] as const);

export const RENDER_2D_SPRITE_VERTEX_STRIDE = 24;
export const RENDER_2D_SPRITE_FLOAT_STRIDE =
    RENDER_2D_SPRITE_VERTEX_STRIDE / Float32Array.BYTES_PER_ELEMENT;
export const RENDER_2D_SPRITE_VERTICES_PER_QUAD = 4;
export const RENDER_2D_SPRITE_INDICES_PER_QUAD = 6;

export const RENDER_2D_SPRITE_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
layout(location = 3) in vec4 a_Color0;
uniform mat4 u_ViewProjection;
out vec2 v_UV0;
out vec4 v_Color0;
void main() {
    v_UV0 = a_UV0;
    v_Color0 = a_Color0;
    gl_Position = u_ViewProjection * vec4(a_Position, 1.0);
}`;

export const RENDER_2D_SPRITE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_MainTex;
in vec2 v_UV0;
in vec4 v_Color0;
out vec4 o_Color;
void main() {
    o_Color = texture(u_MainTex, v_UV0) * v_Color0;
}`;