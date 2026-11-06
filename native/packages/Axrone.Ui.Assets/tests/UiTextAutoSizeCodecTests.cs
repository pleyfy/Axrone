namespace Axrone.Ui.Assets.Tests;

using System.Buffers;
using System.Text;
using Axrone.Ui;
using Axrone.Ui.Assets;
using FluentAssertions;
using Xunit;

public sealed class UiTextAutoSizeCodecTests
{
    private const string LegacyJson =
        "{\"version\":1,\"id\":\"ui.legacy\",\"name\":\"L\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"Old\",\"size\":16,\"maxLines\":1}}]}}";

    private const string AutoSizeJson =
        "{\"version\":1,\"id\":\"ui.auto\",\"name\":\"A\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"Fit\",\"size\":16,\"autoSize\":\"shrink-to-fit\",\"minFontSize\":4,\"maxFontSize\":14}}]}}";

    [Fact]
    public void LegacyDocumentWithoutAutoSizeFieldsReadsAsNone()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(LegacyJson), out IUiDocument? decoded, out UiDocumentError failure)
            .Should().BeTrue(failure.Message);
        UiAssetDocument document = decoded.Should().BeOfType<UiAssetDocument>().Subject;

        document.TryGetText(new UiNodeId(2), out UiNodeText text).Should().BeTrue();
        text.AutoSize.Should().Be(UiTextAutoSize.None);
        text.MinFontSize.Should().Be(0.0f);
        text.MaxFontSize.Should().Be(0.0f);
    }

    [Fact]
    public void AutosizeFieldsDecodeFromJson()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(AutoSizeJson), out IUiDocument? decoded, out UiDocumentError failure)
            .Should().BeTrue(failure.Message);
        UiAssetDocument document = decoded.Should().BeOfType<UiAssetDocument>().Subject;

        document.TryGetText(new UiNodeId(2), out UiNodeText text).Should().BeTrue();
        text.AutoSize.Should().Be(UiTextAutoSize.ShrinkToFit);
        text.MinFontSize.Should().Be(4.0f);
        text.MaxFontSize.Should().Be(14.0f);
    }

    [Fact]
    public void AutosizeFieldsRoundTripThroughWriter()
    {
        UiAssetDocument source = BuildDocument(
            UiTextAutoSize.ShrinkToFit,
            min: 5.0f,
            max: 20.0f);
        byte[] encoded = Encode(source);

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(encoded, out IUiDocument? decoded, out UiDocumentError failure)
            .Should().BeTrue(failure.Message);
        UiAssetDocument document = decoded.Should().BeOfType<UiAssetDocument>().Subject;

        document.TryGetText(new UiNodeId(2), out UiNodeText text).Should().BeTrue();
        text.AutoSize.Should().Be(UiTextAutoSize.ShrinkToFit);
        text.MinFontSize.Should().Be(5.0f);
        text.MaxFontSize.Should().Be(20.0f);
    }

    [Fact]
    public void DefaultPathWritesNoAutosizeFieldsAndRoundTripsUnchanged()
    {
        UiAssetDocument source = BuildDocument(UiTextAutoSize.None, 0.0f, 0.0f);
        byte[] encoded = Encode(source);

        Encoding.UTF8.GetString(encoded).Should().NotContain("autoSize");
        Encoding.UTF8.GetString(encoded).Should().NotContain("minFontSize");
        Encoding.UTF8.GetString(encoded).Should().NotContain("maxFontSize");
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(encoded, out IUiDocument? decoded, out _)
            .Should().BeTrue();
        UiAssetDocument document = decoded.Should().BeOfType<UiAssetDocument>().Subject;
        document.TryGetText(new UiNodeId(2), out UiNodeText text).Should().BeTrue();
        text.AutoSize.Should().Be(UiTextAutoSize.None);
        Encode(document).Should().Equal(encoded);
    }

    [Fact]
    public void UnknownAutoSizeValueIsRejected()
    {
        string json = AutoSizeJson.Replace("\"shrink-to-fit\"", "\"super-size\"", StringComparison.Ordinal);
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(json), out _, out UiDocumentError failure)
            .Should().BeFalse();
        failure.Code.Should().Be(UiDocumentErrorCode.Malformed);
    }

    private static UiAssetDocument BuildDocument(UiTextAutoSize autoSize, float min, float max)
    {
        UiAssetDocumentBuilder builder = new() { AssetId = "ui.autosize" };
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        UiNodeId text = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        _ = builder.TryAppendChild(root, text);
        builder.TrySetText(text, new UiNodeText(
            "Fit",
            string.Empty,
            16.0f,
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0.0f,
            0.0f,
            1,
            autoSize,
            min,
            max));
        return builder.Build(new UiDocumentInfo(
            new UiDocumentId(9),
            "autosize",
            1,
            new UiCanvasConfig(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero)));
    }

    private static byte[] Encode(UiAssetDocument document)
    {
        ArrayBufferWriter<byte> buffer = new();
        using (var codec = new UiDocumentJsonCodec(reuseStorage: false))
        {
            codec.Write(document, buffer);
        }

        return buffer.WrittenSpan.ToArray();
    }
}
