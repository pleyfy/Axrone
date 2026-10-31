namespace Axrone.Ui.Assets;

/// <summary>Discriminator for a binding value.</summary>
public enum UiBindingValueKind
{
    /// <summary>JSON null or an absent binding.</summary>
    Null = 0,

    /// <summary>Boolean binding.</summary>
    Flag = 1,

    /// <summary>Double-precision numeric binding.</summary>
    Numeric = 2,

    /// <summary>UTF-8 string binding; read the text through the table.</summary>
    Text = 3,
}

/// <summary>
/// Scalar binding payload. String values carry their text in the owning
/// <see cref="UiBindingTable"/> so lookups never allocate.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct UiBindingValue(UiBindingValueKind Kind, bool Boolean, double Number)
{
    /// <summary>Gets the null binding.</summary>
    public static UiBindingValue Null => new(UiBindingValueKind.Null, false, 0.0);

    /// <summary>Creates a boolean binding.</summary>
    public static UiBindingValue FromBoolean(bool value) => new(UiBindingValueKind.Flag, value, 0.0);

    /// <summary>Creates a numeric binding.</summary>
    public static UiBindingValue FromNumber(double value) => new(UiBindingValueKind.Numeric, false, value);

    /// <summary>Creates a string binding marker.</summary>
    public static UiBindingValue FromString() => new(UiBindingValueKind.Text, false, 0.0);
}

/// <summary>Discriminator for an authored widget key.</summary>
public enum UiKeyKind
{
    /// <summary>No key.</summary>
    None = 0,

    /// <summary>UTF-16 string key.</summary>
    Text = 1,

    /// <summary>Integral numeric key.</summary>
    Numeric = 2,
}

/// <summary>Authored widget key; serializable mirror of the runtime widget key.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct UiBindingKey(UiKeyKind Kind, long Number, string? Text)
{
    /// <summary>Gets the absent key.</summary>
    public static UiBindingKey None => default;

    /// <summary>Creates a string key.</summary>
    public static UiBindingKey FromString(string value)
    {
        ArgumentException.ThrowIfNullOrEmpty(value);
        return new UiBindingKey(UiKeyKind.Text, 0L, value);
    }

    /// <summary>Creates an integral numeric key.</summary>
    public static UiBindingKey FromNumber(long value) => new(UiKeyKind.Numeric, value, null);
}

/// <summary>Image fit policy.</summary>
public enum UiImageFit
{
    /// <summary>Stretch to the box.</summary>
    Fill,

    /// <summary>Fit inside the box, preserving aspect ratio.</summary>
    Contain,

    /// <summary>Cover the box, preserving aspect ratio.</summary>
    Cover,

    /// <summary>Use the intrinsic size.</summary>
    None,

    /// <summary>Contain, but never upscale.</summary>
    ScaleDown,
}

/// <summary>Normalized UV rectangle.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiUvRect(float X, float Y, float Width, float Height)
{
    /// <summary>The full texture rectangle.</summary>
    public static UiUvRect Full => new(0.0f, 0.0f, 1.0f, 1.0f);
}

/// <summary>Authored text content and typography for one node.</summary>
public readonly record struct UiNodeText(
    string Value,
    string Family,
    float Size,
    UiFontWeight Weight,
    UiFontStyle FontStyle,
    UiTextWrap Wrap,
    UiTextOverflow Overflow,
    UiTextAlign Align,
    UiTextDirection Direction,
    float LineHeight,
    float LetterSpacing,
    int MaxLines)
{
    /// <summary>Gets the neutral text block.</summary>
    public static UiNodeText Default => new(
        string.Empty,
        string.Empty,
        16.0f,
        UiFontWeight.Normal,
        UiFontStyle.Normal,
        UiTextWrap.Word,
        UiTextOverflow.Clip,
        UiTextAlign.Start,
        UiTextDirection.Auto,
        0.0f,
        0.0f,
        0);
}

/// <summary>Source kind of a node image.</summary>
public enum UiImageSourceKind
{
    /// <summary>Direct texture reference.</summary>
    Texture,

    /// <summary>Material reference that supplies the texture.</summary>
    Material,
}

/// <summary>Authored image content for one node.</summary>
public readonly record struct UiNodeImage(
    UiImageSourceKind SourceKind,
    string ResourceId,
    UiImageFit Fit,
    UiColor Tint,
    UiEdgeInsets Border,
    UiUvRect UvRect,
    UiSize SourceSize,
    bool FillCenter,
    bool Bleed)
{
    /// <summary>Gets the neutral image block bound to no resource.</summary>
    public static UiNodeImage Default => new(
        UiImageSourceKind.Texture,
        string.Empty,
        UiImageFit.Fill,
        UiColor.White,
        UiEdgeInsets.Zero,
        UiUvRect.Full,
        UiSize.Zero,
        false,
        false);
}

/// <summary>Authored focus policy for one node.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiNodeFocus(
    int TabIndex,
    int Order,
    bool Scope,
    bool Cycle,
    UiColor RingColor,
    float RingWidth,
    float RingOffset)
{
    /// <summary>Gets the neutral focus policy.</summary>
    public static UiNodeFocus Default => new(0, 0, false, false, UiColor.White, 0.0f, 0.0f);
}
