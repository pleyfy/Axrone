namespace Axrone.Ui.Rendering;

/// <summary>One of the three spans produced by slicing an axis of an image.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiSliceSpan(float Offset, float Size, float UvOffset, float UvSize)
{
    /// <summary>Gets whether the span has a positive drawable and UV extent.</summary>
    public bool IsDrawable => Size > 0.0f && UvSize > 0.0f;
}

/// <summary>
/// Nine-slice math and image fit resolution. All methods are pure, span-writing
/// and allocation-free; callers supply pre-sized instance spans.
/// </summary>
public static class UiNineSlice
{
    /// <summary>Maximum instances a nine-slice command expands to.</summary>
    public const int MaxInstances = 9;

    /// <summary>
    /// Splits one axis into start/middle/end spans. Border sizes are clamped so
    /// they never overlap; when the borders consume the whole extent the middle
    /// span collapses to zero and is skipped by the caller.
    /// </summary>
    /// <param name="extent">Destination extent in pixels.</param>
    /// <param name="start">Start border in destination pixels.</param>
    /// <param name="end">End border in destination pixels.</param>
    /// <param name="sourceExtent">Source extent in pixels used to scale UVs; zero falls back to <paramref name="extent"/>.</param>
    /// <param name="uvOffset">Normalized UV start.</param>
    /// <param name="uvExtent">Normalized UV extent.</param>
    /// <param name="startSpan">Start span.</param>
    /// <param name="middleSpan">Middle span.</param>
    /// <param name="endSpan">End span.</param>
    public static void ComputeAxis(
        float extent,
        float start,
        float end,
        float sourceExtent,
        float uvOffset,
        float uvExtent,
        out UiSliceSpan startSpan,
        out UiSliceSpan middleSpan,
        out UiSliceSpan endSpan)
    {
        if (extent < 0.0f)
        {
            extent = 0.0f;
        }

        start = Math.Clamp(start, 0.0f, extent);
        end = Math.Clamp(end, 0.0f, extent - start);

        float source = sourceExtent > 0.0f ? sourceExtent : extent;
        float uvStart = source > 0.0f ? uvExtent * (start / source) : 0.0f;
        float uvEnd = source > 0.0f ? uvExtent * (end / source) : 0.0f;
        float middleSize = extent - start - end;
        float middleUv = uvExtent - uvStart - uvEnd;

        if (middleUv < 0.0f)
        {
            middleUv = 0.0f;
        }

        startSpan = new UiSliceSpan(0.0f, start, uvOffset, uvStart);
        middleSpan = new UiSliceSpan(start, middleSize, uvOffset + uvStart, middleUv);
        endSpan = new UiSliceSpan(extent - end, end, uvOffset + uvExtent - uvEnd, uvEnd);
    }

