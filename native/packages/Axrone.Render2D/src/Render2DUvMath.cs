namespace Axrone.Render2D;

using Axrone.Numeric;

/// <summary>
/// Single source for the sprite quad UV winding. Flips swap the UV edges and
/// invert the stored extent so consumers can reconstruct both vertex UVs and
/// per-instance UV rectangles from the same result.
/// </summary>
public static class Render2DUvMath
{
    /// <summary>Resolves the flipped UV rectangle of a quad.</summary>
    /// <param name="uv">Source UV window.</param>
    /// <param name="flipX">Mirror horizontally.</param>
    /// <param name="flipY">Mirror vertically.</param>
    /// <param name="u0">Left/top-left U edge.</param>
    /// <param name="v0">Top V edge.</param>
    /// <param name="u1">Right/top-right U edge.</param>
    /// <param name="v1">Bottom V edge.</param>
    public static void Resolve(
        in Rect uv,
        bool flipX,
        bool flipY,
        out float u0,
        out float v0,
        out float u1,
        out float v1)
    {
        u0 = uv.X;
        v0 = uv.Y;
        u1 = u0 + uv.Width;
        v1 = v0 + uv.Height;

        if (flipX)
        {
            (u0, u1) = (u1, u0);
        }

        if (flipY)
        {
            (v0, v1) = (v1, v0);
        }
    }
}
