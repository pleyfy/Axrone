namespace Axrone.Ui.Testing.OpenGL;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;

/// <summary>Single-glyph atlas and layout bindings shared by the UI and scene pixel tests.</summary>
internal static class GlyphSceneFactory
{
    public const uint LayoutId = 1;
    public const int CodePoint = 65;
    public static readonly UiGlyphAtlasPageId Page = new(1);

    public static UiRenderCommand TextCommand(in Rect bounds, in UiColor color, float opacity = 1.0f) =>
        UiRenderCommand.Text(new UiNodeId(1), in bounds, new UiTextLayoutId(LayoutId), in color, 0, opacity);

    public static UiBatchKey TextKey(
        UiBlendMode blend = UiBlendMode.Alpha,
        UiImageSampling sampling = UiImageSampling.Linear,
        bool hasClip = false,
        in Rect clip = default) =>
        new(UiRenderCommandKind.Text, default, Page, blend, sampling, hasClip, clip);

    public static UiBatchKey QuadKey(
        UiBlendMode blend = UiBlendMode.Alpha,
        bool hasClip = false,
        in Rect clip = default) =>
        new(UiRenderCommandKind.Quad, default, Page, blend, UiImageSampling.Linear, hasClip, clip);

    public static IUiGlyphAtlas CreateAtlas(
        UiFontFaceId face,
        int codePoint,
        UiGlyphAtlasPageId page,
        UiResourceId resource,
        in Rect uvRect,
        float width,
        float height,
        UiGlyphFormat format) =>
        new SingleGlyphAtlas(
            face,
            codePoint,
            new UiGlyphAtlasEntry(face, codePoint, page, resource, uvRect, width, height, 0, 0, width, format));

    public static IUiTextLayoutSource CreateLayouts(
        UiTextLayoutId layout,
        UiFontFaceId face,
        params UiShapedGlyph[] glyphs) =>
        new SingleLayoutSource(layout, face, glyphs);

    private sealed class SingleGlyphAtlas : IUiGlyphAtlas
    {
        private readonly UiGlyphAtlasPageId[] _pages;
        private readonly UiGlyphAtlasEntry _entry;

        public SingleGlyphAtlas(UiFontFaceId face, int codePoint, in UiGlyphAtlasEntry entry)
        {
            Face = face;
            CodePoint = codePoint;
            _entry = entry;
            _pages = [entry.Page];
        }

        public UiFontFaceId Face { get; }

        public int CodePoint { get; }

        public int PageCount => 1;

        public ReadOnlySpan<UiGlyphAtlasPageId> Pages => _pages;

        public bool TryGetPage(UiGlyphAtlasPageId page, out UiGlyphAtlasPageInfo info)
        {
            info = new UiGlyphAtlasPageInfo(page, _entry.Texture, (int)_entry.Width, (int)_entry.Height, 1, _entry.Format);
            return page == _entry.Page;
        }

        public bool TryGetEntry(UiFontFaceId face, int codePoint, out UiGlyphAtlasEntry entry)
        {
            if (face == Face && codePoint == CodePoint)
            {
                entry = _entry;
                return true;
            }

            entry = default;
            return false;
        }
    }

    private sealed class SingleLayoutSource : IUiTextLayoutSource
    {
        private readonly UiTextLayoutId _id;
        private readonly UiFontFaceId _face;
        private readonly IUiTextLayout _layout;

        public SingleLayoutSource(UiTextLayoutId id, UiFontFaceId face, UiShapedGlyph[] glyphs)
        {
            _id = id;
            _face = face;
            _layout = new SingleLayout(id, glyphs);
        }

        public bool TryGetLayout(UiTextLayoutId layout, out IUiTextLayout resolved, out UiFontFaceId face)
        {
            if (layout == _id)
            {
                resolved = _layout;
                face = _face;
                return true;
            }

            resolved = null!;
            face = default;
            return false;
        }
    }

    private sealed class SingleLayout : IUiTextLayout
    {
        private readonly UiShapedGlyph[] _glyphs;

        public SingleLayout(UiTextLayoutId id, UiShapedGlyph[] glyphs)
        {
            Id = id;
            _glyphs = glyphs;
        }

        public UiTextLayoutId Id { get; }

        public UiSize Size => new(16, 16);

        public UiTextMetrics Metrics => new(16, 16, 16, 12, 1, false);

        public ReadOnlySpan<UiShapedGlyph> Glyphs => _glyphs;
    }
}
