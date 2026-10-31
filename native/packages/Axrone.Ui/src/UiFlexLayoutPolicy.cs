namespace Axrone.Ui;

/// <summary>
/// Default flex policy: row/column flow, wrapping, gap, justify distribution and
/// intrinsic content sizing. Grow/shrink weights, absolute positioning and
/// cross-axis alignment are resolved by <see cref="UiLayoutEngine"/>, which owns
/// the per-child styles; this policy works purely from measured child extents.
/// </summary>
public readonly struct UiFlexLayoutPolicy : IUiLayoutPolicy<UiFlexLayoutPolicy>
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static UiMeasureResult Measure(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children)
    {
        bool row = style.Direction == UiAxis.Row;
        float padH = MathF.Max(0.0f, style.Padding.Left) + MathF.Max(0.0f, style.Padding.Right) + (2.0f * MathF.Max(0.0f, style.BorderWidth));
        float padV = MathF.Max(0.0f, style.Padding.Top) + MathF.Max(0.0f, style.Padding.Bottom) + (2.0f * MathF.Max(0.0f, style.BorderWidth));
        float contentMaxW = MathF.Max(0.0f, context.Constraints.MaxWidth);
        float contentMaxH = MathF.Max(0.0f, context.Constraints.MaxHeight);
        float contentMaxMain = row ? contentMaxW : contentMaxH;
        bool wrap = style.FlexWrap != UiFlexWrap.NoWrap && float.IsFinite(contentMaxMain) && contentMaxMain > 0.0f;
        float gap = MathF.Max(0.0f, style.Gap);

        float totalMain = 0.0f;
        float totalCross = 0.0f;
        if (children.Length > 0)
        {
            if (wrap)
            {
                MeasureWrapped(children, row, gap, contentMaxMain, out totalMain, out totalCross);
            }
            else
            {
                MeasureSingleLine(children, row, gap, out totalMain, out totalCross);
            }
        }

        float width = row ? totalMain + padH : totalCross + padH;
        float height = row ? totalCross + padV : totalMain + padV;
        return new UiMeasureResult(new UiSize(MathF.Max(0.0f, width), MathF.Max(0.0f, height)), 0.0f, false);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void Arrange(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children,
        Span<Rect> childBounds)
    {
        bool row = style.Direction == UiAxis.Row;
        float contentMain = row ? context.Constraints.MaxWidth : context.Constraints.MaxHeight;
        if (!float.IsFinite(contentMain))
        {
            contentMain = float.PositiveInfinity;
        }

        float gap = MathF.Max(0.0f, style.Gap);
        bool wrap = style.FlexWrap != UiFlexWrap.NoWrap && float.IsFinite(contentMain);
        float contentCross = row ? context.Constraints.MaxHeight : context.Constraints.MaxWidth;

        int index = 0;
        float lineCross = 0.0f;
        while (index < children.Length)
        {
            int lineEnd = index;
            float used = 0.0f;
            while (lineEnd < children.Length)
            {
                UiChildMeasurement child = children[lineEnd];
                float step = MainExtent(in child, row);
                float advance = lineEnd == index ? step : gap + step;
                if (wrap && lineEnd > index && used + advance > contentMain)
                {
                    break;
                }

                used += advance;
                lineEnd++;
            }

            int lineCount = lineEnd - index;
            float free = float.IsFinite(contentMain) ? MathF.Max(0.0f, contentMain - used) : 0.0f;
            ComputeJustify(style.JustifyContent, free, lineCount, out float startMain, out float extraGap);

            float cursor = startMain;
            float lineExtent = 0.0f;
            for (int k = index; k < lineEnd; k++)
            {
                UiChildMeasurement child = children[k];
                float mainStart = MainStartMargin(in child, row);
                float mainEnd = MainEndMargin(in child, row);
                float crossStart = CrossStartMargin(in child, row);
                float crossEnd = CrossEndMargin(in child, row);
                float mainSize = MainSize(in child, row);
                float crossSize = CrossSize(in child, row);
                lineExtent = MathF.Max(lineExtent, crossStart + crossSize + crossEnd);

                childBounds[k] = row
                    ? new Rect(cursor + mainStart, lineCross, mainSize, crossSize)
                    : new Rect(lineCross, cursor + mainStart, crossSize, mainSize);
                cursor += mainStart + mainSize + mainEnd + gap + extraGap;
            }

            index = lineEnd;
            // A single-line container gives its line the full cross extent;
            // wrapped lines pack at their measured cross size.
            lineCross += (wrap ? lineExtent : MathF.Max(lineExtent, contentCross)) + gap;
        }
    }

    private static void MeasureSingleLine(
        ReadOnlySpan<UiChildMeasurement> children,
        bool row,
        float gap,
        out float totalMain,
        out float totalCross)
    {
        float main = 0.0f;
        float cross = 0.0f;
        for (int i = 0; i < children.Length; i++)
        {
            UiChildMeasurement child = children[i];
            if (i > 0)
            {
                main += gap;
            }

            main += MainExtent(in child, row);
            cross = MathF.Max(cross, CrossExtent(in child, row));
        }

        totalMain = main;
        totalCross = cross;
    }

    private static void MeasureWrapped(
        ReadOnlySpan<UiChildMeasurement> children,
        bool row,
        float gap,
        float contentMain,
        out float totalMain,
        out float totalCross)
    {
        float maxLineMain = 0.0f;
        float totalCrossLines = 0.0f;
        float lineMain = 0.0f;
        float lineCross = 0.0f;
        int lines = 0;
        bool hasItem = false;

        for (int i = 0; i < children.Length; i++)
        {
            UiChildMeasurement child = children[i];
            float step = MainExtent(in child, row);
            float advance = hasItem ? gap + step : step;
            if (hasItem && lineMain + advance > contentMain)
            {
                maxLineMain = MathF.Max(maxLineMain, lineMain);
                totalCrossLines += (lines > 0 ? gap : 0.0f) + lineCross;
                lines++;
                lineMain = 0.0f;
                lineCross = 0.0f;
                hasItem = false;
                advance = step;
            }

            lineMain += advance;
            lineCross = MathF.Max(lineCross, CrossExtent(in child, row));
            hasItem = true;
        }

        if (hasItem)
        {
            maxLineMain = MathF.Max(maxLineMain, lineMain);
            totalCrossLines += (lines > 0 ? gap : 0.0f) + lineCross;
        }

        totalMain = maxLineMain;
        totalCross = totalCrossLines;
    }

    private static void ComputeJustify(
        UiJustify justify,
        float free,
        int count,
        out float start,
        out float extraGap)
    {
        start = 0.0f;
        extraGap = 0.0f;
        if (count == 0 || free <= 0.0f)
        {
            return;
        }

        switch (justify)
        {
            case UiJustify.Center:
                start = free * 0.5f;
                break;
            case UiJustify.End:
                start = free;
                break;
            case UiJustify.SpaceBetween:
                extraGap = count > 1 ? free / (count - 1) : 0.0f;
                break;
            case UiJustify.SpaceAround:
            {
                float unit = free / count;
                start = unit * 0.5f;
                extraGap = unit;
                break;
            }
            case UiJustify.SpaceEvenly:
            {
                float unit = free / (count + 1);
                start = unit;
                extraGap = unit;
                break;
            }
            case UiJustify.Start:
            default:
                break;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainSize(in UiChildMeasurement child, bool row) => row ? child.Size.Width : child.Size.Height;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossSize(in UiChildMeasurement child, bool row) => row ? child.Size.Height : child.Size.Width;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainStartMargin(in UiChildMeasurement child, bool row) => row ? child.Margin.Left : child.Margin.Top;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainEndMargin(in UiChildMeasurement child, bool row) => row ? child.Margin.Right : child.Margin.Bottom;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossStartMargin(in UiChildMeasurement child, bool row) => row ? child.Margin.Top : child.Margin.Left;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossEndMargin(in UiChildMeasurement child, bool row) => row ? child.Margin.Bottom : child.Margin.Right;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainExtent(in UiChildMeasurement child, bool row) =>
        MainStartMargin(in child, row) + MainSize(in child, row) + MainEndMargin(in child, row);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossExtent(in UiChildMeasurement child, bool row) =>
        CrossStartMargin(in child, row) + CrossSize(in child, row) + CrossEndMargin(in child, row);
}
