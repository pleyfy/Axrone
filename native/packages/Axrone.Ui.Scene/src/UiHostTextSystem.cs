namespace Axrone.Ui.Scene;

using Axrone.Ui.Rendering;
using Axrone.Ui.Text;

/// <summary>Options shared by every UI host runtime in a bridge.</summary>
public sealed record UiHostRuntimeOptions
{
    /// <summary>Font provider used for shaping and rasterization; null disables text.</summary>
    public UiFontProvider? Fonts { get; init; }

    /// <summary>Fallback family when an authored family is missing.</summary>
    public UiFontFamilyId DefaultFamily { get; init; }

    /// <summary>Fallback text style when an asset provides no face.</summary>
    public UiTextStyle DefaultTextStyle { get; init; }

    /// <summary>Theme token table forwarded to control styles.</summary>
    public IUiTheme? Theme { get; init; }

    /// <summary>Control event sink.</summary>
    public IUiControlEventSink? Events { get; init; }

    /// <summary>Intrinsic image metrics for image controls.</summary>
    public IUiImageMetrics? Images { get; init; }

    /// <summary>GPU upload hook for the glyph atlas; null keeps the atlas headless.</summary>
    public IUiGlyphAtlasUploader? GlyphUploader { get; init; }

    /// <summary>Whether glyphs prefer SDF rasterization; coverage is the fallback.</summary>
    public bool EnableSdfGlyphs { get; init; } = true;
}

/// <summary>
/// Shared text pipeline: shapes node text into pinned layout buffers, resolves
/// font faces from authored descriptors and rasterizes missing glyphs into the
/// paged atlas. One instance serves every host in a bridge.
/// </summary>
public sealed class UiHostTextSystem : IDisposable
{
    private readonly UiFontProvider? _provider;
    private readonly UiFontFamilyId _defaultFamily;
    private readonly UiTextStyle _defaultStyle;
    private readonly UiGlyphRasterizer? _rasterizer;
    private readonly UiTextMeasurer? _measurer;
    private readonly IUiGlyphAtlasUploader? _uploader;
    private readonly bool _enableSdf;
    private readonly UiGlyphAtlas _atlas;
    private static readonly UiSdfOptions s_sdfOptions = UiSdfOptions.Default;
    private readonly Dictionary<UiNodeId, LayoutEntry> _byNode = new();
    private readonly Dictionary<UiTextLayoutId, LayoutEntry> _byId = new();
    private bool _disposed;

    /// <summary>Creates a text pipeline over host options.</summary>
    public UiHostTextSystem(UiHostRuntimeOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _provider = options.Fonts;
        _defaultFamily = options.DefaultFamily;
        _defaultStyle = options.DefaultTextStyle;
        _rasterizer = _provider is null ? null : new UiGlyphRasterizer(_provider);
        _measurer = _provider is null ? null : new UiTextMeasurer(_provider);
        _uploader = options.GlyphUploader;
        _enableSdf = options.EnableSdfGlyphs;
        _atlas = new UiGlyphAtlas(UiGlyphAtlasOptions.Default, options.GlyphUploader);
    }

    /// <summary>Gets the shared glyph atlas.</summary>
    public IUiGlyphAtlas GlyphAtlas => _atlas;

    /// <summary>Gets the uploader the atlas was built with, or null for the headless no-op.</summary>
    public IUiGlyphAtlasUploader? GlyphUploader => _uploader;

    /// <summary>Gets the text measurer used by control layout, when fonts exist.</summary>
    public IUiTextMeasurer? Measurer => _measurer;

    /// <summary>Gets whether text rendering is available.</summary>
    public bool HasFonts => _provider is not null;

    /// <summary>Resolves an authored text style to a runtime style.</summary>
    public UiTextStyle ResolveStyle(in UiNodeText text)
    {
        UiFontFaceId face = UiFontFaceId.Invalid;
        if (_provider is not null)
        {
            UiFontFamilyId family = string.IsNullOrEmpty(text.Family)
                ? _defaultFamily
                : UiFontProvider.FromFamilyName(text.Family);
            var query = new UiFontQuery(family, text.Weight, text.FontStyle, string.Empty);
            if (!_provider.TryGetFace(in query, out face))
            {
                var fallback = new UiFontQuery(_defaultFamily, UiFontWeight.Normal, UiFontStyle.Normal, string.Empty);
                _ = _provider.TryGetFace(in fallback, out face);
            }
        }

        float size = text.Size > 0.0f ? text.Size : _defaultStyle.Size;
        if (size <= 0.0f)
        {
            size = 15.0f;
        }

        float lineHeight = text.LineHeight > 0.0f ? text.LineHeight : size * 1.2f;
        return new UiTextStyle(
            face,
            size,
            lineHeight,
            text.LetterSpacing,
            text.Wrap,
            text.Overflow,
            text.Align,
            text.Direction,
            text.MaxLines);
    }

