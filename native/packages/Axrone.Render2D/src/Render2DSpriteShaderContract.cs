namespace Axrone.Render2D;

/// <summary>Renderer-independent sprite vertex layout and shader binding contract.</summary>
/// <remarks>
/// The C# layout targets a 16-byte vertex: position (two floats), normalized
/// UV (two unsigned shorts) and RGBA8 color (one packed uint). The UV channel is
/// normalized 16-bit rather than the reference TypeScript float pair so the
/// whole vertex fits in one 16-byte record without losing color precision.
/// </remarks>
public static class Render2DSpriteShaderContract
{
    /// <summary>Default sprite shader identity.</summary>
    public const string DefaultShaderId = "Render2D/Sprite";

    /// <summary>Vertex byte stride.</summary>
    public const int VertexStride = 16;

    /// <summary>Vertices emitted per quad.</summary>
    public const int VerticesPerQuad = 4;

    /// <summary>Indices emitted per quad.</summary>
    public const int IndicesPerQuad = 6;

    /// <summary>Position attribute name.</summary>
    public const string PositionAttribute = "a_Position";

    /// <summary>UV attribute name.</summary>
    public const string UvAttribute = "a_UV0";

    /// <summary>Color attribute name.</summary>
    public const string ColorAttribute = "a_Color0";

    /// <summary>Material texture uniform name.</summary>
    public const string MainTextureUniform = "u_MainTex";

    /// <summary>Camera view-projection uniform name.</summary>
    public const string ViewProjectionUniform = "u_ViewProjection";

    /// <summary>Mask shape uniform name.</summary>
    public const string MaskShapeUniform = "u_MaskShape";

    /// <summary>Mask world-to-local uniform name.</summary>
    public const string MaskWorldToLocalUniform = "u_MaskWorldToLocal";

    /// <summary>Mask size uniform name.</summary>
    public const string MaskSizeUniform = "u_MaskSize";

    /// <summary>Mask anchor uniform name.</summary>
    public const string MaskAnchorUniform = "u_MaskAnchor";

    /// <summary>Mask corner radius uniform name.</summary>
    public const string MaskCornerRadiusUniform = "u_MaskCornerRadius";

    private static readonly string[] s_requiredUniforms =
    [
        ViewProjectionUniform,
        MainTextureUniform,
        MaskShapeUniform,
        MaskWorldToLocalUniform,
        MaskSizeUniform,
        MaskAnchorUniform,
        MaskCornerRadiusUniform,
    ];

    /// <summary>Gets the required sprite uniform names in contract order.</summary>
    public static ReadOnlySpan<string> RequiredUniformNames => s_requiredUniforms;

    /// <summary>
    /// Returns true when every required sprite uniform is present in the
    /// candidate sequence. Extra names are allowed; comparison is ordinal.
    /// </summary>
    public static bool IsSpriteUniformNames(ReadOnlySpan<string> names)
    {
        for (int required = 0; required < s_requiredUniforms.Length; required++)
        {
            string expected = s_requiredUniforms[required];
            bool found = false;
            for (int candidate = 0; candidate < names.Length; candidate++)
            {
                if (string.Equals(names[candidate], expected, StringComparison.Ordinal))
                {
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                return false;
            }
        }

        return true;
    }
}
