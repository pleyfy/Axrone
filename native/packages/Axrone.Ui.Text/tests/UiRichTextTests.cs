namespace Axrone.Ui.Text.Tests;

using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiRichTextTests
{
    [Fact]
    public void ParsesNestedRunsAndRestoresOuterStyles()
    {
        UiRichTextRun[] runs = Parse("<b>a<i>b</i>c</b>d", out string plain);

        plain.Should().Be("abcd");
        runs.Should().HaveCount(4);
        runs[0].Start.Should().Be(0);
        runs[0].Length.Should().Be(1);
        runs[0].SpanIndex.Should().Be(0);
        runs[0].Style.Bold.Should().BeTrue();
        runs[0].Style.Italic.Should().BeFalse();

        runs[1].Style.Bold.Should().BeTrue();
        runs[1].Style.Italic.Should().BeTrue();
        runs[1].SpanIndex.Should().Be(1);

        runs[2].Style.Bold.Should().BeTrue();
        runs[2].Style.Italic.Should().BeFalse();
        runs[2].SpanIndex.Should().Be(2);

        runs[3].Style.Should().Be(UiRichTextStyle.Default);
        runs[3].SpanIndex.Should().Be(3);
    }

    [Fact]
    public void ParsesSizeColorAndThemeTokenRuns()
    {
        UiRichTextRun[] runs = Parse(
            "<size=500>A</size><color=#3366FF>B</color><color=token:5>C</color>",
            out string plain);

        plain.Should().Be("ABC");
        runs.Should().HaveCount(3);
        runs[0].Style.HasSize.Should().BeTrue();
        runs[0].Style.Size.Should().Be(500.0f);
        runs[1].Style.HasColor.Should().BeTrue();
        runs[1].Style.Color.R.Should().BeApproximately(0.2f, 1e-4f);
        runs[1].Style.Color.G.Should().BeApproximately(0.4f, 1e-4f);
        runs[1].Style.Color.B.Should().BeApproximately(1.0f, 1e-4f);
        runs[2].Style.HasColorToken.Should().BeTrue();
        runs[2].Style.ColorToken.Should().Be(new UiThemeTokenId(5));
    }

    [Fact]
    public void HandlesEscapedMarkupCharacters()
    {
        UiRichTextRun[] runs = Parse("\\<b\\>", out string plain);
        plain.Should().Be("<b>");
        runs.Should().ContainSingle();

        _ = Parse("a\\\\b", out string slash);
        slash.Should().Be("a\\b");
    }

    [Fact]
    public void EmptyMarkupAndEmptyTagsProduceNoRuns()
    {
        UiRichTextRun[] empty = Parse(string.Empty, out string plain);
        plain.Should().BeEmpty();
        empty.Should().BeEmpty();

        UiRichTextRun[] emptyTags = Parse("<b></b><i> </i>", out string spaced);
        spaced.Should().Be(" ");
        emptyTags.Should().ContainSingle();
    }

    [Theory]
    [InlineData("<z>x</z>", UiRichTextErrorCode.UnknownTag)]
    [InlineData("<b>x", UiRichTextErrorCode.UnclosedTag)]
    [InlineData("</b>", UiRichTextErrorCode.UnexpectedCloseTag)]
    [InlineData("<b>x</i>", UiRichTextErrorCode.MismatchedTag)]
    [InlineData("<b", UiRichTextErrorCode.MalformedTag)]
    [InlineData("<>", UiRichTextErrorCode.MalformedTag)]
    [InlineData("<color=#12>x</color>", UiRichTextErrorCode.InvalidColor)]
    [InlineData("<color=token:0>x</color>", UiRichTextErrorCode.InvalidColor)]
    [InlineData("<size=0>x</size>", UiRichTextErrorCode.InvalidSize)]
    [InlineData("<size=abc>x</size>", UiRichTextErrorCode.InvalidSize)]
    [InlineData("<b=1>x</b>", UiRichTextErrorCode.InvalidAttribute)]
    [InlineData("<color>x</color>", UiRichTextErrorCode.InvalidAttribute)]
    [InlineData("</b=1>", UiRichTextErrorCode.InvalidAttribute)]
    public void RejectsMalformedMarkup(string markup, UiRichTextErrorCode expected)
    {
        ParseError(markup).Should().Be(expected);
    }

    [Fact]
    public void RejectsExcessiveNesting()
    {
        var markup = new StringBuilder();
        for (int i = 0; i <= UiRichTextParser.MaxDepth; i++)
        {
            markup.Append("<b>");
        }

        markup.Append('x');
        for (int i = 0; i <= UiRichTextParser.MaxDepth; i++)
        {
            markup.Append("</b>");
        }

        ParseError(markup.ToString()).Should().Be(UiRichTextErrorCode.TooDeep);
    }

    [Fact]
    public void RejectsTooManyRuns()
    {
        var markup = new StringBuilder();
        for (int i = 0; i <= UiRichTextParser.MaxRuns; i++)
        {
            markup.Append("<b>a</b>");
        }

        ParseError(markup.ToString()).Should().Be(UiRichTextErrorCode.TooManyRuns);
    }

    [Fact]
    public void RejectsSmallPlainDestination()
    {
        var runs = new UiRichTextRun[4];
        bool parsed = UiRichTextParser.TryParse(
            "abc".AsSpan(),
            Span<char>.Empty,
            runs,
            out int plainLength,
            out int runCount,
            out UiRichTextError error);

        parsed.Should().BeFalse();
        plainLength.Should().Be(0);
        runCount.Should().Be(0);
        error.Code.Should().Be(UiRichTextErrorCode.OutputTooSmall);
    }

    [Fact]
    public void ResolverSelectsWeightStyleSizeAndColor()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId regular = Register(provider, "Test", UiFontWeight.Normal, UiFontStyle.Normal);
        UiFontFaceId bold = Register(provider, "Test", UiFontWeight.Bold, UiFontStyle.Normal);
        UiFontFaceId italic = Register(provider, "Test", UiFontWeight.Normal, UiFontStyle.Italic);
        var family = UiFontProvider.FromFamilyName("Test");
        var baseStyle = new UiTextStyle(regular, 1000.0f, 0.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 0);

        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle,
            UiRichTextStyle.Default with { Bold = true },
            null,
            out UiTextStyle resolvedBold,
            out _,
            out bool hasColor).Should().BeTrue();
        resolvedBold.Face.Should().Be(bold);
        hasColor.Should().BeFalse();

        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle,
            UiRichTextStyle.Default with { Italic = true },
            null,
            out UiTextStyle resolvedItalic,
            out _,
            out _).Should().BeTrue();
        resolvedItalic.Face.Should().Be(italic);

        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle,
            UiRichTextStyle.Default with { HasSize = true, Size = 500.0f },
            null,
            out UiTextStyle resolvedSize,
            out _,
            out _).Should().BeTrue();
        resolvedSize.Size.Should().Be(500.0f);

        var theme = new TestTheme();
        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle,
            UiRichTextStyle.Default with { HasColorToken = true, ColorToken = new UiThemeTokenId(5) },
            theme,
            out _,
            out UiColor tokenColor,
            out bool tokenHasColor).Should().BeTrue();
        tokenHasColor.Should().BeTrue();
        tokenColor.Should().Be(new UiColor(0.1f, 0.2f, 0.3f, 1.0f));

        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle,
            UiRichTextStyle.Default with { HasColorToken = true, ColorToken = new UiThemeTokenId(6) },
            theme,
            out _,
            out _,
            out bool unresolved).Should().BeTrue();
        unresolved.Should().BeFalse();

        UiRichTextStyleResolver.TryResolve(
            provider,
            family,
            "en",
            baseStyle with { Face = new UiFontFaceId(9999) },
            UiRichTextStyle.Default,
            null,
            out _,
            out _,
            out _).Should().BeFalse();
    }

    [Fact]
    public void RichShapingAppliesPerRunSizeAndSpanIndex()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var family = UiFontProvider.FromFamilyName("Test");
        var baseStyle = new UiTextStyle(face, 1000.0f, 0.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 0);
        UiRichTextRun[] runs = Parse("<size=500>A</size>B", out string plain);

        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];
        int count = shaper.ShapeRichText(plain.AsSpan(), runs, baseStyle, family, "en", null, glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[0].Advance.Should().Be(300.0f);
        glyphs[0].SpanIndex.Should().Be(0);
        glyphs[0].Cluster.Should().Be(0);
        glyphs[1].CodePoint.Should().Be(0x42);
        glyphs[1].Advance.Should().Be(600.0f);
        glyphs[1].SpanIndex.Should().Be(1);
        glyphs[1].Cluster.Should().Be(1);
        glyphs[1].X.Should().Be(300.0f);
    }

    [Fact]
    public void RichShapingSkipsInvalidRunBounds()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var family = UiFontProvider.FromFamilyName("Test");
        var baseStyle = new UiTextStyle(face, 1000.0f, 0.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 0);
        UiRichTextRun[] runs =
        [
            new UiRichTextRun(10, 1, 0, UiRichTextStyle.Default),
            new UiRichTextRun(-1, 1, 1, UiRichTextStyle.Default),
        ];

        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[4];
        int count = shaper.ShapeRichText("A".AsSpan(), runs, baseStyle, family, "en", null, glyphs);

        count.Should().Be(0);
    }

    private static UiRichTextRun[] Parse(string markup, out string plain)
    {
        ArgumentNullException.ThrowIfNull(markup);
        Span<char> text = stackalloc char[Math.Max(markup.Length, 1)];
        var runs = new UiRichTextRun[2048];
        bool parsed = UiRichTextParser.TryParse(
            markup.AsSpan(),
            text,
            runs,
            out int length,
            out int count,
            out UiRichTextError error);

        parsed.Should().BeTrue(error.Message);
        plain = new string(text[..length]);
        return runs[..count];
    }

    private static UiRichTextErrorCode ParseError(string markup)
    {
        ArgumentNullException.ThrowIfNull(markup);
        Span<char> text = stackalloc char[Math.Max(markup.Length, 1)];
        var runs = new UiRichTextRun[2048];
        bool parsed = UiRichTextParser.TryParse(
            markup.AsSpan(),
            text,
            runs,
            out _,
            out _,
            out UiRichTextError error);

        parsed.Should().BeFalse();
        return error.Code;
    }

    private static UiFontProvider CreateProvider(out UiFontFaceId face)
    {
        var provider = new UiFontProvider();
        face = Register(provider, "Test", UiFontWeight.Normal, UiFontStyle.Normal);
        return provider;
    }

    private static UiFontFaceId Register(
        UiFontProvider provider,
        string family,
        UiFontWeight weight,
        UiFontStyle style)
    {
        UiFontFaceId id = provider.RegisterFace(
            UiTestFont.Create(),
            new UiFontFaceDescriptor(family, weight, style),
            out UiFontError error);
        id.IsValid.Should().BeTrue(error.Message);
        return id;
    }

    private sealed class TestTheme : IUiTheme
    {
        public bool TryGetColor(UiThemeTokenId token, out UiColor color)
        {
            if (token.Value == 5)
            {
                color = new UiColor(0.1f, 0.2f, 0.3f, 1.0f);
                return true;
            }

            color = default;
            return false;
        }

        public bool TryGetNumber(UiThemeTokenId token, out float value)
        {
            _ = token;
            value = 0.0f;
            return false;
        }
    }
}
