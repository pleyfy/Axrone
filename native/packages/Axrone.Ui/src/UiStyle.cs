namespace Axrone.Ui;

/// <summary>Resolved widget style consumed by style sources and render builders.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiWidgetStyle(
    bool Visible,
    float Opacity,
    bool Clip,
    UiColor Background,
    UiColor BorderColor,
    float BorderWidth,
    UiCornerRadii Radius,
    UiColor TextColor)
{
    /// <summary>Gets the neutral visible style.</summary>
    public static UiWidgetStyle Default => new(
        true,
        1.0f,
        false,
        UiColor.Transparent,
        UiColor.Transparent,
        0.0f,
        UiCornerRadii.Zero,
        UiColor.Black);
}

/// <summary>Kind of value stored by a theme token.</summary>
public enum UiThemeTokenKind
{
    /// <summary>RGBA color token.</summary>
    Color,

    /// <summary>Scalar number token.</summary>
    Number,
}

/// <summary>One theme token value.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiThemeToken(
    UiThemeTokenId Id,
    UiThemeTokenKind Kind,
    UiColor Color,
    float Number);

/// <summary>Theme lookup contract.</summary>
public interface IUiTheme
{
    /// <summary>Looks up a color token.</summary>
    bool TryGetColor(UiThemeTokenId token, out UiColor color);

    /// <summary>Looks up a numeric token.</summary>
    bool TryGetNumber(UiThemeTokenId token, out float value);
}

/// <summary>Resolved-style source for a node.</summary>
public interface IUiStyleSource
{
    /// <summary>Resolves the style of one node.</summary>
    bool TryGetStyle(UiNodeId node, out UiWidgetStyle style);
}
