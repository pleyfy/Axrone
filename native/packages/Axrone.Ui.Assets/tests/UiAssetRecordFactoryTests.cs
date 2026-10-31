namespace Axrone.Ui.Assets.Tests;

using System.Text;
using Axrone.Asset;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiAssetRecordFactoryTests
{
    [Fact]
    public void RecordCarriesPayloadKeyFingerprintAndDependencies()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        UiAssetResource[] resources =
        [
            new UiAssetResource(new UiResourceId(1UL), "ui/icon.png", "image/png", 128),
            new UiAssetResource(new UiResourceId(2UL), "Inter", "font/family", 0),
        ];

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        AssetWriteInput<byte[]> input = UiAssetRecordFactory.Create(document, codec, resources);

        input.Kind.Should().Be(UiAssetRecordFactory.AssetKind);
        input.Id.Should().BeNull();
        input.Key.Should().Be(new AssetKey("ui.sample"));
        input.Name.Should().Be("sample");
        input.Data.Should().NotBeEmpty();
        input.Fingerprint.Should().NotBeNull();
        input.Fingerprint!.Value.Value.Should().NotBe(0UL);
        input.Dependencies.Should().NotBeNull().And.HaveCount(2);

        var first = input.Dependencies![0].Should().BeOfType<AssetDependencyInput.KeyDependency>().Subject;
        first.Key.Should().Be(new AssetKey("ui/icon.png"));
        var second = input.Dependencies[1].Should().BeOfType<AssetDependencyInput.KeyDependency>().Subject;
        second.Key.Should().Be(new AssetKey("Inter"));

        codec.TryRead(input.Data, out IUiDocument? decoded, out _).Should().BeTrue();
        decoded!.Info.Name.Should().Be("sample");
    }

    [Fact]
    public void FingerprintIsStableForIdenticalDocuments()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        AssetWriteInput<byte[]> first = UiAssetRecordFactory.Create(UiTestDocuments.CreateSample(), codec);
        AssetWriteInput<byte[]> second = UiAssetRecordFactory.Create(UiTestDocuments.CreateSample(), codec);

        first.Data.Should().Equal(second.Data);
        first.Fingerprint.Should().Be(second.Fingerprint);
    }

    [Fact]
    public void CustomKindAndKeyAreHonored()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        var key = new AssetKey("override.key");
        AssetWriteInput<byte[]> input = UiAssetRecordFactory.Create(
            UiTestDocuments.CreateSample(),
            codec,
            resources: null,
            kind: "custom-ui",
            key: key);

        input.Kind.Should().Be("custom-ui");
        input.Key.Should().Be(key);
        input.Dependencies.Should().BeEmpty();
    }

    [Fact]
    public void KeyFallsBackToDocumentIdWithoutAuthoredAssetId()
    {
        var builder = UiTestDocuments.CreateBuilder();
        UiAssetDocument document = builder.Build(new UiDocumentInfo(
            new UiDocumentId(0x1234),
            "fallback",
            1,
            new UiCanvasConfig(1.0f, 1.0f, UiCanvasScaleMode.Fill, 0.5f, UiEdgeInsets.Zero)));

        AssetKey key = UiAssetKeyFactory.FromDocument(document);

        document.AssetId.Should().BeEmpty();
        key.Should().Be(new AssetKey("00001234"));
    }

    [Fact]
    public void PathKeysAreCanonicalized()
    {
        AssetKey key = UiAssetKeyFactory.FromPath("  ui\\main.ui.json  ");

        key.Value.Should().Be("ui/main.ui.json");
    }

    [Fact]
    public void CreateValidatesArguments()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);

        FluentActions.Invoking(() => UiAssetRecordFactory.Create(null!, codec)).Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => UiAssetRecordFactory.Create(UiTestDocuments.CreateSample(), null!))
            .Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => UiAssetRecordFactory.Create(UiTestDocuments.CreateSample(), codec, kind: string.Empty))
            .Should().Throw<ArgumentException>();
    }

    [Fact]
    public void ImportedDocumentMatchesRecordPayload()
    {
        var importer = new UiDocumentJsonImporter();
        var collector = new UiAssetImportCollector();
        const string json =
            "{\"version\":1,\"id\":\"ui.rec\",\"name\":\"Rec\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"Hi\",\"family\":\"Inter\"}}]}}";
        importer.TryImport(Encoding.UTF8.GetBytes(json), collector, out _).Should().BeTrue();

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        AssetWriteInput<byte[]> input = UiAssetRecordFactory.Create(
            collector.Documents[0],
            codec,
            collector.Resources);

        input.Key.Should().Be(new AssetKey("ui.rec"));
        input.Dependencies.Should().ContainSingle();
        codec.TryRead(input.Data, out IUiDocument? decoded, out _).Should().BeTrue();
        decoded!.Info.Name.Should().Be("Rec");
    }
}
