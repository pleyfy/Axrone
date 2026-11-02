namespace Axrone.Ui.Testing.OpenGL;

internal static class GlyphFields
{
    /// <summary>
    /// Encodes an analytic circle as a single-channel SDF. Distance is measured in page
    /// pixels; <paramref name="spreadPixels"/> maps one pixel of distance to 1/spread of the
    /// normalized 0.5 threshold band, which fixes the antialias width the shader derives from
    /// <c>fwidth</c>.
    /// </summary>
    public static byte[] SdfCircle(int width, int height, float radius, float spreadPixels)
    {
        var data = new byte[width * height];
        float centerX = width * 0.5f;
        float centerY = height * 0.5f;
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                float dx = x + 0.5f - centerX;
                float dy = y + 0.5f - centerY;
                float distance = radius - MathF.Sqrt((dx * dx) + (dy * dy));
                data[(y * width) + x] = ToByte(0.5f + (distance / spreadPixels));
            }
        }

        return data;
    }

    public static byte[] SdfRamp(int width, int height, byte first, byte last)
    {
        var data = new byte[width * height];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int value = width == 1 ? first : first + (((last - first) * x) / (width - 1));
                data[(y * width) + x] = (byte)value;
            }
        }

        return data;
    }

    public static byte[] CoverageRamp(int width, int height, ReadOnlySpan<byte> levels)
    {
        var data = new byte[width * height];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                data[(y * width) + x] = levels[x % levels.Length];
            }
        }

        return data;
    }

    public static byte[] Constant(int width, int height, byte value)
    {
        var data = new byte[width * height];
        Array.Fill(data, value);
        return data;
    }

    public static byte[] ConstantRgb(int width, int height, byte r, byte g, byte b)
    {
        var data = new byte[width * height * 3];
        for (int i = 0; i < data.Length; i += 3)
        {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        return data;
    }

    public static byte[] ConstantRgba(int width, int height, byte r, byte g, byte b, byte a)
    {
        var data = new byte[width * height * 4];
        for (int i = 0; i < data.Length; i += 4)
        {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }

        return data;
    }

    private static byte ToByte(float normalized) =>
        (byte)Math.Clamp((int)MathF.Round(normalized * 255f, MidpointRounding.AwayFromZero), 0, 255);
}
