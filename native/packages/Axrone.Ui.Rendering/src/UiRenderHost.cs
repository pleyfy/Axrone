namespace Axrone.Ui.Rendering;

/// <summary>
/// Backend pipeline state for one batch family: program, blend, sampling and
/// scissor participation. The descriptor is the identity used to cache a
/// compiled pipeline; equal descriptors must reuse the same pipeline.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiPipelineDescriptor(
    UiResourceId Program,
    UiBlendMode Blend,
    UiImageSampling Sampling,
    bool ScissorTest);

/// <summary>
/// Compiled UI pipeline. GPU programs are explicit-lifetime resources, so the
/// handle is disposable and reports validity instead of relying on finalizers.
/// </summary>
public interface IUiPipeline : IDisposable
{
    /// <summary>Gets the descriptor this pipeline was compiled from.</summary>
    UiPipelineDescriptor Descriptor { get; }

    /// <summary>Gets whether the underlying program is still usable.</summary>
    bool IsValid { get; }
}

/// <summary>
/// Frame-level drawing backend. Implementations bind pipelines and issue draw
/// calls; command spans are borrowed for the duration of the call only.
/// </summary>
public interface IUiRenderBackend
{
    /// <summary>Gets whether the backend can accept frames.</summary>
    bool IsReady { get; }

    /// <summary>Compiles or returns a cached pipeline for a descriptor.</summary>
    IUiPipeline CreatePipeline(in UiPipelineDescriptor descriptor);

    /// <summary>Begins one UI frame for a viewport.</summary>
    void BeginFrame(in UiViewport viewport);

    /// <summary>Draws one contiguous batch of commands.</summary>
    void DrawBatch(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands);

    /// <summary>Ends the frame begun by the matching begin call.</summary>
    void EndFrame();
}

/// <summary>
/// Render host contract: accepts immutable frames from the UI runtime and
/// drives the backend. Recorded frames are drained on <see cref="Flush"/>.
/// </summary>
public interface IUiRenderHost
{
    /// <summary>Gets the drawing backend.</summary>
    IUiRenderBackend Backend { get; }

    /// <summary>Records one frame for the next flush.</summary>
    void Submit(IUiFrame frame);

    /// <summary>Drains recorded frames into the backend.</summary>
    void Flush();
}
