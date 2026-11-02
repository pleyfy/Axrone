namespace Axrone.Ui.Scene.OpenGL;

using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;

/// <summary>
/// GL glyph page owner: creates single-channel page textures, uploads packed
/// glyph coverage and exposes the pages through <see cref="IUiTextureSource"/>.
/// </summary>
/// <remarks>Render-thread affine; pages are created on demand and freed on eviction.</remarks>
public sealed class UiHostGlyphAtlasUploader : IUiGlyphAtlasUploader, IUiTextureSource, IDisposable
{
    private readonly GLContext _context;
    private readonly Dictionary<UiGlyphAtlasPageId, PageTexture> _pages = new();
    private readonly Dictionary<UiResourceId, PageTexture> _byResource = new();
    private ulong _nextResource = 1;
    private int _disposed;

    /// <summary>Creates an uploader for a GL context.</summary>
    public UiHostGlyphAtlasUploader(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
    }

    /// <summary>Gets the number of live pages.</summary>
    public int PageCount => _pages.Count;

    /// <summary>Gets whether the uploader has been disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public UiResourceId CreatePage(UiGlyphAtlasPageId page, int width, int height, UiGlyphFormat format)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        _context.AssertRenderThread();

        TextureFormat textureFormat = format switch
        {
            UiGlyphFormat.Rgba32 => TextureFormat.Rgba8,
            UiGlyphFormat.Msdf => TextureFormat.Rgb8,
            _ => TextureFormat.R8,
        };
        var texture = new GLTexture(
            _context,
            GLConst.Texture2D,
            textureFormat,
            width,
            height,
            label: $"UiGlyphPage{page.Value}");
        texture.SetParameter(GLConst.TextureMinFilter, GLConst.Linear);
        texture.SetParameter(GLConst.TextureMagFilter, GLConst.Linear);
        texture.SetParameter(GLConst.TextureWrapS, GLConst.ClampToEdge);
        texture.SetParameter(GLConst.TextureWrapT, GLConst.ClampToEdge);

        var resource = new UiResourceId(_nextResource++);
        var entry = new PageTexture(texture, resource, width, height, format);
        _pages[page] = entry;
        _byResource[resource] = entry;
        return resource;
    }

    /// <inheritdoc/>
    public void UploadGlyph(UiGlyphAtlasPageId page, in Rect pixelRect, ReadOnlySpan<byte> pixels)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (!_pages.TryGetValue(page, out PageTexture? entry))
        {
            return;
        }

        int x = (int)pixelRect.X;
        int y = (int)pixelRect.Y;
        int width = (int)pixelRect.Width;
        int height = (int)pixelRect.Height;
        if (width <= 0 || height <= 0 || pixels.Length < width * height)
        {
            return;
        }

        entry.Texture.UploadSubData2D(pixels, x, y, width, height);
    }

    /// <inheritdoc/>
    public void DeletePage(UiGlyphAtlasPageId page)
    {
        if (_pages.Remove(page, out PageTexture? entry))
        {
            _byResource.Remove(entry.Resource);
            entry.Texture.Dispose();
        }
    }

    /// <summary>Gets the pixel format of one live page.</summary>
    public bool TryGetPageFormat(UiGlyphAtlasPageId page, out UiGlyphFormat format)
    {
        if (_pages.TryGetValue(page, out PageTexture? entry))
        {
            format = entry.Format;
            return true;
        }

        format = default;
        return false;
    }

    /// <inheritdoc/>
    public bool TryGetTexture(UiResourceId resource, out UiTextureBinding binding)
    {
        if (_byResource.TryGetValue(resource, out PageTexture? entry))
        {
            binding = new UiTextureBinding(entry.Texture.Id, 0, entry.Width, entry.Height);
            return true;
        }

        binding = default;
        return false;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        foreach (PageTexture entry in _pages.Values)
        {
            entry.Texture.Dispose();
        }

        _pages.Clear();
        _byResource.Clear();
    }

    private sealed class PageTexture
    {
        public PageTexture(GLTexture texture, UiResourceId resource, int width, int height, UiGlyphFormat format)
        {
            Texture = texture;
            Resource = resource;
            Width = width;
            Height = height;
            Format = format;
        }

        public GLTexture Texture { get; }

        public UiResourceId Resource { get; }

        public int Width { get; }

        public int Height { get; }

        public UiGlyphFormat Format { get; }
    }
}

/// <summary>Adapts the bridge text store to the OpenGL backend layout contract.</summary>
public sealed class UiHostTextLayoutSource : IUiTextLayoutSource
{
    private readonly SceneUiHostBridge _hosts;

    /// <summary>Creates the adapter.</summary>
    public UiHostTextLayoutSource(SceneUiHostBridge hosts)
    {
        ArgumentNullException.ThrowIfNull(hosts);
        _hosts = hosts;
    }

    /// <inheritdoc/>
    public bool TryGetLayout(UiTextLayoutId layout, out IUiTextLayout resolved, out UiFontFaceId face) =>
        _hosts.Text.TryGetLayout(layout, out resolved, out face);
}
