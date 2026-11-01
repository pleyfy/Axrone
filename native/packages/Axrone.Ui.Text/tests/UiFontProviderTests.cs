namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiFontProviderTests
{
    [Fact]
    public void ResolvesFamilyWeightAndStyle()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId regular = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Normal, UiFontStyle.Normal);
        UiFontFaceId bold = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Bold, UiFontStyle.Normal);
        UiFontFaceId italic = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Normal, UiFontStyle.Italic);
        UiFontFamilyId family = UiFontProvider.FromFamilyName("Test");

        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Normal, UiFontStyle.Normal, "en"), out UiFontFaceId resolved)
            .Should().BeTrue();
        resolved.Should().Be(regular);

        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Bold, UiFontStyle.Normal, "en"), out resolved)
            .Should().BeTrue();
        resolved.Should().Be(bold);

        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.SemiBold, UiFontStyle.Normal, "en"), out resolved)
            .Should().BeTrue();
        resolved.Should().Be(bold);

        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Normal, UiFontStyle.Italic, "en"), out resolved)
            .Should().BeTrue();
        resolved.Should().Be(italic);

        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Bold, UiFontStyle.Italic, "en"), out resolved)
            .Should().BeTrue();
        resolved.Should().Be(italic);
    }

    [Fact]
    public void FamilyIdentityIsCaseInsensitiveAndTrimmed()
    {
        UiFontFamilyId first = UiFontProvider.FromFamilyName("  My Family  ");
        UiFontFamilyId second = UiFontProvider.FromFamilyName("my family");

        first.IsValid.Should().BeTrue();
        first.Should().Be(second);
        UiFontProvider.FromFamilyName(string.Empty).IsValid.Should().BeFalse();
        UiFontProvider.FromFamilyName(new string('x', UiFontProvider.MaxFamilyNameLength + 1)).IsValid.Should().BeFalse();
    }

    [Fact]
    public void FallbackChainResolvesMissingGlyphs()
    {
        using var provider = new UiFontProvider();
        UiFontFamilyId primaryFamily = UiFontProvider.FromFamilyName("Primary");
        UiFontFamilyId fallbackFamily = UiFontProvider.FromFamilyName("Fallback");
        UiFontFaceId primary = Register(provider, UiTestFont.Create(), "Primary", UiFontWeight.Normal, UiFontStyle.Normal);
        UiFontFaceId fallback = Register(provider, UiTestFont.CreateFallback(), "Fallback", UiFontWeight.Normal, UiFontStyle.Normal);

        provider.TryMeasureGlyph(primary, 0x5A, out _).Should().BeFalse();
        provider.TryResolveGlyph(primary, 0x5A, out UiFontFaceId resolved, out UiGlyphMetrics metrics).Should().BeTrue();
        resolved.Should().Be(fallback);
        metrics.Advance.Should().Be(500.0f);

        provider.TryResolveGlyph(primary, 0x41, out resolved, out _).Should().BeTrue();
        resolved.Should().Be(primary);

        provider.SetFallbackFamilies([fallbackFamily]);
        provider.TryGetFace(new UiFontQuery(primaryFamily, UiFontWeight.Normal, UiFontStyle.Normal, "en"), out UiFontFaceId familyFace)
            .Should().BeTrue();
        familyFace.Should().Be(primary);
    }

    [Fact]
    public void UnknownFamilyFallsBackToDefault()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create(), "Only", UiFontWeight.Normal, UiFontStyle.Normal);

        provider.TryGetFace(new UiFontQuery(UiFontProvider.FromFamilyName("Missing"), UiFontWeight.Normal, UiFontStyle.Normal, "en"), out UiFontFaceId resolved)
            .Should().BeTrue();
        resolved.Should().Be(face);
        provider.DefaultFamily.Should().Be(UiFontProvider.FromFamilyName("Only"));
    }

    [Fact]
    public void DuplicateFaceIsRejected()
    {
        using var provider = new UiFontProvider();
        var descriptor = new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal);
        _ = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Normal, UiFontStyle.Normal);

        UiFontFaceId duplicate = provider.RegisterFace(UiTestFont.Create(), in descriptor, out UiFontError error);

        duplicate.IsValid.Should().BeFalse();
        error.Code.Should().Be(UiFontErrorCode.DuplicateFace);
        provider.FaceCount.Should().Be(1);
    }

    [Fact]
    public void SameFamilyDifferentWeightsAreAllowed()
    {
        using var provider = new UiFontProvider();
        _ = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Normal, UiFontStyle.Normal);
        _ = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Bold, UiFontStyle.Normal);

        provider.FaceCount.Should().Be(2);
        provider.FamilyCount.Should().Be(1);
    }

    [Fact]
    public void InvalidDescriptorsAreRejected()
    {
        using var provider = new UiFontProvider();
        byte[] font = UiTestFont.Create();

        provider.RegisterFace(font, new UiFontFaceDescriptor(string.Empty, UiFontWeight.Normal, UiFontStyle.Normal), out UiFontError empty)
            .IsValid.Should().BeFalse();
        empty.Code.Should().Be(UiFontErrorCode.InvalidDescriptor);

        provider.RegisterFace(font, new UiFontFaceDescriptor(new string('x', 65), UiFontWeight.Normal, UiFontStyle.Normal), out UiFontError longName)
            .IsValid.Should().BeFalse();
        longName.Code.Should().Be(UiFontErrorCode.InvalidDescriptor);

        provider.RegisterFace(font, new UiFontFaceDescriptor("Test", (UiFontWeight)950, UiFontStyle.Normal), out UiFontError weight)
            .IsValid.Should().BeFalse();
        weight.Code.Should().Be(UiFontErrorCode.InvalidDescriptor);
    }

    [Fact]
    public void NativeRegistrationWorks()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId id = provider.RegisterNativeFace(
            UiTestFont.Create(),
            new UiFontFaceDescriptor("Native", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);

        id.IsValid.Should().BeTrue(error.Message);
        provider.TryMeasureGlyph(id, 0x41, out UiGlyphMetrics metrics).Should().BeTrue();
        metrics.Advance.Should().Be(600.0f);
        provider.TryGetFace(id, out UiFontFace? face).Should().BeTrue();
        face!.Buffer.IsNative.Should().BeTrue();
    }

    [Fact]
    public void DisposeClearsFacesAndIsIdempotent()
    {
        var provider = new UiFontProvider();
        _ = Register(provider, UiTestFont.Create(), "Test", UiFontWeight.Normal, UiFontStyle.Normal);
        UiFontFamilyId family = UiFontProvider.FromFamilyName("Test");

        provider.Dispose();
        provider.Dispose();

        provider.FaceCount.Should().Be(0);
        provider.FamilyCount.Should().Be(0);
        provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Normal, UiFontStyle.Normal, "en"), out _).Should().BeFalse();
        FluentActions.Invoking(() => provider.SetFallbackFamilies([family])).Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void InvalidFallbackSetIsRejected()
    {
        using var provider = new UiFontProvider();
        FluentActions.Invoking(() => provider.SetFallbackFamilies([UiFontFamilyId.Invalid]))
            .Should().Throw<ArgumentException>();

        var tooMany = new UiFontFamilyId[UiFontProvider.MaxFallbackFamilies + 1];
        for (int i = 0; i < tooMany.Length; i++)
        {
            tooMany[i] = new UiFontFamilyId((uint)(i + 1));
        }

        FluentActions.Invoking(() => provider.SetFallbackFamilies(tooMany))
            .Should().Throw<ArgumentOutOfRangeException>();
    }

    private static UiFontFaceId Register(
        UiFontProvider provider,
        byte[] font,
        string family,
        UiFontWeight weight,
        UiFontStyle style)
    {
        UiFontFaceId id = provider.RegisterFace(
            font,
            new UiFontFaceDescriptor(family, weight, style),
            out UiFontError error);
        id.IsValid.Should().BeTrue(error.Message);
        return id;
    }
}
