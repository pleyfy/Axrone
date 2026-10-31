namespace Axrone.Ui.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiContractTests
{
    [Fact]
    public void IdentifiersTreatZeroAsInvalid()
    {
        UiDocumentId.Invalid.IsValid.Should().BeFalse();
        UiNodeId.Invalid.IsValid.Should().BeFalse();
        UiFontFaceId.Invalid.IsValid.Should().BeFalse();
        UiFontFamilyId.Invalid.IsValid.Should().BeFalse();
        UiGlyphAtlasPageId.Invalid.IsValid.Should().BeFalse();
        UiThemeTokenId.Invalid.IsValid.Should().BeFalse();
        UiResourceId.Invalid.IsValid.Should().BeFalse();
        UiTextLayoutId.Invalid.IsValid.Should().BeFalse();

        new UiNodeId(1).IsValid.Should().BeTrue();
        new UiDocumentId(7).IsValid.Should().BeTrue();
        new UiResourceId(1UL).IsValid.Should().BeTrue();
        new UiFontFaceId(3).IsValid.Should().BeTrue();
    }

    [Fact]
    public void LengthFactoriesCarryKindAndValue()
    {
        UiLength.Auto.Kind.Should().Be(UiLengthKind.Auto);
        UiLength.Content.Kind.Should().Be(UiLengthKind.Content);
        UiLength.Px(12.5f).Should().Be(new UiLength(UiLengthKind.Px, 12.5f));
        UiLength.Percent(50.0f).Kind.Should().Be(UiLengthKind.Percent);
        UiLength.Stretch(2.0f).Value.Should().Be(2.0f);
        UiLength.Viewport(75.0f).Kind.Should().Be(UiLengthKind.Viewport);
    }

    [Fact]
    public void DefaultLayoutStyleIsFlexColumn()
    {
        UiLayoutStyle style = UiLayoutStyle.Default;

        style.Display.Should().Be(UiDisplayMode.Stack);
        style.Direction.Should().Be(UiAxis.Column);
        style.Grow.Should().Be(0.0f);
        style.Shrink.Should().Be(1.0f);
        style.MaxWidth.Should().Be(float.PositiveInfinity);
        style.AlignItems.Should().Be(UiAlign.Stretch);
        style.Position.Should().Be(UiPositionMode.Flow);
        style.FlexWrap.Should().Be(UiFlexWrap.NoWrap);
    }

    [Fact]
    public void UnboundedConstraintsHaveNoMaximum()
    {
        UiMeasureConstraints constraints = UiMeasureConstraints.Unbounded;

        constraints.MinWidth.Should().Be(0.0f);
        constraints.MinHeight.Should().Be(0.0f);
        constraints.MaxWidth.Should().Be(float.PositiveInfinity);
        constraints.MaxHeight.Should().Be(float.PositiveInfinity);
    }

    [Fact]
    public void DefaultWidgetStyleIsVisibleAndOpaque()
    {
        UiWidgetStyle style = UiWidgetStyle.Default;

        style.Visible.Should().BeTrue();
        style.Opacity.Should().Be(1.0f);
        style.Clip.Should().BeFalse();
        style.Background.Should().Be(UiColor.Transparent);
        style.TextColor.Should().Be(UiColor.Black);
    }

    [Fact]
    public void InvalidationAllCoversEveryChannel()
    {
        UiInvalidationFlags all = UiInvalidationFlags.All;
        UiInvalidationFlags channels =
            UiInvalidationFlags.Layout |
            UiInvalidationFlags.Style |
            UiInvalidationFlags.Content |
            UiInvalidationFlags.Render |
            UiInvalidationFlags.Structure |
            UiInvalidationFlags.Focus;

        all.Should().Be(channels);
        UiInvalidationFlags.None.Should().Be(0);
    }

    [Fact]
    public void LayoutPolicySpecializesStatically()
    {
        UiLayoutContext context = new(
            new UiNodeId(1),
            new UiViewport(new UiSize(800.0f, 600.0f)),
            UiMeasureConstraints.Unbounded);

        UiMeasureResult measured = Measure<FixedStackPolicy>(in context);

        measured.Size.Should().Be(new UiSize(10.0f, 20.0f));
        measured.HasBaseline.Should().BeFalse();

        Span<Rect> bounds = stackalloc Rect[2];
        Arrange<FixedStackPolicy>(in context, bounds);
        bounds[0].Should().Be(new Rect(0.0f, 0.0f, 5.0f, 10.0f));
        bounds[1].Should().Be(new Rect(0.0f, 10.0f, 5.0f, 10.0f));
    }

    private static UiMeasureResult Measure<TPolicy>(in UiLayoutContext context)
        where TPolicy : struct, IUiLayoutPolicy<TPolicy> =>
        TPolicy.Measure(in context, UiLayoutStyle.Default, default);

    private static void Arrange<TPolicy>(in UiLayoutContext context, Span<Rect> bounds)
        where TPolicy : struct, IUiLayoutPolicy<TPolicy> =>
        TPolicy.Arrange(in context, UiLayoutStyle.Default, default, bounds);
}

internal struct FixedStackPolicy : IUiLayoutPolicy<FixedStackPolicy>
{
    public static UiMeasureResult Measure(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children)
    {
        _ = context;
        _ = style;
        _ = children;
        return new UiMeasureResult(new UiSize(10.0f, 20.0f), 0.0f, false);
    }

    public static void Arrange(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children,
        Span<Rect> childBounds)
    {
        _ = context;
        _ = style;
        _ = children;
        for (int i = 0; i < childBounds.Length; i++)
        {
            childBounds[i] = new Rect(0.0f, i * 10.0f, 5.0f, 10.0f);
        }
    }
}
