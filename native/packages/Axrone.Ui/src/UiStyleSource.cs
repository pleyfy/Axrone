namespace Axrone.Ui;

/// <summary>
/// Per-node style override. Literal values win over inherited values; a valid
/// theme token wins over the literal of the same channel so a theme swap
/// re-colors every node that referenced it.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiStylePatch
{
    /// <summary>Gets the visibility override; visibility is inherited.</summary>
    public bool? Visible { get; init; }

    /// <summary>Gets the clip override.</summary>
    public bool? Clip { get; init; }

    /// <summary>Gets the opacity override; opacity multiplies down the tree.</summary>
    public float? Opacity { get; init; }

    /// <summary>Gets the opacity token.</summary>
    public UiThemeTokenId OpacityToken { get; init; }

    /// <summary>Gets the border width override.</summary>
    public float? BorderWidth { get; init; }

    /// <summary>Gets the border width token.</summary>
    public UiThemeTokenId BorderWidthToken { get; init; }

    /// <summary>Gets the background color override.</summary>
    public UiColor? Background { get; init; }

    /// <summary>Gets the background color token.</summary>
    public UiThemeTokenId BackgroundToken { get; init; }

    /// <summary>Gets the border color override.</summary>
    public UiColor? BorderColor { get; init; }

    /// <summary>Gets the border color token.</summary>
    public UiThemeTokenId BorderColorToken { get; init; }

    /// <summary>Gets the text color override; text color is inherited.</summary>
    public UiColor? TextColor { get; init; }

    /// <summary>Gets the text color token.</summary>
    public UiThemeTokenId TextColorToken { get; init; }

    /// <summary>Gets the corner radius override.</summary>
    public UiCornerRadii? Radius { get; init; }
}

/// <summary>
/// Resolves <see cref="UiWidgetStyle"/> per node from a default style, optional
/// theme tokens and per-node patches. Visibility, opacity and text color
/// inherit through the node's parent chain; the remaining channels reset to the
/// default style.
/// </summary>
/// <remarks>
/// Resolved styles are cached per node and the cache is dropped whenever the
/// default style, theme or a patch changes. Lookups are allocation-free once
/// the ancestor buffer and cache have warmed up.
/// </remarks>
public sealed class UiStyleSource : IUiStyleSource
{
    private readonly IUiNodeTree _nodes;
    private readonly Dictionary<UiNodeId, UiStylePatch> _patches = new();
    private readonly Dictionary<UiNodeId, UiWidgetStyle> _cache = new();
    private UiNodeId[] _ancestors = new UiNodeId[16];
    private UiWidgetStyle _defaultStyle = UiWidgetStyle.Default;

    /// <summary>Creates a style source over a node tree.</summary>
    /// <param name="nodes">Document node tree used for inheritance.</param>
    /// <param name="theme">Optional theme token table.</param>
    public UiStyleSource(IUiNodeTree nodes, IUiTheme? theme = null)
    {
        ArgumentNullException.ThrowIfNull(nodes);
        _nodes = nodes;
        Theme = theme;
    }

    /// <summary>Gets the theme token table; may be null.</summary>
    public IUiTheme? Theme { get; }

    /// <summary>Gets or sets the base style of every node.</summary>
    public UiWidgetStyle DefaultStyle
    {
        get => _defaultStyle;
        set
        {
            _defaultStyle = value;
            _cache.Clear();
        }
    }

    /// <summary>Sets or replaces the patch of one node.</summary>
    public void SetPatch(UiNodeId node, in UiStylePatch patch)
    {
        _patches[node] = patch;
        _cache.Clear();
    }

    /// <summary>Removes the patch of one node.</summary>
    public bool RemovePatch(UiNodeId node)
    {
        bool removed = _patches.Remove(node);
        if (removed)
        {
            _cache.Clear();
        }

        return removed;
    }

    /// <summary>Removes every patch.</summary>
    public void ClearPatches()
    {
        _patches.Clear();
        _cache.Clear();
    }

    /// <summary>Drops every resolved style; call after mutating the tree.</summary>
    public void Invalidate() => _cache.Clear();

    /// <inheritdoc/>
    public bool TryGetStyle(UiNodeId node, out UiWidgetStyle style)
    {
        if (!_nodes.TryGetNode(node, out _))
        {
            style = default;
            return false;
        }

        if (_cache.TryGetValue(node, out style))
        {
            return true;
        }

        int depth = 0;
        UiNodeId cursor = node;
        while (cursor.IsValid)
        {
            EnsureAncestorCapacity(depth + 1);
            _ancestors[depth++] = cursor;
            if (!_nodes.TryGetNode(cursor, out UiNodeRecord record))
            {
                break;
            }

            cursor = record.Parent;
        }

        UiWidgetStyle resolved = _defaultStyle;
        for (int i = depth - 1; i >= 0; i--)
        {
            if (_patches.TryGetValue(_ancestors[i], out UiStylePatch patch))
            {
                resolved = Apply(in resolved, in patch);
            }
            else
            {
                resolved = Apply(in resolved, default);
            }
        }

        _cache[node] = resolved;
        style = resolved;
        return true;
    }

    private UiWidgetStyle Apply(in UiWidgetStyle parent, in UiStylePatch patch)
    {
        bool visible = parent.Visible && (patch.Visible ?? true);
        float opacity = parent.Opacity;
        if (TryResolveNumber(patch.OpacityToken, patch.Opacity, out float patchOpacity))
        {
            opacity *= patchOpacity;
        }

        UiColor textColor = TryResolveColor(patch.TextColorToken, patch.TextColor, parent.TextColor, out UiColor resolvedText)
            ? resolvedText
            : parent.TextColor;

        return new UiWidgetStyle(
            visible,
            opacity,
            patch.Clip ?? _defaultStyle.Clip,
            ResolveColorOr(patch.BackgroundToken, patch.Background, _defaultStyle.Background),
            ResolveColorOr(patch.BorderColorToken, patch.BorderColor, _defaultStyle.BorderColor),
            ResolveNumberOr(patch.BorderWidthToken, patch.BorderWidth, _defaultStyle.BorderWidth),
            patch.Radius ?? _defaultStyle.Radius,
            textColor);
    }

    private bool TryResolveColor(UiThemeTokenId token, UiColor? literal, UiColor fallback, out UiColor value)
    {
        if (token.IsValid && Theme is not null && Theme.TryGetColor(token, out value))
        {
            return true;
        }

        if (literal.HasValue)
        {
            value = literal.Value;
            return true;
        }

        value = fallback;
        return false;
    }

    private UiColor ResolveColorOr(UiThemeTokenId token, UiColor? literal, UiColor fallback) =>
        TryResolveColor(token, literal, fallback, out UiColor value) ? value : fallback;

    private bool TryResolveNumber(UiThemeTokenId token, float? literal, out float value)
    {
        if (token.IsValid && Theme is not null && Theme.TryGetNumber(token, out value))
        {
            return true;
        }

        if (literal.HasValue)
        {
            value = literal.Value;
            return true;
        }

        value = 0.0f;
        return false;
    }

    private float ResolveNumberOr(UiThemeTokenId token, float? literal, float fallback) =>
        TryResolveNumber(token, literal, out float value) ? value : fallback;

    private void EnsureAncestorCapacity(int needed)
    {
        if (needed > _ancestors.Length)
        {
            int capacity = _ancestors.Length;
            while (capacity < needed)
            {
                capacity *= 2;
            }

            _ancestors = new UiNodeId[capacity];
        }
    }
}
