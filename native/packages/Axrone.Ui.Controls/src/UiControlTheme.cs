namespace Axrone.Ui.Controls;

using Axrone.Ui;

/// <summary>
/// Theme token identities consumed by every control style. Resolve them through
/// <see cref="UiControlTheme.CreateDefaultTheme"/> or any <see cref="IUiTheme"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiControlTheme(
    UiThemeTokenId Background,
    UiThemeTokenId BackgroundHover,
    UiThemeTokenId BackgroundPressed,
    UiThemeTokenId BackgroundDisabled,
    UiThemeTokenId Border,
    UiThemeTokenId BorderFocused,
    UiThemeTokenId TextColor,
    UiThemeTokenId TextColorDisabled,
    UiThemeTokenId Accent,
    UiThemeTokenId Surface,
    UiThemeTokenId Height,
    UiThemeTokenId Radius,
    UiThemeTokenId BorderWidth,
    UiThemeTokenId FontSize,
    UiThemeTokenId RowHeight)
{
    /// <summary>Gets the default token map (identities 1 through 15).</summary>
    public static UiControlTheme Default => new(
        new UiThemeTokenId(1),
        new UiThemeTokenId(2),
        new UiThemeTokenId(3),
        new UiThemeTokenId(4),
        new UiThemeTokenId(5),
        new UiThemeTokenId(6),
        new UiThemeTokenId(7),
        new UiThemeTokenId(8),
        new UiThemeTokenId(9),
        new UiThemeTokenId(10),
        new UiThemeTokenId(11),
        new UiThemeTokenId(12),
        new UiThemeTokenId(13),
        new UiThemeTokenId(14),
        new UiThemeTokenId(15));

    /// <summary>Builds the dark default theme for <see cref="Default"/>.</summary>
    public static UiTheme CreateDefaultTheme() => new UiThemeBuilder()
        .AddColor(new UiThemeTokenId(1), new UiColor(0.05f, 0.09f, 0.16f, 1.0f))
        .AddColor(new UiThemeTokenId(2), new UiColor(0.11f, 0.17f, 0.27f, 1.0f))
        .AddColor(new UiThemeTokenId(3), new UiColor(0.06f, 0.10f, 0.17f, 1.0f))
        .AddColor(new UiThemeTokenId(4), new UiColor(0.07f, 0.12f, 0.20f, 0.6f))
        .AddColor(new UiThemeTokenId(5), new UiColor(0.85f, 0.90f, 1.00f, 0.15f))
        .AddColor(new UiThemeTokenId(6), new UiColor(0.38f, 0.65f, 0.98f, 1.0f))
        .AddColor(new UiThemeTokenId(7), new UiColor(0.97f, 0.98f, 1.00f, 1.0f))
        .AddColor(new UiThemeTokenId(8), new UiColor(0.55f, 0.62f, 0.72f, 1.0f))
        .AddColor(new UiThemeTokenId(9), new UiColor(0.15f, 0.39f, 0.92f, 1.0f))
        .AddColor(new UiThemeTokenId(10), new UiColor(0.07f, 0.13f, 0.22f, 1.0f))
        .AddNumber(new UiThemeTokenId(11), 36.0f)
        .AddNumber(new UiThemeTokenId(12), 8.0f)
        .AddNumber(new UiThemeTokenId(13), 1.0f)
        .AddNumber(new UiThemeTokenId(14), 15.0f)
        .AddNumber(new UiThemeTokenId(15), 28.0f)
        .Build();
}

/// <summary>Theme lookup bundle handed to control behaviors.</summary>
internal readonly struct ControlStyleContext
{
    private readonly IUiTheme? _theme;

    public ControlStyleContext(IUiTheme? theme, in UiControlTheme tokens)
    {
        _theme = theme;
        Tokens = tokens;
    }

    public UiControlTheme Tokens { get; }

    public UiColor Color(UiThemeTokenId token, UiColor fallback) =>
        _theme is not null && _theme.TryGetColor(token, out UiColor value) ? value : fallback;

    public float Number(UiThemeTokenId token, float fallback) =>
        _theme is not null && _theme.TryGetNumber(token, out float value) ? value : fallback;
}
