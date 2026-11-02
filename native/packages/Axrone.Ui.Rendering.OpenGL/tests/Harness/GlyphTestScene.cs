namespace Axrone.Ui.Testing.OpenGL;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Resources;
using Axrone.Render.OpenGL.Texture;
using Axrone.Ui;
using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;

/// <summary>
/// One-glyph scene wired through the production UI OpenGL backend: a single atlas page, one
/// shaped layout, and a texture source that resolves the page resource to the live GL texture.
/// </summary>
internal sealed class GlyphTestScene : IDisposable
{
    public const uint LayoutId = GlyphSceneFactory.LayoutId;
    public const int CodePoint = GlyphSceneFactory.CodePoint;

    private readonly GLTexture _page;
    private readonly IUiGlyphAtlas _atlas;
    private readonly IUiTextLayoutSource _layouts;
    private readonly TestTextureSource _textures;
    private int _disposed;

    public GlyphTestScene(
        GLContext context,
        TextureFormat textureFormat,
        UiGlyphFormat glyphFormat,
        int pageWidth,
        int pageHeight,
        ReadOnlySpan<byte> pagePixels)
    {
        ArgumentNullException.ThrowIfNull(context);
        Context = context;
        Face = new UiFontFaceId(1);
        Resource = new UiResourceId(1);
        Format = glyphFormat;
        PageWidth = pageWidth;
        PageHeight = pageHeight;
        _page = TextureReadback.CreateTexture(context, textureFormat, pageWidth, pageHeight, pagePixels);
        _atlas = GlyphSceneFactory.CreateAtlas(
            Face,
            CodePoint,
            GlyphSceneFactory.Page,
            Resource,
            new Rect(0, 0, 1, 1),
            pageWidth,
            pageHeight,
            glyphFormat);
        _layouts = GlyphSceneFactory.CreateLayouts(
            new UiTextLayoutId(LayoutId),
            Face,
            new UiShapedGlyph(CodePoint, 0, 0, 0, pageWidth, 0));
        _textures = new TestTextureSource(Resource, _page, pageWidth, pageHeight);
    }

    public GLContext Context { get; }

    public UiFontFaceId Face { get; }

    public UiResourceId Resource { get; }

    public UiGlyphFormat Format { get; }

    public int PageWidth { get; }

    public int PageHeight { get; }

    public GLTexture PageTexture => _page;

    public UiOpenGlBackend CreateBackend() =>
        new(Context, new UiOpenGlBackendOptions
        {
            GlyphAtlas = _atlas,
            TextLayouts = _layouts,
            Textures = _textures,
        });

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _page.Dispose();
    }

    private sealed class TestTextureSource : IUiTextureSource
    {
        private readonly UiResourceId _resource;
        private readonly GLTexture _texture;
        private readonly int _width;
        private readonly int _height;

        public TestTextureSource(UiResourceId resource, GLTexture texture, int width, int height)
        {
            _resource = resource;
            _texture = texture;
            _width = width;
            _height = height;
        }

        public bool TryGetTexture(UiResourceId resource, out UiTextureBinding binding)
        {
            // Resolve the live GL name on every call so a context rebuild can swap texture ids.
            binding = new UiTextureBinding(_texture.Id, 0, _width, _height);
            return resource == _resource;
        }
    }
}
