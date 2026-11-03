namespace Axrone.Event.Tests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ZeroAllocationCollectionDefinition
{
    public const string Name = "Event.ZeroAllocation";

    private ZeroAllocationCollectionDefinition()
    {
    }
}

[Collection(ZeroAllocationCollectionDefinition.Name)]
public sealed class ZeroAllocationTests
{
    private const int WarmupIterations = 10_000;
    private const int MeasuredIterations = 10_000;
    private const int TotalIterations = WarmupIterations + MeasuredIterations;

    [Fact]
    public void Scheduler_EnqueueDequeue_DoesNotAllocate()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(64));

        for (int i = 0; i < WarmupIterations; i++)
        {
            scheduler.Schedule(i);
            scheduler.TryDequeue(out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            scheduler.Schedule(i);
            scheduler.TryDequeue(out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        scheduler.ScheduledCount.Should().Be(TotalIterations, "every schedule call must have been accepted");
        scheduler.DequeuedCount.Should().Be(TotalIterations, "every scheduled item must have been dequeued");
    }

    [Fact]
    public void ImmediateDispatch_DoesNotAllocate()
    {
        using var router = new EventRouter<int>(1024);
        using var subscription = router.Subscribe(static (_, _) => { });

        for (int i = 0; i < WarmupIterations; i++)
        {
            router.PublishImmediate(i);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            router.PublishImmediate(i);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        router.Metrics.Execution.Count.Should().Be(TotalIterations, "every publish must have invoked the handler");
        router.Metrics.Emit.Count.Should().Be(TotalIterations);
    }

    [Fact]
    public void Forwarding_DoesNotAllocateInSteadyState()
    {
        using var source = new EventRouter<int>(1024);
        using var target = new EventRouter<int>(65536);
        using var forwarder = new EventForwarder<int>(source, target);

        for (int i = 0; i < WarmupIterations; i++)
        {
            source.PublishImmediate(i);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            source.PublishImmediate(i);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        forwarder.BackpressureDropCount.Should().Be(0);
        forwarder.LoopDropCount.Should().Be(0);
        forwarder.FilteredCount.Should().Be(0);
        forwarder.FailureCount.Should().Be(0);
        forwarder.ForwardedCount.Should().Be(TotalIterations, "every publish must have reached the target");
        source.Metrics.Execution.Count.Should().Be(TotalIterations, "the forwarder subscription must have run for every publish");
    }

    [Fact]
    public void TimerAdvanceAndDrain_DoesNotAllocateInSteadyState()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var scheduler = new EventScheduler<int>(
            new EventSchedulerOptions(16) { MaxTimers = 4 },
            clock);
        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromTicks(1), 1);

        for (int i = 0; i < WarmupIterations; i++)
        {
            clock.AdvanceTicks(1);
            scheduler.AdvanceDueTimers();
            scheduler.TryDequeue(out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            clock.AdvanceTicks(1);
            scheduler.AdvanceDueTimers();
            scheduler.TryDequeue(out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        timer.FiredTicks.Should().Be(TotalIterations, "each advance must have fired exactly one tick");
        scheduler.ScheduledCount.Should().Be(TotalIterations);
        scheduler.DequeuedCount.Should().Be(TotalIterations);
    }
}
