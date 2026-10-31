namespace Axrone.Ui;

/// <summary>
/// Leaf-content measurer for text nodes. Each node carries its source text and
/// resolved <see cref="UiTextStyle"/>; the actual glyph metrics come from an
/// <see cref="IUiTextMeasurer"/>, so this type owns no font parser.
/// </summary>
/// <remarks>
/// Measurements are dictionary lookups over the registered text, so a warmed-up
/// steady-state layout pass performs no allocation. Single-threaded.
/// </remarks>
public sealed class UiTextContentMeasurer : IUiContentMeasurer
{
    private readonly IUiTextMeasurer _measurer;
    private readonly Dictionary<UiNodeId, TextEntry> _entries = new();

    /// <summary>Creates a text content measurer over a text-metrics provider.</summary>
    public UiTextContentMeasurer(IUiTextMeasurer measurer)
    {
        ArgumentNullException.ThrowIfNull(measurer);
        _measurer = measurer;
    }

    /// <summary>Gets the number of registered text nodes.</summary>
    public int Count => _entries.Count;

    /// <summary>Sets or replaces the text and style of one node.</summary>
    public void SetText(UiNodeId node, string text, in UiTextStyle style)
    {
        ArgumentNullException.ThrowIfNull(text);
        _entries[node] = new TextEntry(text, style);
    }

    /// <summary>Removes one node's text.</summary>
    public bool Remove(UiNodeId node) => _entries.Remove(node);

    /// <summary>Removes every registered text node.</summary>
    public void Clear() => _entries.Clear();

    /// <inheritdoc/>
    public bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size)
    {
        if (!_entries.TryGetValue(node, out TextEntry entry))
        {
            size = default;
            return false;
        }

        UiTextStyle style = entry.Style;
        UiTextMetrics metrics = _measurer.Measure(entry.Text.AsSpan(), in style, in constraints);
        size = new UiSize(
            MathF.Max(0.0f, metrics.Width),
            MathF.Max(0.0f, metrics.Height));
        return true;
    }

    private readonly record struct TextEntry(string Text, UiTextStyle Style);
}
