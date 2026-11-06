namespace Axrone.Ui.Controls.Tests;

using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class ThemeVariantScaleTests
{
    private static readonly UiTheme DefaultTheme = UiControlTheme.CreateDefaultTheme();

    [Fact]
    public void ResolveThemeScaleMatchesReferenceRatioAndClamp()
    {
        var tokens = UiControlTheme.Default;
        UiControlThemeResolver.ResolveThemeScale(DefaultTheme, in tokens).Should().Be(1.0f);

        UiTheme doubled = new UiThemeBuilder()
            .AddNumber(tokens.Height, 72.0f)
            .Build();
        UiControlThemeResolver.ResolveThemeScale(doubled, in tokens).Should().Be(2.0f);

        UiTheme tiny = new UiThemeBuilder()
            .AddNumber(tokens.Height, 10.0f)
            .Build();
        UiControlThemeResolver.ResolveThemeScale(tiny, in tokens).Should().Be(UiControlThemeResolver.MinimumScale);

        UiTheme broken = new UiThemeBuilder()
            .AddNumber(tokens.Height, float.NaN)
            .Build();
        float scale = UiControlThemeResolver.ResolveThemeScale(broken, in tokens);
        float.IsFinite(scale).Should().BeTrue();
        scale.Should().BeGreaterThanOrEqualTo(UiControlThemeResolver.MinimumScale);

        UiControlThemeResolver.ResolveThemeScale(null, in tokens).Should().Be(1.0f);
        UiControlThemeResolver.ResolveThemeScale(DefaultTheme, in tokens, referenceHeight: 0.0f)
            .Should().Be(UiControlThemeResolver.MinimumScale);
    }

    [Fact]
    public void VariantPaletteResolutionIsDeterministic()
    {
        var tokens = UiControlTheme.Default;
        for (int run = 0; run < 8; run++)
        {
            UiVariantPalette primary = UiControlThemeResolver.ResolveVariantPalette(DefaultTheme, in tokens, UiControlVariant.Primary);
            UiVariantPalette danger = UiControlThemeResolver.ResolveVariantPalette(DefaultTheme, in tokens, UiControlVariant.Danger);
            primary.Idle.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));
            primary.Hover.Should().Be(new UiColor(0.23f, 0.51f, 0.96f, 1.0f));
            primary.Pressed.Should().Be(new UiColor(0.11f, 0.30f, 0.84f, 1.0f));
            primary.Text.Should().Be(new UiColor(0.97f, 0.98f, 1.00f, 1.0f));
            primary.Border.Should().Be(new UiColor(0.58f, 0.77f, 0.99f, 0.53f));
            danger.Idle.Should().Be(new UiColor(0.94f, 0.27f, 0.27f, 1.0f));
            danger.Text.Should().Be(new UiColor(0.97f, 0.98f, 1.00f, 1.0f));
        }
    }

    [Fact]
    public void NeutralAndUnknownVariantsFallBackToSurfaceTokens()
    {
        var tokens = UiControlTheme.Default;
        UiVariantPalette neutral = UiControlThemeResolver.ResolveVariantPalette(DefaultTheme, in tokens, UiControlVariant.Neutral);
        UiVariantPalette unknown = UiControlThemeResolver.ResolveVariantPalette(DefaultTheme, in tokens, (UiControlVariant)200);
        neutral.Should().Be(unknown);
        neutral.Idle.Should().Be(new UiColor(0.05f, 0.09f, 0.16f, 1.0f));
        neutral.Hover.Should().Be(new UiColor(0.11f, 0.17f, 0.27f, 1.0f));
        neutral.Pressed.Should().Be(new UiColor(0.06f, 0.10f, 0.17f, 1.0f));
        neutral.Text.Should().Be(new UiColor(0.97f, 0.98f, 1.00f, 1.0f));
        neutral.Border.Should().Be(new UiColor(0.85f, 0.90f, 1.00f, 0.15f));
    }

    [Fact]
    public void MissingThemeFallsBackToDefaultPaletteColors()
    {
        var tokens = UiControlTheme.Default;
        UiVariantPalette success = UiControlThemeResolver.ResolveVariantPalette(null, in tokens, UiControlVariant.Success);
        success.Idle.Should().Be(new UiColor(0.13f, 0.77f, 0.37f, 1.0f));
        success.Border.Should().Be(new UiColor(0.53f, 0.94f, 0.67f, 0.67f));
    }

    [Fact]
    public void TokenOverridesWinForVariantPalettes()
    {
        var tokens = UiControlTheme.Default;
        UiTheme custom = new UiThemeBuilder()
            .AddColor(tokens.Variants.SuccessIdle, new UiColor(0.0f, 1.0f, 0.0f, 1.0f))
            .Build();
        UiVariantPalette success = UiControlThemeResolver.ResolveVariantPalette(custom, in tokens, UiControlVariant.Success);
        success.Idle.Should().Be(new UiColor(0.0f, 1.0f, 0.0f, 1.0f));
        success.Hover.Should().Be(new UiColor(0.29f, 0.87f, 0.50f, 1.0f), "unspecified tokens keep their defaults");
    }

    [Fact]
    public void ButtonNeutralStyleMatchesHistoricalColors()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK", variant: UiControlVariant.Neutral);
        host.Runtime.Mount(button);
        host.Layout();
        host.TryGetBounds(button, out Axrone.Numeric.Rect box).Should().BeTrue();

        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle idle);
        idle.Background.Should().Be(new UiColor(0.05f, 0.09f, 0.16f, 1.0f));
        idle.BorderColor.Should().Be(new UiColor(0.85f, 0.90f, 1.00f, 0.15f));
        idle.TextColor.Should().Be(new UiColor(0.97f, 0.98f, 1.00f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Move, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Pointer(UiPointerPhase.Enter, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle hover);
        hover.Background.Should().Be(new UiColor(0.11f, 0.17f, 0.27f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Down, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle pressed);
        pressed.Background.Should().Be(new UiColor(0.06f, 0.10f, 0.17f, 1.0f));

        _ = host.Pointer(UiPointerPhase.Up, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle focused);
        focused.BorderColor.Should().Be(new UiColor(0.38f, 0.65f, 0.98f, 1.0f));
    }

    [Fact]
    public void ButtonPrimaryVariantResolvesPaletteThroughTheme()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK", variant: UiControlVariant.Primary);
        host.Runtime.Mount(button);
        host.Layout();

        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle idle);
        idle.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));
        idle.TextColor.Should().Be(new UiColor(0.97f, 0.98f, 1.00f, 1.0f));
        idle.BorderColor.Should().Be(new UiColor(0.58f, 0.77f, 0.99f, 0.53f));

        host.TryGetBounds(button, out Axrone.Numeric.Rect box).Should().BeTrue();
        _ = host.Pointer(UiPointerPhase.Move, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Pointer(UiPointerPhase.Enter, box.X + 5.0f, box.Y + 5.0f);
        _ = host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle hover);
        hover.Background.Should().Be(new UiColor(0.23f, 0.51f, 0.96f, 1.0f));
    }

    [Fact]
    public void CheckedToggleAndCheckboxUseVariantIdle()
    {
        var host = new ControlHost();
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Agree", isChecked: true, variant: UiControlVariant.Success);
        UiControl toggle = host.Create(ControlKind.Toggle, isChecked: true, variant: UiControlVariant.Danger);
        host.Runtime.Mount(checkbox);
        host.Runtime.Mount(toggle);
        host.Layout();

        _ = host.Runtime.TryGetStyle(checkbox.Node, out UiWidgetStyle checkboxStyle);
        checkboxStyle.Background.Should().Be(new UiColor(0.13f, 0.77f, 0.37f, 1.0f));
        _ = host.Runtime.TryGetStyle(toggle.Node, out UiWidgetStyle toggleStyle);
        toggleStyle.Background.Should().Be(new UiColor(0.94f, 0.27f, 0.27f, 1.0f));
    }

    [Fact]
    public void ProgressBarVariantResolvesFillFromPalette()
    {
        var host = new ControlHost();
        UiControl neutralBar = host.Create(ControlKind.ProgressBar, value: 0.5f);
        UiControl warningBar = host.Create(ControlKind.ProgressBar, value: 0.5f, variant: UiControlVariant.Warning);
        host.Runtime.Mount(neutralBar);
        host.Runtime.Mount(warningBar);
        host.Layout();

        _ = host.Runtime.TryGetStyle(neutralBar.Node, out UiWidgetStyle neutral);
        neutral.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f), "neutral keeps the historical accent fill");
        _ = host.Runtime.TryGetStyle(warningBar.Node, out UiWidgetStyle warning);
        warning.Background.Should().Be(new UiColor(0.96f, 0.62f, 0.04f, 1.0f));
        warning.TextColor.Should().Be(new UiColor(0.08f, 0.05f, 0.01f, 1.0f));
    }

    [Fact]
    public void SliderVariantResolvesFromPalette()
    {
        var host = new ControlHost();
        UiControl slider = host.Create(ControlKind.Slider, value: 0.5f, variant: UiControlVariant.Primary);
        host.Runtime.Mount(slider);
        host.Layout();

        _ = host.Runtime.TryGetStyle(slider.Node, out UiWidgetStyle style);
        style.Background.Should().Be(new UiColor(0.15f, 0.39f, 0.92f, 1.0f));
    }

    [Fact]
    public void ToggleGeometryScalesWithThemeHeight()
    {
        var tokens = UiControlTheme.Default;
        UiTheme doubled = new UiThemeBuilder()
            .AddNumber(tokens.Height, 72.0f)
            .Build();
        var runtime = new UiControlRuntime(new UiControlRuntimeOptions(
            TextMeasurer: new TestTextMeasurer(),
            Theme: doubled,
            ThemeTokens: tokens,
            Viewport: ControlHost.DefaultViewport));
        UiControl toggle = runtime.CreateControl(ControlKind.Toggle);
        _ = runtime.Mount(toggle);
        _ = runtime.UpdateLayout(ControlHost.DefaultViewport);

        runtime.TryGetBounds(toggle.Node, out Axrone.Numeric.Rect box).Should().BeTrue();
        box.Width.Should().Be(88.0f, "44 * scale 2");
        box.Height.Should().Be(48.0f, "24 * scale 2");
    }

    [Fact]
    public void ToggleGeometryMatchesHistoricalSizeAtScaleOne()
    {
        var host = new ControlHost();
        UiControl toggle = host.Create(ControlKind.Toggle);
        host.Runtime.Mount(toggle);
        host.Layout();
        host.TryGetBounds(toggle, out Axrone.Numeric.Rect box).Should().BeTrue();
        box.Width.Should().Be(44.0f);
        box.Height.Should().Be(24.0f);
    }
}
