namespace Axrone.Ui.Assets.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiAssetDependencyScannerTests
{
    [Fact]
    public void ScansFontTextureMaterialAndNodeMaterialReferences()
    {
        var doc = new Doc();
        UiNodeId text = doc.Add(UiNodeKind.Text);
        doc.Builder.TrySetText(text, TextWithFamily("Inter")).Should().BeTrue();
        UiNodeId texture = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(texture, Texture("ui/icon.png")).Should().BeTrue();
        UiNodeId materialImage = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(materialImage, MaterialImage("mat.button")).Should().BeTrue();
        UiNodeId button = doc.Add(UiNodeKind.Button);
        doc.Builder.TrySetMaterial(button, "mat.overlay".AsSpan()).Should().BeTrue();

        var scanner = new UiAssetDependencyScanner();
        bool scanned = scanner.TryScan(doc.Build(), out UiDocumentError failure);

        scanned.Should().BeTrue(failure.Message);
        scanner.Resources.Should().HaveCount(4);
        scanner.Resources.Should().Contain(r => r.Path == "Inter" && r.MediaType == "font/family");
        scanner.Resources.Should().Contain(r => r.Path == "ui/icon.png" && r.MediaType == "image/png");
        scanner.Resources.Should().Contain(r => r.Path == "mat.button" && r.MediaType == "application/x-axrone-material");
        scanner.Resources.Should().Contain(r => r.Path == "mat.overlay" && r.MediaType == "application/x-axrone-material");
        scanner.Resources.Should().OnlyContain(r => r.ByteLength == 0);
        scanner.Resources.Should().OnlyContain(r => r.Id.IsValid);
    }

    [Fact]
    public void DeduplicatesRepeatedReferencesAcrossNodes()
    {
        var doc = new Doc();
        for (int i = 0; i < 2; i++)
        {
            UiNodeId text = doc.Add(UiNodeKind.Text);
            doc.Builder.TrySetText(text, TextWithFamily("Inter")).Should().BeTrue();
            UiNodeId texture = doc.Add(UiNodeKind.Image);
            doc.Builder.TrySetImage(texture, Texture("ui/icon.png")).Should().BeTrue();
            UiNodeId button = doc.Add(UiNodeKind.Button);
            doc.Builder.TrySetMaterial(button, "mat.overlay".AsSpan()).Should().BeTrue();
        }

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeTrue(failure.Message);

        scanner.Resources.Should().HaveCount(3);
        scanner.Resources.Should().OnlyHaveUniqueItems(r => r.Id);
        scanner.Resources.Count(r => r.Path == "ui/icon.png").Should().Be(1);
    }

    [Fact]
    public void SkipsEmptyAndAbsentReferences()
    {
        var doc = new Doc();
        UiNodeId emptyText = doc.Add(UiNodeKind.Text);
        doc.Builder.TrySetText(emptyText, UiNodeText.Default).Should().BeTrue();
        UiNodeId emptyImage = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(emptyImage, UiNodeImage.Default).Should().BeTrue();
        _ = doc.Add(UiNodeKind.Container);

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeTrue(failure.Message);

        scanner.Resources.Should().BeEmpty();
    }

    [Fact]
    public void ScansNestedDescendants()
    {
        var doc = new Doc();
        UiNodeId container = doc.Add(UiNodeKind.Container);
        UiNodeId nested = doc.AddTo(container, UiNodeKind.Container);
        UiNodeId deepImage = doc.AddTo(nested, UiNodeKind.Image);
        doc.Builder.TrySetImage(deepImage, Texture("deep/tex.png")).Should().BeTrue();

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeTrue(failure.Message);

        scanner.Resources.Should().ContainSingle(r => r.Path == "deep/tex.png" && r.MediaType == "image/png");
    }

    [Fact]
    public void SortsResourcesByIdAndRepeatsDeterministically()
    {
        var doc = new Doc();
        UiNodeId text = doc.Add(UiNodeKind.Text);
        doc.Builder.TrySetText(text, TextWithFamily("Zeta")).Should().BeTrue();
        UiNodeId texture = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(texture, Texture("alpha.png")).Should().BeTrue();
        UiNodeId material = doc.Add(UiNodeKind.Button);
        doc.Builder.TrySetMaterial(material, "mat.alpha".AsSpan()).Should().BeTrue();

        var scanner = new UiAssetDependencyScanner();
        UiAssetDocument document = doc.Build();
        scanner.TryScan(document, out _).Should().BeTrue();
        (UiResourceId, string, string)[] first = Capture(scanner);

        for (int i = 1; i < first.Length; i++)
        {
            first[i - 1].Item1.Value.Should().BeLessThan(first[i].Item1.Value);
        }

        scanner.TryScan(document, out _).Should().BeTrue();
        Capture(scanner).Should().Equal(first);
    }

    [Fact]
    public void SamePathInDifferentKindsProducesDistinctIdentities()
    {
        var doc = new Doc();
        UiNodeId texture = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(texture, Texture("shared/path")).Should().BeTrue();
        UiNodeId materialImage = doc.Add(UiNodeKind.Image);
        doc.Builder.TrySetImage(materialImage, MaterialImage("shared/path")).Should().BeTrue();

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(doc.Build(), out _).Should().BeTrue();

        scanner.Resources.Should().HaveCount(2);
        scanner.Resources[0].Id.Should().NotBe(scanner.Resources[1].Id);
        scanner.Resources[0].Path.Should().Be(scanner.Resources[1].Path);
    }

