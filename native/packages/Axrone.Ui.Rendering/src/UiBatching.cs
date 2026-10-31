namespace Axrone.Ui.Rendering;

/// <summary>
/// Immutable batch identity. Two adjacent draw commands may share one GPU draw
/// call only when this whole key is bit-identical: kind, resource, atlas page,
/// blend state, sampling and clip all map to backend state changes.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiBatchKey(
    UiRenderCommandKind Kind,
    UiResourceId Resource,
    UiGlyphAtlasPageId AtlasPage,
    UiBlendMode Blend,
    UiImageSampling Sampling,
    bool HasClip,
    Rect Clip);

/// <summary>
/// Batch boundary sink. The host calls <see cref="BeginBatch"/> once per run of
/// compatible commands and <see cref="EndBatch"/> after the run is drawn. The
/// command span passed alongside is borrowed and must not be retained.
/// </summary>
public interface IUiBatchSink
{
    /// <summary>Starts a batch covering a contiguous command range.</summary>
    /// <param name="key">Batch identity.</param>
    /// <param name="firstCommand">Index of the first command in the frame.</param>
    /// <param name="commandCount">Number of commands in the run.</param>
    void BeginBatch(in UiBatchKey key, int firstCommand, int commandCount);

    /// <summary>Ends the batch started by the matching begin call.</summary>
    /// <param name="key">Batch identity; must equal the begin key.</param>
    void EndBatch(in UiBatchKey key);
}
