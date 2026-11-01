namespace Axrone.Event.Tests;

public sealed class TimerScheduleTests
{
    private static readonly DateTimeOffset Start = DateTimeOffset.UnixEpoch;

    private struct CollectingDispatcher : IEventDispatcher<int>
    {
        public List<int> Values;

        public void Dispatch(in ScheduledEvent<int> item) => Values.Add(item.Envelope.Payload);
    }

    [Fact]
    public void Delay_FiresAfterClockAdvance()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 42);

        scheduler.TimerCount.Should().Be(1);
        timer.IsActive.Should().BeTrue();
        timer.FiredTicks.Should().Be(0);
        timer.RemainingTicks.Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(4));
        scheduler.AdvanceDueTimers().Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(1));
        scheduler.AdvanceDueTimers().Should().Be(1);

        timer.IsActive.Should().BeFalse();
        timer.FiredTicks.Should().Be(1);
        scheduler.TimerCount.Should().Be(0);

        Collect(scheduler).Should().Equal(42);
    }

    [Fact]
    public void At_FiresAtDeadlineAndPastDeadlineFiresImmediately()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var future = scheduler.ScheduleAt(Start.AddSeconds(10), 1);
        using var past = scheduler.ScheduleAt(Start.AddSeconds(-1), 2);

        clock.Advance(TimeSpan.FromSeconds(9));
        scheduler.AdvanceDueTimers().Should().Be(1);
        Collect(scheduler).Should().Equal(2);

        clock.Advance(TimeSpan.FromSeconds(1));
        scheduler.AdvanceDueTimers().Should().Be(1);
        Collect(scheduler).Should().Equal(1);

        future.IsActive.Should().BeFalse();
        past.IsActive.Should().BeFalse();
    }

    [Fact]
    public void NegativeDelay_FiresOnNextAdvance()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(-5), 7);

        scheduler.AdvanceDueTimers().Should().Be(1);
        Collect(scheduler).Should().Equal(7);
        timer.IsActive.Should().BeFalse();
    }

    [Fact]
    public void Recurring_FiresEveryIntervalInOrder()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(10), 3);

        clock.Advance(TimeSpan.FromSeconds(35));
        scheduler.AdvanceDueTimers().Should().Be(3);

        timer.FiredTicks.Should().Be(3);
        timer.IsActive.Should().BeTrue();
        timer.RemainingTicks.Should().Be(-1);
        timer.DueAt.Should().Be(Start.AddSeconds(40));
        scheduler.TimerCount.Should().Be(1);

        Collect(scheduler).Should().Equal(3, 3, 3);
    }

    [Fact]
    public void Recurring_MaxTicksCompletesTimer()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(10), 5, maxTicks: 3);

        timer.RemainingTicks.Should().Be(3);

        clock.Advance(TimeSpan.FromSeconds(100));
        scheduler.AdvanceDueTimers().Should().Be(3);

        timer.FiredTicks.Should().Be(3);
        timer.RemainingTicks.Should().Be(0);
        timer.IsActive.Should().BeFalse();
        scheduler.TimerCount.Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(100));
        scheduler.AdvanceDueTimers().Should().Be(0);
        Collect(scheduler).Should().Equal(5, 5, 5);
    }

    [Fact]
    public void Recurring_CatchUpRespectsLaneBackpressure()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = new EventScheduler<int>(
            new EventSchedulerOptions(1) { MaxTimers = 4 },
            clock);

        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(10), 9);

        clock.Advance(TimeSpan.FromSeconds(30));
        scheduler.AdvanceDueTimers().Should().Be(1);
        timer.FiredTicks.Should().Be(1);
        Collect(scheduler).Should().Equal(9);

        scheduler.AdvanceDueTimers().Should().Be(1);
        timer.FiredTicks.Should().Be(2);
        Collect(scheduler).Should().Equal(9);

        scheduler.AdvanceDueTimers().Should().Be(1);
        timer.FiredTicks.Should().Be(3);
        Collect(scheduler).Should().Equal(9);

        scheduler.AdvanceDueTimers().Should().Be(0);
        scheduler.TimerCount.Should().Be(1);
    }

    [Fact]
    public void SameTimestamp_OrdersByPriorityThenCreation()
    {
        List<int> first = RunSameTimestampOrder();
        List<int> second = RunSameTimestampOrder();

        first.Should().Equal(1, 3, 2, 4);
        first.Should().Equal(second);
    }

    [Fact]
    public void CancellationToken_CancelsPendingTimer()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var cts = new CancellationTokenSource();

        using var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 1, cancellationToken: cts.Token);
        scheduler.TimerCount.Should().Be(1);

        cts.Cancel();

        timer.IsActive.Should().BeFalse();
        scheduler.TimerCount.Should().Be(0);
        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(0);
        Collect(scheduler).Should().BeEmpty();
    }

    [Fact]
    public void CancelledTokenAtScheduleTime_ReturnsInactiveHandle()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        scheduler.TryScheduleDelay(TimeSpan.FromSeconds(1), 1, cancellationToken: cts.Token)
            .Should().BeNull();

        EventTimerHandle handle = scheduler.ScheduleDelay(
            TimeSpan.FromSeconds(1),
            1,
            cancellationToken: cts.Token);
        handle.IsActive.Should().BeFalse();
        handle.Should().BeSameAs(EventTimerHandle.Inactive);
        scheduler.TimerCount.Should().Be(0);
    }

    [Fact]
    public void CancelAfterFirstRecurringTick_StopsFurtherTicks()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(10), 4);

        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(1);

        timer.Cancel();
        timer.IsActive.Should().BeFalse();
        scheduler.TimerCount.Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(100));
        scheduler.AdvanceDueTimers().Should().Be(0);
        Collect(scheduler).Should().Equal(4);
    }

    [Fact]
    public void PauseResume_ShiftsDueAndSkipsPausedTime()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(10), 8);

        clock.Advance(TimeSpan.FromSeconds(5));
        timer.Pause();

        timer.IsPaused.Should().BeTrue();
        scheduler.PausedTimerCount.Should().Be(1);
        timer.DueAt.Should().Be(Start.AddSeconds(10));

        clock.Advance(TimeSpan.FromSeconds(100));
        scheduler.AdvanceDueTimers().Should().Be(0);

        timer.Resume();
        timer.IsPaused.Should().BeFalse();
        scheduler.PausedTimerCount.Should().Be(0);
        timer.DueAt.Should().Be(Start.AddSeconds(110));

        clock.Advance(TimeSpan.FromSeconds(4));
        scheduler.AdvanceDueTimers().Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(1));
        scheduler.AdvanceDueTimers().Should().Be(1);
        Collect(scheduler).Should().Equal(8);
    }

    [Fact]
    public void RecurringPause_SkipsMissedTicks()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var timer = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(10), 6);

        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(1);
        Collect(scheduler).Should().Equal(6);

        timer.Pause();
        clock.Advance(TimeSpan.FromSeconds(100));
        scheduler.AdvanceDueTimers().Should().Be(0);

        timer.Resume();
        timer.DueAt.Should().Be(Start.AddSeconds(120));

        clock.Advance(TimeSpan.FromSeconds(9));
        scheduler.AdvanceDueTimers().Should().Be(0);

        clock.Advance(TimeSpan.FromSeconds(1));
        scheduler.AdvanceDueTimers().Should().Be(1);

        timer.FiredTicks.Should().Be(2);
        Collect(scheduler).Should().Equal(6);
    }

    [Fact]
    public void TimerCapacity_AppliesBackpressure()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = new EventScheduler<int>(
            new EventSchedulerOptions(8) { MaxTimers = 1 },
            clock);

        using var first = scheduler.ScheduleDelay(TimeSpan.FromSeconds(10), 1);

        scheduler.TryScheduleDelay(TimeSpan.FromSeconds(10), 2).Should().BeNull();
        var schedule = () => scheduler.ScheduleDelay(TimeSpan.FromSeconds(10), 3);
        schedule.Should().Throw<EventQueueFullException>()
            .Which.Capacity.Should().Be(1);
        scheduler.TimerCount.Should().Be(1);

        first.Cancel();
        scheduler.TimerCount.Should().Be(0);
        scheduler.TryScheduleDelay(TimeSpan.FromSeconds(10), 4).Should().NotBeNull();
    }

    [Fact]
    public void Complete_CancelsTimersAndRejectsNewOnes()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);
        using var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 1);

        scheduler.Complete();

        timer.IsActive.Should().BeFalse();
        scheduler.TimerCount.Should().Be(0);
        scheduler.TryScheduleDelay(TimeSpan.FromSeconds(1), 2).Should().BeNull();

        var schedule = () => scheduler.ScheduleAt(Start.AddSeconds(1), 3);
        schedule.Should().Throw<InvalidOperationException>();

        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(0);
    }

    [Fact]
    public void ClearTimers_DiscardsActiveAndPausedTimers()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var active = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 1);
        using var paused = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 2);
        using var recurring = scheduler.ScheduleRecurring(TimeSpan.FromSeconds(5), 3);
        paused.Pause();

        scheduler.ClearTimers().Should().Be(3);
        scheduler.TimerCount.Should().Be(0);
        active.IsActive.Should().BeFalse();
        paused.IsActive.Should().BeFalse();

        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(0);
    }

    [Fact]
    public void InvalidIntervalAndPriority_AreRejected()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        var zero = () => scheduler.ScheduleRecurring(TimeSpan.Zero, 1);
        zero.Should().Throw<ArgumentOutOfRangeException>();

        var negative = () => scheduler.TryScheduleRecurring(TimeSpan.FromSeconds(-1), 1);
        negative.Should().Throw<ArgumentOutOfRangeException>();

        var priority = () => scheduler.TryScheduleDelay(
            TimeSpan.FromSeconds(1),
            1,
            (EventPriority)9);
        priority.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void InvalidMaxTimersOption_IsRejected()
    {
        var create = () => new EventScheduler<int>(
            new EventSchedulerOptions(4) { MaxTimers = 0 });

        create.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void HugeDelay_ClampsToMaximumInstant()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var timer = scheduler.ScheduleDelay(TimeSpan.MaxValue, 1);

        timer.DueAt.Should().Be(DateTimeOffset.MaxValue);
        scheduler.TimerCount.Should().Be(1);
    }

    [Fact]
    public void DisposedHandle_CancelsTimer()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        var timer = scheduler.ScheduleDelay(TimeSpan.FromSeconds(5), 1);
        timer.Dispose();

        timer.IsActive.Should().BeFalse();
        scheduler.TimerCount.Should().Be(0);
    }

    private static EventScheduler<int> CreateScheduler(ManualTimeProvider clock) =>
        new(new EventSchedulerOptions(8) { MaxTimers = 8 }, clock);

    private static List<int> Collect(EventScheduler<int> scheduler)
    {
        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        scheduler.Drain(ref dispatcher);
        return dispatcher.Values;
    }

    private static List<int> RunSameTimestampOrder()
    {
        var clock = new ManualTimeProvider(Start);
        var scheduler = CreateScheduler(clock);

        using var high1 = scheduler.ScheduleAt(Start.AddSeconds(10), 1, EventPriority.High);
        using var normal1 = scheduler.ScheduleAt(Start.AddSeconds(10), 2, EventPriority.Normal);
        using var high2 = scheduler.ScheduleAt(Start.AddSeconds(10), 3, EventPriority.High);
        using var normal2 = scheduler.ScheduleAt(Start.AddSeconds(10), 4, EventPriority.Normal);

        clock.Advance(TimeSpan.FromSeconds(10));
        scheduler.AdvanceDueTimers().Should().Be(4);
        return Collect(scheduler);
    }
}
