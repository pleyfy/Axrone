namespace Axrone.Ui.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiLayoutEngineTests
{
    private const float Epsilon = 0.0001f;

    [Fact]
    public void ColumnMeasuresIntrinsicHeightWithGap()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle { Direction = UiAxis.Column, AlignItems = UiAlign.Start, Gap = 5.0f });
        harness.AddLeaf(root, Leaf(), new UiSize(30.0f, 10.0f));
        harness.AddLeaf(root, Leaf(), new UiSize(20.0f, 20.0f));
        harness.Freeze();

        UiMeasureResult measured = harness.Measure(root);

        measured.Size.Width.Should().BeApproximately(30.0f, Epsilon);
        measured.Size.Height.Should().BeApproximately(35.0f, Epsilon);
    }

    [Fact]
    public void RowAddsPaddingBorderAndGap()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Gap = 5.0f,
            Padding = new UiEdgeInsets(10.0f, 10.0f, 10.0f, 10.0f),
            BorderWidth = 1.0f,
        });
        harness.AddLeaf(root, Leaf(), new UiSize(20.0f, 10.0f));
        harness.AddLeaf(root, Leaf(), new UiSize(30.0f, 10.0f));
        harness.Freeze();

        UiMeasureResult measured = harness.Measure(root);
        measured.Size.Width.Should().BeApproximately(77.0f, Epsilon);
        measured.Size.Height.Should().BeApproximately(32.0f, Epsilon);

        harness.Arrange(root, new Rect(0.0f, 0.0f, 77.0f, 32.0f));
        Rect content = harness.Sink.Boxes[root].Content;
        content.X.Should().BeApproximately(11.0f, Epsilon);
        content.Y.Should().BeApproximately(11.0f, Epsilon);
        content.Width.Should().BeApproximately(55.0f, Epsilon);
        content.Height.Should().BeApproximately(10.0f, Epsilon);
    }

    [Fact]
    public void PercentLengthsResolveAgainstContent()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(100.0f),
        });
        UiLayoutStyle percent = Leaf();
        percent = percent with { Width = UiLength.Percent(50.0f), Height = UiLength.Percent(50.0f) };
        harness.AddLeaf(root, percent, new UiSize(0.0f, 0.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 100.0f));

        Rect bounds = harness.Sink.Boxes[harness.ChildrenOf(root)[0]].Bounds;
        bounds.Width.Should().BeApproximately(100.0f, Epsilon);
        bounds.Height.Should().BeApproximately(50.0f, Epsilon);
    }

    [Fact]
    public void StretchLengthFillsContentExtent()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(200.0f),
        });
        UiLayoutStyle stretch = Leaf() with { Width = UiLength.Stretch(1.0f) };
        UiNodeId child = harness.AddLeaf(root, stretch, new UiSize(0.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 10.0f));

        harness.Sink.Boxes[child].Bounds.Width.Should().BeApproximately(200.0f, Epsilon);
    }

    [Fact]
    public void GrowDistributesPositiveFreeSpaceByWeight()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(200.0f),
        });
        UiNodeId small = harness.AddLeaf(root, Leaf() with { Grow = 1.0f }, new UiSize(50.0f, 10.0f));
        UiNodeId large = harness.AddLeaf(root, Leaf() with { Grow = 3.0f }, new UiSize(50.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 10.0f));

        Rect smallBounds = harness.Sink.Boxes[small].Bounds;
        Rect largeBounds = harness.Sink.Boxes[large].Bounds;
        smallBounds.Width.Should().BeApproximately(75.0f, Epsilon);
        largeBounds.X.Should().BeApproximately(75.0f, Epsilon);
        largeBounds.Width.Should().BeApproximately(125.0f, Epsilon);
    }

    [Fact]
    public void ShrinkDistributesNegativeFreeSpaceByWeight()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(100.0f),
        });
        UiNodeId first = harness.AddLeaf(root, Leaf(), new UiSize(80.0f, 10.0f));
        UiNodeId second = harness.AddLeaf(root, Leaf(), new UiSize(80.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 100.0f, 10.0f));

        harness.Sink.Boxes[first].Bounds.Width.Should().BeApproximately(50.0f, Epsilon);
        harness.Sink.Boxes[second].Bounds.X.Should().BeApproximately(50.0f, Epsilon);
        harness.Sink.Boxes[second].Bounds.Width.Should().BeApproximately(50.0f, Epsilon);
    }

    [Fact]
    public void WrapBreaksLinesAtContentWidth()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            FlexWrap = UiFlexWrap.Wrap,
            Gap = 5.0f,
            Width = UiLength.Px(100.0f),
        });
        UiNodeId first = harness.AddLeaf(root, Leaf(), new UiSize(40.0f, 10.0f));
        UiNodeId second = harness.AddLeaf(root, Leaf(), new UiSize(40.0f, 10.0f));
        UiNodeId third = harness.AddLeaf(root, Leaf(), new UiSize(40.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 100.0f, 25.0f));

        harness.Sink.Boxes[first].Bounds.X.Should().BeApproximately(0.0f, Epsilon);
        harness.Sink.Boxes[first].Bounds.Y.Should().BeApproximately(0.0f, Epsilon);
        harness.Sink.Boxes[second].Bounds.X.Should().BeApproximately(45.0f, Epsilon);
        harness.Sink.Boxes[second].Bounds.Y.Should().BeApproximately(0.0f, Epsilon);
        harness.Sink.Boxes[third].Bounds.X.Should().BeApproximately(0.0f, Epsilon);
        harness.Sink.Boxes[third].Bounds.Y.Should().BeApproximately(15.0f, Epsilon);
    }

    [Fact]
    public void SpaceBetweenSpreadsFreeSpaceAcrossGaps()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            JustifyContent = UiJustify.SpaceBetween,
            Width = UiLength.Px(200.0f),
        });
        UiNodeId first = harness.AddLeaf(root, Leaf(), new UiSize(50.0f, 10.0f));
        UiNodeId second = harness.AddLeaf(root, Leaf(), new UiSize(50.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 10.0f));

        harness.Sink.Boxes[first].Bounds.X.Should().BeApproximately(0.0f, Epsilon);
        harness.Sink.Boxes[second].Bounds.X.Should().BeApproximately(150.0f, Epsilon);
    }

    [Fact]
    public void AlignItemsAndAlignSelfPlaceChildrenOnCrossAxis()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Center,
            Width = UiLength.Px(100.0f),
            Height = UiLength.Px(100.0f),
        });
        UiNodeId centered = harness.AddLeaf(root, Leaf(), new UiSize(20.0f, 20.0f));
        UiNodeId end = harness.AddLeaf(root, Leaf() with { AlignSelf = UiAlignSelf.End }, new UiSize(20.0f, 20.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 100.0f, 100.0f));

        harness.Sink.Boxes[centered].Bounds.Y.Should().BeApproximately(40.0f, Epsilon);
        harness.Sink.Boxes[end].Bounds.Y.Should().BeApproximately(80.0f, Epsilon);
    }

    [Fact]
    public void MinAndMaxClampExplicitLengths()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(100.0f),
            MinWidth = 150.0f,
            MaxHeight = 40.0f,
            Height = UiLength.Px(90.0f),
        });
        harness.Freeze();

        UiMeasureResult measured = harness.Measure(root);

        measured.Size.Width.Should().BeApproximately(150.0f, Epsilon);
        measured.Size.Height.Should().BeApproximately(40.0f, Epsilon);
    }

    [Fact]
    public void AbsoluteChildUsesInsets()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(200.0f),
            Padding = new UiEdgeInsets(10.0f, 10.0f, 10.0f, 10.0f),
        });
        UiNodeId child = harness.AddLeaf(root, new UiLayoutStyle
        {
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(5.0f),
            InsetTop = UiLength.Px(6.0f),
            Width = UiLength.Px(30.0f),
            Height = UiLength.Px(40.0f),
        }, new UiSize(0.0f, 0.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 200.0f));

        Rect bounds = harness.Sink.Boxes[child].Bounds;
        bounds.X.Should().BeApproximately(15.0f, Epsilon);
        bounds.Y.Should().BeApproximately(16.0f, Epsilon);
        bounds.Width.Should().BeApproximately(30.0f, Epsilon);
        bounds.Height.Should().BeApproximately(40.0f, Epsilon);
    }

    [Fact]
    public void AbsoluteChildStretchesBetweenOpposingAnchors()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(200.0f),
        });
        UiNodeId child = harness.AddLeaf(root, new UiLayoutStyle
        {
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(10.0f),
            InsetRight = UiLength.Px(20.0f),
            InsetTop = UiLength.Px(5.0f),
        }, new UiSize(12.0f, 12.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 200.0f));

        Rect bounds = harness.Sink.Boxes[child].Bounds;
        bounds.X.Should().BeApproximately(10.0f, Epsilon);
        bounds.Y.Should().BeApproximately(5.0f, Epsilon);
        bounds.Width.Should().BeApproximately(170.0f, Epsilon);
        bounds.Height.Should().BeApproximately(12.0f, Epsilon);
    }

    [Fact]
    public void NestedContainersPropagateContentOrigins()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(100.0f),
        });
        UiNodeId panel = harness.AddContainer(root, new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Start,
            Width = UiLength.Px(100.0f),
            Height = UiLength.Px(80.0f),
        });
        UiNodeId leaf = harness.AddLeaf(panel, new UiLayoutStyle
        {
            Margin = new UiEdgeInsets(6.0f, 0.0f, 0.0f, 5.0f),
        }, new UiSize(20.0f, 10.0f));
        harness.Freeze();

        harness.Measure(root);
        harness.Arrange(root, new Rect(0.0f, 0.0f, 200.0f, 100.0f));

        Rect panelBounds = harness.Sink.Boxes[panel].Bounds;
        panelBounds.Width.Should().BeApproximately(100.0f, Epsilon);
        Rect leafBounds = harness.Sink.Boxes[leaf].Bounds;
        leafBounds.X.Should().BeApproximately(5.0f, Epsilon);
        leafBounds.Y.Should().BeApproximately(6.0f, Epsilon);
        leafBounds.Width.Should().BeApproximately(20.0f, Epsilon);
        leafBounds.Height.Should().BeApproximately(10.0f, Epsilon);
    }

    [Fact]
    public void RepeatedLayoutsAreDeterministic()
    {
        LayoutHarness first = BuildMixedTree();
        LayoutHarness second = BuildMixedTree();
        first.Freeze();
        second.Freeze();

        first.Measure(first.Root);
        first.Arrange(first.Root, new Rect(0.0f, 0.0f, 300.0f, 120.0f));
        second.Measure(second.Root);
        second.Arrange(second.Root, new Rect(0.0f, 0.0f, 300.0f, 120.0f));

        foreach (KeyValuePair<UiNodeId, Box> entry in first.Sink.Boxes)
        {
            Box other = second.Sink.Boxes[entry.Key];
            other.Bounds.X.Should().Be(entry.Value.Bounds.X);
            other.Bounds.Y.Should().Be(entry.Value.Bounds.Y);
            other.Bounds.Width.Should().Be(entry.Value.Bounds.Width);
            other.Bounds.Height.Should().Be(entry.Value.Bounds.Height);
        }
    }

    [Fact]
    public void SteadyStateMeasureAndArrangeAllocatesNothing()
    {
        LayoutHarness harness = BuildMixedTree();
        harness.Freeze();

        for (int i = 0; i < 4; i++)
        {
            harness.Measure(harness.Root);
            harness.Arrange(harness.Root, new Rect(0.0f, 0.0f, 300.0f, 120.0f));
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            harness.Measure(harness.Root);
            harness.Arrange(harness.Root, new Rect(0.0f, 0.0f, 300.0f, 120.0f));
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void CyclicTreeIsRejected()
    {
        CountingTree tree = new() { Cyclic = true };
        UiLayoutEngine engine = new();

        Action measure = () => engine.Measure(tree, new UiNodeId(1), UiMeasureConstraints.Unbounded);

        measure.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void MissingChildNodeIsRejected()
    {
        CountingTree tree = new() { OrphanChild = true };
        UiLayoutEngine engine = new();

        Action measure = () => engine.Measure(tree, new UiNodeId(1), UiMeasureConstraints.Unbounded);

        measure.Should().Throw<InvalidOperationException>();
    }

    private static LayoutHarness BuildMixedTree()
    {
        LayoutHarness harness = new();
        UiLayoutStyle rootStyle = new()
        {
            Direction = UiAxis.Row,
            AlignItems = UiAlign.Stretch,
            Gap = 8.0f,
            Padding = new UiEdgeInsets(4.0f, 4.0f, 4.0f, 4.0f),
            Width = UiLength.Px(300.0f),
            Height = UiLength.Px(120.0f),
        };
        harness.AddRoot(rootStyle);
        harness.AddLeaf(harness.Root, Leaf() with { Grow = 1.0f, Margin = new UiEdgeInsets(2.0f, 3.0f, 2.0f, 1.0f) }, new UiSize(40.0f, 30.0f));
        UiNodeId column = harness.AddContainer(harness.Root, new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Start,
            Gap = 2.0f,
            Width = UiLength.Px(120.0f),
        });
        harness.AddLeaf(column, Leaf(), new UiSize(60.0f, 20.0f));
        harness.AddLeaf(column, Leaf(), new UiSize(50.0f, 25.0f));
        harness.AddLeaf(harness.Root, new UiLayoutStyle
        {
            Position = UiPositionMode.Absolute,
            InsetRight = UiLength.Px(6.0f),
            InsetBottom = UiLength.Px(6.0f),
            Width = UiLength.Px(24.0f),
            Height = UiLength.Px(24.0f),
        }, new UiSize(0.0f, 0.0f));
        return harness;
    }

    private static UiLayoutStyle Leaf() => UiLayoutStyle.Default with
    {
        Width = UiLength.Auto,
        Height = UiLength.Auto,
    };
}

internal readonly record struct Box(Rect Bounds, Rect Content);

internal sealed class RecordingSink : IUiLayoutSink
{
    public Dictionary<UiNodeId, Box> Boxes { get; } = new();

    public void SetBox(UiNodeId node, in Rect bounds, in Rect content) => Boxes[node] = new Box(bounds, content);
}

internal sealed class FakeContentMeasurer : IUiContentMeasurer
{
    private readonly Dictionary<UiNodeId, UiSize> _sizes = new();

    public int MeasureCount { get; private set; }

    public void Set(UiNodeId node, in UiSize size) => _sizes[node] = size;

    public bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size)
    {
        _ = constraints;
        MeasureCount++;
        return _sizes.TryGetValue(node, out size);
    }
}

