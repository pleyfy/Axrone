namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiDrawListTests
{
    private static UiRenderCommand Quad(float x, int z, UiNodeId? node = null) =>
        UiRenderCommand.Quad(node ?? new UiNodeId(1), new Rect(x, 0.0f, 10.0f, 10.0f), UiColor.White, z);

    [Fact]
    public void AddPreservesRecordOrder()
    {
        UiDrawList list = new(4);
        list.Add(Quad(1.0f, 2));
        list.Add(Quad(2.0f, 0));
        list.Add(Quad(3.0f, 1));

        list.Count.Should().Be(3);
        list.Commands[0].Bounds.X.Should().Be(1.0f);
        list.Commands[2].Bounds.X.Should().Be(3.0f);
    }

    [Fact]
    public void ActiveClipIntersectsCommandAndCullsOutside()
    {
        UiDrawList list = new(8);
        list.PushClip(new Rect(0.0f, 0.0f, 100.0f, 100.0f));

        list.Add(Quad(-20.0f, 0));
        list.Add(Quad(50.0f, 0));
        list.Add(Quad(200.0f, 0));

        list.Count.Should().Be(1);
        UiRenderCommand stored = list.Commands[0];
        stored.Bounds.X.Should().Be(50.0f);
        (stored.Flags & UiRenderFlags.Clip).Should().Be(UiRenderFlags.Clip);
        stored.Clip.X.Should().Be(0.0f);
        stored.Clip.Width.Should().Be(100.0f);
    }

    [Fact]
    public void UnboundedCommandsSurviveClipCulling()
    {
        UiDrawList list = new(4);
        list.PushClip(new Rect(0.0f, 0.0f, 10.0f, 10.0f));

        list.Add(UiRenderCommand.Custom(new UiNodeId(1), new UiResourceId(1), 0));

        list.Count.Should().Be(1);
        list.Commands[0].Clip.Width.Should().Be(10.0f);
    }

    [Fact]
    public void NestedClipsIntersectAndRestore()
    {
        UiDrawList list = new(8);
        list.PushClip(new Rect(0.0f, 0.0f, 100.0f, 100.0f));
        list.PushClip(new Rect(5.0f, 0.0f, 100.0f, 100.0f));
        list.HasClip.Should().BeTrue();
        list.ActiveClip.X.Should().Be(5.0f);

        list.Add(Quad(60.0f, 0));
        list.Commands[0].Clip.X.Should().Be(5.0f);
        list.Commands[0].Clip.Width.Should().Be(95.0f);

        list.PopClip().Should().BeTrue();
        list.Add(Quad(0.0f, 0));
        list.Commands[1].Clip.Width.Should().Be(100.0f);

        list.PopClip().Should().BeTrue();
        list.PopClip().Should().BeFalse();
    }

    [Fact]
    public void EmptyClipIntersectionCullsEverythingUntilPop()
    {
        UiDrawList list = new(4);
        list.PushClip(new Rect(0.0f, 0.0f, 10.0f, 10.0f));
        list.PushClip(new Rect(20.0f, 20.0f, 10.0f, 10.0f));

        for (int i = 0; i < 10; i++)
        {
            list.Add(Quad(0.0f, i));
        }

        list.Count.Should().Be(0);
        list.PopClip();
        list.Add(Quad(0.0f, 0));
        list.Count.Should().Be(1);
    }

    [Fact]
    public void ExplicitCommandClipIntersectsWithStackClip()
    {
        UiDrawList list = new(4);
        list.PushClip(new Rect(0.0f, 0.0f, 100.0f, 100.0f));

        list.Add(Quad(60.0f, 0).WithClip(new Rect(50.0f, 0.0f, 100.0f, 100.0f)));

        list.Count.Should().Be(1);
        list.Commands[0].Clip.X.Should().Be(50.0f);
        list.Commands[0].Clip.Width.Should().Be(50.0f);
    }

    [Fact]
    public void SortIsStableAndAscending()
    {
        UiDrawList list = new(16);
        list.Add(Quad(10.0f, 1, new UiNodeId(10)));
        list.Add(Quad(20.0f, 0, new UiNodeId(20)));
        list.Add(Quad(30.0f, 1, new UiNodeId(30)));
        list.Add(Quad(40.0f, 0, new UiNodeId(40)));
        list.Add(Quad(50.0f, 1, new UiNodeId(50)));

        list.SortByZIndex();

        ReadOnlySpan<UiRenderCommand> commands = list.Commands;
        commands[0].Node.Value.Should().Be(20u);
        commands[1].Node.Value.Should().Be(40u);
        commands[2].Node.Value.Should().Be(10u);
        commands[3].Node.Value.Should().Be(30u);
        commands[4].Node.Value.Should().Be(50u);
        commands[0].ZIndex.Should().Be(0);
    }

    [Fact]
    public void SortIsDeterministicAcrossRuns()
    {
        static uint Hash(UiDrawList list)
        {
            uint hash = 2166136261u;
            ReadOnlySpan<UiRenderCommand> commands = list.Commands;
            for (int i = 0; i < commands.Length; i++)
            {
                hash = (hash ^ commands[i].Node.Value) * 16777619u;
                hash = (hash ^ (uint)commands[i].ZIndex) * 16777619u;
            }

            return hash;
        }

        static uint Run()
        {
            UiDrawList list = new(64);
            for (int i = 0; i < 64; i++)
            {
                list.Add(Quad(i, (i * 7) % 5, new UiNodeId((uint)(i + 1))));
            }

            list.SortByZIndex();
            return Hash(list);
        }

        Run().Should().Be(Run());
    }

    [Fact]
    public void BuildReportsKindCountsAndBorrowedSpan()
    {
        UiDrawList list = new(8);
        list.Add(Quad(0.0f, 0));
        list.Add(UiRenderCommand.Image(new UiNodeId(2), new Rect(0, 0, 4, 4), new UiResourceId(1), new Rect(0, 0, 1, 1), UiColor.White, 0));
        list.Add(UiRenderCommand.Text(new UiNodeId(3), new Rect(0, 0, 4, 4), new UiTextLayoutId(1), UiColor.Black, 0));
        list.Add(UiRenderCommand.Stroke(new UiNodeId(4), new UiResourceId(2), 0));
        list.Add(UiRenderCommand.Custom(new UiNodeId(5), new UiResourceId(3), 0));

        UiFrameMetrics metrics = list.ComputeMetrics(layoutPasses: 2, widgetCount: 9, visibleWidgetCount: 5, glyphCount: 12);
        UiFrame frame = list.Build(new UiViewport(800, 600, 1, 0, 0), metrics);

        frame.Commands.Length.Should().Be(list.Count);
        frame.Metrics.RenderCount.Should().Be(5);
        frame.Metrics.ImageCommandCount.Should().Be(1);
        frame.Metrics.TextCommandCount.Should().Be(1);
        frame.Metrics.StrokeCommandCount.Should().Be(1);
        frame.Metrics.CustomCommandCount.Should().Be(1);
        frame.Metrics.GlyphCount.Should().Be(12);
        frame.Viewport.Width.Should().Be(800);
        frame.IsEmpty.Should().BeFalse();
    }

    [Fact]
    public void BuildCanRebindReusableFrame()
    {
        UiDrawList list = new(4);
        UiFrame frame = new();
        list.Add(Quad(0, 0));
        list.Build(frame, new UiViewport(100, 100, 1, 0, 0), default);
        frame.Commands.Length.Should().Be(1);

        list.Clear();
        list.Add(Quad(0, 0));
        list.Add(Quad(0, 0));
        list.Build(frame, new UiViewport(200, 100, 1, 0, 0), default);

        frame.Commands.Length.Should().Be(2);
        frame.Viewport.Width.Should().Be(200);
    }

    [Fact]
    public void RecordingAndSortingAreZeroAllocationAfterWarmup()
    {
        UiDrawList list = new(1024);

        static void Fill(UiDrawList target)
        {
            for (int i = 0; i < 1024; i++)
            {
                target.Add(UiRenderCommand.Quad(
                    new UiNodeId((uint)(i + 1)),
                    new Rect(i, i, 8, 8),
                    UiColor.White,
                    i & 7));
            }

            target.SortByZIndex();
            target.Clear();
        }

        Fill(list);
        Fill(list);
        Fill(list);

        long before = GC.GetAllocatedBytesForCurrentThread();
        Fill(list);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        delta.Should().Be(0);
    }

    [Fact]
    public void InvalidCapacityThrows()
    {
        Action act = static () => _ = new UiDrawList(0);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
