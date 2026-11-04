namespace Axrone.Ui.Controls;

using Axrone.Ui;

/// <summary>Control emphasis variant selecting a themed palette.</summary>
public enum UiControlVariant : byte
{
    /// <summary>Surface-emphasis default; matches the historical control look.</summary>
    Neutral = 0,

    /// <summary>Accent-emphasis primary action.</summary>
    Primary = 1,

    /// <summary>Affirmative success action.</summary>
    Success = 2,

    /// <summary>Cautionary warning action.</summary>
    Warning = 3,

    /// <summary>Destructive danger action.</summary>
    Danger = 4,
}

/// <summary>State colors resolved for one control variant; all values are theme-driven.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiVariantPalette(
    UiColor Idle,
    UiColor Hover,
    UiColor Pressed,
    UiColor Text,
    UiColor Border);

/// <summary>
/// Token identities for the non-neutral variant palettes. The default identities
/// (16-34) are appended to the built-in token table, so serialized themes using
/// identities 1-15 keep their meaning.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiControlVariantTokens(
    UiThemeTokenId PrimaryHover,
    UiThemeTokenId PrimaryPressed,
    UiThemeTokenId PrimaryText,
    UiThemeTokenId PrimaryBorder,
    UiThemeTokenId SuccessIdle,
    UiThemeTokenId SuccessHover,
    UiThemeTokenId SuccessPressed,
    UiThemeTokenId SuccessText,
    UiThemeTokenId SuccessBorder,
    UiThemeTokenId WarningIdle,
    UiThemeTokenId WarningHover,
    UiThemeTokenId WarningPressed,
    UiThemeTokenId WarningText,
    UiThemeTokenId WarningBorder,
    UiThemeTokenId DangerIdle,
    UiThemeTokenId DangerHover,
    UiThemeTokenId DangerPressed,
    UiThemeTokenId DangerText,
    UiThemeTokenId DangerBorder)
{
    /// <summary>Gets the default variant token map (identities 16 through 34).</summary>
    public static UiControlVariantTokens Default => new(
        new UiThemeTokenId(16),
        new UiThemeTokenId(17),
        new UiThemeTokenId(18),
        new UiThemeTokenId(19),
        new UiThemeTokenId(20),
        new UiThemeTokenId(21),
        new UiThemeTokenId(22),
        new UiThemeTokenId(23),
        new UiThemeTokenId(24),
        new UiThemeTokenId(25),
        new UiThemeTokenId(26),
        new UiThemeTokenId(27),
        new UiThemeTokenId(28),
        new UiThemeTokenId(29),
        new UiThemeTokenId(30),
        new UiThemeTokenId(31),
        new UiThemeTokenId(32),
        new UiThemeTokenId(33),
        new UiThemeTokenId(34));
}

/// <summary>Resolves theme scale factors and variant palettes for controls.</summary>
public static class UiControlThemeResolver
{
    /// <summary>Gets the reference control height for scale resolution.</summary>
    public const float DefaultControlHeight = 36.0f;

    /// <summary>Gets the smallest allowed theme scale.</summary>
    public const float MinimumScale = 0.5f;

    /// <summary>
    /// Resolves the theme scale factor, mirroring TypeScript
    /// <c>resolveThemeScale = max(controlHeight / reference, 0.5)</c>.
    /// Missing, non-positive or NaN heights resolve to the minimum scale;
    /// there is no upper clamp.
    /// </summary>
    /// <param name="theme">Theme token table; may be null.</param>
    /// <param name="tokens">Token identity map.</param>
    /// <param name="referenceHeight">Height that maps to scale 1; must be positive.</param>
    /// <returns>The resolved scale factor.</returns>
    public static float ResolveThemeScale(IUiTheme? theme, in UiControlTheme tokens, float referenceHeight = DefaultControlHeight)
    {
        if (referenceHeight <= 0.0f)
        {
            return MinimumScale;
        }

        float height = theme is not null && theme.TryGetNumber(tokens.Height, out float value) && value > 0.0f
            ? value
            : referenceHeight;
        float scale = height / referenceHeight;
        return scale >= MinimumScale ? scale : MinimumScale;
    }

