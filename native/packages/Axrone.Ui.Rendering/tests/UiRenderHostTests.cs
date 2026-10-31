namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiRenderHostTests
{
    private static UiFrame BuildFrame(float viewportWidth, int quadCount)
    {
        UiDrawList list = new(quadCount);
        for (int i = 0; i < quadCount; i++)
        {
            list.Add(UiRenderCommand.Quad(
                new UiNodeId((uint)(i + 1)),
                new Rect(i, 0, 4, 4),
                UiColor.White,
                zIndex: 0));
        }

        return list.Build(new UiViewport(viewportWidth, 100, 1, 0, 0), list.ComputeMetrics());
    }

    [Fact]
    public void FlushDrainsFramesInSubmissionOrder()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);

        host.Submit(BuildFrame(100, 1));
        host.Submit(BuildFrame(200, 2));
        host.PendingCount.Should().Be(2);

        host.Flush();

        backend.FrameCount.Should().Be(2);
        backend.LastViewport.Width.Should().Be(200);
        host.PendingCount.Should().Be(0);
    }

    [Fact]
    public void FlushGroupsCommandsIntoBatches()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        UiDrawList list = new(4);
        list.Add(UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 4, 4), UiColor.White, 0));
        list.Add(UiRenderCommand.Quad(new UiNodeId(2), new Rect(0, 0, 4, 4), UiColor.White, 0));
        list.Add(UiRenderCommand.Image(new UiNodeId(3), new Rect(0, 0, 4, 4), new UiResourceId(7), new Rect(0, 0, 1, 1), UiColor.White, 0));

        host.Submit(list.Build(new UiViewport(100, 100, 1, 0, 0), list.ComputeMetrics()));
        host.Flush();

        backend.FrameCount.Should().Be(1);
        backend.DrawCallCount.Should().Be(2);
        backend.CommandCount.Should().Be(3);
    }

    [Fact]
    public void FullRingDropsTheOldestFrame()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);

        for (int i = 1; i <= UiFrameRenderHost.MaxPendingFrames + 1; i++)
        {
            host.Submit(BuildFrame(i, i));
        }

        host.PendingCount.Should().Be(UiFrameRenderHost.MaxPendingFrames);
        host.DroppedFrames.Should().Be(1);

        host.Flush();

        backend.FrameCount.Should().Be(UiFrameRenderHost.MaxPendingFrames);
        backend.CommandCount.Should().Be(2 + 3 + 4 + 5);
    }

    [Fact]
    public void FlushSkipsFramesWhenBackendIsNotReady()
    {
        UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        host.Submit(BuildFrame(100, 1));
        backend.Dispose();

        host.Flush();

        backend.FrameCount.Should().Be(0);
        host.SkippedFrames.Should().Be(1);
        host.PendingCount.Should().Be(0);
    }

    [Fact]
    public void DisposedHostRejectsSubmitAndFlush()
    {
        using UiRecordingBackend backend = new();
        UiFrameRenderHost host = new(backend);
        host.Dispose();
        host.Dispose();

        Action submit = () => host.Submit(BuildFrame(100, 1));
        Action flush = host.Flush;

        submit.Should().Throw<ObjectDisposedException>();
        flush.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void DisposedHostReleasesPendingFrames()
    {
        using UiRecordingBackend backend = new();
        UiFrameRenderHost host = new(backend);
        host.Submit(BuildFrame(100, 1));

        host.Dispose();

        host.PendingCount.Should().Be(0);
    }

    [Fact]
    public void FlushIsZeroAllocationAfterWarmup()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        UiFrame frame = BuildFrame(320, 64);

        static void Cycle(UiFrameRenderHost target, IUiFrame source)
        {
            target.Submit(source);
            target.Flush();
        }

        Cycle(host, frame);
        Cycle(host, frame);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            Cycle(host, frame);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        delta.Should().Be(0);
        backend.FrameCount.Should().Be(66);
    }

    [Fact]
    public void TraceHashIsDeterministicAcrossInstances()
    {
        static uint Run()
        {
            using UiRecordingBackend backend = new();
            using UiFrameRenderHost host = new(backend);
            host.Submit(BuildFrame(640, 8));
            host.Submit(BuildFrame(640, 3));
            host.Flush();
            return backend.TraceHash;
        }

        Run().Should().Be(Run());
    }

    [Fact]
    public void PipelineCacheReusesEqualDescriptors()
    {
        using UiRecordingBackend backend = new();
        UiPipelineDescriptor descriptor = new(new UiResourceId(1), UiBlendMode.Alpha, UiImageSampling.Linear, false);

        IUiPipeline first = backend.CreatePipeline(in descriptor);
        IUiPipeline second = backend.CreatePipeline(in descriptor);
        IUiPipeline third = backend.CreatePipeline(new UiPipelineDescriptor(new UiResourceId(2), UiBlendMode.Additive, UiImageSampling.Nearest, true));

        ReferenceEquals(first, second).Should().BeTrue();
        ReferenceEquals(first, third).Should().BeFalse();
        backend.PipelineCount.Should().Be(2);
        first.IsValid.Should().BeTrue();

        backend.Dispose();
        first.IsValid.Should().BeFalse();
    }

    [Fact]
    public void BackendRejectsInvalidFrameNesting()
    {
        using UiRecordingBackend backend = new();
        UiViewport viewport = new(100, 100, 1, 0, 0);

        Action drawOutside = () => backend.DrawBatch(UiBatchKeyFactory.Create(UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 1, 1), UiColor.White, 0)), ReadOnlySpan<UiRenderCommand>.Empty);
        Action endWithoutBegin = backend.EndFrame;

        drawOutside.Should().Throw<InvalidOperationException>();
        endWithoutBegin.Should().Throw<InvalidOperationException>();

        backend.BeginFrame(viewport);
        Action beginTwice = () => backend.BeginFrame(viewport);
        beginTwice.Should().Throw<InvalidOperationException>();
        backend.EndFrame();
    }

    [Fact]
    public void ResetClearsCountersAndHash()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        host.Submit(BuildFrame(100, 2));
        host.Flush();

        backend.Reset();

        backend.FrameCount.Should().Be(0);
        backend.DrawCallCount.Should().Be(0);
        backend.CommandCount.Should().Be(0);
        backend.TraceHash.Should().Be(2166136261u);
    }
}
