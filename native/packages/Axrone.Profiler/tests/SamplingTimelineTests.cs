namespace Axrone.Profiler.Tests;

public sealed class SamplingTimelineTests
{
    [Fact]
    public void Sampler_Fires_Ticks_And_Tracks_State()
    {
        var schedule = new ManualSamplerSchedule();
        int count = 0;
        var sampler = new ContinuousSampler(
            onTick: _ => Interlocked.Increment(ref count),
            intervalMs: 8.0,
            minIntervalMs: 1.0,
            maxIntervalMs: 64.0,
            targetFrameBudgetMs: 1_000_000_000.0,
            schedule: schedule);

        sampler.Start();
        schedule.Delays.Should().Equal(8.0);

        schedule.FireOnce();
        schedule.FireOnce();
        schedule.FireOnce();

        sampler.TickCount.Should().Be(3);
        count.Should().Be(3);
        sampler.IsRunning.Should().BeTrue();

        sampler.Stop();
        sampler.TickCount.Should().Be(3, "a stopped sampler is never rearmed");
        schedule.Armed.Should().BeFalse();

        sampler.GetState().IsRunning.Should().BeFalse();
        sampler.GetState().IsAdaptive.Should().BeTrue();
        sampler.GetState().TickCount.Should().Be(3);

        // A tick far under the budget halves the interval every time, so the whole cadence is
        // predictable: 8 -> 4 -> 2 -> 1, clamped at the floor.
        schedule.Delays.Should().Equal(8.0, 4.0, 2.0, 1.0);
    }

    [Fact]
    public void Sampler_Adapts_Interval_To_Tick_Cost()
    {
        var schedule = new ManualSamplerSchedule();
        var sampler = new ContinuousSampler(
            onTick: _ => Thread.SpinWait(200_000),
            intervalMs: 10.0,
            minIntervalMs: 1.0,
            maxIntervalMs: 400.0,
            targetFrameBudgetMs: 0.001,
            schedule: schedule);

        sampler.Start();
        for (int i = 0; i < 4; i++)
        {
            schedule.FireOnce();
        }

        // A 200k-iteration spin is tens of microseconds, three orders above a one-microsecond
        // budget, so adaptation must double the interval on every tick rather than drift with the
        // machine.
        sampler.Stop();
        schedule.Delays.Should().Equal(10.0, 20.0, 40.0, 80.0, 160.0);
        sampler.IntervalMs.Should().Be(160.0);
    }

    [Fact]
    public void Sampler_Interval_Change_Rearms_And_ClapmsToTheWindow()
    {
        var schedule = new ManualSamplerSchedule();
        var sampler = new ContinuousSampler(
            onTick: _ => { },
            intervalMs: 10.0,
            minIntervalMs: 2.0,
            maxIntervalMs: 30.0,
            targetFrameBudgetMs: 1_000_000_000.0,
            adaptive: false,
            schedule: schedule);

        sampler.Start();
        sampler.SetInterval(25.0);
        schedule.Delays.Should().Equal(10.0, 25.0);

        Action tooWide = () => sampler.SetInterval(31.0);
        tooWide.Should().Throw<ArgumentException>();

        sampler.SetAdaptation(false);
        schedule.FireOnce();
        sampler.IntervalMs.Should().Be(25.0, "adaptation is off, so the interval never moves");
    }

    [Fact]
    public void Sampler_Dispose_StopsTheSchedule_And_RejectsRestart()
    {
        var schedule = new ManualSamplerSchedule();
        var sampler = new ContinuousSampler(
            onTick: _ => { },
            intervalMs: 10.0,
            minIntervalMs: 1.0,
            maxIntervalMs: 100.0,
            schedule: schedule);

        sampler.Start();
        ((IDisposable)sampler).Dispose();

        schedule.Armed.Should().BeFalse();
        Action restart = () => sampler.Start();
        restart.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void Sampler_Rejects_Bad_Configuration()
    {
        Action badInterval = () => _ = new ContinuousSampler(_ => { }, intervalMs: 500.0, minIntervalMs: 1.0, maxIntervalMs: 100.0);
        badInterval.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Timeline_Records_And_Caps_Events()
    {
        using var recorder = new TimelineRecorder(maxEvents: 4, heartbeatMs: 10_000);
        recorder.Start();
        recorder.RecordEvent(TimelineCategory.Memory, "heap:1");
        recorder.RecordEvent(TimelineCategory.Gc, "gc:2");
        recorder.Tick();
        recorder.RecordEvent(TimelineCategory.Cpu, "frame");
        recorder.RecordEvent(TimelineCategory.Allocation, "alloc");
        recorder.RecordEvent(TimelineCategory.Memory, "heap:6");

        IReadOnlyList<TimelineRecordEvent> events = recorder.GetEvents();
        events.Should().HaveCount(4);
        events.Should().OnlyContain(e => e.TimestampMs > 0L);
        events[^1].Message.Should().Be("heap:6");

        recorder.Clear();
        recorder.Count.Should().Be(0);
        recorder.Stop();
        recorder.IsActive.Should().BeFalse();

        Action stopped = () => recorder.RecordEvent(TimelineCategory.Cpu, "late");
        stopped.Should().Throw<InvalidOperationException>();
    }
}

/// <summary>
/// Schedule that records every requested delay instead of waiting on the clock, so the whole
/// adaptive cadence is asserted from the recorded sequence.
/// </summary>
file sealed class ManualSamplerSchedule : ISamplerSchedule
{
    private Action? _fire;

    public List<double> Delays { get; } = new();

    public bool Armed => _fire is not null;

    public void Arm(Action fire, double delayMs)
    {
        _fire = fire;
        Delays.Add(delayMs);
    }

    public void Cancel() => _fire = null;

    public void FireOnce()
    {
        Action fire = _fire ?? throw new InvalidOperationException("the sampler is not armed");
        fire();
    }
}
