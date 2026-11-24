namespace Axrone.Event.Tests;

public sealed class EmitterParityZeroAllocationTests
{
    private const int WarmupIterations = 5_000;
    private const int MeasuredIterations = 5_000;

    [Fact]
    public void PausedEnqueueCopyAndClear_DoesNotAllocate()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with
        {
            Capacity = 1024,
            DispatchBatchSize = 64,
            DeadLetterCapacity = 64,
            MeterName = "Axrone.Event.Zero",
            PausedBufferCapacity = 64,
        });
        router.Pause();

        Span<EventEnvelope<int>> view = stackalloc EventEnvelope<int>[64];
        for (int i = 0; i < WarmupIterations; i++)
        {
            router.Publish(i);
            _ = router.CopyBufferedEnvelopes(view);
            _ = router.Metrics;
            _ = router.ClearBuffer();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            router.Publish(i);
            _ = router.CopyBufferedEnvelopes(view);
            _ = router.Metrics;
            _ = router.ClearBuffer();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        router.BufferedCount.Should().Be(0);
    }

    [Fact]
    public void ImmediateDispatchWithMetrics_DoesNotAllocate()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with
        {
            Capacity = 1024,
            DispatchBatchSize = 64,
            DeadLetterCapacity = 64,
            MeterName = "Axrone.Event.Zero",
        });
        using var subscription = router.Subscribe(static (_, _) => { });

        for (int i = 0; i < WarmupIterations; i++)
        {
            _ = router.PublishImmediate(i);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            _ = router.PublishImmediate(i);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        router.Metrics.Execution.Count.Should().Be(WarmupIterations + MeasuredIterations);
    }

    [Fact]
    public void EventUtilsCombinators_DoNotAllocateWhenInvoked()
    {
        int calls = 0;
        Action<int> filtered = EventUtils.Where<int>(static value => value > 0, _ => calls++);

        for (int i = 0; i < WarmupIterations; i++)
        {
            filtered(1);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            filtered(1);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        calls.Should().Be(WarmupIterations + MeasuredIterations);
    }
}