internal sealed class LayoutHarness
{
    private readonly UiDocumentBuilder _builder = new();
    private readonly UiDocumentInfo _info = new(new UiDocumentId(1), "layout", 1, default);

    public UiLayoutStyleTable Styles { get; } = new();

    public FakeContentMeasurer Content { get; } = new();

    public UiTextContentMeasurer TextContent { get; } = new(new FixedTextMeasurer());

    public RecordingSink Sink { get; } = new();

    public UiLayoutTree Tree { get; private set; } = null!;

    public UiLayoutEngine Engine { get; set; } = new() { Viewport = new UiViewport(new UiSize(1000.0f, 700.0f)) };

    public UiNodeId Root { get; private set; }

    public UiNodeId AddRoot(in UiLayoutStyle style)
    {
        UiNodeId node = _builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
        Styles.Set(node, in style);
        Root = node;
        return node;
    }

    public UiNodeId AddContainer(UiNodeId parent, in UiLayoutStyle style)
    {
        UiNodeId node = _builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
        Styles.Set(node, in style);
        if (!_builder.TryAppendChild(parent, node))
        {
            throw new InvalidOperationException("append failed");
        }

        return node;
    }

    public UiNodeId AddLeaf(UiNodeId parent, in UiLayoutStyle style, in UiSize content)
    {
        UiNodeId node = _builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
        Styles.Set(node, in style);
        Content.Set(node, in content);
        if (!_builder.TryAppendChild(parent, node))
        {
            throw new InvalidOperationException("append failed");
        }

        return node;
    }

