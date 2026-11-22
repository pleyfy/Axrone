/**
 * Canonical GLSL shader sources for the WebGL2 UI renderer.
 *
 * All inline template-literal shader strings have been moved here from
 * renderer.ts so they can be maintained in one place. The two fragment
 * shaders that need rounded-rect SDF evaluation (quad and image) share a
 * single `ROUNDED_RECT_SDF_GLSL` block instead of each carrying a copy.
 *
 * The shared ROUNDED_RECT_SDF_GLSL constant is hosted in @axrone/render-core
 * so render-2d can reuse it for mask evaluation.
 */
export { ROUNDED_RECT_SDF_GLSL } from '@axrone/render-core/nine-slice';
import { ROUNDED_RECT_SDF_GLSL } from '@axrone/render-core/nine-slice';

export const QUAD_VERTEX_SOURCE = `#version 300 es
precision highp float;
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

export const QUAD_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_Local;
in vec2 v_Size;
in vec4 v_FillColor;
in vec4 v_BorderColor;
in vec4 v_Radius;
in float v_BorderWidth;
out vec4 o_Color;
${ROUNDED_RECT_SDF_GLSL}
void main() {
    float outer = roundedRectSdf(v_Local, v_Size, v_Radius);
    float aa = max(fwidth(outer), 0.75);
    float outerAlpha = 1.0 - smoothstep(-aa, aa, outer);
    vec4 color = v_FillColor;
    if (v_BorderWidth > 0.0 && v_BorderColor.a > 0.0) {
        vec2 innerSize = max(v_Size - vec2(v_BorderWidth * 2.0), vec2(0.0));
        vec2 innerLocal = v_Local - vec2(v_BorderWidth);
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

export const TEXT_VERTEX_SOURCE = `#version 300 es
precision highp float;
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

export const TEXT_FRAGMENT_SOURCE = `#version 300 es
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

export const IMAGE_VERTEX_SOURCE = `#version 300 es
precision highp float;
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

export const IMAGE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_Image;
in vec2 v_Local;
in vec2 v_Size;
in vec2 v_Uv;
in vec4 v_Tint;
in vec4 v_Radius;
out vec4 o_Color;
${ROUNDED_RECT_SDF_GLSL}
void main() {
    float sdf = roundedRectSdf(v_Local, v_Size, v_Radius);
    float aa = max(fwidth(sdf), 0.75);
    float mask = 1.0 - smoothstep(-aa, aa, sdf);
    vec4 color = texture(u_Image, v_Uv) * v_Tint;
    color *= mask;
    if (color.a <= 0.0) { discard; }
    o_Color = color;
}`;
