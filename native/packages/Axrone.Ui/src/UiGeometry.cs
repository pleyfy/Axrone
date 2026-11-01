namespace Axrone.Ui;

/// <summary>Logical size in UI/reference pixels.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiSize(float Width, float Height)
{
    /// <summary>Zero size.</summary>
    public static UiSize Zero => default;
}

/// <summary>Four-sided inset/padding/margin values.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiEdgeInsets(float Top, float Right, float Bottom, float Left)
{
    /// <summary>No inset.</summary>
    public static UiEdgeInsets Zero => default;
}

/// <summary>Four corner radii in UI pixels.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiCornerRadii(
    float TopLeft,
    float TopRight,
    float BottomRight,
    float BottomLeft)
{
    /// <summary>Square corners.</summary>
    public static UiCornerRadii Zero => default;
}

/// <summary>Resolved viewport used by layout and rendering.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiViewport(float Width, float Height, float Scale, float OffsetX, float OffsetY)
{
    /// <summary>Creates a viewport from a size, at unit scale and no offset.</summary>
    public UiViewport(UiSize size)
        : this(size.Width, size.Height, 1.0f, 0.0f, 0.0f)
    {
    }
}
