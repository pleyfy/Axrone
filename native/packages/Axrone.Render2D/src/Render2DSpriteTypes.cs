namespace Axrone.Render2D;

/// <summary>Discriminates a texture-backed sprite source from a material-backed one.</summary>
public enum Render2DSpriteSourceKind : byte
{
    /// <summary>Source resolved by a texture reference.</summary>
    Texture = 0,

    /// <summary>Source resolved by a material reference.</summary>
    Material = 1,
}

/// <summary>Stable source identity used for batch grouping.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct Render2DSpriteSourceKey(Render2DSpriteSourceKind Kind, ulong Id) :
    IComparable<Render2DSpriteSourceKey>,
    IComparable
{
    /// <summary>Gets the invalid source key.</summary>
    public static Render2DSpriteSourceKey Invalid => default;

    /// <summary>Gets whether the key names a real resource.</summary>
    public bool IsValid => Id != 0;

    /// <inheritdoc/>
    public int CompareTo(Render2DSpriteSourceKey other)
    {
        int kind = Kind.CompareTo(other.Kind);
        return kind != 0 ? kind : Id.CompareTo(other.Id);
    }

    /// <inheritdoc/>
    public int CompareTo(object? obj) =>
        obj is Render2DSpriteSourceKey other ? CompareTo(other) : 1;

    /// <summary>Less-than operator.</summary>
    public static bool operator <(Render2DSpriteSourceKey left, Render2DSpriteSourceKey right) =>
        left.CompareTo(right) < 0;

    /// <summary>Less-than-or-equal operator.</summary>
    public static bool operator <=(Render2DSpriteSourceKey left, Render2DSpriteSourceKey right) =>
        left.CompareTo(right) <= 0;

    /// <summary>Greater-than operator.</summary>
    public static bool operator >(Render2DSpriteSourceKey left, Render2DSpriteSourceKey right) =>
        left.CompareTo(right) > 0;

    /// <summary>Greater-than-or-equal operator.</summary>
    public static bool operator >=(Render2DSpriteSourceKey left, Render2DSpriteSourceKey right) =>
        left.CompareTo(right) >= 0;
}

/// <summary>
/// Renderer-agnostic source reference. The identifier is a caller-owned stable
/// resource key (for example a scene asset symbol); Render2D never resolves it.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct Render2DSpriteSource(Render2DSpriteSourceKind Kind, ulong Id)
{
    /// <summary>Creates a texture source.</summary>
    public static Render2DSpriteSource Texture(ulong textureId) =>
        new(Render2DSpriteSourceKind.Texture, textureId);

    /// <summary>Creates a material source.</summary>
    public static Render2DSpriteSource Material(ulong materialId) =>
        new(Render2DSpriteSourceKind.Material, materialId);

    /// <summary>Gets whether the source names a real resource.</summary>
    public bool IsValid => Id != 0;

    /// <summary>Gets the batch-grouping key.</summary>
    public Render2DSpriteSourceKey Key => new(Kind, Id);
}

/// <summary>Four-sided sprite border in source pixels.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DBorder(float Left, float Right, float Top, float Bottom)
{
    /// <summary>Zero border.</summary>
    public static Render2DBorder Zero => default;
}

/// <summary>Nine-slice source size and border extents.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DSpriteSlice(Vec2 SourceSize, Render2DBorder Border);

/// <summary>Mask shape understood by the sprite material contract.</summary>
public enum Render2DSpriteMaskShape : byte
{
    /// <summary>Ellipse inscribed in the mask bounds.</summary>
    Circle = 0,

    /// <summary>Rounded rectangle mask.</summary>
    RoundedRect = 1,
}

/// <summary>World-to-local mask state consumed by the sprite shader.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DSpriteMask(
    Render2DSpriteMaskShape Shape,
    Mat4 InverseWorldMatrix,
    Vec2 Size,
    Vec2 Anchor,
    float CornerRadius = 0.0f);

/// <summary>One sprite submission consumed by the builder.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DSpriteSubmission(
    Render2DSpriteSource Source,
    Mat4 WorldMatrix,
    Vec2 Size,
    Vec2 Anchor,
    Rect UvRect,
    Vec4 Color,
    bool Visible = true,
    bool FlipX = false,
    bool FlipY = false,
    bool HasClip = false,
    Rect Clip = default,
    bool HasSlice = false,
    Render2DSpriteSlice Slice = default,
    bool HasMask = false,
    Render2DSpriteMask Mask = default);

/// <summary>Batch identity: source, clip rectangle and mask state.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DBatchKey(
    Render2DSpriteSourceKey Source,
    bool HasClip,
    Rect Clip,
    bool HasMask,
    Render2DSpriteMask Mask)
{
    /// <summary>Builds the key of one submission.</summary>
    public static Render2DBatchKey From(in Render2DSpriteSubmission submission) =>
        new(
            submission.Source.Key,
            submission.HasClip,
            submission.HasClip ? submission.Clip : default,
            submission.HasMask,
            submission.HasMask ? submission.Mask : default);
}

/// <summary>Contiguous sprite range sharing one batch key.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DBatchRange(
    Render2DBatchKey Key,
    int SpriteOffset,
    int SpriteCount,
    int QuadCount,
    int IndexOffset,
    int IndexCount);
