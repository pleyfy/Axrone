namespace Axrone.Asset2D.Tests;

/// <summary>
/// Probes must separate "not my format" from "my format but unreadable": a broken atlas keeps its
/// coded reason all the way to the chain result instead of collapsing into a decline.
/// </summary>
public sealed class Asset2DProbeTests
{
    private const string CanonicalAtlas = """
        {
          "id": "hero",
          "textureId": "hero.png",
          "textureSize": { "width": 8, "height": 8 },
          "frames": [
            { "id": "hero_idle_1", "region": { "x": 0, "y": 0, "width": 8, "height": 8 } }
          ]
        }
        """;

    [Theory]
    [InlineData("{ \"id\": ")]
    [InlineData("{ not json")]
    [InlineData("{}:{}")]
    public void Corrupt_Json_KeepsItsCodedReason(string broken)
    {
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", broken);

        Asset2DProbe canonical = SpriteAtlasJsonImporter<TopLeftOriginPolicy>.Probe(in context);
        canonical.Verdict.Should().Be(Asset2DProbeVerdict.MineButUnreadable);
        canonical.ErrorCode.Should().Be("asset2d.atlas.json.malformed");
        canonical.Reason.Should().NotBeNullOrWhiteSpace();
        SpriteAtlasJsonImporter<TopLeftOriginPolicy>.CanImport(in context)
            .Should().BeTrue("a broken document is ours, not a foreign format");

        Asset2DProbe packed = TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>.Probe(in context);
        packed.Verdict.Should().Be(Asset2DProbeVerdict.MineButUnreadable);
        packed.ErrorCode.Should().Be("asset2d.atlas.json.malformed");
    }

    [Theory]
    [InlineData("hello")]
    [InlineData("")]
    [InlineData("\n  ")]
    public void Foreign_Payload_IsADeclineWithoutCode(string foreign)
    {
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", foreign);

        TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>.Probe(in context).Verdict
            .Should().Be(Asset2DProbeVerdict.NotMine);
        SpriteAtlasJsonImporter<TopLeftOriginPolicy>.Probe(in context).Verdict
            .Should().Be(Asset2DProbeVerdict.NotMine);
        SpriteAtlasJsonImporter<TopLeftOriginPolicy>.CanImport(in context).Should().BeFalse();
    }

    [Fact]
    public void Valid_Atlas_IsAcceptedWithoutCode()
    {
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", CanonicalAtlas);

        Asset2DProbe probe = SpriteAtlasJsonImporter<TopLeftOriginPolicy>.Probe(in context);
        probe.Verdict.Should().Be(Asset2DProbeVerdict.Mine);
        probe.ErrorCode.Should().BeNull();
        probe.Reason.Should().BeNull();

        Asset2DImportResult<TopLeftOriginPolicy> result =
            ImporterChain<
                TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>,
                SpriteAtlasJsonImporter<TopLeftOriginPolicy>,
                TopLeftOriginPolicy>.Import(in context);
        result.IsSuccess.Should().BeTrue(result.ErrorMessage ?? string.Empty);
        result.ErrorCode.Should().BeNull();
    }

    [Fact]
    public void Chain_ReportsTheRealReason_ForBrokenJson()
    {
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", "{ \"id\": ");

        Asset2DImportResult<TopLeftOriginPolicy> result =
            ImporterChain<
                TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>,
                SpriteAtlasJsonImporter<TopLeftOriginPolicy>,
                TopLeftOriginPolicy>.Import(in context);

        result.IsSuccess.Should().BeFalse();
        result.ErrorCode.Should().Be("asset2d.atlas.json.malformed");
        result.ErrorMessage.Should().StartWith("No importer could read the asset at 'sprites/hero.spriteatlas.json'");
    }

    [Fact]
    public void Chain_ReportsNotFound_WhenEveryImporterDeclines()
    {
        AssetImportContext context = Context("readme.txt", "hello");

        Asset2DImportResult<TopLeftOriginPolicy> result =
            ImporterChain<
                TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>,
                SpriteAtlasJsonImporter<TopLeftOriginPolicy>,
                TopLeftOriginPolicy>.Import(in context);

        result.IsSuccess.Should().BeFalse();
        result.ErrorCode.Should().Be("asset2d.importer.not-found");
        result.ErrorMessage.Should().Contain("No registered importer");
    }

    [Fact]
    public void Import_RejectsValidationFailure_WithTheThrownCode()
    {
        const string zeroSized = """
            {
              "id": "hero",
              "textureId": "hero.png",
              "textureSize": { "width": 8, "height": 8 },
              "frames": [
                { "id": "hero_idle_1", "region": { "x": 0, "y": 0, "width": 0, "height": 8 } }
              ]
            }
            """;
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", zeroSized);

        Asset2DImportResult<TopLeftOriginPolicy> result =
            SpriteAtlasJsonImporter<TopLeftOriginPolicy>.Import(in context);

        result.IsSuccess.Should().BeFalse();
        result.ErrorCode.Should().Be(Asset2DValidationException.ValidationErrorCode);
        result.ErrorMessage.Should().NotBeNullOrWhiteSpace();
    }

    [Theory]
    [InlineData("""
        { "id": "hero", "textureId": "hero.png", "frames": [] }
        """, "asset2d.atlas.textureSize.missing")]
    [InlineData("""
        { "id": "hero", "textureId": "hero.png", "textureSize": { "width": 8, "height": 8 }, "frames": [] }
        """, "asset2d.atlas.frames.empty")]
    public void Canonical_Import_ReportsTheCodedSchemaFailure(string json, string expectedCode)
    {
        AssetImportContext context = Context("sprites/hero.spriteatlas.json", json);

        Asset2DImportResult<TopLeftOriginPolicy> result =
            SpriteAtlasJsonImporter<TopLeftOriginPolicy>.Import(in context);

        result.IsSuccess.Should().BeFalse();
        result.ErrorCode.Should().Be(expectedCode);
    }

    [Theory]
    [InlineData("""
        { "frames": {}, "meta": { "image": "a.png", "size": { "w": 8, "h": 8 } } }
        """)]
    [InlineData("""
        { "frames": { "f": { "frame": { "x": 0, "y": 0, "w": 8, "h": 8 } } }, "meta": { "image": "a.png" } }
        """)]
    public void TexturePacker_Import_ReportsTheCodedSchemaFailure(string json)
    {
        AssetImportContext context = Context("sprites/run.json", json);

        TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>.Probe(in context).Verdict
            .Should().Be(Asset2DProbeVerdict.Mine);
        Asset2DImportResult<TopLeftOriginPolicy> result =
            TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>.Import(in context);

        result.IsSuccess.Should().BeFalse();
        result.ErrorCode.Should().Be("asset2d.atlas.texturepacker.sections.missing");
    }

    private static AssetImportContext Context(string path, string content) =>
        new(path.AsSpan(), Encoding.UTF8.GetBytes(content));
}
