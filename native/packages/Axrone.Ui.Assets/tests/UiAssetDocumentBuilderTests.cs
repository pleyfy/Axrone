namespace Axrone.Ui.Assets.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiAssetDocumentBuilderTests
{
    [Fact]
    public void BuildPreservesHierarchyAndSiblingOrder()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        UiNodeId root = new(1);
        UiNodeId first = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId second = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId third = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        builder.TryAppendChild(root, first).Should().BeTrue();
        builder.TryAppendChild(root, second).Should().BeTrue();
        builder.TryAppendChild(first, third).Should().BeTrue();

        UiAssetDocument document = builder.Build(UiTestDocuments.Info());

        document.Nodes.Count.Should().Be(4);
        document.Nodes.Root.Should().Be(new UiNodeId(1));
        document.Nodes.GetChildren(new UiNodeId(1)).ToArray().Should().Equal(new UiNodeId(2), new UiNodeId(3));
        document.Nodes.GetChildren(new UiNodeId(2)).ToArray().Should().Equal(new UiNodeId(4));
        document.Nodes.TryGetNode(new UiNodeId(4), out UiNodeRecord leaf).Should().BeTrue();
        leaf.Parent.Should().Be(new UiNodeId(2));
        leaf.Kind.Should().Be(UiNodeKind.Text);
    }

    [Fact]
    public void AppendRejectsCyclesAndReparenting()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        UiNodeId root = new(1);
        UiNodeId child = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        builder.TryAppendChild(root, child).Should().BeTrue();

        builder.TryAppendChild(root, root).Should().BeFalse();
        builder.TryAppendChild(child, root).Should().BeFalse();
        builder.TryAppendChild(root, child).Should().BeFalse();
        builder.TryAppendChild(new UiNodeId(99), child).Should().BeFalse();
    }

    [Fact]
    public void RemoveCompactsIdentitiesAndDetachesSubtree()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        UiNodeId root = new(1);
        UiNodeId removed = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId kept = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId grandChild = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        builder.TryAppendChild(root, removed).Should().BeTrue();
        builder.TryAppendChild(root, kept).Should().BeTrue();
        builder.TryAppendChild(removed, grandChild).Should().BeTrue();

        builder.TryRemoveNode(removed).Should().BeTrue();
        builder.NodeCount.Should().Be(2);

        UiAssetDocument document = builder.Build(UiTestDocuments.Info());

        document.Nodes.Count.Should().Be(2);
        document.Nodes.GetChildren(new UiNodeId(1)).ToArray().Should().Equal(new UiNodeId(2));
        document.Nodes.TryGetNode(new UiNodeId(3), out _).Should().BeFalse();
    }

    [Fact]
    public void BuildRequiresExactlyOneRoot()
    {
        UiAssetDocumentBuilder empty = new();
        empty.Invoking(static b => b.Build(UiTestDocuments.Info())).Should().Throw<InvalidOperationException>();

        UiAssetDocumentBuilder twoRoots = new();
        _ = twoRoots.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        _ = twoRoots.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        twoRoots.Invoking(static b => b.Build(UiTestDocuments.Info())).Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void BuildRejectsInvalidMetadata()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        builder.Invoking(static b => b.Build(new UiDocumentInfo(new UiDocumentId(1), string.Empty, 1, default)))
            .Should().Throw<ArgumentException>();
        builder.Invoking(static b => b.Build(new UiDocumentInfo(new UiDocumentId(1), "x", 0, default)))
            .Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void PayloadsRoundTripThroughBuild()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        UiNodeId root = new(1);
        UiNodeId node = builder.CreateNode(UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Interactive);
        builder.TryAppendChild(root, node).Should().BeTrue();
        builder.TrySetRole(node, "button".AsSpan()).Should().BeTrue();
        builder.TrySetController(node, "button-feedback".AsSpan()).Should().BeTrue();
        builder.TrySetKey(node, UiBindingKey.FromNumber(7)).Should().BeTrue();
        builder.TrySetLayout(node, new UiLayoutStyle
        {
            Width = UiLength.Px(320.0f),
            Height = UiLength.Percent(50.0f),
            Padding = new UiEdgeInsets(1.0f, 2.0f, 3.0f, 4.0f),
            ZIndex = 5,
        }).Should().BeTrue();
        builder.TrySetStyle(node, new UiWidgetStyle(
            true,
            0.75f,
            true,
            new UiColor(0.1f, 0.2f, 0.3f, 1.0f),
            UiColor.White,
            2.0f,
            new UiCornerRadii(4.0f, 4.0f, 4.0f, 4.0f),
            UiColor.Black)).Should().BeTrue();
        builder.TrySetImage(node, new UiNodeImage(
            UiImageSourceKind.Material,
            "mat.button",
            UiImageFit.Cover,
            UiColor.White,
            UiEdgeInsets.Zero,
            UiUvRect.Full,
            new UiSize(32.0f, 32.0f),
            true,
            true)).Should().BeTrue();
        builder.TrySetFocus(node, new UiNodeFocus(3, 2, true, true, UiColor.White, 1.5f, 2.5f)).Should().BeTrue();
        builder.TrySetMaterial(node, "mat.overlay".AsSpan()).Should().BeTrue();
        builder.AssetId = "ui.sample";

        UiAssetDocument document = builder.Build(UiTestDocuments.Info());

        document.AssetId.Should().Be("ui.sample");
        document.TryGetRole(node, out string? role).Should().BeTrue();
        role.Should().Be("button");
        document.TryGetController(node, out string? controller).Should().BeTrue();
        controller.Should().Be("button-feedback");
        document.TryGetKey(node, out UiBindingKey key).Should().BeTrue();
        key.Kind.Should().Be(UiKeyKind.Numeric);
        key.Number.Should().Be(7);

        document.TryGetLayout(node, out UiLayoutStyle layout).Should().BeTrue();
        layout.Width.Should().Be(UiLength.Px(320.0f));
        layout.Height.Should().Be(UiLength.Percent(50.0f));
        layout.Padding.Should().Be(new UiEdgeInsets(1.0f, 2.0f, 3.0f, 4.0f));
        layout.ZIndex.Should().Be(5);

        document.TryGetStyle(node, out UiWidgetStyle style).Should().BeTrue();
        style.Opacity.Should().Be(0.75f);
        style.Background.Should().Be(new UiColor(0.1f, 0.2f, 0.3f, 1.0f));

        document.TryGetImage(node, out UiNodeImage image).Should().BeTrue();
        image.SourceKind.Should().Be(UiImageSourceKind.Material);
        image.ResourceId.Should().Be("mat.button");
        image.Fit.Should().Be(UiImageFit.Cover);
        image.Bleed.Should().BeTrue();

        document.TryGetFocus(node, out UiNodeFocus focus).Should().BeTrue();
        focus.TabIndex.Should().Be(3);
        focus.Scope.Should().BeTrue();

        document.TryGetMaterialUtf8(node, out ReadOnlySpan<byte> materialUtf8).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(materialUtf8).Should().Be("mat.overlay");
        document.TryGetMaterial(node, out UiResourceId material).Should().BeTrue();
        material.Should().Be(new UiResourceId(Axrone.Asset.Fnv1a64.Compute(materialUtf8)));
    }

    [Fact]
    public void SettersRejectUnknownNodes()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        UiNodeId missing = new(42);

        builder.TrySetRole(missing, "x".AsSpan()).Should().BeFalse();
        builder.TrySetLayout(missing, UiLayoutStyle.Default).Should().BeFalse();
        builder.TrySetStyle(missing, UiWidgetStyle.Default).Should().BeFalse();
        builder.TrySetText(missing, UiNodeText.Default).Should().BeFalse();
        builder.TrySetImage(missing, UiNodeImage.Default).Should().BeFalse();
        builder.TrySetFocus(missing, UiNodeFocus.Default).Should().BeFalse();
        builder.TrySetMaterial(missing, "m".AsSpan()).Should().BeFalse();
        builder.TrySetKey(missing, UiBindingKey.FromString("k")).Should().BeFalse();
    }

    [Fact]
    public void ResetClearsTreeBindingsAndAssetId()
    {
        UiAssetDocumentBuilder builder = UiTestDocuments.CreateBuilder();
        builder.Bindings.SetBoolean("flag", true);
        builder.AssetId = "ui.x";

        builder.Reset();

        builder.NodeCount.Should().Be(0);
        builder.Bindings.Count.Should().Be(0);
        builder.AssetId.Should().BeEmpty();
        builder.Invoking(static b => b.Build(UiTestDocuments.Info())).Should().Throw<InvalidOperationException>();
    }
}
