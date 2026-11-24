import type { SceneShaderDefinition } from './types';

export const DEFAULT_SCENE_LINE_SHADER_ID = 'scene/line-ribbon';

/**
 * Line/Trail ribbon shader.
 *
 * Renders view-aligned ribbon geometry as triangle lists. Each segment is a
 * quad (2 triangles) billboarded toward the camera. Vertex layout:
 *   - location 0 `a_Position` : vec3  (world position, offset already applied)
 *   - location 2 `a_UV0`      : vec2  (texture coordinates)
 *   - location 3 `a_Color0`   : vec4  (per-vertex RGBA from gradient)
 *
 * Uniforms:
 *   - u_ViewProjection : mat4
 *   - u_Model          : mat4  (identity for world-space, entity world matrix for local)
 *   - u_MainTexture    : sampler2D
 *   - u_UseTexture     : float (0 = color only, 1 = texture * color)
 */
export const createLineShaderDefinition = (
    id: string = DEFAULT_SCENE_LINE_SHADER_ID
): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
precision mediump float;
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
layout(location = 3) in vec4 a_Color0;
uniform mat4 u_ViewProjection;
uniform mat4 u_Model;
out vec2 v_UV;
out vec4 v_Color;
void main() {
    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);
    gl_Position = u_ViewProjection * worldPosition;
    v_UV = a_UV0;
    v_Color = a_Color0;
}`,
    fragmentSource: `#version 300 es
precision mediump float;
uniform sampler2D u_MainTexture;
uniform float u_UseTexture;
in vec2 v_UV;
in vec4 v_Color;
out vec4 o_Color;
void main() {
    vec4 color = v_Color;
    if (u_UseTexture > 0.5) {
        color *= texture(u_MainTexture, v_UV);
    }
    if (color.a < 0.004) {
        discard;
    }
    o_Color = color;
}`,
    attributes: {
        position: 'a_Position',
        uv0: 'a_UV0',
        color0: 'a_Color0',
    },
    uniforms: [
        'u_ViewProjection',
        'u_Model',
        'u_MainTexture',
        'u_UseTexture',
    ],
    depthTest: true,
    cull: false,
    blend: true,
});
