namespace Axrone.Batching.Tests;

/// <summary>
/// Coverage for pipeline telemetry and snapshots.
/// </summary>
public class PipelineTelemetryTests
{
    private struct NoopKernel : IBatchKernel<int>
    {
        public void Execute(Span<int> batch)
        {
        }
    }

    [Fact]
    public void GetSnapshot_ReflectsPendingWork()
    {
        using var pipeline = TimeSlicedPipeline.Create<int>(8).Build();
        for (var i = 0; i < 5; i++)
        {
            pipeline.TryWrite(i);
        }

        pipeline.SwapProducer();

        var snapshot = pipeline.GetSnapshot();

        snapshot.Capacity.Should().Be(8);
        snapshot.PendingItems.Should().Be(0);
        snapshot.HasRemainingWork.Should().BeFalse();

        var kernel = new NoopKernel();
        pipeline.ExecuteSlice(ref kernel, FrameBudget.Infinite);

        pipeline.GetSnapshot().HasRemainingWork.Should().BeFalse();
    }

    [Fact]
    public void GetSnapshot_AfterPartialSlice_ReportsRemainder()
    {
        var clock = new ManualTimestamp(Stopwatch.GetTimestamp());
        using var pipeline = new TimeSlicedPipeline<int>(
            200,
            BatchStride.Default,
            "Axrone.Batching.Tests",
            clock.GetTimestamp);
        for (var i = 0; i < 200; i++)
        {
            pipeline.TryWrite(i).Should().BeTrue();
        }

        pipeline.SwapProducer();

        // The injected clock advances past the deadline inside the first chunk, so the slice
        // always stops after exactly one chunk instead of depending on wall-clock scheduling.
        const long budgetTicks = 10_000;
        long budgetStart = clock.Now;
        var spin = new ClockAdvancingKernel(clock, budgetTicks * 2);
        var first = pipeline.ExecuteSlice(
            ref spin,
            new FrameBudget(budgetStart, budgetStart + budgetTicks));

        first.Status.Should().Be(FrameBudgetStatus.BudgetExceeded);
        first.ProcessedCount.Should().Be(TimeSlicedPipeline<int>.InitialStride);
        var snapshot = pipeline.GetSnapshot();
        snapshot.PendingItems.Should().Be(first.RemainingCount);
        snapshot.TotalItems.Should().Be(200);
        snapshot.ProcessedItems.Should().Be(first.ProcessedCount);
        (snapshot.ProcessedItems + snapshot.PendingItems).Should().Be(200);
        snapshot.HasRemainingWork.Should().BeTrue();
        snapshot.CalibratedStride.Should().BeInRange(
            TimeSlicedPipeline<int>.MinStride, TimeSlicedPipeline<int>.MaxStride);
        snapshot.DroppedItems.Should().Be(0);
        snapshot.ProgressPercentage.Should().BeInRange(0d, 100d);
        snapshot.TicksPerItem.Should().BeGreaterThan(0d);
        snapshot.ItemsPerSecond.Should().BeGreaterThan(0d);
        snapshot.RemainingEstimatedSeconds.Should().BeGreaterThan(0d);
    }

    [Fact]
    public void GetSnapshot_ZeroTickSlice_StillCalibrates()
    {
        var clock = new ManualTimestamp(Stopwatch.GetTimestamp());
        using var pipeline = new TimeSlicedPipeline<int>(
            64,
            BatchStride.Default,
            "Axrone.Batching.Tests",
            clock.GetTimestamp);
        for (var i = 0; i < 64; i++)
        {
            pipeline.TryWrite(i).Should().BeTrue();
        }

        pipeline.SwapProducer();

        // The kernel does not advance the clock: the chunk completes in zero ticks. Calibration
        // must still produce a positive cost floor so snapshot rates never read zero after work.
        var kernel = new NoopKernel();
        var result = pipeline.ExecuteSlice(
            ref kernel,
            new FrameBudget(clock.Now, clock.Now + 1_000_000));

        result.Status.Should().Be(FrameBudgetStatus.Completed);
        result.ProcessedCount.Should().Be(64);
        var snapshot = pipeline.GetSnapshot();
        snapshot.TicksPerItem.Should().BeGreaterThan(0d);
        snapshot.ItemsPerSecond.Should().BeGreaterThan(0d);
        snapshot.CalibratedStride.Should().BeInRange(
            TimeSlicedPipeline<int>.MinStride, TimeSlicedPipeline<int>.MaxStride);
    }

    [Fact]
    public void GetSnapshot_Idle_ReportsZeroRates()
    {
        using var pipeline = TimeSlicedPipeline.Create<int>(4).Build();

        var snapshot = pipeline.GetSnapshot();

        snapshot.TotalItems.Should().Be(0);
        snapshot.ProgressPercentage.Should().Be(0d);
        snapshot.ItemsPerSecond.Should().Be(0d);
        snapshot.RemainingEstimatedSeconds.Should().Be(-1d);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var pipeline = TimeSlicedPipeline.Create<int>(4).Build();

        pipeline.Dispose();
        var act = () => pipeline.Dispose();

        act.Should().NotThrow();
    }
}
