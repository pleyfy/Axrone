#pragma warning disable CA1002 // Payloads expose concrete collections for allocation-free access.
#pragma warning disable CA2227 // The setup protocol assigns payload collections once at creation.
#pragma warning disable CA1062 // Phase parameters are supplied by the frame graph, which null-checks before dispatch.

namespace Axrone.Render.OpenGL.FrameGraph.Passes;

using Axrone.Lighting;

/// <summary>
/// Payload for the shadow map pass, owning the pass's setup, validate and execute phases.
/// A null <see cref="Cascades"/> preserves the legacy single-view-projection path.
/// </summary>
public record struct ShadowPassData
    : IPassSetup<ShadowPassData>, IPassValidate<ShadowPassData>, IPassExecute<ShadowPassData>
{
    /// <summary>Depth-only shader program.</summary>
    public GLProgram DepthProgram { get; set; }

    /// <summary>Shadow map texture resource name.</summary>
    public string ShadowMapTextureName { get; set; }

    /// <summary>Shadow framebuffer resource name.</summary>
    public string ShadowFramebufferName { get; set; }

    /// <summary>Light view-projection matrix. Update per frame before execution.</summary>
    public Mat4 LightViewProjection { get; set; }

    /// <summary>Optional per-cascade matrices and atlas tiles.</summary>
    public ShadowFrameData? Cascades { get; set; }

    /// <summary>Shadow map width.</summary>
    public int ShadowMapWidth { get; set; }

    /// <summary>Shadow map height.</summary>
    public int ShadowMapHeight { get; set; }

    /// <summary>Meshes rendered into the shadow map.</summary>
    public List<GLMesh> Meshes { get; set; }

    /// <inheritdoc/>
    public static void Declare(IRenderPassBuilder builder, ref ShadowPassData data)
    {
        builder.Writes(data.ShadowMapTextureName);
        builder.Writes(data.ShadowFramebufferName);
    }

    /// <inheritdoc/>
    public static void Validate(in ShadowPassData data)
    {
        if (data.DepthProgram.IsDisposed)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration, "Depth shader program has been disposed", nameof(ShadowPass));
        }

        if (data.ShadowMapWidth <= 0 || data.ShadowMapHeight <= 0)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration, "Shadow map dimensions must be positive", nameof(ShadowPass));
        }

        if (data.Cascades is { } frame)
        {
            if (frame.AtlasWidth != data.ShadowMapWidth || frame.AtlasHeight != data.ShadowMapHeight)
            {
                ThrowHelper.Throw(
                    RenderErrorCode.InvalidPassConfiguration,
                    "Shadow cascade atlas dimensions do not match the pass dimensions",
                    nameof(ShadowPass));
            }

            if (frame.IsEnabled)
            {
                (int columns, int rows) = ShadowCascadeCounts.ToGrid(frame.Settings.CascadeCount);
                if (data.ShadowMapWidth < (columns * ShadowSettings.MinAtlasSize) ||
                    data.ShadowMapHeight < (rows * ShadowSettings.MinAtlasSize))
                {
                    ThrowHelper.Throw(
                        RenderErrorCode.InvalidPassConfiguration,
                        $"Shadow atlas must provide {columns * ShadowSettings.MinAtlasSize}x{rows * ShadowSettings.MinAtlasSize} pixels for the selected cascade grid",
                        nameof(ShadowPass));
                }

                if (frame.ActiveCascadeCount == 0)
                {
                    ThrowHelper.Throw(
                        RenderErrorCode.InvalidPassConfiguration,
                        "Enabled shadow cascades require at least one populated matrix",
                        nameof(ShadowPass));
                }
            }
        }
    }

    /// <inheritdoc/>
    public static void Execute(in ShadowPassData data, IRenderContext context, PassExecutionContext ctx)
    {
        var glContext = ctx.Context;
        glContext.AssertRenderThread();

        var gl = glContext.GL;
        var state = glContext.State;

        uint fboId = 0;
        if (ctx.HasResource(data.ShadowFramebufferName))
        {
            fboId = ctx.GetFramebuffer(data.ShadowFramebufferName).Id;
        }

        state.BindFramebuffer(GLConst.Framebuffer, fboId);
        state.SetViewport(0, 0, data.ShadowMapWidth, data.ShadowMapHeight);

        state.SetDepthTest(true);
        state.SetDepthFunc(GLConst.Lequal);
        state.SetDepthMask(true);
        state.SetBlend(false);
        state.SetCullFace(true);
        state.SetCullMode(GLConst.Front);
        state.SetColorMask(false, false, false, false);
        state.SetClearDepth(1.0);
        gl.Clear(GLConst.DepthBufferBit);

        Span<GLMesh> meshes = CollectionsMarshal.AsSpan(data.Meshes);
        if (meshes.IsEmpty)
        {
            state.SetColorMask(true, true, true, true);
            state.BindFramebuffer(GLConst.Framebuffer, 0);
            return;
        }

        state.UseProgram(data.DepthProgram.Id);
        int lightMatrixLocation = data.DepthProgram.GetUniformLocation("u_lightViewProjection");

        if (data.Cascades is { IsEnabled: true } cascades)
        {
            for (int cascade = 0; cascade < cascades.ActiveCascadeCount; cascade++)
            {
                Vec4 tile = cascades.GetAtlasTile(cascade);
                int x = (int)(data.ShadowMapWidth * tile.X);
                int y = (int)(data.ShadowMapHeight * tile.Y);
                int width = Math.Max(1, (int)(data.ShadowMapWidth * tile.Z));
                int height = Math.Max(1, (int)(data.ShadowMapHeight * tile.W));
                state.SetViewport(x, y, width, height);

                if (lightMatrixLocation >= 0)
                {
                    unsafe
                    {
                        Mat4 matrix = cascades.GetLightViewProjection(cascade);
                        gl.UniformMatrix4(lightMatrixLocation, 1, false, &matrix.M11);
                    }
                }

                for (int i = 0; i < meshes.Length; i++)
                {
                    meshes[i].Draw();
                }
            }
        }
        else if (data.Cascades is null)
        {
            if (lightMatrixLocation >= 0)
            {
                unsafe
                {
                    Mat4 matrix = data.LightViewProjection;
                    gl.UniformMatrix4(lightMatrixLocation, 1, false, &matrix.M11);
                }
            }

            for (int i = 0; i < meshes.Length; i++)
            {
                meshes[i].Draw();
            }
        }

        state.SetViewport(0, 0, data.ShadowMapWidth, data.ShadowMapHeight);
        state.SetColorMask(true, true, true, true);
        state.BindFramebuffer(GLConst.Framebuffer, 0);
    }
}

