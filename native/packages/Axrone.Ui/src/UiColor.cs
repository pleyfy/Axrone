namespace Axrone.Ui;

/// <summary>Linear RGBA color in [0, 1].</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColor(float R, float G, float B, float A)
{
    /// <summary>Fully transparent black.</summary>
    public static UiColor Transparent => new(0.0f, 0.0f, 0.0f, 0.0f);

    /// <summary>Opaque black.</summary>
    public static UiColor Black => new(0.0f, 0.0f, 0.0f, 1.0f);

    /// <summary>Opaque white.</summary>
    public static UiColor White => new(1.0f, 1.0f, 1.0f, 1.0f);
}
