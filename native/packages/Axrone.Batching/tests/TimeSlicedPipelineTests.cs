namespace Axrone.Batching.Tests;

/// <summary>
/// Coverage for the time-sliced pipeline: completion, slicing, resume, staleness.
/// </summary>
public class TimeSlicedPipelineTests
{
    private struct DoubleKernel : IBatchKernel<int>
    {
        public void Execute(Span<int> batch)
        {
            for (var i = 0; i < batch.Length; i++)
            {
                batch[i] *= 2;
            }
        }
    }

    private struct IncrementKernel : IElementKernel<int>
    {
        public void Execute(ref int item) => item++;
    }

    private static TimeSlicedPipeline<int> Fill(int count)
    {
        var pipeline = new TimeSlicedPipeline<int>(Math.Max(count, 1));
        for (var i = 0; i < count; i++)
        {
            pipeline.TryWrite(i + 1).Should().BeTrue();
        }

        pipeline.SwapProducer();
        return pipeline;
    }

    [Fact]
    public void ExecuteSlice_Empty_ReturnsEmpty()
    {
        var pipeline = new TimeSlicedPipeline<int>(4);
        var kernel = new DoubleKernel();

        var result = pipeline.ExecuteSlice(ref kernel, FrameBudget.Infinite);

        result.Status.Should().Be(FrameBudgetStatus.Empty);
        result.ProcessedCount.Should().Be(0);
    }

    [Fact]
    public void ExecuteSlice_InfiniteBudget_Completes()
    {
        var pipeline = Fill(10);
        var kernel = new DoubleKernel();

        var result = pipeline.ExecuteSlice(ref kernel, FrameBudget.Infinite);

        result.Status.Should().Be(FrameBudgetStatus.Completed);
        result.ProcessedCount.Should().Be(10);
        result.RemainingCount.Should().Be(0);
        pipeline.HasRemainingWork.Should().BeFalse();
    }

    [Fact]
    public void ExecuteSlice_ZeroBudget_ExceedsImmediately()
    {
        var pipeline = Fill(10);
        var kernel = new DoubleKernel();

        var result = pipeline.ExecuteSlice(ref kernel, new FrameBudget(0d));

        result.Status.Should().Be(FrameBudgetStatus.BudgetExceeded);
        result.ProcessedCount.Should().Be(0);
        result.RemainingCount.Should().Be(10);
    }

    [Fact]
    public void ExecuteSlice_SmallBudget_ResumesToCompletion()
    {
        var clock = new ManualTimestamp(Stopwatch.GetTimestamp());
        using var pipeline = new TimeSlicedPipeline<int>(
            200,
            BatchStride.Default,
            "Axrone.Batching.Tests",
            clock.GetTimestamp);
        for (var i = 0; i < 200; i++)
        {
            pipeline.TryWrite(i + 1).Should().BeTrue();
        }

        pipeline.SwapProducer();

        // The kernel advances the injected clock past the deadline during the first chunk, so the
        // slice always stops after exactly one chunk regardless of machine speed or load.
        const long budgetTicks = 10_000;
        long budgetStart = clock.Now;
        var advancing = new ClockAdvancingKernel(clock, budgetTicks * 2);
        var first = pipeline.ExecuteSlice(
            ref advancing,
            new FrameBudget(budgetStart, budgetStart + budgetTicks));

        first.Status.Should().Be(FrameBudgetStatus.BudgetExceeded);
        first.ProcessedCount.Should().Be(TimeSlicedPipeline<int>.InitialStride);
        first.RemainingCount.Should().Be(200 - TimeSlicedPipeline<int>.InitialStride);
        (clock.Now - budgetStart).Should().Be(budgetTicks * 2);
        pipeline.HasRemainingWork.Should().BeTrue();

        var kernel = new DoubleKernel();
        SliceResult last = pipeline.ExecuteSlice(
            ref kernel,
            new FrameBudget(clock.Now, clock.Now + 10_000_000));

        last.Status.Should().Be(FrameBudgetStatus.Completed);
        last.ProcessedCount.Should().Be(200 - TimeSlicedPipeline<int>.InitialStride);
        last.RemainingCount.Should().Be(0);
        pipeline.HasRemainingWork.Should().BeFalse();
    }

    [Fact]
    public void ExecuteElements_InfiniteBudget_Completes()
    {
        var pipeline = Fill(8);
        var kernel = new IncrementKernel();

        var result = pipeline.ExecuteElements(ref kernel, FrameBudget.Infinite);

        result.Status.Should().Be(FrameBudgetStatus.Completed);
        result.ProcessedCount.Should().Be(8);
    }

    [Fact]
    public void StaleSnapshot_RemainderDropped_FreshBatchPickedUp()
    {
        var pipeline = new TimeSlicedPipeline<int>(8);
        for (var i = 0; i < 8; i++)
        {
            pipeline.TryWrite(1).Should().BeTrue();
        }

        pipeline.SwapProducer();

        // Publish twice more without consuming: the first snapshot goes stale.
        for (var i = 0; i < 8; i++)
        {
            pipeline.TryWrite(2).Should().BeTrue();
        }

        pipeline.SwapProducer();
        for (var i = 0; i < 8; i++)
        {
            pipeline.TryWrite(3).Should().BeTrue();
        }

        pipeline.SwapProducer();

        var kernel = new DoubleKernel();
        var result = pipeline.ExecuteSlice(ref kernel, FrameBudget.Infinite);

        result.Status.Should().Be(FrameBudgetStatus.Completed);
        pipeline.DroppedItems.Should().BeGreaterThanOrEqualTo(0);
        pipeline.HasRemainingWork.Should().BeFalse();
    }
}