    /// <summary>
    /// Expands a nine-sliced image command into up to nine instances. UVs are
    /// mirrored per span when the command carries flip flags because a flipped
    /// nine-slice must sample the opposite source corner while keeping geometry
    /// in place. Corner radii are zero on slices to avoid distorting them.
    /// </summary>
    /// <param name="command">Image command carrying <see cref="UiRenderFlags.NineSlice"/>.</param>
    /// <param name="sourceSize">Source image size in pixels for UV border scaling.</param>
    /// <param name="destination">Destination span; must hold at least <see cref="MaxInstances"/>.</param>
    /// <returns>Number of instances written.</returns>
    public static int Build(in UiRenderCommand command, in UiSize sourceSize, Span<UiImageInstance> destination)
    {
        if (destination.Length < MaxInstances)
        {
            return 0;
        }

        Rect bounds = command.Bounds;
        if (bounds.Width <= 0.0f || bounds.Height <= 0.0f)
        {
            return 0;
        }

        UiEdgeInsets border = command.SliceBorder;
        Rect uv = command.UvRect;

        ComputeAxis(bounds.Width, border.Left, border.Right, sourceSize.Width, uv.X, uv.Width,
            out UiSliceSpan xs, out UiSliceSpan xm, out UiSliceSpan xe);
        ComputeAxis(bounds.Height, border.Top, border.Bottom, sourceSize.Height, uv.Y, uv.Height,
            out UiSliceSpan ys, out UiSliceSpan ym, out UiSliceSpan ye);

        Span<UiSliceSpan> columns = [xs, xm, xe];
        Span<UiSliceSpan> rows = [ys, ym, ye];

        bool flipX = (command.Flags & UiRenderFlags.FlipX) != 0;
        bool flipY = (command.Flags & UiRenderFlags.FlipY) != 0;

        int count = 0;
        for (int row = 0; row < 3; row++)
        {
            ref readonly UiSliceSpan vertical = ref rows[row];
            if (!vertical.IsDrawable)
            {
                continue;
            }

            for (int column = 0; column < 3; column++)
            {
                ref readonly UiSliceSpan horizontal = ref columns[column];
                if (!horizontal.IsDrawable)
                {
                    continue;
                }

                float u = horizontal.UvOffset;
                if (flipX)
                {
                    u = uv.Right - (horizontal.UvOffset - uv.X) - horizontal.UvSize;
                }

                float v = vertical.UvOffset;
                if (flipY)
                {
                    v = uv.Bottom - (vertical.UvOffset - uv.Y) - vertical.UvSize;
                }

                destination[count++] = new UiImageInstance(
                    new Rect(bounds.X + horizontal.Offset, bounds.Y + vertical.Offset, horizontal.Size, vertical.Size),
                    new Rect(u, v, horizontal.UvSize, vertical.UvSize),
                    command.Color,
                    UiCornerRadii.Zero,
                    command.Opacity,
                    UiRenderFlags.None);
            }
        }

        return count;
    }
}

/// <summary>Resolves <see cref="UiImageFit"/> into a destination rectangle.</summary>
public static class UiImageFitResolver
{
    /// <summary>Resolves one fit policy.</summary>
    /// <param name="fit">Fit policy.</param>
    /// <param name="destination">Layout box the image may occupy.</param>
    /// <param name="sourceSize">Source image size in pixels.</param>
    /// <param name="result">Resolved draw rectangle (may exceed the box for cover).</param>
    /// <returns><see langword="false"/> when the policy needs a positive source size and none was supplied.</returns>
    public static bool TryResolve(UiImageFit fit, in Rect destination, in UiSize sourceSize, out Rect result)
    {
        if (fit == UiImageFit.Fill)
        {
            result = destination;
            return true;
        }

        if (destination.Width <= 0.0f || destination.Height <= 0.0f)
        {
            result = destination;
            return false;
        }

        float sourceWidth = sourceSize.Width;
        float sourceHeight = sourceSize.Height;
        if (sourceWidth <= 0.0f || sourceHeight <= 0.0f)
        {
            result = destination;
            return false;
        }

        if (fit == UiImageFit.None)
        {
            result = Center(destination, sourceWidth, sourceHeight);
            return true;
        }

        float scaleX = destination.Width / sourceWidth;
        float scaleY = destination.Height / sourceHeight;
        float scale = fit == UiImageFit.Cover ? MathF.Max(scaleX, scaleY) : MathF.Min(scaleX, scaleY);

        if (fit == UiImageFit.ScaleDown && scale > 1.0f)
        {
            scale = 1.0f;
        }

        result = Center(destination, sourceWidth * scale, sourceHeight * scale);
        return true;
    }

    private static Rect Center(in Rect destination, float width, float height) =>
        new(
            destination.X + ((destination.Width - width) * 0.5f),
            destination.Y + ((destination.Height - height) * 0.5f),
            width,
            height);
}

