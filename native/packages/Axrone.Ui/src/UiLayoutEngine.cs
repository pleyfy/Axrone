namespace Axrone.Ui;

/// <summary>
/// Two-phase layout engine over a monomorphized <see cref="IUiLayoutPolicy{TSelf}"/>.
/// </summary>
/// <remarks>
/// Measure resolves style lengths (px/percent/stretch/viewport/auto), measures
/// flow and absolute children, delegates intrinsic container sizing to the
/// policy and caches border-box sizes. Arrange resolves the content box, asks
/// the policy for main-axis child placement, then applies grow/shrink weights,
/// cross-axis alignment/stretch and absolute anchoring before recursing.
/// <para>
/// The engine is single-threaded and allocates nothing in steady state: the
/// measure cache and scratch spans are reused across passes.
/// </para>
/// </remarks>
/// <typeparam name="TPolicy">Static layout policy.</typeparam>
public sealed class UiLayoutEngine<TPolicy> : IUiLayoutEngine
    where TPolicy : struct, IUiLayoutPolicy<TPolicy>
{
    private const int InitialScratch = 16;
    private const int MaxDepth = 512;

    private readonly UiMeasureCache _cache = new();
    private UiChildMeasurement[] _measurements = new UiChildMeasurement[InitialScratch];
    private UiLayoutStyle[] _styles = new UiLayoutStyle[InitialScratch];
    private UiNodeId[] _childIds = new UiNodeId[InitialScratch];
    private Rect[] _childBounds = new Rect[InitialScratch];
    private int[] _flowToChild = new int[InitialScratch];
    private int[] _absoluteToChild = new int[InitialScratch];
    private int _depth;

    /// <summary>
    /// Gets or sets the viewport used to resolve <see cref="UiLengthKind.Viewport"/>
    /// lengths. Defaults to a zero-sized viewport.
    /// </summary>
    public UiViewport Viewport { get; set; }

    /// <inheritdoc/>
    public UiMeasureResult Measure(IUiLayoutTree tree, UiNodeId node, in UiMeasureConstraints constraints)
    {
        ArgumentNullException.ThrowIfNull(tree);
        if (!tree.TryGetNode(node, out IUiLayoutNode? layoutNode) || layoutNode is null)
        {
            UiThrowHelper.ThrowLayoutTreeMissingNode(node);
        }

        _cache.Clear();
        _depth = 0;
        return MeasureNode(tree, node, layoutNode, in constraints);
    }

    /// <inheritdoc/>
    public void Arrange(IUiLayoutTree tree, UiNodeId node, in Rect bounds, IUiLayoutSink sink)
    {
        ArgumentNullException.ThrowIfNull(tree);
        ArgumentNullException.ThrowIfNull(sink);
        if (!tree.TryGetNode(node, out IUiLayoutNode? layoutNode) || layoutNode is null)
        {
            UiThrowHelper.ThrowLayoutTreeMissingNode(node);
        }

        _depth = 0;
        ArrangeNode(tree, node, layoutNode, in bounds, sink);
    }

    private UiMeasureResult MeasureNode(
        IUiLayoutTree tree,
        UiNodeId id,
        IUiLayoutNode layoutNode,
        in UiMeasureConstraints constraints)
    {
        uint key = id.Value;
        if (_cache.TryGetInProgress(key))
        {
            UiThrowHelper.ThrowLayoutCycle(id);
        }

        if (_cache.TryGetComplete(key, out UiMeasureResult cached))
        {
            return cached;
        }

        _cache.SetInProgress(key);
        if (++_depth > MaxDepth)
        {
            UiThrowHelper.ThrowInvalidOperation("Layout tree depth exceeds the supported limit.");
        }

        UiLayoutStyle style = layoutNode.Style;
        float border = MathF.Max(0.0f, style.BorderWidth);
        float insetLeft = MathF.Max(0.0f, style.Padding.Left) + border;
        float insetTop = MathF.Max(0.0f, style.Padding.Top) + border;
        float insetRight = MathF.Max(0.0f, style.Padding.Right) + border;
        float insetBottom = MathF.Max(0.0f, style.Padding.Bottom) + border;

        float outerMaxWidth = constraints.MaxWidth;
        float outerMaxHeight = constraints.MaxHeight;
        bool hasWidth = TryResolveLength(style.Width, outerMaxWidth, Viewport.Width, out float resolvedWidth);
        bool hasHeight = TryResolveLength(style.Height, outerMaxHeight, Viewport.Height, out float resolvedHeight);

        float contentMaxWidth = hasWidth
            ? MathF.Max(0.0f, resolvedWidth - insetLeft - insetRight)
            : SubtractInsets(outerMaxWidth, insetLeft + insetRight);
        float contentMaxHeight = hasHeight
            ? MathF.Max(0.0f, resolvedHeight - insetTop - insetBottom)
            : SubtractInsets(outerMaxHeight, insetTop + insetBottom);

        ReadOnlySpan<UiNodeId> children = layoutNode.Children;
        UiMeasureResult measured;
        if (children.Length == 0)
        {
            UiSize content = layoutNode.MeasureContent(new UiMeasureConstraints(0.0f, 0.0f, contentMaxWidth, contentMaxHeight));
            measured = new UiMeasureResult(
                new UiSize(
                    MathF.Max(0.0f, content.Width) + insetLeft + insetRight,
                    MathF.Max(0.0f, content.Height) + insetTop + insetBottom),
                0.0f,
                false);
        }
        else
        {
            EnsureScratch(children.Length);
            int flow = 0;
            for (int i = 0; i < children.Length; i++)
            {
                UiNodeId childId = children[i];
                if (!tree.TryGetNode(childId, out IUiLayoutNode? childNode) || childNode is null)
                {
                    UiThrowHelper.ThrowLayoutTreeMissingNode(childId);
                }

                UiLayoutStyle childStyle = childNode.Style;
                UiMeasureConstraints childConstraints = childStyle.Position == UiPositionMode.Absolute
                    ? BuildAbsoluteConstraints(in childStyle, contentMaxWidth, contentMaxHeight)
                    : BuildFlowConstraints(in childStyle, in style, contentMaxWidth, contentMaxHeight);
                UiMeasureResult childResult = MeasureNode(tree, childId, childNode, in childConstraints);
                if (childStyle.Position != UiPositionMode.Absolute)
                {
                    _measurements[flow++] = new UiChildMeasurement(childId, childResult.Size, childStyle.Margin);
                }
            }

            UiLayoutContext context = new(
                id,
                Viewport,
                new UiMeasureConstraints(0.0f, 0.0f, contentMaxWidth, contentMaxHeight));
            measured = MeasurePolicy(in context, in style, _measurements.AsSpan(0, flow));
        }

        float width = hasWidth ? resolvedWidth : measured.Size.Width;
        float height = hasHeight ? resolvedHeight : measured.Size.Height;
        width = ClampDimension(width, style.MinWidth, style.MaxWidth, constraints.MinWidth, constraints.MaxWidth);
        height = ClampDimension(height, style.MinHeight, style.MaxHeight, constraints.MinHeight, constraints.MaxHeight);

        UiMeasureResult result = new(new UiSize(width, height), measured.Baseline, measured.HasBaseline);
        _cache.Store(key, in result);
        _depth--;
        return result;
    }

    private void ArrangeNode(
        IUiLayoutTree tree,
        UiNodeId id,
        IUiLayoutNode layoutNode,
        in Rect bounds,
        IUiLayoutSink sink)
    {
        if (++_depth > MaxDepth)
        {
            UiThrowHelper.ThrowInvalidOperation("Layout tree depth exceeds the supported limit.");
        }

        UiLayoutStyle style = layoutNode.Style;
        float border = MathF.Max(0.0f, style.BorderWidth);
        float insetLeft = MathF.Max(0.0f, style.Padding.Left) + border;
        float insetTop = MathF.Max(0.0f, style.Padding.Top) + border;
        float insetRight = MathF.Max(0.0f, style.Padding.Right) + border;
        float insetBottom = MathF.Max(0.0f, style.Padding.Bottom) + border;
        Rect content = new(
            bounds.X + insetLeft,
            bounds.Y + insetTop,
            MathF.Max(0.0f, bounds.Width - insetLeft - insetRight),
            MathF.Max(0.0f, bounds.Height - insetTop - insetBottom));

        sink.SetBox(id, in bounds, in content);

        ReadOnlySpan<UiNodeId> children = layoutNode.Children;
        if (children.Length == 0)
        {
            _depth--;
            return;
        }

        EnsureScratch(children.Length);
        bool row = style.Direction == UiAxis.Row;
        int flow = 0;
        int absolute = 0;
        for (int i = 0; i < children.Length; i++)
        {
            UiNodeId childId = children[i];
            if (!tree.TryGetNode(childId, out IUiLayoutNode? childNode) || childNode is null)
            {
                UiThrowHelper.ThrowLayoutTreeMissingNode(childId);
            }

            UiLayoutStyle childStyle = childNode.Style;
            _childIds[i] = childId;
            _styles[i] = childStyle;
            if (childStyle.Position == UiPositionMode.Absolute)
            {
                _absoluteToChild[absolute++] = i;
                continue;
            }

            UiSize size = GetOrMeasureSize(tree, childId, childNode, content.Width, content.Height);
            _measurements[flow] = new UiChildMeasurement(childId, size, childStyle.Margin);
            _flowToChild[flow] = i;
            flow++;
        }

        if (flow > 0)
        {
            if (style.FlexWrap == UiFlexWrap.NoWrap)
            {
                DistributeMainAxis(row, row ? content.Width : content.Height, style.Gap, flow);
            }

            UiLayoutContext context = new(
                id,
                Viewport,
                new UiMeasureConstraints(content.Width, content.Height, content.Width, content.Height));
            ArrangePolicy(in context, in style, _measurements.AsSpan(0, flow), _childBounds.AsSpan(0, flow));
            ArrangeFlowChildren(tree, row, in content, in style, flow, sink);
        }

        for (int a = 0; a < absolute; a++)
        {
            int childIndex = _absoluteToChild[a];
            UiNodeId childId = _childIds[childIndex];
            if (!tree.TryGetNode(childId, out IUiLayoutNode? childNode) || childNode is null)
            {
                UiThrowHelper.ThrowLayoutTreeMissingNode(childId);
            }

            UiSize measured = GetOrMeasureSize(tree, childId, childNode, content.Width, content.Height);
            Rect childBounds = ResolveAbsolute(in _styles[childIndex], in content, in measured);
            RemeasureTight(tree, childId, childNode, in childBounds);
            ArrangeNode(tree, childId, childNode, in childBounds, sink);
        }

        _depth--;
    }

    private void ArrangeFlowChildren(
        IUiLayoutTree tree,
        bool row,
        in Rect content,
        in UiLayoutStyle style,
        int flow,
        IUiLayoutSink sink)
    {
        int index = 0;
        while (index < flow)
        {
            float lineCross = CrossCoordinate(in _childBounds[index], row);
            int lineEnd = index + 1;
            while (lineEnd < flow && CrossCoordinate(in _childBounds[lineEnd], row) == lineCross)
            {
                lineEnd++;
            }

            float band = 0.0f;
            for (int k = index; k < lineEnd; k++)
            {
                UiChildMeasurement measurement = _measurements[k];
                band = MathF.Max(
                    band,
                    CrossStartMargin(in measurement, row) + CrossSize(in measurement, row) + CrossEndMargin(in measurement, row));
            }

            // A single-line container aligns children across the whole content
            // cross extent; wrapped lines align inside their measured band.
            if (style.FlexWrap == UiFlexWrap.NoWrap)
            {
                band = MathF.Max(band, row ? content.Height : content.Width);
            }

            for (int k = index; k < lineEnd; k++)
            {
                int childIndex = _flowToChild[k];
                UiLayoutStyle childStyle = _styles[childIndex];
                UiChildMeasurement measurement = _measurements[k];
                UiAlign align = EffectiveAlign(childStyle.AlignSelf, style.AlignItems);
                float marginStart = CrossStartMargin(in measurement, row);
                float marginEnd = CrossEndMargin(in measurement, row);
                float crossSize = CrossSize(in measurement, row);
                float crossPosition;

                if (align == UiAlign.Stretch && IsAutoLength(row ? childStyle.Height : childStyle.Width))
                {
                    crossSize = MathF.Max(0.0f, band - marginStart - marginEnd);
                    crossPosition = lineCross + marginStart;
                }
                else
                {
                    crossPosition = align switch
                    {
                        UiAlign.Center => lineCross + marginStart + (MathF.Max(0.0f, band - marginStart - crossSize - marginEnd) * 0.5f),
                        UiAlign.End => lineCross + band - marginEnd - crossSize,
                        _ => lineCross + marginStart,
                    };
                }

                Rect relative = row
                    ? new Rect(_childBounds[k].X, crossPosition, _childBounds[k].Width, crossSize)
                    : new Rect(crossPosition, _childBounds[k].Y, crossSize, _childBounds[k].Height);
                Rect childBounds = new Rect(content.X + relative.X, content.Y + relative.Y, relative.Width, relative.Height);

                UiNodeId childId = _childIds[childIndex];
                if (!tree.TryGetNode(childId, out IUiLayoutNode? childNode) || childNode is null)
                {
                    UiThrowHelper.ThrowLayoutTreeMissingNode(childId);
                }

                UiSize measured = measurement.Size;
                if (childBounds.Width != measured.Width || childBounds.Height != measured.Height)
                {
                    RemeasureTight(tree, childId, childNode, in childBounds);
                }

                ArrangeNode(tree, childId, childNode, in childBounds, sink);
            }

            index = lineEnd;
        }
    }

    private void DistributeMainAxis(bool row, float contentMain, float gap, int flow)
    {
        if (!float.IsFinite(contentMain) || flow == 0)
        {
            return;
        }

        float used = MathF.Max(0.0f, gap) * (flow - 1);
        for (int k = 0; k < flow; k++)
        {
            used += MainExtent(in _measurements[k], row);
        }

        float free = contentMain - used;
        if (free > 0.0f)
        {
            float totalGrow = 0.0f;
            for (int k = 0; k < flow; k++)
            {
                totalGrow += MathF.Max(0.0f, _styles[_flowToChild[k]].Grow);
            }

            if (totalGrow <= 0.0f)
            {
                return;
            }

            float scale = free / totalGrow;
            for (int k = 0; k < flow; k++)
            {
                float grow = MathF.Max(0.0f, _styles[_flowToChild[k]].Grow);
                if (grow > 0.0f)
                {
                    _measurements[k] = WithMainSize(in _measurements[k], row, MainSize(in _measurements[k], row) + (grow * scale));
                }
            }

            return;
        }

        if (free >= 0.0f)
        {
            return;
        }

        float totalShrink = 0.0f;
        for (int k = 0; k < flow; k++)
        {
            totalShrink += MathF.Max(0.0f, _styles[_flowToChild[k]].Shrink);
        }

        if (totalShrink <= 0.0f)
        {
            return;
        }

        float shrinkScale = -free / totalShrink;
        for (int k = 0; k < flow; k++)
        {
            UiLayoutStyle childStyle = _styles[_flowToChild[k]];
            float shrink = MathF.Max(0.0f, childStyle.Shrink);
            if (shrink <= 0.0f)
            {
                continue;
            }

            float current = MainSize(in _measurements[k], row);
            float minimum = row ? MathF.Max(0.0f, childStyle.MinWidth) : MathF.Max(0.0f, childStyle.MinHeight);
            float target = MathF.Max(minimum, current - (shrink * shrinkScale));
            _measurements[k] = WithMainSize(in _measurements[k], row, target);
        }
    }

    private Rect ResolveAbsolute(in UiLayoutStyle style, in Rect content, in UiSize measured)
    {
        bool hasLeft = TryResolveInset(style.InsetLeft, content.Width, Viewport.Width, out float left);
        bool hasRight = TryResolveInset(style.InsetRight, content.Width, Viewport.Width, out float right);
        bool hasTop = TryResolveInset(style.InsetTop, content.Height, Viewport.Height, out float top);
        bool hasBottom = TryResolveInset(style.InsetBottom, content.Height, Viewport.Height, out float bottom);
        bool autoWidth = IsAutoLength(style.Width);
        bool autoHeight = IsAutoLength(style.Height);

        float width = measured.Width;
        float x;
        if (autoWidth && hasLeft && hasRight)
        {
            width = MathF.Max(0.0f, content.Width - left - right);
            x = content.X + left;
        }
        else if (hasLeft)
        {
            x = content.X + left;
        }
        else if (hasRight)
        {
            x = content.X + content.Width - right - width;
        }
        else
        {
            x = content.X;
        }

        float height = measured.Height;
        float y;
        if (autoHeight && hasTop && hasBottom)
        {
            height = MathF.Max(0.0f, content.Height - top - bottom);
            y = content.Y + top;
        }
        else if (hasTop)
        {
            y = content.Y + top;
        }
        else if (hasBottom)
        {
            y = content.Y + content.Height - bottom - height;
        }
        else
        {
            y = content.Y;
        }

        return new Rect(x, y, width, height);
    }

    private UiMeasureConstraints BuildFlowConstraints(
        in UiLayoutStyle childStyle,
        in UiLayoutStyle parentStyle,
        float contentMaxWidth,
        float contentMaxHeight)
    {
        bool row = parentStyle.Direction == UiAxis.Row;
        UiLength mainLength = row ? childStyle.Width : childStyle.Height;
        float mainMax = row ? contentMaxWidth : contentMaxHeight;
        float crossMax = row ? contentMaxHeight : contentMaxWidth;
        float mainMin = 0.0f;

        if (IsAutoLength(mainLength) &&
            TryResolveLength(childStyle.Basis, mainMax, row ? Viewport.Width : Viewport.Height, out float basis))
        {
            mainMin = MathF.Max(0.0f, basis);
            mainMax = mainMin;
        }

        return row
            ? new UiMeasureConstraints(mainMin, 0.0f, mainMax, crossMax)
            : new UiMeasureConstraints(0.0f, mainMin, crossMax, mainMax);
    }

    private UiMeasureConstraints BuildAbsoluteConstraints(in UiLayoutStyle style, float contentMaxWidth, float contentMaxHeight)
    {
        float minWidth = 0.0f;
        float maxWidth = contentMaxWidth;
        float minHeight = 0.0f;
        float maxHeight = contentMaxHeight;

        if (IsAutoLength(style.Width) &&
            float.IsFinite(contentMaxWidth) &&
            TryResolveInset(style.InsetLeft, contentMaxWidth, Viewport.Width, out float left) &&
            TryResolveInset(style.InsetRight, contentMaxWidth, Viewport.Width, out float right))
        {
            minWidth = MathF.Max(0.0f, contentMaxWidth - left - right);
            maxWidth = minWidth;
        }

        if (IsAutoLength(style.Height) &&
            float.IsFinite(contentMaxHeight) &&
            TryResolveInset(style.InsetTop, contentMaxHeight, Viewport.Height, out float top) &&
            TryResolveInset(style.InsetBottom, contentMaxHeight, Viewport.Height, out float bottom))
        {
            minHeight = MathF.Max(0.0f, contentMaxHeight - top - bottom);
            maxHeight = minHeight;
        }

        return new UiMeasureConstraints(minWidth, minHeight, maxWidth, maxHeight);
    }

    private UiSize GetOrMeasureSize(
        IUiLayoutTree tree,
        UiNodeId id,
        IUiLayoutNode layoutNode,
        float maxWidth,
        float maxHeight)
    {
        if (_cache.TryGetComplete(id.Value, out UiMeasureResult cached))
        {
            return cached.Size;
        }

        UiMeasureResult measured = MeasureNode(
            tree,
            id,
            layoutNode,
            new UiMeasureConstraints(0.0f, 0.0f, maxWidth, maxHeight));
        return measured.Size;
    }

    private void RemeasureTight(IUiLayoutTree tree, UiNodeId id, IUiLayoutNode layoutNode, in Rect bounds)
    {
        _cache.Clear();
        MeasureNode(
            tree,
            id,
            layoutNode,
            new UiMeasureConstraints(bounds.Width, bounds.Height, bounds.Width, bounds.Height));
    }

    private static bool TryResolveLength(UiLength length, float available, float viewportExtent, out float value)
    {
        switch (length.Kind)
        {
            case UiLengthKind.Px:
                value = MathF.Max(0.0f, length.Value);
                return true;
            case UiLengthKind.Percent:
                if (float.IsFinite(available))
                {
                    value = MathF.Max(0.0f, available * length.Value * 0.01f);
                    return true;
                }

                break;
            case UiLengthKind.Stretch:
                if (float.IsFinite(available))
                {
                    value = MathF.Max(0.0f, available);
                    return true;
                }

                break;
            case UiLengthKind.Viewport:
                value = MathF.Max(0.0f, viewportExtent * length.Value * 0.01f);
                return true;
            case UiLengthKind.Auto:
            case UiLengthKind.Content:
            default:
                break;
        }

        value = 0.0f;
        return false;
    }

    private static bool TryResolveInset(UiLength length, float available, float viewportExtent, out float value)
    {
        if (length.Kind == UiLengthKind.Auto)
        {
            value = 0.0f;
            return false;
        }

        return TryResolveLength(length, available, viewportExtent, out value);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsAutoLength(UiLength length) =>
        length.Kind is UiLengthKind.Auto or UiLengthKind.Content;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float SubtractInsets(float extent, float insets) =>
        float.IsFinite(extent) ? MathF.Max(0.0f, extent - insets) : extent;

    private static float ClampDimension(float value, float styleMin, float styleMax, float constraintMin, float constraintMax)
    {
        // Zero/negative style maxima mean "unbounded"; only a positive value is
        // a real limit, so a default-constructed style does not collapse to 0.
        float styleMaximum = styleMax > 0.0f ? styleMax : float.PositiveInfinity;
        float minimum = MathF.Max(0.0f, MathF.Max(styleMin, constraintMin));
        float maximum = MathF.Min(styleMaximum, constraintMax);
        if (maximum < minimum)
        {
            maximum = minimum;
        }

        if (!float.IsFinite(value))
        {
            value = maximum;
        }

        return MathF.Max(minimum, MathF.Min(value, maximum));
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static UiAlign EffectiveAlign(UiAlignSelf alignSelf, UiAlign fallback) => alignSelf switch
    {
        UiAlignSelf.Start => UiAlign.Start,
        UiAlignSelf.Center => UiAlign.Center,
        UiAlignSelf.End => UiAlign.End,
        UiAlignSelf.Stretch => UiAlign.Stretch,
        _ => fallback,
    };

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossCoordinate(in Rect rect, bool row) => row ? rect.Y : rect.X;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainSize(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Size.Width : measurement.Size.Height;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossSize(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Size.Height : measurement.Size.Width;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainStartMargin(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Margin.Left : measurement.Margin.Top;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainEndMargin(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Margin.Right : measurement.Margin.Bottom;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossStartMargin(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Margin.Top : measurement.Margin.Left;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float CrossEndMargin(in UiChildMeasurement measurement, bool row) =>
        row ? measurement.Margin.Bottom : measurement.Margin.Right;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float MainExtent(in UiChildMeasurement measurement, bool row) =>
        MainStartMargin(in measurement, row) + MainSize(in measurement, row) + MainEndMargin(in measurement, row);

    private static UiChildMeasurement WithMainSize(in UiChildMeasurement measurement, bool row, float size)
    {
        UiSize current = measurement.Size;
        UiSize updated = row
            ? new UiSize(MathF.Max(0.0f, size), current.Height)
            : new UiSize(current.Width, MathF.Max(0.0f, size));
        return measurement with { Size = updated };
    }

    private static UiMeasureResult MeasurePolicy(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children) =>
        TPolicy.Measure(in context, in style, children);

    private static void ArrangePolicy(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children,
        Span<Rect> childBounds) =>
        TPolicy.Arrange(in context, in style, children, childBounds);

    private void EnsureScratch(int childCount)
    {
        if (childCount <= _measurements.Length)
        {
            return;
        }

        int capacity = _measurements.Length;
        while (capacity < childCount)
        {
            capacity *= 2;
        }

        _measurements = new UiChildMeasurement[capacity];
        _styles = new UiLayoutStyle[capacity];
        _childIds = new UiNodeId[capacity];
        _childBounds = new Rect[capacity];
        _flowToChild = new int[capacity];
        _absoluteToChild = new int[capacity];
    }
}

/// <summary>Layout engine with the default <see cref="UiFlexLayoutPolicy"/>.</summary>
public sealed class UiLayoutEngine : IUiLayoutEngine
{
    private readonly UiLayoutEngine<UiFlexLayoutPolicy> _engine = new();

    /// <summary>Gets or sets the viewport used to resolve viewport-relative lengths.</summary>
    public UiViewport Viewport
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _engine.Viewport;
        set => _engine.Viewport = value;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public UiMeasureResult Measure(IUiLayoutTree tree, UiNodeId node, in UiMeasureConstraints constraints) =>
        _engine.Measure(tree, node, in constraints);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Arrange(IUiLayoutTree tree, UiNodeId node, in Rect bounds, IUiLayoutSink sink) =>
        _engine.Arrange(tree, node, in bounds, sink);
}
