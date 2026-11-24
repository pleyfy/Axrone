namespace Axrone.Reactive.Tests;

/// <summary>
/// Deterministic frame-time scheduler contract: nothing runs between advances, due work runs in
/// order, and cancellation/re-entrancy never leave the queue inconsistent.
/// </summary>
public sealed class FrameSchedulerTests
{
    [Fact]
    public void Schedule_RunsAtTheDueBoundary()
    {
        using var scheduler = new FrameScheduler();
        int calls = 0;

        scheduler.Schedule(() => calls++, TimeSpan.FromMilliseconds(10));

        scheduler.Advance(TimeSpan.FromMilliseconds(9));
        calls.Should().Be(0);

        scheduler.Advance(TimeSpan.FromMilliseconds(1));
        calls.Should().Be(1);
    }

    [Fact]
    public void ZeroDue_RunsOnTheNextAdvanceOnly()
    {
        using var scheduler = new FrameScheduler();
        int calls = 0;

        scheduler.Schedule(() => calls++, TimeSpan.Zero);
        calls.Should().Be(0);

        scheduler.Advance(TimeSpan.Zero);
        calls.Should().Be(1);
    }

    [Fact]
    public void Periodic_RunsOncePerPeriod()
    {
        using var scheduler = new FrameScheduler();
        int calls = 0;

        using IDisposable timer = scheduler.SchedulePeriodic(() => calls++, TimeSpan.FromMilliseconds(10));

        scheduler.Advance(TimeSpan.FromMilliseconds(35));
        calls.Should().Be(3);

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        calls.Should().Be(4);
    }

    [Fact]
    public void Cancel_PreventsExecution()
    {
        using var scheduler = new FrameScheduler();
        int calls = 0;

        IDisposable handle = scheduler.Schedule(() => calls++, TimeSpan.FromMilliseconds(10));
        handle.Dispose();

        scheduler.Advance(TimeSpan.FromMilliseconds(20));
        calls.Should().Be(0);
    }

    [Fact]
    public void SameDue_RunsInScheduleOrder()
    {
        using var scheduler = new FrameScheduler();
        var order = new List<string>();

        scheduler.Schedule(() => order.Add("first"), TimeSpan.FromMilliseconds(5));
        scheduler.Schedule(() => order.Add("second"), TimeSpan.FromMilliseconds(5));

        scheduler.Advance(TimeSpan.FromMilliseconds(5));

        order.Should().Equal("first", "second");
    }

    [Fact]
    public void ReentrantSchedule_RunsInTheSameAdvance()
    {
        using var scheduler = new FrameScheduler();
        var order = new List<string>();
        bool nested = false;

        scheduler.Schedule(
            () =>
            {
                order.Add("outer");
                if (!nested)
                {
                    nested = true;
                    scheduler.Schedule(() => order.Add("inner"), TimeSpan.Zero);
                }
            },
            TimeSpan.Zero);

        scheduler.Advance(TimeSpan.Zero);

        order.Should().Equal("outer", "inner");
    }

    [Fact]
    public void NegativeAdvance_Throws()
    {
        using var scheduler = new FrameScheduler();

        Action advance = () => scheduler.Advance(TimeSpan.FromMilliseconds(-1));

        advance.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Dispose_StopsFurtherWork()
    {
        var scheduler = new FrameScheduler();
        int calls = 0;
        scheduler.Schedule(() => calls++, TimeSpan.FromMilliseconds(1));
        scheduler.Dispose();

        Action advance = () => scheduler.Advance(TimeSpan.FromMilliseconds(10));

        advance.Should().Throw<ObjectDisposedException>();
        calls.Should().Be(0);
    }
}
