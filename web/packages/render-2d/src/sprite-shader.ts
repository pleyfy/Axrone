export const RENDER_2D_DEFAULT_SPRITE_SHADER_ID = 'Render2D/Sprite';

export const RENDER_2D_SPRITE_ATTRIBUTE_NAMES = Object.freeze({
    position: 'a_Position',
    uv0: 'a_UV0',
    color0: 'a_Color0',
} as const);

export const RENDER_2D_SPRITE_UNIFORM_NAMES = Object.freeze([
    'u_ViewProjection',
    'u_MainTex',
    'u_MaskShape',
    'u_MaskWorldToLocal',
    'u_MaskSize',
    'u_MaskAnchor',
    'u_MaskCornerRadius',
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
out vec3 v_WorldPosition;
void main() {
    v_UV0 = a_UV0;
    v_Color0 = a_Color0;
    v_WorldPosition = a_Position;
    gl_Position = u_ViewProjection * vec4(a_Position, 1.0);
}`;

export const RENDER_2D_SPRITE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_MainTex;
uniform int u_MaskShape;
uniform mat4 u_MaskWorldToLocal;
uniform vec2 u_MaskSize;
uniform vec2 u_MaskAnchor;
uniform float u_MaskCornerRadius;
in vec2 v_UV0;
in vec4 v_Color0;
in vec3 v_WorldPosition;
out vec4 o_Color;

float evaluateMaskCircle(vec2 localPosition, vec2 maskSize, vec2 maskAnchor) {
    vec2 maskMin = -maskAnchor * maskSize;
    vec2 maskCenter = maskMin + maskSize * 0.5;
    vec2 radius = max(maskSize * 0.5, vec2(0.000001));
    vec2 normalized = (localPosition - maskCenter) / radius;
    return step(length(normalized), 1.0);
}

float evaluateMaskRoundedRect(vec2 localPosition, vec2 maskSize, vec2 maskAnchor, float cornerRadius) {
    vec2 maskMin = -maskAnchor * maskSize;
    vec2 maskCenter = maskMin + maskSize * 0.5;
    vec2 halfSize = maskSize * 0.5;
    float radius = clamp(cornerRadius, 0.0, min(halfSize.x, halfSize.y));
    vec2 local = abs(localPosition - maskCenter);
    vec2 inner = max(halfSize - vec2(radius), vec2(0.0));
    vec2 delta = local - inner;
    vec2 maxDelta = max(delta, vec2(0.0));
    float outsideDistance = length(maxDelta) + min(max(delta.x, delta.y), 0.0) - radius;
    return step(outsideDistance, 0.0);
}

float evaluateMask(vec3 worldPosition) {
    if (u_MaskShape == 0) {
        return 1.0;
    }

    vec2 localPosition = (u_MaskWorldToLocal * vec4(worldPosition, 1.0)).xy;

    if (u_MaskShape == 1) {
        return evaluateMaskCircle(localPosition, u_MaskSize, u_MaskAnchor);
    }

    if (u_MaskShape == 2) {
        return evaluateMaskRoundedRect(localPosition, u_MaskSize, u_MaskAnchor, u_MaskCornerRadius);
    }

    return 1.0;
}

void main() {
    float mask = evaluateMask(v_WorldPosition);
    if (mask <= 0.0) {
        discard;
    }

    o_Color = texture(u_MainTex, v_UV0) * v_Color0;
}`;