namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Binds collected area lights to the material shader contract declared in
/// <see cref="SceneGlShaderSnippets.AreaLights"/>. The uniform element names are
/// precomputed so the per-frame path allocates nothing.
/// </summary>
public static class SceneGlAreaLightBinder
{
    /// <summary>Maximum area lights forwarded to one material shader.</summary>
    public const int MaxAreaLights = 4;

    private const string CountUniform = "u_AreaLightCount";

    private static readonly string[] PositionNames =
    [
        "u_AreaLightPosition[0]", "u_AreaLightPosition[1]",
        "u_AreaLightPosition[2]", "u_AreaLightPosition[3]"
    ];

    private static readonly string[] RightNames =
    [
        "u_AreaLightRight[0]", "u_AreaLightRight[1]",
        "u_AreaLightRight[2]", "u_AreaLightRight[3]"
    ];

    private static readonly string[] UpNames =
    [
        "u_AreaLightUp[0]", "u_AreaLightUp[1]",
        "u_AreaLightUp[2]", "u_AreaLightUp[3]"
    ];

    private static readonly string[] ColorNames =
    [
        "u_AreaLightColor[0]", "u_AreaLightColor[1]",
        "u_AreaLightColor[2]", "u_AreaLightColor[3]"
    ];

    private static readonly string[] ParamNames =
    [
        "u_AreaLightParams[0]", "u_AreaLightParams[1]",
        "u_AreaLightParams[2]", "u_AreaLightParams[3]"
    ];

    /// <summary>Binds up to <see cref="MaxAreaLights"/> emitters to a shader.</summary>
    public static int Bind(SceneGlShader shader, ReadOnlySpan<SceneAreaLightRenderItem> lights)
    {
        ArgumentNullException.ThrowIfNull(shader);

        int count = Math.Min(lights.Length, MaxAreaLights);
        shader.SetInt(CountUniform, count);

        for (int i = 0; i < count; i++)
        {
            ref readonly SceneAreaLightRenderItem light = ref lights[i];
            Vec3 right = light.Rotation * Vec3.UnitX;
            Vec3 up = light.Rotation * Vec3.UnitY;

            shader.SetVec3(PositionNames[i], in light.Position);
            shader.SetVec3(RightNames[i], in right);
            shader.SetVec3(UpNames[i], in up);
            shader.SetVec3(ColorNames[i], in light.Color);

            var parameters = new Vec4(
                light.Shape == SceneAreaLightShape.Disk ? 1.0f : 0.0f,
                light.Size.X * 0.5f,
                light.Size.Y * 0.5f,
                light.Range);
            shader.SetVec4(ParamNames[i], in parameters);
        }

        return count;
    }
}