    [Fact]
    public void MapsTextureExtensionsToMediaTypes()
    {
        var doc = new Doc();
        string[] paths = ["a.png", "b.JPG", "c.webp", "d.bin"];
        foreach (string path in paths)
        {
            UiNodeId image = doc.Add(UiNodeKind.Image);
            doc.Builder.TrySetImage(image, Texture(path)).Should().BeTrue();
        }

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(doc.Build(), out _).Should().BeTrue();

        scanner.Resources.Should().HaveCount(4);
        scanner.Resources.Should().Contain(r => r.Path == "a.png" && r.MediaType == "image/png");
        scanner.Resources.Should().Contain(r => r.Path == "b.JPG" && r.MediaType == "image/jpeg");
        scanner.Resources.Should().Contain(r => r.Path == "c.webp" && r.MediaType == "image/webp");
        scanner.Resources.Should().Contain(r => r.Path == "d.bin" && r.MediaType == "application/octet-stream");
    }

    [Fact]
    public void RejectsDocumentWithoutRoot()
    {
        var storage = new UiDocumentStorage(4, 1, 64);
        var document = new UiAssetDocument(
            storage,
            new UiDocumentInfo(new UiDocumentId(1), "empty", 1, default),
            "ui.empty");

        var scanner = new UiAssetDependencyScanner();
        scanner.TryScan(document, out UiDocumentError failure).Should().BeFalse();

        failure.Code.Should().Be(UiDocumentErrorCode.MissingRoot);
        scanner.Resources.Should().BeEmpty();
    }

    [Fact]
    public void EnforcesResourceLimitForUniqueReferences()
    {
        var doc = new Doc();
        for (int i = 0; i < 3; i++)
        {
            UiNodeId image = doc.Add(UiNodeKind.Image);
            doc.Builder.TrySetImage(image, Texture($"ui/{i}.png")).Should().BeTrue();
        }

        var scanner = new UiAssetDependencyScanner(maxResources: 2);
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeFalse();

        failure.Code.Should().Be(UiDocumentErrorCode.ResourceLimit);
        scanner.Resources.Should().HaveCount(2);
    }

    [Fact]
    public void AllowsExactlyTheResourceLimit()
    {
        var doc = new Doc();
        for (int i = 0; i < 3; i++)
        {
            UiNodeId image = doc.Add(UiNodeKind.Image);
            doc.Builder.TrySetImage(image, Texture($"ui/{i}.png")).Should().BeTrue();
        }

        var scanner = new UiAssetDependencyScanner(maxResources: 3);
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeTrue(failure.Message);

        scanner.Resources.Should().HaveCount(3);
    }

    [Fact]
    public void DuplicateReferencesDoNotConsumeTheLimit()
    {
        var doc = new Doc();
        for (int i = 0; i < 4; i++)
        {
            UiNodeId image = doc.Add(UiNodeKind.Image);
            doc.Builder.TrySetImage(image, Texture("ui/shared.png")).Should().BeTrue();
        }

        var scanner = new UiAssetDependencyScanner(maxResources: 1);
        scanner.TryScan(doc.Build(), out UiDocumentError failure).Should().BeTrue(failure.Message);

        scanner.Resources.Should().ContainSingle();
    }

    [Fact]
    public void ScannerRejectsNonPositiveLimit()
    {
        FluentActions.Invoking(static () => new UiAssetDependencyScanner(maxResources: 0))
            .Should().Throw<ArgumentOutOfRangeException>();
    }

    private static (UiResourceId Id, string Path, string MediaType)[] Capture(UiAssetDependencyScanner scanner)
    {
        var captured = new (UiResourceId, string, string)[scanner.Resources.Count];
        for (int i = 0; i < captured.Length; i++)
        {
            UiAssetResource resource = scanner.Resources[i];
            captured[i] = (resource.Id, resource.Path, resource.MediaType);
        }

        return captured;
    }

    private static UiNodeText TextWithFamily(string family) => UiNodeText.Default with
    {
        Value = "text",
        Family = family,
    };

    private static UiNodeImage Texture(string path) => UiNodeImage.Default with { ResourceId = path };

    private static UiNodeImage MaterialImage(string path) => UiNodeImage.Default with
    {
        SourceKind = UiImageSourceKind.Material,
        ResourceId = path,
    };

    private sealed class Doc
    {
        private const UiNodeFlags NodeFlags =
            UiNodeFlags.Visible | UiNodeFlags.Enabled | UiNodeFlags.Interactive;

        public Doc()
        {
            Root = Builder.CreateNode(UiNodeKind.Root, NodeFlags);
            _ = Builder.TrySetRole(Root, "root".AsSpan());
        }

        public UiAssetDocumentBuilder Builder { get; } = new();

        public UiNodeId Root { get; }

        public UiNodeId Add(UiNodeKind kind = UiNodeKind.Container) => AddTo(Root, kind);

        public UiNodeId AddTo(UiNodeId parent, UiNodeKind kind = UiNodeKind.Container)
        {
            UiNodeId id = Builder.CreateNode(kind, NodeFlags);
            if (!Builder.TryAppendChild(parent, id))
            {
                throw new InvalidOperationException("Test document append failed.");
            }

            return id;
        }

        public UiAssetDocument Build() => Builder.Build(new UiDocumentInfo(
            new UiDocumentId(1),
            "scan",
            1,
            new UiCanvasConfig(1.0f, 1.0f, UiCanvasScaleMode.Fill, 0.5f, UiEdgeInsets.Zero)));
    }
}
