namespace Axrone.Render2D;

/// <summary>
/// Packed sprite vertex: position sample (two floats), normalized UV (two
/// unorm16 values) and RGBA8 color (one uint). The layout is exactly 16 bytes.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct Render2DSpriteVertex(
    float X,
    float Y,
    ushort U,
    ushort V,
    uint Color)
{
    /// <summary>Gets the vertex byte stride.</summary>
    public const int Stride = 16;

    /// <summary>Gets the position lane.</summary>
    public Vec2 Position => new(X, Y);

    /// <summary>Gets the denormalized UV lane.</summary>
    public Vec2 Uv => new(U / 65535.0f, V / 65535.0f);

    /// <summary>Packs a normalized UV component into unorm16.</summary>
    public static ushort PackUv(float value)
    {
        float clamped = float.IsFinite(value) ? Math.Clamp(value, 0.0f, 1.0f) : 0.0f;
        return (ushort)MathF.Round(clamped * 65535.0f);
    }
}

/// <summary>Single source of RGBA8 color packing.</summary>
public static class Render2DColorPacker
{
    /// <summary>Packs a linear RGBA color into R | G&lt;&lt;8 | B&lt;&lt;16 | A&lt;&lt;24.</summary>
    public static uint Pack(in Vec4 color)
    {
        uint red = PackChannel(color.X);
        uint green = PackChannel(color.Y);
        uint blue = PackChannel(color.Z);
        uint alpha = PackChannel(color.W);
        return red | (green << 8) | (blue << 16) | (alpha << 24);
    }

    /// <summary>Unpacks one channel from a packed color.</summary>
    public static byte UnpackChannel(uint packed, int channel)
    {
        if ((uint)channel > 3)
        {
            return 0;
        }

        return (byte)((packed >> (channel * 8)) & 0xFF);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint PackChannel(float value)
    {
        float clamped = float.IsFinite(value) ? Math.Clamp(value, 0.0f, 1.0f) : 0.0f;
        return (uint)MathF.Round(clamped * 255.0f) & 0xFF;
    }
}
