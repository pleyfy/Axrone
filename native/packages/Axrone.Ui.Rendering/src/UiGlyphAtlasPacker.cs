namespace Axrone.Ui.Rendering;

/// <summary>Atlas paging policy.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphAtlasOptions(int PageWidth, int PageHeight, int Padding, int MaxPages, UiGlyphFormat Format)
{
    /// <summary>Gets the default policy: 1024² SDF pages, one-pixel gaps, four pages.</summary>
    public static UiGlyphAtlasOptions Default => new(1024, 1024, 1, 4, UiGlyphFormat.Sdf);
}

/// <summary>Raster input for one glyph. The atlas never rasterizes; it packs pixels a font backend produced.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphRaster(
    UiFontFaceId Face,
    int CodePoint,
    int Width,
    int Height,
    float OriginX,
    float OriginY,
    float Advance,
    UiGlyphFormat Format)
{
    /// <summary>Gets the bytes one pixel occupies for the raster's format.</summary>
    public int BytesPerPixel => UiGlyphAtlas.BytesPerPixel(Format);
}

/// <summary>
/// GPU upload hook. The atlas owns packing and lifetime; the host owns texture
/// creation, upload and deletion. Calls happen on the render thread.
/// </summary>
public interface IUiGlyphAtlasUploader
{
    /// <summary>Creates a page texture and returns its resource identity.</summary>
    UiResourceId CreatePage(UiGlyphAtlasPageId page, int width, int height, UiGlyphFormat format);

    /// <summary>Uploads one glyph's pixels into a page slot.</summary>
    void UploadGlyph(UiGlyphAtlasPageId page, in Rect pixelRect, ReadOnlySpan<byte> pixels);

    /// <summary>Deletes a page texture.</summary>
    void DeletePage(UiGlyphAtlasPageId page);
}

/// <summary>Receives eviction notifications so batches referencing the page can be flushed.</summary>
public interface IUiGlyphAtlasEvictionListener
{
    /// <summary>Called after a page and its entries have been removed.</summary>
    void OnGlyphPageEvicted(UiGlyphAtlasPageId page);
}

/// <summary>
/// Default uploader for headless use: no GPU texture is created, and resource
/// identities are derived from the page id so tests can assert binding.
/// </summary>
public sealed class NullGlyphAtlasUploader : IUiGlyphAtlasUploader
{
    /// <summary>Shared instance.</summary>
    public static NullGlyphAtlasUploader Instance { get; } = new();

    /// <inheritdoc/>
    public UiResourceId CreatePage(UiGlyphAtlasPageId page, int width, int height, UiGlyphFormat format) =>
        new(page.Value);

    /// <inheritdoc/>
    public void UploadGlyph(UiGlyphAtlasPageId page, in Rect pixelRect, ReadOnlySpan<byte> pixels)
    {
    }

    /// <inheritdoc/>
    public void DeletePage(UiGlyphAtlasPageId page)
    {
    }
}

/// <summary>
/// Shelf-packing glyph atlas. Glyphs are placed left-to-right on a shelf; a
/// glyph that overflows the page width starts a new shelf, and a glyph that
/// overflows the page height starts a new page. When the page budget is
/// exceeded the least recently touched page is evicted wholesale.
/// </summary>
/// <remarks>
/// The atlas is render-thread affine: no internal locking. Lookups are
/// allocation-free; only first-time glyph insertion and page creation allocate
/// (page dictionaries and their backing arrays).
/// </remarks>
public sealed class UiGlyphAtlas : IUiGlyphAtlas, IDisposable
{
    private readonly IUiGlyphAtlasUploader _uploader;
    private readonly IUiGlyphAtlasEvictionListener? _evictionListener;
    private readonly int _padding;
    private readonly int _maxPages;

    private UiGlyphAtlasPageId[] _ids;
    private Page[] _pages;
    private Dictionary<GlyphKey, UiGlyphAtlasEntry>?[] _entries;
    private int _pageCount;
    private uint _nextPageId;
    private long _frame;
    private int _evictionCount;
    private int _disposed;

