namespace Axrone.Ui.Rendering.OpenGL;

using Axrone.Render.OpenGL.Native;

/// <summary>OpenGL constants used by the UI backend that are not already modelled by <see cref="GLConst"/>.</summary>
internal static class UiGl
{
    public const uint Zero = 0;
    public const uint One = 1;
    public const uint SrcAlpha = 0x0302;
    public const uint OneMinusSrcAlpha = 0x0303;
    public const uint DstColor = 0x0306;
    public const uint ScissorTest = 0x0C11;
    public const uint LinkStatus = 0x8B82;
    public const uint SamplerMinFilter = 0x2801;
    public const uint SamplerMagFilter = 0x2800;
    public const uint SamplerWrapS = 0x2802;
    public const uint SamplerWrapT = 0x2803;
    public const uint Linear = 0x2601;
    public const uint Nearest = 0x2600;
    public const uint ClampToEdge = 0x812F;
}

/// <summary>
/// GLSL 330 core sources for the three UI pipelines. Attribute locations match
/// the instance layouts (<see cref="UiQuadInstance"/>, <see cref="UiImageInstance"/>,
/// <see cref="UiGlyphInstance"/>): location 0 is the unit
/// quad, 1–4 are vec4 payloads, 5–6 are scalar payloads.
/// </summary>
internal static class UiShaderSources
{
    public const string QuadVertex = """
#version 330 core
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_Fill;
layout(location = 3) in vec4 a_Border;
layout(location = 4) in vec4 a_Radii;
layout(location = 5) in float a_BorderWidth;
layout(location = 6) in float a_Opacity;
uniform vec2 u_Viewport;
out vec2 v_Local;
out vec2 v_Size;
out vec4 v_Fill;
out vec4 v_Border;
out vec4 v_Radii;
out float v_BorderWidth;
out float v_Opacity;
void main()
{
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    vec2 ndc = vec2(pixel.x / u_Viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_Viewport.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Local = a_Unit * a_Rect.zw;
    v_Size = a_Rect.zw;
    v_Fill = a_Fill;
    v_Border = a_Border;
    v_Radii = a_Radii;
    v_BorderWidth = a_BorderWidth;
    v_Opacity = a_Opacity;
}
""";

    public const string QuadFragment = """
#version 330 core
in vec2 v_Local;
in vec2 v_Size;
in vec4 v_Fill;
in vec4 v_Border;
in vec4 v_Radii;
in float v_BorderWidth;
in float v_Opacity;
out vec4 o_Color;
float sdRound(vec2 p, vec2 halfSize, vec4 radii)
{
    float r = p.x < 0.0
        ? (p.y < 0.0 ? radii.x : radii.w)
        : (p.y < 0.0 ? radii.y : radii.z);
    r = min(r, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + vec2(r);
    return length(max(q, vec2(0.0))) - r;
}
void main()
{
    vec2 p = v_Local - v_Size * 0.5;
    float d = sdRound(p, v_Size * 0.5, v_Radii);
    float aa = max(fwidth(d), 0.0001);
    float fill = 1.0 - smoothstep(-aa, aa, d);
    vec4 color = v_Fill;
    if (v_BorderWidth > 0.0)
    {
        float inside = smoothstep(-v_BorderWidth - aa, -v_BorderWidth + aa, d);
        color = mix(v_Border, v_Fill, inside);
    }
    float alpha = color.a * fill * v_Opacity;
    if (alpha <= 0.001) discard;
    o_Color = vec4(color.rgb, alpha);
}
""";

    public const string ImageVertex = """
#version 330 core
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_Uv;
layout(location = 3) in vec4 a_Tint;
layout(location = 4) in vec4 a_Radii;
layout(location = 5) in float a_Opacity;
layout(location = 6) in float a_Flags;
uniform vec2 u_Viewport;
out vec2 v_Unit;
out vec2 v_Size;
out vec2 v_UvMin;
out vec2 v_UvMax;
out vec4 v_Tint;
out vec4 v_Radii;
out float v_Opacity;
out float v_Flags;
void main()
{
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    vec2 ndc = vec2(pixel.x / u_Viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_Viewport.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Unit = a_Unit;
    v_Size = a_Rect.zw;
    v_UvMin = a_Uv.xy;
    v_UvMax = a_Uv.xy + a_Uv.zw;
    v_Tint = a_Tint;
    v_Radii = a_Radii;
    v_Opacity = a_Opacity;
    v_Flags = a_Flags;
}
""";

