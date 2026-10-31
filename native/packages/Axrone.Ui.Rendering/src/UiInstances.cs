namespace Axrone.Ui.Rendering;

/// <summary>
/// GPU quad instance. 72 bytes: bounds, fill, border, radii, border width and
/// opacity. The struct is written straight into a pinned upload buffer, so its
/// field order is the vertex-attribute layout contract.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct UiQuadInstance
{
    /// <summary>Destination rectangle in frame pixels.</summary>
    public readonly Rect Bounds;

    /// <summary>Fill color.</summary>
    public readonly UiColor Fill;

    /// <summary>Border color.</summary>
    public readonly UiColor Border;

    /// <summary>Corner radii in pixels.</summary>
    public readonly UiCornerRadii Radii;

    /// <summary>Border width in pixels.</summary>
    public readonly float BorderWidth;

    /// <summary>Opacity multiplier applied to fill and border.</summary>
    public readonly float Opacity;

    /// <summary>Creates a quad instance.</summary>
    public UiQuadInstance(in Rect bounds, in UiColor fill, in UiColor border, in UiCornerRadii radii, float borderWidth, float opacity)
    {
        Bounds = bounds;
        Fill = fill;
        Border = border;
        Radii = radii;
        BorderWidth = borderWidth;
        Opacity = opacity;
    }
}

/// <summary>
/// GPU image instance. 72 bytes: destination, UV window, tint, radii, opacity
/// and flip flags.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct UiImageInstance
{
    /// <summary>Destination rectangle in frame pixels.</summary>
    public readonly Rect Bounds;

    /// <summary>Normalized source UV window.</summary>
    public readonly Rect UvRect;

    /// <summary>Color tint.</summary>
    public readonly UiColor Tint;

    /// <summary>Corner radii in pixels.</summary>
    public readonly UiCornerRadii Radii;

    /// <summary>Opacity multiplier.</summary>
    public readonly float Opacity;

    /// <summary>Mirroring flags (<see cref="UiRenderFlags.FlipX"/>, <see cref="UiRenderFlags.FlipY"/>).</summary>
    public readonly UiRenderFlags Flags;

    /// <summary>Creates an image instance.</summary>
    public UiImageInstance(in Rect bounds, in Rect uvRect, in UiColor tint, in UiCornerRadii radii, float opacity, UiRenderFlags flags)
    {
        Bounds = bounds;
        UvRect = uvRect;
        Tint = tint;
        Radii = radii;
        Opacity = opacity;
        Flags = flags;
    }
}

/// <summary>
/// GPU glyph instance. 72 bytes: destination, atlas UV window, fill and outline
/// colors, outline width and opacity.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct UiGlyphInstance
{
    /// <summary>Destination rectangle in frame pixels.</summary>
    public readonly Rect Bounds;

    /// <summary>Normalized atlas UV window.</summary>
    public readonly Rect UvRect;

    /// <summary>Glyph fill color.</summary>
    public readonly UiColor Color;

    /// <summary>Glyph outline color.</summary>
    public readonly UiColor OutlineColor;

    /// <summary>Outline width in pixels; zero disables the outline.</summary>
    public readonly float OutlineWidth;

    /// <summary>Opacity multiplier.</summary>
    public readonly float Opacity;

    /// <summary>Creates a glyph instance.</summary>
    public UiGlyphInstance(in Rect bounds, in Rect uvRect, in UiColor color, in UiColor outlineColor, float outlineWidth, float opacity)
    {
        Bounds = bounds;
        UvRect = uvRect;
        Color = color;
        OutlineColor = outlineColor;
        OutlineWidth = outlineWidth;
        Opacity = opacity;
    }
}

/// <summary>
/// Fixed-capacity instance buffer backed by a pinned array so uploads read a
/// stable address. <see cref="TryAdd"/> returns <see langword="false"/> at
/// capacity, which is the flush trigger: the caller draws the accumulated run,
/// clears, then retries the instance.
/// </summary>
/// <typeparam name="T">Unmanaged instance payload.</typeparam>
public sealed class UiInstanceBuffer<T>
    where T : unmanaged
{
    private readonly T[] _items;
    private int _count;

    /// <summary>Initializes a buffer with a fixed capacity.</summary>
    /// <param name="capacity">Maximum instance count; must be positive.</param>
    public UiInstanceBuffer(int capacity)
    {
        if (capacity <= 0)
        {
            UiRenderThrowHelper.ThrowArgumentOutOfRange(nameof(capacity), capacity, "Capacity must be positive.");
        }

        _items = GC.AllocateArray<T>(capacity, pinned: true);
        _count = 0;
    }

    /// <summary>Gets the fixed capacity.</summary>
    public int Capacity => _items.Length;

    /// <summary>Gets the buffered instance count.</summary>
    public int Count => _count;

    /// <summary>Gets whether the buffer is full.</summary>
    public bool IsFull => _count == _items.Length;

    /// <summary>Gets the written instances as a read-only view.</summary>
    public ReadOnlySpan<T> Items => new(_items, 0, _count);

    /// <summary>Appends one instance, or reports that a flush is required.</summary>
    /// <param name="item">Instance payload.</param>
    /// <returns><see langword="true"/> when stored; <see langword="false"/> when full.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryAdd(in T item)
    {
        if (_count == _items.Length)
        {
            return false;
        }

        _items[_count++] = item;
        return true;
    }

    /// <summary>Resets the count without touching the backing array.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Clear() => _count = 0;
}
