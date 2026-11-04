namespace Axrone.Ui.Controls;

using Axrone.Ui;

/// <summary>Shared state-to-style projection for control behaviors.</summary>
internal static class ControlStyles
{
    private static readonly UiColor Transparent = UiColor.Transparent;

    internal static UiControlState StateOf(in ControlEntry entry) =>
        entry.Disabled
            ? UiControlState.Disabled
            : entry.Pressed
                ? UiControlState.Pressed
                : entry.PointerInside
                    ? UiControlState.Hover
                    : UiControlState.Normal;

    internal static UiCornerRadii Radius(in ControlStyleContext style)
    {
        float radius = MathF.Max(0.0f, style.Number(style.Tokens.Radius, 8.0f));
        return new UiCornerRadii(radius, radius, radius, radius);
    }

    internal static float BorderWidth(in ControlStyleContext style) =>
        MathF.Max(0.0f, style.Number(style.Tokens.BorderWidth, 1.0f));

    internal static UiStylePatch Interactive(in ControlStyleContext style, in ControlEntry entry, bool accentWhenChecked)
    {
        UiControlState state = StateOf(entry);
        UiVariantPalette palette = style.Palette(entry.Variant);
        UiColor background = state switch
        {
            UiControlState.Disabled => style.Color(style.Tokens.BackgroundDisabled, new UiColor(0.07f, 0.12f, 0.20f, 0.6f)),
            UiControlState.Pressed => palette.Pressed,
            UiControlState.Hover => palette.Hover,
            _ => palette.Idle,
        };
        if (accentWhenChecked && entry.Checked && state != UiControlState.Disabled)
        {
            background = entry.Variant == UiControlVariant.Neutral
                ? style.Color(style.Tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f))
                : palette.Idle;
        }

        return new UiStylePatch
        {
            Visible = true,
            Background = background,
            BorderColor = entry.Focused
                ? style.Color(style.Tokens.BorderFocused, new UiColor(0.38f, 0.65f, 0.98f, 1.0f))
                : palette.Border,
            BorderWidth = BorderWidth(in style),
            Radius = Radius(in style),
            TextColor = state == UiControlState.Disabled
                ? style.Color(style.Tokens.TextColorDisabled, new UiColor(0.55f, 0.62f, 0.72f, 1.0f))
                : palette.Text,
        };
    }

    internal static UiStylePatch Surface(in ControlStyleContext style, in ControlEntry entry) =>
        new()
        {
            Visible = true,
            Background = style.Color(style.Tokens.Surface, new UiColor(0.07f, 0.13f, 0.22f, 1.0f)),
            BorderColor = entry.Focused
                ? style.Color(style.Tokens.BorderFocused, new UiColor(0.38f, 0.65f, 0.98f, 1.0f))
                : style.Color(style.Tokens.Border, new UiColor(0.85f, 0.90f, 1.00f, 0.15f)),
            BorderWidth = BorderWidth(in style),
            Radius = Radius(in style),
            TextColor = style.Color(style.Tokens.TextColor, UiColor.White),
        };

    internal static UiStylePatch Text(in ControlStyleContext style, in ControlEntry entry) =>
        new()
        {
            Visible = true,
            Background = Transparent,
            TextColor = entry.Disabled
                ? style.Color(style.Tokens.TextColorDisabled, new UiColor(0.55f, 0.62f, 0.72f, 1.0f))
                : style.Color(style.Tokens.TextColor, UiColor.White),
        };

    internal static UiStylePatch Accent(in ControlStyleContext style, in ControlEntry entry)
    {
        UiVariantPalette palette = entry.Variant == UiControlVariant.Neutral
            ? new UiVariantPalette(
                style.Color(style.Tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f)),
                style.Color(style.Tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f)),
                style.Color(style.Tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f)),
                style.Color(style.Tokens.TextColor, UiColor.White),
                style.Color(style.Tokens.Border, new UiColor(0.85f, 0.90f, 1.00f, 0.15f)))
            : style.Palette(entry.Variant);
        return new UiStylePatch
        {
            Visible = true,
            Background = entry.Disabled
                ? style.Color(style.Tokens.BackgroundDisabled, new UiColor(0.07f, 0.12f, 0.20f, 0.6f))
                : palette.Idle,
            BorderColor = palette.Border,
            BorderWidth = BorderWidth(in style),
            Radius = Radius(in style),
            TextColor = palette.Text,
        };
    }
}

/// <summary>Key codes consumed by the built-in behaviors.</summary>
internal static class ControlKeys
{
    internal const ushort Backspace = 8;
    internal const ushort Tab = 9;
    internal const ushort Enter = 13;
    internal const ushort Escape = 27;
    internal const ushort Space = 32;
    internal const ushort End = 35;
    internal const ushort Home = 36;
    internal const ushort Left = 37;
    internal const ushort Up = 38;
    internal const ushort Right = 39;
    internal const ushort Down = 40;
    internal const ushort Delete = 46;
    internal const ushort PageUp = 33;
    internal const ushort PageDown = 34;
}
