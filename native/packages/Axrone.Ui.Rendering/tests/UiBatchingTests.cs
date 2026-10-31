namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using FluentAssertions;
using System.Runtime.CompilerServices;
using Xunit;

public sealed class UiBatchingTests
{
    private static UiRenderCommand Quad(ulong resource, int z = 0) =>
        UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 10, 10), UiColor.White, z) with
        {
            Resource = new UiResourceId(resource),
        };

    private static UiRenderCommand Image(ulong resource, UiImageSampling sampling) =>
        UiRenderCommand.Image(
            new UiNodeId(2),
            new Rect(0, 0, 10, 10),
            new UiResourceId(resource),
            new Rect(0, 0, 1, 1),
            UiColor.White,
            0,
            sampling: sampling);

    [Fact]
    public void AdjacentMatchingCommandsShareOneRun()
    {
        UiBatchGrouper grouper = new([Quad(1), Quad(1), Quad(1)]);

        grouper.TryNext(out UiBatchKey key, out ReadOnlySpan<UiRenderCommand> run).Should().BeTrue();
        run.Length.Should().Be(3);
        key.Kind.Should().Be(UiRenderCommandKind.Quad);
        grouper.TryNext(out _, out _).Should().BeFalse();
    }

    [Fact]
    public void ResourceChangeSplitsTheRun()
    {
        UiBatchGrouper grouper = new([Quad(1), Quad(1), Quad(2), Quad(2)]);

        grouper.TryNext(out UiBatchKey first, out ReadOnlySpan<UiRenderCommand> firstRun).Should().BeTrue();
        firstRun.Length.Should().Be(2);
        first.Resource.Should().Be(new UiResourceId(1));

        grouper.TryNext(out UiBatchKey second, out ReadOnlySpan<UiRenderCommand> secondRun).Should().BeTrue();
        secondRun.Length.Should().Be(2);
        second.Resource.Should().Be(new UiResourceId(2));
    }

    [Fact]
    public void SamplingAndClipSplitImageRuns()
    {
        UiRenderCommand linear = Image(3, UiImageSampling.Linear);
        UiRenderCommand nearest = Image(3, UiImageSampling.Nearest);
        UiRenderCommand clipped = linear.WithClip(new Rect(0, 0, 5, 5));

        UiBatchGrouper grouper = new([linear, nearest, clipped]);

        grouper.TryNext(out UiBatchKey a, out ReadOnlySpan<UiRenderCommand> runA).Should().BeTrue();
        runA.Length.Should().Be(1);
        a.Sampling.Should().Be(UiImageSampling.Linear);

        grouper.TryNext(out UiBatchKey b, out ReadOnlySpan<UiRenderCommand> runB).Should().BeTrue();
        runB.Length.Should().Be(1);
        b.Sampling.Should().Be(UiImageSampling.Nearest);

        grouper.TryNext(out UiBatchKey c, out ReadOnlySpan<UiRenderCommand> runC).Should().BeTrue();
        runC.Length.Should().Be(1);
        c.HasClip.Should().BeTrue();
        c.Clip.Width.Should().Be(5);
    }

    [Fact]
    public void NonAdjacentEqualKeysAreNotCoalesced()
    {
        UiBatchGrouper grouper = new([Quad(1), Quad(2), Quad(1)]);

        int runs = 0;
        while (grouper.TryNext(out _, out ReadOnlySpan<UiRenderCommand> run))
        {
            run.Length.Should().Be(1);
            runs++;
        }

        runs.Should().Be(3);
    }

    [Fact]
    public void KindIsPartOfTheKey()
    {
        UiRenderCommand quad = UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 1, 1), UiColor.White, 0);
        UiRenderCommand custom = UiRenderCommand.Custom(new UiNodeId(1), new UiResourceId(1), 0);

        UiBatchKeyFactory.Create(quad).Should().NotBe(UiBatchKeyFactory.Create(custom));
    }

    [Fact]
    public void BatchSequenceIsDeterministic()
    {
        static uint Hash()
        {
            UiRenderCommand[] commands = new UiRenderCommand[32];
            for (int i = 0; i < commands.Length; i++)
            {
                commands[i] = Quad((ulong)((i / 3) + 1), i & 3);
            }

            uint hash = 2166136261u;
            UiBatchGrouper grouper = new(commands);
            while (grouper.TryNext(out UiBatchKey key, out ReadOnlySpan<UiRenderCommand> run))
            {
                hash = (hash ^ (uint)key.Resource.Value) * 16777619u;
                hash = (hash ^ (uint)run.Length) * 16777619u;
            }

            return hash;
        }

        Hash().Should().Be(Hash());
    }

    [Fact]
    public void GroupingIsZeroAllocation()
    {
        UiRenderCommand[] commands = new UiRenderCommand[512];
        for (int i = 0; i < commands.Length; i++)
        {
            commands[i] = Quad((ulong)((i / 8) + 1), i & 3);
        }

        static int Count(UiRenderCommand[] source)
        {
            int count = 0;
            UiBatchGrouper grouper = new(source);
            while (grouper.TryNext(out _, out ReadOnlySpan<UiRenderCommand> run))
            {
                count += run.Length;
            }

            return count;
        }

        Count(commands);
        Count(commands);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int result = Count(commands);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        result.Should().Be(512);
        delta.Should().Be(0);
    }

    [Fact]
    public void InstanceBufferReportsFullAtCapacity()
    {
        UiInstanceBuffer<UiQuadInstance> buffer = new(2);
        UiQuadInstance instance = new(new Rect(0, 0, 1, 1), UiColor.White, UiColor.Black, UiCornerRadii.Zero, 0, 1);

        buffer.TryAdd(instance).Should().BeTrue();
        buffer.TryAdd(instance).Should().BeTrue();
        buffer.IsFull.Should().BeTrue();
        buffer.TryAdd(instance).Should().BeFalse();
        buffer.Count.Should().Be(2);

        buffer.Clear();
        buffer.Count.Should().Be(0);
        buffer.TryAdd(instance).Should().BeTrue();
    }

    [Fact]
    public void InstanceEncodingIsZeroAllocation()
    {
        UiRenderCommand quad = Quad(1);
        UiRenderCommand image = UiRenderCommand.Image(
            new UiNodeId(1),
            new Rect(0, 0, 32, 32),
            new UiResourceId(1),
            new Rect(0, 0, 1, 1),
            UiColor.White,
            0).WithSliceBorder(new UiEdgeInsets(4, 4, 4, 4));
        Span<UiQuadInstance> quads = stackalloc UiQuadInstance[1];
        Span<UiImageInstance> images = stackalloc UiImageInstance[UiNineSlice.MaxInstances];

        UiInstanceEncoder.EncodeQuad(in quad, quads);
        UiInstanceEncoder.EncodeImage(in image, new UiSize(64, 64), images);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 128; i++)
        {
            UiInstanceEncoder.EncodeQuad(in quad, quads);
            UiInstanceEncoder.EncodeImage(in image, new UiSize(64, 64), images);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void InstanceLayoutsHaveExpectedSizes()
    {
        Unsafe.SizeOf<UiQuadInstance>().Should().Be(72);
        Unsafe.SizeOf<UiImageInstance>().Should().Be(72);
        Unsafe.SizeOf<UiGlyphInstance>().Should().Be(72);
        Unsafe.SizeOf<UiBatchKey>().Should().BeLessThanOrEqualTo(56);
        Unsafe.SizeOf<UiSliceSpan>().Should().Be(16);
    }
}
