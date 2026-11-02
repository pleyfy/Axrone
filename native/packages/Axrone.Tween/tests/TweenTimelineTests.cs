namespace Axrone.Tween.Tests;

public class TweenTimelineTests
{
    private static (TweenEngine Engine, ManualTweenClock Clock) Create()
    {
        var clock = new ManualTweenClock();
        return (new TweenEngine(16, clock), clock);
    }

    private static TweenSpec Linear(float seconds, Action? onComplete = null, Action? onKill = null) =>
        new TweenBuilder()
            .From(0.0f)
            .To(1.0f)
            .DurationSeconds(seconds)
            .OnComplete(onComplete ?? (() => { }))
            .OnKill(onKill ?? (() => { }))
            .Build();

    private static void Pump(TweenEngine engine, ManualTweenClock clock, TweenTimeline timeline, float seconds)
    {
        var step = DurationNs.FromSeconds(seconds);
        clock.Advance(step);
        timeline.Update(step);
        engine.Update(step);
        timeline.Update(DurationNs.Zero);
    }

    [Fact]
    public void AbsolutePlacement_LaunchesOnSchedule()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            bool done = false;
            var timeline = new TweenTimeline(engine).OnComplete(() => done = true);
            timeline.Add(Linear(1.0f), DurationNs.Zero);
            timeline.Add(Linear(1.0f), DurationNs.FromSeconds(2.0f));
            timeline.Duration.Should().Be(DurationNs.FromSeconds(3.0f));
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            engine.ActiveCount.Should().Be(0);

            Pump(engine, clock, timeline, 0.5f);
            engine.ActiveCount.Should().Be(0);

            Pump(engine, clock, timeline, 0.5f);
            engine.ActiveCount.Should().Be(1);

            Pump(engine, clock, timeline, 1.0f);
            engine.ActiveCount.Should().Be(0);
            done.Should().BeTrue();
        }
    }

    [Fact]
    public void Append_ChainsAfterCurrentEnd()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            bool done = false;
            var timeline = new TweenTimeline(engine).OnComplete(() => done = true);
            timeline.Append(Linear(1.0f));
            timeline.Append(Linear(1.0f), DurationNs.FromSeconds(0.5f));
            timeline.Duration.Should().Be(DurationNs.FromSeconds(2.5f));
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            done.Should().BeFalse();

            Pump(engine, clock, timeline, 1.0f);
            done.Should().BeFalse();

            Pump(engine, clock, timeline, 0.5f);
            done.Should().BeTrue();
        }
    }

    [Fact]
    public void ScrubBack_ReplaysFinishedEntries()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            int completions = 0;
            var timeline = new TweenTimeline(engine);
            timeline.Add(Linear(1.0f, () => completions++), DurationNs.Zero);
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            completions.Should().Be(1);

            timeline.Scrub(DurationNs.Zero);
            completions.Should().Be(1);

            Pump(engine, clock, timeline, 1.0f);
            completions.Should().Be(2);
        }
    }

    [Fact]
    public void ScrubForward_KillsLiveEntry()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            int kills = 0;
            var timeline = new TweenTimeline(engine);
            timeline.Add(Linear(5.0f, null, () => kills++), DurationNs.Zero);
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            engine.ActiveCount.Should().Be(1);

            timeline.Scrub(DurationNs.FromSeconds(10.0f));
            engine.Update(DurationNs.FromSeconds(0.1f));
            kills.Should().Be(1);
            engine.ActiveCount.Should().Be(0);
        }
    }

    [Fact]
    public void TimeScale_CompressesWallTime()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            bool done = false;
            var timeline = new TweenTimeline(engine).OnComplete(() => done = true);
            timeline.TimeScale = 2.0f;
            timeline.Add(Linear(2.0f), DurationNs.Zero);
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            done.Should().BeTrue();
        }
    }

    [Fact]
    public void Pause_HoldsPlayheadAndMembers_ResumeContinues()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            var seen = new List<float>();
            TweenSpec spec = new TweenBuilder()
                .From(0.0f).To(10.0f).DurationSeconds(2.0f).OnUpdate(seen.Add).Build();
            var timeline = new TweenTimeline(engine);
            timeline.Add(spec, DurationNs.Zero);
            timeline.Play();

            Pump(engine, clock, timeline, 0.5f);
            seen.Should().Equal(2.5f);

            timeline.Pause();
            timeline.IsPaused.Should().BeTrue();
            timeline.IsPlaying.Should().BeTrue();

            Pump(engine, clock, timeline, 0.5f);
            seen.Should().Equal(2.5f);
            timeline.Position.Should().Be(DurationNs.FromSeconds(0.5f));

            timeline.Resume();
            timeline.IsPaused.Should().BeFalse();
            Pump(engine, clock, timeline, 0.5f);
            seen.Should().Equal(2.5f, 5.0f);
        }
    }

    [Fact]
    public void Pause_BeforePlayOrTwice_IsNoOp()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            bool done = false;
            var timeline = new TweenTimeline(engine).OnComplete(() => done = true);
            timeline.Add(Linear(1.0f), DurationNs.Zero);

            timeline.Pause();
            timeline.IsPaused.Should().BeFalse();

            timeline.Play();
            timeline.Resume();
            timeline.IsPaused.Should().BeFalse();

            Pump(engine, clock, timeline, 0.5f);
            done.Should().BeFalse();

            timeline.Pause();
            timeline.Pause();
            timeline.IsPaused.Should().BeTrue();

            Pump(engine, clock, timeline, 2.0f);
            done.Should().BeFalse();

            timeline.Resume();
            timeline.Resume();
            timeline.IsPaused.Should().BeFalse();
            Pump(engine, clock, timeline, 0.5f);
            done.Should().BeTrue();
        }
    }

    [Fact]
    public void PausedPlayback_ReplaysIdentically()
    {
        static List<float> Run()
        {
            var (engine, clock) = Create();
            using (engine)
            {
                var seen = new List<float>();
                TweenSpec spec = new TweenBuilder()
                    .From(0.0f).To(10.0f).DurationSeconds(2.0f).OnUpdate(seen.Add).Build();
                var timeline = new TweenTimeline(engine);
                timeline.Add(spec, DurationNs.Zero);
                timeline.Play();
                Pump(engine, clock, timeline, 0.25f);
                timeline.Pause();
                Pump(engine, clock, timeline, 0.5f);
                timeline.Resume();
                Pump(engine, clock, timeline, 0.75f);
                Pump(engine, clock, timeline, 1.0f);
                return seen;
            }
        }

        Run().Should().Equal(Run());
    }

    [Fact]
    public void ScrubMid_ResumesFromOffset()
    {
        var (engine, clock) = Create();
        using (engine)
        {
            var seen = new List<float>();
            TweenSpec spec = new TweenBuilder()
                .From(0.0f).To(10.0f).DurationSeconds(4.0f).OnUpdate(seen.Add).Build();
            var timeline = new TweenTimeline(engine);
            timeline.Add(spec, DurationNs.Zero);
            timeline.Play();

            Pump(engine, clock, timeline, 1.0f);
            seen.Should().Equal(2.5f);

            timeline.Scrub(DurationNs.FromSeconds(3.0f));
            Pump(engine, clock, timeline, 1.0f);
            seen.Should().Equal(2.5f, 10.0f);
            engine.ActiveCount.Should().Be(0);
        }
    }
}
