namespace Axrone.Render.Effects;

/// <summary>
/// Payload for the colour grading pass, owning the pass's setup, validate and
/// execute phases. Grading fentities are multiplicative and centred on 1.0 (neutral).
/// </summary>
public sealed class ColorGradingPassData
    : IPassSetup<ColorGradingPassData>, IPassValidate<ColorGradingPassData>, IPassExecute<ColorGradingPassData>
{
    private const float MinGradingFactor = 0f;
    private const float MaxGradingFactor = 2f;

    /// <summary>Colour grading shader program. Assigned by the factory before the pass is constructed.</summary>
    public GLProgram Program { get; set; } = null!;

    /// <summary>Input colour texture resource name.</summary>
    public string InputTextureName { get; set; } = string.Empty;

    /// <summary>Graded output target name.</summary>
    public string OutputTextureName { get; set; } = string.Empty;

    /// <summary>Contrast factor. Must be in [0, 2]. Update per frame if animated.</summary>
    public float Contrast { get; set; }

    /// <summary>Saturation factor. Must be in [0, 2]. Update per frame if animated.</summary>
    public float Saturation { get; set; }

    /// <summary>Brightness factor. Must be in [0, 2]. Update per frame if animated.</summary>
    public float Brightness { get; set; }

    /// <summary>Post-process phase. Display-referred effects run after tone mapping.</summary>
    public PostProcessPhase Phase { get; set; }

    /// <inheritdoc/>
    public static void Declare(IRenderPassBuilder builder, ref ColorGradingPassData data)
    {
        builder.Reads(data.InputTextureName);
        builder.Writes(data.OutputTextureName);
    }

    /// <inheritdoc/>
    public static void Validate(in ColorGradingPassData data)
    {
        if (data.Program.IsDisposed)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                "Colour grading shader program has been disposed", nameof(ColorGradingPass));
        }

        if (string.IsNullOrWhiteSpace(data.InputTextureName))
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                "Input texture name must not be empty", nameof(ColorGradingPass));
        }

        if (string.IsNullOrWhiteSpace(data.OutputTextureName))
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                "Colour grading output name must not be empty", nameof(ColorGradingPass));
        }

        if (data.Contrast < MinGradingFactor || data.Contrast > MaxGradingFactor)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                $"Colour grading contrast must be in [0, 2], got {data.Contrast}", nameof(ColorGradingPass));
        }

        if (data.Saturation < MinGradingFactor || data.Saturation > MaxGradingFactor)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                $"Colour grading saturation must be in [0, 2], got {data.Saturation}", nameof(ColorGradingPass));
        }

        if (data.Brightness < MinGradingFactor || data.Brightness > MaxGradingFactor)
        {
            ThrowHelper.Throw(RenderErrorCode.InvalidPassConfiguration,
                $"Colour grading brightness must be in [0, 2], got {data.Brightness}", nameof(ColorGradingPass));
        }
    }

    /// <inheritdoc/>
    public static void Execute(in ColorGradingPassData data, IRenderContext context, PassExecutionContext ctx)
    {
        var glContext = ctx.Context;
        glContext.AssertRenderThread();

        var gl = glContext.GL;
        var state = glContext.State;

        var inputTexture = ctx.GetTexture(data.InputTextureName);
        var outputTexture = ctx.GetTexture(data.OutputTextureName);

        if (ctx.HasResource(data.OutputTextureName + "_fbo"))
        {
            state.BindFramebuffer(GLConst.Framebuffer, ctx.GetFramebuffer(data.OutputTextureName + "_fbo").Id);
        }

        state.SetViewport(0, 0, outputTexture.Width, outputTexture.Height);
        state.SetDepthTest(false);
        state.SetBlend(false);
        state.SetCullFace(false);
        state.SetColorMask(true, true, true, true);

        state.UseProgram(data.Program.Id);
        state.BindTexture2D(0, inputTexture.Id);

        int location = data.Program.GetUniformLocation("u_inputTexture");
        if (location != -1)
        {
            gl.Uniform1(location, 0);
        }

        location = data.Program.GetUniformLocation("u_contrast");
        if (location != -1)
        {
            gl.Uniform1(location, data.Contrast);
        }

        location = data.Program.GetUniformLocation("u_saturation");
        if (location != -1)
        {
            gl.Uniform1(location, data.Saturation);
        }

        location = data.Program.GetUniformLocation("u_brightness");
        if (location != -1)
        {
            gl.Uniform1(location, data.Brightness);
        }

        state.BindVertexArray(0);
        gl.DrawArrays(GLConst.Triangles, 0, 3);
    }
}

/// <summary>
/// Factory for the colour grading post-process pass.
/// </summary>
public static class ColorGradingPass
{
    /// <summary>Creates a colour grading pass.</summary>
    public static RenderPass<ColorGradingPassData> Create(
        string name,
        GLProgram program,
        string inputName,
        string outputName,
        float contrast = 1f,
        float saturation = 1f,
        float brightness = 1f)
    {
        ArgumentNullException.ThrowIfNull(program);
        ArgumentNullException.ThrowIfNull(inputName);
        ArgumentNullException.ThrowIfNull(outputName);
        return new RenderPass<ColorGradingPassData>(
            name,
            FramePassKind.PostProcess,
            new ColorGradingPassData
            {
                Program = program,
                InputTextureName = inputName,
                OutputTextureName = outputName,
                Contrast = contrast,
                Saturation = saturation,
                Brightness = brightness,
                Phase = PostProcessPhase.AfterTonemap
            });
    }
}