    /// <summary>
    /// Resolves the state palette of one control variant, mirroring TypeScript
    /// <c>resolveVariantPalette</c>. <see cref="UiControlVariant.Neutral"/> and
    /// unknown values map to the surface tokens, preserving historical colors;
    /// other variants resolve through appended theme tokens.
    /// </summary>
    /// <param name="theme">Theme token table; may be null.</param>
    /// <param name="tokens">Token identity map, including variant tokens.</param>
    /// <param name="variant">Control emphasis variant.</param>
    /// <returns>The resolved palette.</returns>
    public static UiVariantPalette ResolveVariantPalette(IUiTheme? theme, in UiControlTheme tokens, UiControlVariant variant)
    {
        UiControlVariantTokens variants = tokens.Variants;
        switch (variant)
        {
            case UiControlVariant.Primary:
                return new UiVariantPalette(
                    Color(theme, tokens.Accent, DefaultTheme.Accent),
                    Color(theme, variants.PrimaryHover, DefaultTheme.PrimaryHover),
                    Color(theme, variants.PrimaryPressed, DefaultTheme.PrimaryPressed),
                    Color(theme, variants.PrimaryText, DefaultTheme.VariantText),
                    Color(theme, variants.PrimaryBorder, DefaultTheme.PrimaryBorder));
            case UiControlVariant.Success:
                return new UiVariantPalette(
                    Color(theme, variants.SuccessIdle, DefaultTheme.SuccessIdle),
                    Color(theme, variants.SuccessHover, DefaultTheme.SuccessHover),
                    Color(theme, variants.SuccessPressed, DefaultTheme.SuccessPressed),
                    Color(theme, variants.SuccessText, DefaultTheme.VariantText),
                    Color(theme, variants.SuccessBorder, DefaultTheme.SuccessBorder));
            case UiControlVariant.Warning:
                return new UiVariantPalette(
                    Color(theme, variants.WarningIdle, DefaultTheme.WarningIdle),
                    Color(theme, variants.WarningHover, DefaultTheme.WarningHover),
                    Color(theme, variants.WarningPressed, DefaultTheme.WarningPressed),
                    Color(theme, variants.WarningText, DefaultTheme.WarningText),
                    Color(theme, variants.WarningBorder, DefaultTheme.WarningBorder));
            case UiControlVariant.Danger:
                return new UiVariantPalette(
                    Color(theme, variants.DangerIdle, DefaultTheme.DangerIdle),
                    Color(theme, variants.DangerHover, DefaultTheme.DangerHover),
                    Color(theme, variants.DangerPressed, DefaultTheme.DangerPressed),
                    Color(theme, variants.DangerText, DefaultTheme.VariantText),
                    Color(theme, variants.DangerBorder, DefaultTheme.DangerBorder));
            default:
                return new UiVariantPalette(
                    Color(theme, tokens.Background, DefaultTheme.Background),
                    Color(theme, tokens.BackgroundHover, DefaultTheme.BackgroundHover),
                    Color(theme, tokens.BackgroundPressed, DefaultTheme.BackgroundPressed),
                    Color(theme, tokens.TextColor, DefaultTheme.Text),
                    Color(theme, tokens.Border, DefaultTheme.Border));
        }
    }

    private static UiColor Color(IUiTheme? theme, UiThemeTokenId token, in UiColor fallback) =>
        theme is not null && theme.TryGetColor(token, out UiColor value) ? value : fallback;

    /// <summary>Default palette colors used when a theme omits a variant token.</summary>
    internal static class DefaultTheme
    {
        internal static readonly UiColor Background = new(0.05f, 0.09f, 0.16f, 1.0f);
        internal static readonly UiColor BackgroundHover = new(0.11f, 0.17f, 0.27f, 1.0f);
        internal static readonly UiColor BackgroundPressed = new(0.06f, 0.10f, 0.17f, 1.0f);
        internal static readonly UiColor Text = UiColor.White;
        internal static readonly UiColor Border = new(0.85f, 0.90f, 1.00f, 0.15f);
        internal static readonly UiColor Accent = new(0.15f, 0.39f, 0.92f, 1.0f);
        internal static readonly UiColor VariantText = new(0.97f, 0.98f, 1.00f, 1.0f);
        internal static readonly UiColor PrimaryHover = new(0.23f, 0.51f, 0.96f, 1.0f);
        internal static readonly UiColor PrimaryPressed = new(0.11f, 0.30f, 0.84f, 1.0f);
        internal static readonly UiColor PrimaryBorder = new(0.58f, 0.77f, 0.99f, 0.53f);
        internal static readonly UiColor SuccessIdle = new(0.13f, 0.77f, 0.37f, 1.0f);
        internal static readonly UiColor SuccessHover = new(0.29f, 0.87f, 0.50f, 1.0f);
        internal static readonly UiColor SuccessPressed = new(0.09f, 0.64f, 0.29f, 1.0f);
        internal static readonly UiColor SuccessBorder = new(0.53f, 0.94f, 0.67f, 0.67f);
        internal static readonly UiColor WarningIdle = new(0.96f, 0.62f, 0.04f, 1.0f);
        internal static readonly UiColor WarningHover = new(0.98f, 0.75f, 0.14f, 1.0f);
        internal static readonly UiColor WarningPressed = new(0.85f, 0.47f, 0.02f, 1.0f);
        internal static readonly UiColor WarningText = new(0.08f, 0.05f, 0.01f, 1.0f);
        internal static readonly UiColor WarningBorder = new(0.99f, 0.83f, 0.30f, 0.67f);
        internal static readonly UiColor DangerIdle = new(0.94f, 0.27f, 0.27f, 1.0f);
        internal static readonly UiColor DangerHover = new(0.97f, 0.44f, 0.44f, 1.0f);
        internal static readonly UiColor DangerPressed = new(0.86f, 0.15f, 0.15f, 1.0f);
        internal static readonly UiColor DangerBorder = new(0.99f, 0.65f, 0.65f, 0.67f);
    }
}