    public const string ImageFragment = """
#version 330 core
in vec2 v_Unit;
in vec2 v_Size;
in vec2 v_UvMin;
in vec2 v_UvMax;
in vec4 v_Tint;
in vec4 v_Radii;
in float v_Opacity;
in float v_Flags;
uniform sampler2D u_Texture;
out vec4 o_Color;
float sdRound(vec2 p, vec2 halfSize, vec4 radii)
{
    float r = p.x < 0.0
        ? (p.y < 0.0 ? radii.x : radii.w)
        : (p.y < 0.0 ? radii.y : radii.z);
    r = min(r, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + vec2(r);
    return length(max(q, vec2(0.0))) - r;
}
void main()
{
    vec2 uv = mix(v_UvMin, v_UvMax, v_Unit);
    uint flags = uint(v_Flags + 0.5);
    if ((flags & 2u) != 0u) uv.x = v_UvMin.x + v_UvMax.x - uv.x;
    if ((flags & 4u) != 0u) uv.y = v_UvMin.y + v_UvMax.y - uv.y;
    vec4 texel = texture(u_Texture, uv);
    vec2 p = v_Unit * v_Size - v_Size * 0.5;
    float d = sdRound(p, v_Size * 0.5, v_Radii);
    float aa = max(fwidth(d), 0.0001);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    float alpha = texel.a * v_Tint.a * v_Opacity * mask;
    if (alpha <= 0.001) discard;
    o_Color = vec4(texel.rgb * v_Tint.rgb, alpha);
}
""";

    public const string TextVertex = """
#version 330 core
layout(location = 0) in vec2 a_Unit;
layout(location = 1) in vec4 a_Rect;
layout(location = 2) in vec4 a_Uv;
layout(location = 3) in vec4 a_Color;
layout(location = 4) in vec4 a_OutlineColor;
layout(location = 5) in float a_OutlineWidth;
layout(location = 6) in float a_Opacity;
uniform vec2 u_Viewport;
out vec2 v_Unit;
out vec2 v_UvMin;
out vec2 v_UvMax;
out vec4 v_Color;
out vec4 v_OutlineColor;
out float v_OutlineWidth;
out float v_Opacity;
void main()
{
    vec2 pixel = a_Rect.xy + a_Unit * a_Rect.zw;
    vec2 ndc = vec2(pixel.x / u_Viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_Viewport.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_Unit = a_Unit;
    v_UvMin = a_Uv.xy;
    v_UvMax = a_Uv.xy + a_Uv.zw;
    v_Color = a_Color;
    v_OutlineColor = a_OutlineColor;
    v_OutlineWidth = a_OutlineWidth;
    v_Opacity = a_Opacity;
}
""";

    public const string TextFragment = """
#version 330 core
in vec2 v_Unit;
in vec2 v_UvMin;
in vec2 v_UvMax;
in vec4 v_Color;
in vec4 v_OutlineColor;
in float v_OutlineWidth;
in float v_Opacity;
uniform sampler2D u_Texture;
out vec4 o_Color;
void main()
{
    vec2 uv = mix(v_UvMin, v_UvMax, v_Unit);
    float dist = texture(u_Texture, uv).r;
    float aa = max(fwidth(dist), 0.0001);
    float fill = smoothstep(0.5 - aa, 0.5 + aa, dist);
    float edge = v_OutlineWidth > 0.0 ? smoothstep(0.5 - v_OutlineWidth - aa, 0.5 - v_OutlineWidth + aa, dist) : 0.0;
    vec4 color = mix(v_OutlineColor, v_Color, fill);
    float alpha = max(fill * v_Color.a, edge * v_OutlineColor.a) * v_Opacity;
    if (alpha <= 0.001) discard;
    o_Color = vec4(color.rgb, alpha);
}
""";
}
