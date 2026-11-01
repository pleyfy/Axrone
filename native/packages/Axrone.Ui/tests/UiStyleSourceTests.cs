namespace Axrone.Ui.Tests;

using FluentAssertions;
using Xunit;

public sealed class UiStyleSourceTests
{
    [Fact]
    public void ThemeTokensResolveColorsAndNumbers()
    {
        UiThemeTokenId background = new(1);
        UiThemeTokenId opacity = new(2);
        UiTheme theme = new UiThemeBuilder()
            .AddColor(background, UiColor.White)
            .AddNumber(opacity, 0.25f)
            .Build();

        theme.TryGetColor(background, out UiColor color).Should().BeTrue();
        color.Should().Be(UiColor.White);
        theme.TryGetNumber(opacity, out float value).Should().BeTrue();
        value.Should().Be(0.25f);
        theme.TryGetColor(new UiThemeTokenId(99), out _).Should().BeFalse();
        theme.TryGetNumber(new UiThemeTokenId(99), out _).Should().BeFalse();
        theme.ColorCount.Should().Be(1);
        theme.NumberCount.Should().Be(1);
    }

    [Fact]
    public void LiteralPatchAppliesToDefaultChannels()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Child, new UiStylePatch
        {
            Background = UiColor.White,
            BorderColor = UiColor.Black,
            BorderWidth = 2.0f,
            Radius = new UiCornerRadii(1.0f, 2.0f, 3.0f, 4.0f),
            Opacity = 0.5f,
            Clip = true,
        });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle style).Should().BeTrue();

        style.Background.Should().Be(UiColor.White);
        style.BorderColor.Should().Be(UiColor.Black);
        style.BorderWidth.Should().Be(2.0f);
        style.Radius.TopRight.Should().Be(2.0f);
        style.Opacity.Should().Be(0.5f);
        style.Clip.Should().BeTrue();
    }

    [Fact]
    public void ThemeTokenWinsOverLiteralOnTheSameChannel()
    {
        UiThemeTokenId text = new(1);
        UiTheme theme = new UiThemeBuilder().AddColor(text, UiColor.White).Build();
        StyleHarness harness = new(theme);
        harness.Source.SetPatch(harness.Child, new UiStylePatch
        {
            TextColor = UiColor.Black,
            TextColorToken = text,
        });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle style);

        style.TextColor.Should().Be(UiColor.White);
    }

    [Fact]
    public void MissingTokenFallsBackToLiteral()
    {
        StyleHarness harness = new(new UiThemeBuilder().Build());
        harness.Source.SetPatch(harness.Child, new UiStylePatch
        {
            Background = UiColor.White,
            BackgroundToken = new UiThemeTokenId(42),
        });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle style);

        style.Background.Should().Be(UiColor.White);
    }

    [Fact]
    public void TextColorInheritsThroughAncestors()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Root, new UiStylePatch { TextColor = UiColor.White });
        harness.Source.SetPatch(harness.Grandchild, new UiStylePatch { TextColor = UiColor.Black });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle child);
        harness.Source.TryGetStyle(harness.Grandchild, out UiWidgetStyle grandchild);

        child.TextColor.Should().Be(UiColor.White);
        grandchild.TextColor.Should().Be(UiColor.Black);
    }

    [Fact]
    public void OpacityMultipliesDownTheChain()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Root, new UiStylePatch { Opacity = 0.5f });
        harness.Source.SetPatch(harness.Child, new UiStylePatch { Opacity = 0.5f });

        harness.Source.TryGetStyle(harness.Grandchild, out UiWidgetStyle style);

        style.Opacity.Should().Be(0.25f);
    }

    [Fact]
    public void HiddenAncestorHidesDescendants()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Root, new UiStylePatch { Visible = false });
        harness.Source.SetPatch(harness.Child, new UiStylePatch { Visible = true });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle child);
        harness.Source.TryGetStyle(harness.Grandchild, out UiWidgetStyle grandchild);

        child.Visible.Should().BeFalse();
        grandchild.Visible.Should().BeFalse();
    }

    [Fact]
    public void HiddenNodeHidesItsOwnSubtree()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Child, new UiStylePatch { Visible = false });

        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle child);
        harness.Source.TryGetStyle(harness.Grandchild, out UiWidgetStyle grandchild);

        child.Visible.Should().BeFalse();
        grandchild.Visible.Should().BeFalse();
        harness.Source.TryGetStyle(harness.Root, out UiWidgetStyle root);
        root.Visible.Should().BeTrue();
    }

    [Fact]
    public void UnknownNodeIsRejected()
    {
        StyleHarness harness = new();

        harness.Source.TryGetStyle(UiNodeId.Invalid, out _).Should().BeFalse();
        harness.Source.TryGetStyle(new UiNodeId(99999), out _).Should().BeFalse();
    }

    [Fact]
    public void PatchMutationInvalidatesResolvedCache()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Child, new UiStylePatch { TextColor = UiColor.White });
        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle before);
        before.TextColor.Should().Be(UiColor.White);

        harness.Source.SetPatch(harness.Child, new UiStylePatch { TextColor = UiColor.Black });
        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle after);

        after.TextColor.Should().Be(UiColor.Black);
        harness.Source.RemovePatch(harness.Child).Should().BeTrue();
        harness.Source.TryGetStyle(harness.Child, out UiWidgetStyle removed);
        removed.TextColor.Should().Be(UiWidgetStyle.Default.TextColor);
    }

    [Fact]
    public void DefaultStyleMutationInvalidatesResolvedCache()
    {
        StyleHarness harness = new();
        harness.Source.TryGetStyle(harness.Root, out UiWidgetStyle before);
        before.Background.Should().Be(UiColor.Transparent);

        harness.Source.DefaultStyle = UiWidgetStyle.Default with { Background = UiColor.White };
        harness.Source.TryGetStyle(harness.Root, out UiWidgetStyle after);

        after.Background.Should().Be(UiColor.White);
    }

    [Fact]
    public void ResolutionIsAllocationFreeAfterWarmup()
    {
        StyleHarness harness = new();
        harness.Source.SetPatch(harness.Root, new UiStylePatch { TextColor = UiColor.White, Opacity = 0.75f });
        harness.Source.SetPatch(harness.Child, new UiStylePatch { Opacity = 0.5f });

        for (int i = 0; i < 4; i++)
        {
            harness.Source.Invalidate();
            harness.Source.TryGetStyle(harness.Grandchild, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            harness.Source.Invalidate();
            harness.Source.TryGetStyle(harness.Grandchild, out UiWidgetStyle style);
            _ = style;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    private sealed class StyleHarness
    {
        private readonly UiDocumentBuilder _builder = new();

        public StyleHarness(IUiTheme? theme = null)
        {
            Root = _builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
            Child = _builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
            Grandchild = _builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
            _builder.TryAppendChild(Root, Child);
            _builder.TryAppendChild(Child, Grandchild);
            IUiNodeTree nodes = _builder.Build(new UiDocumentInfo(new UiDocumentId(1), "style", 1, default)).Nodes;
            Source = new UiStyleSource(nodes, theme);
        }

        public UiNodeId Root { get; }

        public UiNodeId Child { get; }

        public UiNodeId Grandchild { get; }

        public UiStyleSource Source { get; }
    }
}