/// <summary>
/// Factory for the shadow map pass (depth-only from the light's perspective).
/// </summary>
public static class ShadowPass
{
    /// <summary>Creates a single-view legacy shadow map pass.</summary>
    public static RenderPass<ShadowPassData> Create(
        string name,
        GLProgram depthProgram,
        string shadowMapTextureName,
        string shadowFramebufferName,
        Mat4 lightViewProjection,
        int shadowMapWidth = 2048,
        int shadowMapHeight = 2048)
    {
        ArgumentNullException.ThrowIfNull(depthProgram);
        ArgumentNullException.ThrowIfNull(shadowMapTextureName);
        ArgumentNullException.ThrowIfNull(shadowFramebufferName);
        return new RenderPass<ShadowPassData>(
            name,
            FramePassKind.Shadow,
            new ShadowPassData
            {
                DepthProgram = depthProgram,
                ShadowMapTextureName = shadowMapTextureName,
                ShadowFramebufferName = shadowFramebufferName,
                LightViewProjection = lightViewProjection,
                ShadowMapWidth = shadowMapWidth,
                ShadowMapHeight = shadowMapHeight,
                Meshes = new List<GLMesh>()
            });
    }

    /// <summary>Creates a cascaded shadow map pass.</summary>
    /// <param name="name">Pass name.</param>
    /// <param name="depthProgram">Depth-only shader program.</param>
    /// <param name="shadowMapTextureName">Atlas texture resource name.</param>
    /// <param name="shadowFramebufferName">Atlas framebuffer resource name.</param>
    /// <param name="cascades">Reusable populated cascade snapshot.</param>
    /// <param name="shadowMapWidth">Atlas width.</param>
    /// <param name="shadowMapHeight">Atlas height.</param>
    /// <returns>The registered pass payload.</returns>
    public static RenderPass<ShadowPassData> Create(
        string name,
        GLProgram depthProgram,
        string shadowMapTextureName,
        string shadowFramebufferName,
        ShadowFrameData cascades,
        int shadowMapWidth = 2048,
        int shadowMapHeight = 2048)
    {
        ArgumentNullException.ThrowIfNull(depthProgram);
        ArgumentNullException.ThrowIfNull(shadowMapTextureName);
        ArgumentNullException.ThrowIfNull(shadowFramebufferName);
        ArgumentNullException.ThrowIfNull(cascades);
        return new RenderPass<ShadowPassData>(
            name,
            FramePassKind.Shadow,
            new ShadowPassData
            {
                DepthProgram = depthProgram,
                ShadowMapTextureName = shadowMapTextureName,
                ShadowFramebufferName = shadowFramebufferName,
                Cascades = cascades,
                ShadowMapWidth = shadowMapWidth,
                ShadowMapHeight = shadowMapHeight,
                Meshes = new List<GLMesh>()
            });
    }
}
