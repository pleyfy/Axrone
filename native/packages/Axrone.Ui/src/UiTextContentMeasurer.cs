namespace Axrone.Ui;

/// <summary>
/// Leaf-content measurer for text nodes. Each node carries its source text and
/// resolved <see cref="UiTextStyle"/>; the actual glyph metrics come from an
/// <see cref="IUiTextMeasurer"/>, so this type owns no font parser.
/// Shrink-to-fit styles are resolved through <see cref="UiAutoSizeService"/> and
/// cached, so repeated layout passes reuse the measurement instead of re-shrinking.
/// </summary>
/// <remarks>
/// Measurements are dictionary lookups over the registered text, so a warmed-up
/// steady-state layout pass performs no allocation. Single-threaded.
/// </remarks>
public sealed class UiTextContentMeasurer : IUiContentMeasurer
{
    private readonly IUiTextMeasurer _measurer;
    private readonly UiAutoSizeService? _injectedAutoSizing;
    private readonly Dictionary<UiNodeId, TextEntry> _entries = new();
    private UiAutoSizeService? _autoSizing;

    /// <summary>Creates a text content measurer over a text-metrics provider.</summary>
    public UiTextContentMeasurer(IUiTextMeasurer measurer)
    {
        ArgumentNullException.ThrowIfNull(measurer);
        _measurer = measurer;
    }

    /// <summary>Creates a text content measurer with an explicit auto-size cache.</summary>
    /// <param name="measurer">Text metrics provider.</param>
    /// <param name="autoSizing">Shared auto-size service; consumed by shrink-to-fit styles.</param>
    public UiTextContentMeasurer(IUiTextMeasurer measurer, UiAutoSizeService autoSizing)
    {
        ArgumentNullException.ThrowIfNull(measurer);
        ArgumentNullException.ThrowIfNull(autoSizing);
        _measurer = measurer;
        _injectedAutoSizing = autoSizing;
    }

    /// <summary>Gets the auto-size service backing shrink-to-fit styles.</summary>
    public UiAutoSizeService AutoSizing => _autoSizing ??= _injectedAutoSizing ?? new UiAutoSizeService();

    /// <summary>Gets the number of registered text nodes.</summary>
    public int Count => _entries.Count;

    /// <summary>Sets or replaces the text and style of one node.</summary>
    public void SetText(UiNodeId node, string text, in UiTextStyle style)
    {
        ArgumentNullException.ThrowIfNull(text);
        _entries[node] = new TextEntry(text, style, 0.0f);
    }

    /// <summary>Removes one node's text.</summary>
    public bool Remove(UiNodeId node) => _entries.Remove(node);

    /// <summary>Removes every registered text node and drops cached auto-size measurements.</summary>
    public void Clear()
    {
        _entries.Clear();
        _autoSizing?.Invalidate();
        _injectedAutoSizing?.Invalidate();
    }

    /// <summary>
    /// Reads the font size the node's shrink-to-fit style last resolved to,
    /// for renderers that must draw text at the shrunk size.
    /// </summary>
    public bool TryGetResolvedStyle(UiNodeId node, out UiTextStyle style)
    {
        if (_entries.TryGetValue(node, out TextEntry entry) && entry.ResolvedSize > 0.0f)
        {
            style = entry.Style with { Size = entry.ResolvedSize };
            return true;
        }

        style = default;
        return false;
    }

    /// <inheritdoc/>
    public bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size)
    {
        if (!_entries.TryGetValue(node, out TextEntry entry))
        {
            size = default;
            return false;
        }

        UiTextStyle style = entry.Style;
        UiTextMetrics metrics;
        if (style.AutoSize == UiTextAutoSize.ShrinkToFit)
        {
            UiAutoSizeResult result = AutoSizing.Measure(_measurer, entry.Text, style, in constraints);
            metrics = result.Metrics;
            if (result.MarkedFixedSize)
            {
                _entries[node] = new TextEntry(
                    entry.Text,
                    style with { Size = result.ResolvedSize, AutoSize = UiTextAutoSize.None },
                    result.ResolvedSize);
            }
            else if (entry.ResolvedSize != result.ResolvedSize)
            {
                _entries[node] = entry with { ResolvedSize = result.ResolvedSize };
            }
        }
        else
        {
            metrics = _measurer.Measure(entry.Text.AsSpan(), in style, in constraints);
        }

        size = new UiSize(
            MathF.Max(0.0f, metrics.Width),
            MathF.Max(0.0f, metrics.Height));
        return true;
    }

    private readonly record struct TextEntry(string Text, UiTextStyle Style, float ResolvedSize);
}