    public void Freeze() =>
        Tree = new UiLayoutTree(_builder.Build(_info).Nodes, Styles, new HarnessContent(Content, TextContent));

    public UiMeasureResult Measure(UiNodeId node) =>
        Engine.Measure(Tree, node, new UiMeasureConstraints(0.0f, 0.0f, 300.0f, 200.0f));

    public void Arrange(UiNodeId node, in Rect bounds) => Engine.Arrange(Tree, node, in bounds, Sink);

    public UiNodeId[] ChildrenOf(UiNodeId node) => Tree.Nodes.GetChildren(node).ToArray();
}

internal sealed class HarnessContent : IUiContentMeasurer
{
    private readonly FakeContentMeasurer _boxes;
    private readonly UiTextContentMeasurer _text;

    public HarnessContent(FakeContentMeasurer boxes, UiTextContentMeasurer text)
    {
        _boxes = boxes;
        _text = text;
    }

    public bool TryMeasureContent(UiNodeId node, in UiMeasureConstraints constraints, out UiSize size) =>
        _text.TryMeasureContent(node, in constraints, out size) ||
        _boxes.TryMeasureContent(node, in constraints, out size);
}

internal sealed class CountingTree : IUiLayoutTree
{
    public bool OrphanChild { get; init; }

    public bool Cyclic { get; init; }

    public bool TryGetNode(UiNodeId id, out IUiLayoutNode? node)
    {
        if (OrphanChild && id.Value == 2)
        {
            node = null;
            return false;
        }

        node = new CountingNode(id, Cyclic);
        return true;
    }
}

internal sealed class CountingNode : IUiLayoutNode
{
    private readonly bool _cyclic;

    public CountingNode(UiNodeId id, bool cyclic)
    {
        Id = id;
        _cyclic = cyclic;
    }

    public UiNodeId Id { get; }

    public UiLayoutStyle Style => new() { Direction = UiAxis.Column, Width = UiLength.Auto, Height = UiLength.Auto };

    public ReadOnlySpan<UiNodeId> Children
    {
        get
        {
            if (Id.Value == 1)
            {
                return new[] { new UiNodeId(2) };
            }

            return _cyclic ? new[] { new UiNodeId(1) } : ReadOnlySpan<UiNodeId>.Empty;
        }
    }

    public UiSize MeasureContent(in UiMeasureConstraints constraints)
    {
        _ = constraints;
        return new UiSize(10.0f, 10.0f);
    }
}