    /// <summary>Initializes an atlas.</summary>
    /// <param name="options">Paging policy.</param>
    /// <param name="uploader">GPU upload hook; defaults to the headless no-op uploader.</param>
    /// <param name="evictionListener">Optional eviction observer.</param>
    public UiGlyphAtlas(
        in UiGlyphAtlasOptions options,
        IUiGlyphAtlasUploader? uploader = null,
        IUiGlyphAtlasEvictionListener? evictionListener = null)
    {
        if (options.PageWidth < 8 || options.PageHeight < 8)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(options), options.PageWidth, "Atlas pages must be at least 8x8.");
        }

        if (options.Padding < 0)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(options), options.Padding, "Atlas padding must not be negative.");
        }

        if (options.MaxPages <= 0)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(options), options.MaxPages, "Atlas must allow at least one page.");
        }

        _uploader = uploader ?? NullGlyphAtlasUploader.Instance;
        _evictionListener = evictionListener;
        _padding = options.Padding;
        _maxPages = options.MaxPages;
        _ids = new UiGlyphAtlasPageId[options.MaxPages];
        _pages = new Page[options.MaxPages];
        _entries = new Dictionary<GlyphKey, UiGlyphAtlasEntry>?[options.MaxPages];
        _pageCount = 0;
        _nextPageId = 1;
        _frame = 0;
        _evictionCount = 0;
        _disposed = 0;

        PageWidth = options.PageWidth;
        PageHeight = options.PageHeight;
        Format = options.Format;
    }

    /// <summary>Gets the configured page width.</summary>
    public int PageWidth { get; }

    /// <summary>Gets the configured page height.</summary>
    public int PageHeight { get; }

    /// <summary>Gets the default raster format.</summary>
    public UiGlyphFormat Format { get; }

    /// <summary>Gets how many pages have been evicted since construction.</summary>
    public int EvictionCount => _evictionCount;

    /// <summary>Gets whether the atlas has been disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public int PageCount => _pageCount;

    /// <inheritdoc/>
    public ReadOnlySpan<UiGlyphAtlasPageId> Pages => new(_ids, 0, _pageCount);

    /// <summary>Advances the access clock used by LRU eviction.</summary>
    public void Tick() => _frame++;

    /// <inheritdoc/>
    public bool TryGetPage(UiGlyphAtlasPageId page, out UiGlyphAtlasPageInfo info)
    {
        int index = IndexOf(page);
        if (index < 0)
        {
            info = default;
            return false;
        }

        ref readonly Page entry = ref _pages[index];
        info = new UiGlyphAtlasPageInfo(entry.Id, entry.Texture, entry.Width, entry.Height, entry.AllocatedGlyphs, entry.Format);
        return true;
    }

    /// <inheritdoc/>
    public bool TryGetEntry(UiFontFaceId face, int codePoint, out UiGlyphAtlasEntry entry)
    {
        GlyphKey key = new(face.Value, codePoint);
        for (int i = 0; i < _pageCount; i++)
        {
            Dictionary<GlyphKey, UiGlyphAtlasEntry>? pageEntries = _entries[i];
            if (pageEntries is not null && pageEntries.TryGetValue(key, out entry))
            {
                _pages[i].LastAccess = _frame;
                return true;
            }
        }

        entry = default;
        return false;
    }

    /// <summary>
    /// Places one glyph, uploading its pixels through the uploader. Inserting an
    /// already resident face/code point returns the existing placement and does
    /// not upload again.
    /// </summary>
    /// <param name="raster">Raster metadata.</param>
    /// <param name="pixels">Tightly packed pixel data in the raster's format; may be empty for metadata-only placement.</param>
    /// <param name="entry">Resolved placement.</param>
    /// <returns><see langword="true"/> when the glyph is resident.</returns>
    public bool TryAddGlyph(in UiGlyphRaster raster, ReadOnlySpan<byte> pixels, out UiGlyphAtlasEntry entry)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        if (!raster.Face.IsValid || raster.CodePoint < 0 || raster.Width <= 0 || raster.Height <= 0)
        {
            entry = default;
            return false;
        }

        GlyphKey key = new(raster.Face.Value, raster.CodePoint);
        if (TryGetEntry(raster.Face, raster.CodePoint, out entry))
        {
            return true;
        }

        long expectedLong = (long)raster.Width * raster.Height * raster.BytesPerPixel;
        if (expectedLong > int.MaxValue)
        {
            entry = default;
            return false;
        }

        int expected = (int)expectedLong;
        if (pixels.Length != 0 && pixels.Length < expected)
        {
            entry = default;
            return false;
        }

        int pageIndex = FindPageWithRoom(in raster);
        if (pageIndex < 0)
        {
            pageIndex = CreatePage(raster.Format, raster.Width, raster.Height);
            if (pageIndex < 0)
            {
                entry = default;
                return false;
            }
        }

        ref Page page = ref _pages[pageIndex];
        int x = page.CursorX;
        int y = page.CursorY;

        if (x + raster.Width > page.Width)
        {
            x = 0;
            y += page.RowHeight;
            page.RowHeight = 0;
        }

        if (y + raster.Height > page.Height)
        {
            // The shelf overflowed the page height: this page is full for this format.
            page.Full = true;
            pageIndex = CreatePage(raster.Format, raster.Width, raster.Height);
            if (pageIndex < 0)
            {
                entry = default;
                return false;
            }

            page = ref _pages[pageIndex];
            x = 0;
            y = 0;
        }

        Rect pixelRect = new(x, y, raster.Width, raster.Height);
        entry = new UiGlyphAtlasEntry(
            raster.Face,
            raster.CodePoint,
            page.Id,
            page.Texture,
            new Rect(
                (float)x / page.Width,
                (float)y / page.Height,
                (float)raster.Width / page.Width,
                (float)raster.Height / page.Height),
            raster.Width,
            raster.Height,
            raster.OriginX,
            raster.OriginY,
            raster.Advance,
            page.Format);

        page.CursorX = x + raster.Width + _padding;
        page.RowHeight = Math.Max(page.RowHeight, raster.Height + _padding);
        page.AllocatedGlyphs++;
        page.LastAccess = _frame;

        Dictionary<GlyphKey, UiGlyphAtlasEntry> pageEntries = _entries[pageIndex]!;
        pageEntries.Add(key, entry);

        if (pixels.Length != 0)
        {
            _uploader.UploadGlyph(page.Id, in pixelRect, pixels[..expected]);
        }

        return true;
    }

    /// <summary>Gets the byte size of one pixel for a raster format.</summary>
    /// <param name="format">Raster format.</param>
    /// <returns>1 for coverage/SDF, 3 for MSDF, 4 for RGBA.</returns>
    public static int BytesPerPixel(UiGlyphFormat format) => format switch
    {
        UiGlyphFormat.Alpha8 or UiGlyphFormat.Sdf => 1,
        UiGlyphFormat.Msdf => 3,
        _ => 4,
    };

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        for (int i = 0; i < _pageCount; i++)
        {
            _uploader.DeletePage(_ids[i]);
            _entries[i]?.Clear();
        }

        _pageCount = 0;
    }

    private int FindPageWithRoom(in UiGlyphRaster raster)
    {
        for (int i = 0; i < _pageCount; i++)
        {
            ref readonly Page page = ref _pages[i];
            if (page.Full || page.Format != raster.Format)
            {
                continue;
            }

            if (raster.Width > page.Width || raster.Height > page.Height)
            {
                continue;
            }

            int x = page.CursorX;
            int y = page.CursorY;
            if (x + raster.Width > page.Width)
            {
                x = 0;
                y += page.RowHeight;
            }

            if (y + raster.Height <= page.Height)
            {
                return i;
            }
        }

        return -1;
    }

    private int CreatePage(UiGlyphFormat format, int glyphWidth, int glyphHeight)
    {
        if (glyphWidth > PageWidth || glyphHeight > PageHeight)
        {
            return -1;
        }

        if (_pageCount == _maxPages)
        {
            EvictLeastRecentlyUsed();
        }

        UiGlyphAtlasPageId id = new(_nextPageId++);
        UiResourceId texture = _uploader.CreatePage(id, PageWidth, PageHeight, format);
        int index = _pageCount++;

        _ids[index] = id;
        _pages[index] = new Page
        {
            Id = id,
            Texture = texture,
            Width = PageWidth,
            Height = PageHeight,
            Format = format,
            CursorX = 0,
            CursorY = 0,
            RowHeight = 0,
            AllocatedGlyphs = 0,
            LastAccess = _frame,
            Full = false,
        };
        _entries[index] ??= new Dictionary<GlyphKey, UiGlyphAtlasEntry>();
        _entries[index]!.Clear();

        return index;
    }

    private void EvictLeastRecentlyUsed()
    {
        int victim = 0;
        long oldest = _pages[0].LastAccess;
        for (int i = 1; i < _pageCount; i++)
        {
            if (_pages[i].LastAccess < oldest)
            {
                oldest = _pages[i].LastAccess;
                victim = i;
            }
        }

        UiGlyphAtlasPageId id = _ids[victim];
        _entries[victim]!.Clear();
        _uploader.DeletePage(id);
        _evictionCount++;

        int last = _pageCount - 1;
        if (victim != last)
        {
            Array.Copy(_ids, victim + 1, _ids, victim, last - victim);
            Array.Copy(_pages, victim + 1, _pages, victim, last - victim);
            Array.Copy(_entries, victim + 1, _entries, victim, last - victim);
        }

        _ids[last] = default;
        _pages[last] = default;
        _entries[last] = null;
        _pageCount = last;

        _evictionListener?.OnGlyphPageEvicted(id);
    }

    private int IndexOf(UiGlyphAtlasPageId page)
    {
        if (!page.IsValid)
        {
            return -1;
        }

        for (int i = 0; i < _pageCount; i++)
        {
            if (_ids[i] == page)
            {
                return i;
            }
        }

        return -1;
    }

    private readonly struct GlyphKey(uint face, int codePoint) : IEquatable<GlyphKey>
    {
        private readonly uint _face = face;
        private readonly int _codePoint = codePoint;

        public bool Equals(GlyphKey other) => _face == other._face && _codePoint == other._codePoint;

        public override bool Equals(object? obj) => obj is GlyphKey other && Equals(other);

        public override int GetHashCode() => unchecked((int)((_face * 397u) ^ (uint)_codePoint));

        public static bool operator ==(GlyphKey left, GlyphKey right) => left.Equals(right);

        public static bool operator !=(GlyphKey left, GlyphKey right) => !left.Equals(right);
    }

    private struct Page
    {
        public UiGlyphAtlasPageId Id;
        public UiResourceId Texture;
        public int Width;
        public int Height;
        public UiGlyphFormat Format;
        public int CursorX;
        public int CursorY;
        public int RowHeight;
        public int AllocatedGlyphs;
        public long LastAccess;
        public bool Full;
    }
}