    /// <summary>
    /// Shapes one node's text and returns its layout id. Returns
    /// <see cref="UiTextLayoutId.Invalid"/> when fonts are unavailable or the
    /// text has no measurable lines.
    /// </summary>
    public UiTextLayoutId BuildLayout(UiNodeId node, string text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        ThrowIfDisposed();
        if (_provider is null || string.IsNullOrEmpty(text))
        {
            return UiTextLayoutId.Invalid;
        }

        if (!_byNode.TryGetValue(node, out LayoutEntry? entry))
        {
            entry = new LayoutEntry(new UiTextLayoutBuffer(_provider), node);
            _byNode.Add(node, entry);
            _byId.Add(entry.Layout.Id, entry);
        }

        if (!entry.Layout.TryLayout(text, in style, in constraints))
        {
            return UiTextLayoutId.Invalid;
        }

        entry.StyleSize = style.Size;
        entry.Face = style.Face;
        EnsureGlyphs(style.Face, entry.Layout.Glyphs, style.Size);
        return entry.Layout.Id;
    }

    /// <summary>Resolves a layout by id.</summary>
    public bool TryGetLayout(UiTextLayoutId id, out IUiTextLayout layout, out UiFontFaceId face)
    {
        if (_byId.TryGetValue(id, out LayoutEntry? entry))
        {
            layout = entry.Layout;
            face = entry.Face;
            return true;
        }

        layout = null!;
        face = UiFontFaceId.Invalid;
        return false;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _atlas.Dispose();
        _byNode.Clear();
        _byId.Clear();
        _disposed = true;
    }

    private void EnsureGlyphs(UiFontFaceId face, ReadOnlySpan<UiShapedGlyph> glyphs, float pixelSize)
    {
        if (_rasterizer is null || !face.IsValid)
        {
            return;
        }

        float ascent = 0.0f;
        if (_provider!.TryGetFace(face, out UiFontFace? fontFace) && fontFace.UnitsPerEm > 0)
        {
            ascent = fontFace.Ascender * pixelSize / fontFace.UnitsPerEm;
        }

        for (int i = 0; i < glyphs.Length; i++)
        {
            int codePoint = glyphs[i].CodePoint;
            if (_atlas.TryGetEntry(face, codePoint, out _))
            {
                continue;
            }

            UiGlyphBitmap bitmap;
            UiGlyphFormat format;
            if (_enableSdf &&
                _rasterizer.TryRasterizeSdf(face, codePoint, pixelSize, in s_sdfOptions, out bitmap, out _) &&
                !bitmap.IsEmpty)
            {
                format = UiGlyphFormat.Sdf;
            }
            else if (_rasterizer.TryRasterize(face, codePoint, pixelSize, out bitmap, out _) && !bitmap.IsEmpty)
            {
                format = bitmap.Format == UiGlyphBitmapFormat.Sdf ? UiGlyphFormat.Sdf : UiGlyphFormat.Alpha8;
            }
            else
            {
                continue;
            }

            var raster = new UiGlyphRaster(
                face,
                codePoint,
                bitmap.Width,
                bitmap.Height,
                -bitmap.BearingX,
                bitmap.BearingY - ascent,
                bitmap.Advance,
                format);
            _ = _atlas.TryAddGlyph(in raster, bitmap.Alpha, out _);
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

    private sealed class LayoutEntry
    {
        public LayoutEntry(UiTextLayoutBuffer layout, UiNodeId node)
        {
            Layout = layout;
            Node = node;
        }

        public UiTextLayoutBuffer Layout { get; }

        public UiNodeId Node { get; }

        public UiFontFaceId Face { get; set; }

        public float StyleSize { get; set; }
    }
}
