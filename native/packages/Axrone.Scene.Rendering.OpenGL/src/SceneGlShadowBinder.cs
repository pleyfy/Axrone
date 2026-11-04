namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Binds a shadow atlas and the current cascade snapshot to a shader that
/// includes <c>SceneGltfShaderLibrary.ShadowBlockId</c>. Shaders without the
/// shadow contract fail closed instead of sampling an invalid texture.
/// </summary>
public static class SceneGlShadowBinder
{
    /// <summary>Texture unit reserved for the global shadow atlas.</summary>
    public const int TextureUnit = 16;

    private const string TextureUniform = "u_ShadowMap";
    private const string EnabledUniform = "u_ShadowEnabled";
    private const string CascadeCountUniform = "u_ShadowCascadeCount";
    private const string FilterUniform = "u_ShadowFilter";
    private const string SplitsUniform = "u_ShadowSplits";
    private const string TilesUniform = "u_ShadowTiles";
    private const string TexelUniform = "u_ShadowTexelSize";
    private const string MatricesUniform = "u_ShadowLightMatrices";
    private const string DepthBiasUniform = "u_ShadowDepthBias";
    private const string NormalBiasUniform = "u_ShadowNormalBias";

    private const string HeightFogEnabledUniform = "u_HeightFogEnabled";
    private const string HeightFogColorUniform = "u_HeightFogColor";
    private const string HeightFogDensityUniform = "u_HeightFogDensity";
    private const string HeightFogFalloffUniform = "u_HeightFogFalloff";
    private const string HeightFogGroundUniform = "u_HeightFogGroundHeight";

    /// <summary>Whether the context can bind the reserved shadow sampler unit.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool SupportsTextureUnit(GLContext context) =>
        context is not null && context.Capabilities.MaxTextureImageUnits > TextureUnit;

    /// <summary>Clears a shader's shadow gate without requiring atlas resources.</summary>
    public static void Disable(SceneGlShader shader)
    {
        ArgumentNullException.ThrowIfNull(shader);
        shader.SetInt(EnabledUniform, 0);
        shader.SetInt(CascadeCountUniform, 0);
    }

    /// <summary>Binds the atlas, sampler, cascade matrices and filter parameters.</summary>
    /// <returns>False when the shader has no shadow contract or the context cannot host the unit.</returns>
    public static bool Bind(
        GLContext context,
        SceneGlShader shader,
        SceneGlShadowAtlas atlas,
        ShadowFrameData frame,
        in HeightFogSettings heightFog = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(shader);
        ArgumentNullException.ThrowIfNull(atlas);
        ArgumentNullException.ThrowIfNull(frame);

        BindHeightFog(shader, in heightFog);

        if (!atlas.IsAvailable || !frame.IsEnabled || !SupportsTextureUnit(context))
        {
            Disable(shader);
            return false;
        }

        context.AssertRenderThread();

        int samplerLocation = shader.GetUniformLocation(TextureUniform);
        if (samplerLocation < 0)
        {
            Disable(shader);
            return false;
        }

        context.State.BindTexture2D((uint)TextureUnit, atlas.Texture.Id);
        context.State.BindSampler((uint)TextureUnit, atlas.Sampler.Id);
        context.GL.Uniform1(samplerLocation, TextureUnit);

        shader.SetInt(EnabledUniform, 1);
        shader.SetInt(CascadeCountUniform, frame.ActiveCascadeCount);
        shader.SetInt(FilterUniform, ShadowFilterModes.ToShaderValue(frame.Filter));
        shader.SetFloat(DepthBiasUniform, frame.Bias.Depth);
        shader.SetFloat(NormalBiasUniform, frame.Bias.Normal);
        Vec2 texel = frame.AtlasTexelSize;
        shader.SetVec2(TexelUniform, in texel);

        Vec4 splits = new(
            frame.GetSplitDepth(0),
            frame.GetSplitDepth(1),
            frame.GetSplitDepth(2),
            frame.GetSplitDepth(3));
        shader.SetVec4(SplitsUniform, in splits);

        int tileLocation = ResolveArrayLocation(shader, TilesUniform);
        if (tileLocation < 0)
        {
            Disable(shader);
            return false;
        }

        int matrixLocation = ResolveArrayLocation(shader, MatricesUniform);
        if (matrixLocation < 0)
        {
            Disable(shader);
            return false;
        }

        for (int i = 0; i < ShadowCascadeCounts.MaxCount; i++)
        {
            Vec4 tile = i < frame.ActiveCascadeCount ? frame.GetAtlasTile(i) : Vec4.Zero;
            context.GL.Uniform4(tileLocation + i, tile.X, tile.Y, tile.Z, tile.W);

            Mat4 matrix = i < frame.ActiveCascadeCount
                ? frame.GetLightViewProjection(i)
                : Mat4.Identity;
            unsafe
            {
                context.GL.UniformMatrix4(matrixLocation + i, 1, false, &matrix.M11);
            }
        }

        return true;
    }

    /// <summary>
    /// Binds the height-fog uniforms when the shader declares them. Shaders
    /// without the fog contract are left untouched, so custom or ES variants
    /// never receive orphan uniform writes.
    /// </summary>
    public static void BindHeightFog(SceneGlShader shader, in HeightFogSettings heightFog)
    {
        ArgumentNullException.ThrowIfNull(shader);

        if (shader.GetUniformLocation(HeightFogEnabledUniform) < 0)
        {
            return;
        }

        shader.SetInt(HeightFogEnabledUniform, heightFog.Enabled ? 1 : 0);
        shader.SetVec3(HeightFogColorUniform, in heightFog.Color);
        shader.SetFloat(HeightFogDensityUniform, heightFog.Density);
        shader.SetFloat(HeightFogFalloffUniform, heightFog.Falloff);
        shader.SetFloat(HeightFogGroundUniform, heightFog.GroundHeight);
    }

    private static int ResolveArrayLocation(SceneGlShader shader, string name)
    {
        int baseLocation = shader.Program.GetUniformLocation(name + "[0]");
        return baseLocation >= 0 ? baseLocation : shader.Program.GetUniformLocation(name);
    }
}
