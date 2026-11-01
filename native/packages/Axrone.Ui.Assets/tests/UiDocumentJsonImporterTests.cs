namespace Axrone.Ui.Assets.Tests;

using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiDocumentJsonImporterTests
{
    private const string MenuJson =
        "{\"version\":1,\"id\":\"ui.menu\",\"name\":\"Menu\",\"canvas\":{\"referenceWidth\":1920,\"referenceHeight\":1080,\"scaleMode\":\"match-width\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"Play\",\"family\":\"Inter\",\"size\":18}},{\"role\":\"image\",\"image\":{\"source\":{\"kind\":\"texture\",\"resourceId\":\"ui/icon.png\",\"width\":32,\"height\":32},\"fit\":\"contain\"}},{\"role\":\"image\",\"image\":{\"source\":{\"kind\":\"material\",\"materialId\":\"mat.button\"}}},{\"role\":\"button\",\"key\":\"play\",\"material\":\"mat.overlay\",\"children\":[{\"role\":\"image\",\"image\":{\"source\":{\"kind\":\"texture\",\"resourceId\":\"ui/icon.png\"}}}]}]},\"bindings\":{\"title\":\"Play\",\"score\":3,\"paused\":true,\"selected\":null}}";

    [Theory]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\"}", true)]
    [InlineData("  {\"id\":\"ui.x\"}", true)]
    [InlineData("{\"name\":\"X\"}", true)]
    [InlineData("{\"role\":\"root\"}", false)]
    [InlineData("[", false)]
    [InlineData("", false)]
    [InlineData("{", false)]
    public void CanImportProbesTheFirstKey(string header, bool expected)
    {
        var importer = new UiDocumentJsonImporter();
        importer.CanImport(Encoding.UTF8.GetBytes(header)).Should().Be(expected);
    }

    [Fact]
    public void CanImportSkipsUtf8Bom()
    {
        byte[] bom = [0xEF, 0xBB, 0xBF, (byte)'{', (byte)'"', (byte)'v', (byte)'e', (byte)'r', (byte)'s', (byte)'i', (byte)'o', (byte)'n', (byte)'"'];
        new UiDocumentJsonImporter().CanImport(bom).Should().BeTrue();
    }

    [Fact]
    public void ImportRebuildsDocumentAndScansResources()
    {
        var importer = new UiDocumentJsonImporter();
        var collector = new UiAssetImportCollector();

        importer.TryImport(Encoding.UTF8.GetBytes(MenuJson), collector, out UiDocumentError failure)
            .Should().BeTrue(failure.Message);

        collector.DocumentCount.Should().Be(1);
        collector.ResourceCount.Should().Be(4);

        UiAssetDocument document = collector.Documents[0].Should().BeOfType<UiAssetDocument>().Subject;
        document.AssetId.Should().Be("ui.menu");
        document.Nodes.Count.Should().Be(6);
        document.Bindings.Count.Should().Be(4);

        collector.Resources.Should().Contain(r => r.Path == "Inter" && r.MediaType == "font/family");
        collector.Resources.Should().Contain(r => r.Path == "ui/icon.png" && r.MediaType == "image/png");
        collector.Resources.Should().Contain(r => r.Path == "mat.button" && r.MediaType == "application/x-axrone-material");
        collector.Resources.Should().Contain(r => r.Path == "mat.overlay" && r.MediaType == "application/x-axrone-material");

        for (int i = 1; i < collector.Resources.Count; i++)
        {
            collector.Resources[i - 1].Id.Value.Should().BeLessThan(collector.Resources[i].Id.Value);
        }
    }

    [Fact]
    public void DuplicateReferencesAreDeduplicated()
    {
        var importer = new UiDocumentJsonImporter();
        var collector = new UiAssetImportCollector();
        importer.TryImport(Encoding.UTF8.GetBytes(MenuJson), collector, out _).Should().BeTrue();

        collector.Resources.Should().OnlyHaveUniqueItems(r => r.Id);
        collector.Resources.Count(r => r.Path == "ui/icon.png").Should().Be(1);
    }

    [Fact]
    public void ImportedDocumentsSurviveLaterImports()
    {
        var importer = new UiDocumentJsonImporter();
        var first = new UiAssetImportCollector();
        importer.TryImport(Encoding.UTF8.GetBytes(MenuJson), first, out _).Should().BeTrue();

        const string other =
            "{\"version\":1,\"id\":\"ui.other\",\"name\":\"Other\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"}}";
        var second = new UiAssetImportCollector();
        importer.TryImport(Encoding.UTF8.GetBytes(other), second, out _).Should().BeTrue();

        first.Documents[0].Info.Name.Should().Be("Menu");
        second.Documents[0].Info.Name.Should().Be("Other");
    }

    [Fact]
    public void ResourceIdentityIsStableAcrossImports()
    {
        var first = new UiAssetImportCollector();
        var second = new UiAssetImportCollector();
        new UiDocumentJsonImporter().TryImport(Encoding.UTF8.GetBytes(MenuJson), first, out _).Should().BeTrue();
        new UiDocumentJsonImporter().TryImport(Encoding.UTF8.GetBytes(MenuJson), second, out _).Should().BeTrue();

        first.Resources.Select(static r => r.Id).Should().Equal(second.Resources.Select(static r => r.Id));
    }

    [Fact]
    public void MalformedPayloadLeavesSinkUntouched()
    {
        var collector = new UiAssetImportCollector();
        bool imported = new UiDocumentJsonImporter()
            .TryImport(Encoding.UTF8.GetBytes("{\"version\":1}"), collector, out UiDocumentError failure);

        imported.Should().BeFalse();
        failure.Code.Should().Be(UiDocumentErrorCode.Malformed);
        collector.DocumentCount.Should().Be(0);
        collector.ResourceCount.Should().Be(0);
    }

    [Fact]
    public void ImportRejectsNullSink()
    {
        FluentActions.Invoking(() => new UiDocumentJsonImporter()
                .TryImport(Encoding.UTF8.GetBytes(MenuJson), null!, out _))
            .Should().Throw<ArgumentNullException>();
    }
}