/// <summary>
/// Converts draw commands into typed GPU instance records. Every encoder writes
/// into a caller-owned span, skips nothing silently only where a documented
/// precondition fails, and never allocates.
/// </summary>
public static class UiInstanceEncoder
{
    /// <summary>Encodes one quad command.</summary>
    /// <param name="command">Quad command.</param>
    /// <param name="destination">Destination span.</param>
    /// <returns>1 when written, 0 when the destination is empty or the command is not a quad.</returns>
    public static int EncodeQuad(in UiRenderCommand command, Span<UiQuadInstance> destination)
    {
        if (destination.Length == 0 || command.Kind != UiRenderCommandKind.Quad)
        {
            return 0;
        }

        destination[0] = new UiQuadInstance(
            command.Bounds,
            command.Color,
            command.BorderColor,
            command.Radius,
            command.BorderWidth,
            command.Opacity);
        return 1;
    }

    /// <summary>
    /// Encodes one image command, expanding nine-slice borders when flagged.
    /// </summary>
    /// <param name="command">Image command.</param>
    /// <param name="sourceSize">Source image size for fit and UV border scaling.</param>
    /// <param name="destination">Destination span.</param>
    /// <returns>Number of instances written.</returns>
    public static int EncodeImage(in UiRenderCommand command, in UiSize sourceSize, Span<UiImageInstance> destination)
    {
        if (destination.Length == 0 || command.Kind != UiRenderCommandKind.Image)
        {
            return 0;
        }

        if ((command.Flags & UiRenderFlags.NineSlice) != 0)
        {
            return UiNineSlice.Build(command, sourceSize, destination);
        }

        Rect draw = command.Bounds;
        if (command.Fit != UiImageFit.Fill && UiImageFitResolver.TryResolve(command.Fit, command.Bounds, sourceSize, out Rect fitted))
        {
            draw = fitted;
        }

        destination[0] = new UiImageInstance(
            draw,
            command.UvRect,
            command.Color,
            command.Radius,
            command.Opacity,
            command.Flags & (UiRenderFlags.FlipX | UiRenderFlags.FlipY));
        return 1;
    }

    /// <summary>
    /// Encodes the glyphs of a shaped layout. Glyphs whose atlas entry is not
    /// resident are skipped and counted in <paramref name="missedGlyphs"/>; the
    /// host is expected to rasterize and retry before submission.
    /// </summary>
    /// <param name="command">Text command.</param>
    /// <param name="face">Resolved font face of the layout.</param>
    /// <param name="layout">Shaped layout.</param>
    /// <param name="atlas">Glyph residency source.</param>
    /// <param name="destination">Destination span.</param>
    /// <param name="missedGlyphs">Number of glyphs skipped for a missing atlas entry.</param>
    /// <returns>Number of instances written.</returns>
    public static int EncodeGlyphs(
        in UiRenderCommand command,
        UiFontFaceId face,
        IUiTextLayout layout,
        IUiGlyphAtlas atlas,
        Span<UiGlyphInstance> destination,
        out int missedGlyphs)
    {
        missedGlyphs = 0;
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(atlas);

        if (command.Kind != UiRenderCommandKind.Text)
        {
            return 0;
        }

        ReadOnlySpan<UiShapedGlyph> glyphs = layout.Glyphs;
        int count = 0;

        for (int i = 0; i < glyphs.Length; i++)
        {
            ref readonly UiShapedGlyph glyph = ref glyphs[i];
            if (!atlas.TryGetEntry(face, glyph.CodePoint, out UiGlyphAtlasEntry entry))
            {
                missedGlyphs++;
                continue;
            }

            if (entry.Width <= 0.0f || entry.Height <= 0.0f || count == destination.Length)
            {
                if (count == destination.Length)
                {
                    missedGlyphs += glyphs.Length - i;
                    break;
                }

                continue;
            }

            destination[count++] = new UiGlyphInstance(
                new Rect(
                    command.Bounds.X + glyph.X - entry.OriginX,
                    command.Bounds.Y + glyph.Y - entry.OriginY,
                    entry.Width,
                    entry.Height),
                entry.UvRect,
                command.Color,
                command.BorderColor,
                command.BorderWidth,
                command.Opacity);
        }

        return count;
    }
}
