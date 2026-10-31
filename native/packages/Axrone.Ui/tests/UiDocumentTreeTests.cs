namespace Axrone.Ui.Tests;

using FluentAssertions;
using Xunit;

public sealed class UiDocumentTreeTests
{
    private static readonly UiDocumentInfo Info = new(new UiDocumentId(1), "test", 1, default);

    [Fact]
    public void BuildSnapshotsRootAndChildOrder()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId first = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId second = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        builder.TryAppendChild(root, first).Should().BeTrue();
        builder.TryAppendChild(root, second).Should().BeTrue();

        IUiDocument document = builder.Build(Info);

        document.Info.Should().Be(Info);
        document.Nodes.Count.Should().Be(3);
        document.Nodes.Root.Should().Be(root);
        document.Nodes.GetChildren(root).ToArray().Should().Equal(first, second);
        document.Nodes.GetChildren(first).Length.Should().Be(0);
    }

    [Fact]
    public void RecordsCarryParentAndSiblingLinks()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId first = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId second = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        builder.TryAppendChild(root, first);
        builder.TryAppendChild(root, second);

        IUiNodeTree nodes = builder.Build(Info).Nodes;

        nodes.TryGetNode(root, out UiNodeRecord rootRecord).Should().BeTrue();
        rootRecord.Parent.Should().Be(UiNodeId.Invalid);
        rootRecord.FirstChild.Should().Be(first);

        nodes.TryGetNode(first, out UiNodeRecord firstRecord).Should().BeTrue();
        firstRecord.Parent.Should().Be(root);
        firstRecord.NextSibling.Should().Be(second);

        nodes.TryGetNode(second, out UiNodeRecord secondRecord).Should().BeTrue();
        secondRecord.NextSibling.Should().Be(UiNodeId.Invalid);
    }

    [Fact]
    public void RemovedSubtreeIdsBecomeStale()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId branch = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId leaf = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        builder.TryAppendChild(root, branch);
        builder.TryAppendChild(branch, leaf);

        builder.TryRemoveNode(branch).Should().BeTrue();
        builder.LiveNodeCount.Should().Be(1);

        IUiNodeTree nodes = builder.Build(Info).Nodes;
        nodes.TryGetNode(branch, out _).Should().BeFalse();
        nodes.TryGetNode(leaf, out _).Should().BeFalse();
        nodes.GetChildren(root).Length.Should().Be(0);
        nodes.Count.Should().Be(1);
    }

    [Fact]
    public void RecycledSlotRejectsStaleHandle()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId old = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);

        builder.TryRemoveNode(old).Should().BeTrue();
        UiNodeId replacement = builder.CreateNode(UiNodeKind.Button, UiNodeFlags.Visible);
        builder.TryAppendChild(root, replacement).Should().BeTrue();

        replacement.Should().NotBe(old);

        IUiNodeTree nodes = builder.Build(Info).Nodes;
        nodes.TryGetNode(old, out _).Should().BeFalse();
        nodes.TryGetNode(replacement, out UiNodeRecord record).Should().BeTrue();
        record.Kind.Should().Be(UiNodeKind.Button);
    }

    [Fact]
    public void AppendingCyclesIsRejected()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId branch = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId leaf = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        builder.TryAppendChild(root, branch).Should().BeTrue();
        builder.TryAppendChild(branch, leaf).Should().BeTrue();

        builder.TryAppendChild(leaf, root).Should().BeFalse();
        builder.TryAppendChild(branch, root).Should().BeFalse();
        builder.TryAppendChild(branch, branch).Should().BeFalse();
        builder.TryAppendChild(leaf, branch).Should().BeFalse();
    }

    [Fact]
    public void BuildRejectsMissingOrMultipleRoots()
    {
        UiDocumentBuilder empty = new();
        Action emptyBuild = () => empty.Build(Info);
        emptyBuild.Should().Throw<InvalidOperationException>();

        UiDocumentBuilder forest = new();
        forest.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        forest.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        Action forestBuild = () => forest.Build(Info);
        forestBuild.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void SnapshotIsImmutableAcrossBuilderMutations()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId first = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        builder.TryAppendChild(root, first);

        UiDocument document = (UiDocument)builder.Build(Info);

        UiNodeId second = builder.CreateNode(UiNodeKind.Image, UiNodeFlags.Visible);
        builder.TryAppendChild(root, second);

        document.Nodes.GetChildren(root).Length.Should().Be(1);
        document.Nodes.TryGetNode(second, out _).Should().BeFalse();
        document.Nodes.Count.Should().Be(2);
    }

    [Fact]
    public void UnknownIdentifiersResolveToEmpty()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        IUiNodeTree nodes = builder.Build(Info).Nodes;

        nodes.TryGetNode(UiNodeId.Invalid, out _).Should().BeFalse();
        nodes.TryGetNode(new UiNodeId(123456), out _).Should().BeFalse();
        nodes.GetChildren(UiNodeId.Invalid).Length.Should().Be(0);
        nodes.GetChildren(new UiNodeId(123456)).Length.Should().Be(0);
        nodes.GetChildren(root).Length.Should().Be(0);
    }

    [Fact]
    public void RepeatedBuildsAreDeterministic()
    {
        UiDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        UiNodeId child = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        builder.TryAppendChild(root, child);

        UiDocument first = (UiDocument)builder.Build(Info);
        UiDocument second = (UiDocument)builder.Build(Info);

        first.Nodes.Root.Should().Be(second.Nodes.Root);
        first.Nodes.GetChildren(root).ToArray().Should().Equal(second.Nodes.GetChildren(root).ToArray());
        first.Nodes.Count.Should().Be(second.Nodes.Count);
    }
}
