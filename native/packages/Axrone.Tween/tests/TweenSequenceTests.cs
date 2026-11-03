namespace Axrone.Tween.Tests;

public class TweenSequenceTests
{
    private static (TweenEngine Engine, ManualTweenClock Clock) Create()
    {
        var clock = new ManualTweenClock();
        return (new TweenEngine(16, clock), clock);
    }

    private static TweenSpec Instant(string name, List<string> log) =>
        new TweenBuilder()
            .From(0f)
            .To(0f)
            .Duration(DurationNs.Zero)
            .OnComplete(() => log.Add(name))
            .Build();

    private static void Step((TweenEngine Engine, ManualTweenClock Clock) ctx, float seconds)
    {
        ctx.Clock.Advance(DurationNs.FromSeconds(seconds));
        ctx.Engine.Update();
    }

    [Fact]
    public void SequentialGroups_RunInOrder()
    {
        var ctx = Create();
        var log = new List<string>();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(Instant("a", log)).Append(Instant("b", log)).AppendCallback(() => log.Add("c"));
        bool done = false;
        sequence.OnComplete(() => done = true);

        sequence.Play();
        Step(ctx, 0.016f);
        log.Should().Equal("a");

        Step(ctx, 0.016f);
        log.Should().Equal("a", "b", "c");
        done.Should().BeTrue();
    }

    [Fact]
    public void Pause_HoldsCurrentGroup_ResumeContinues()
    {
        var ctx = Create();
        var seen = new List<float>();
        var log = new List<string>();
        var slow = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .OnUpdate(seen.Add)
            .OnComplete(() => { })
            .Build();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(slow).AppendCallback(() => log.Add("next"));

        sequence.Play();
        Step(ctx, 0.5f);
        seen.Should().Equal(5f);

        sequence.Pause();
        sequence.IsPaused.Should().BeTrue();
        sequence.IsPlaying.Should().BeTrue();

        Step(ctx, 0.5f);
        seen.Should().Equal(5f);
        log.Should().BeEmpty();

        sequence.Resume();
        sequence.IsPaused.Should().BeFalse();
        Step(ctx, 0.5f);
        seen.Should().Equal(5f, 10f);
        log.Should().Equal("next");
    }

    [Fact]
    public void Pause_BeforePlayOrTwice_IsNoOp()
    {
        var ctx = Create();
        var seen = new List<float>();
        var slow = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .OnUpdate(seen.Add)
            .OnComplete(() => { })
            .Build();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(slow);

        sequence.Pause();
        sequence.IsPaused.Should().BeFalse();

        sequence.Play();
        sequence.Resume();
        sequence.IsPaused.Should().BeFalse();

        Step(ctx, 0.5f);
        sequence.Pause();
        sequence.Pause();
        sequence.IsPaused.Should().BeTrue();

        Step(ctx, 0.5f);
        seen.Should().Equal(5f);

        sequence.Resume();
        sequence.Resume();
        sequence.IsPaused.Should().BeFalse();

        // A second resume must not fast-forward the group.
        Step(ctx, 0.25f);
        seen.Should().Equal(5f, 7.5f);
    }

    [Fact]
    public void Join_RunsAlongside()
    {
        var ctx = Create();
        var log = new List<string>();
        var slow = new TweenBuilder()
            .From(0f)
            .To(1f)
            .DurationSeconds(1f)
            .OnComplete(() => log.Add("slow"))
            .Build();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(Instant("fast", log)).Join(slow);

        sequence.Play();
        Step(ctx, 0.016f);

        log.Should().Equal("fast");
        Step(ctx, 1f);
        log.Should().Equal("fast", "slow");
    }

    [Fact]
    public void Interval_WaitsBeforeNextGroup()
    {
        var ctx = Create();
        var log = new List<string>();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(Instant("a", log)).AppendInterval(DurationNs.FromSeconds(1f)).Append(Instant("b", log));

        sequence.Play();
        Step(ctx, 0.016f);
        log.Should().Equal("a");

        Step(ctx, 0.5f);
        log.Should().Equal("a");

        Step(ctx, 0.5f);
        Step(ctx, 0.016f);
        log.Should().Equal("a", "b");
    }

    [Fact]
    public void Cancel_StopsPlayback()
    {
        var ctx = Create();
        var log = new List<string>();
        var slow = new TweenBuilder()
            .From(0f)
            .To(1f)
            .DurationSeconds(10f)
            .OnComplete(() => log.Add("slow"))
            .Build();
        var sequence = new TweenSequence(ctx.Engine);
        sequence.Append(Instant("a", log)).Append(slow);
        bool done = false;
        sequence.OnComplete(() => done = true);

        sequence.Play();
        Step(ctx, 0.016f);
        sequence.Cancel();
        Step(ctx, 10f);

        log.Should().Equal("a");
        done.Should().BeFalse();
    }

    [Fact]
    public void Empty_CompletesImmediately()
    {
        var ctx = Create();
        bool done = false;
        var sequence = new TweenSequence(ctx.Engine);
        sequence.OnComplete(() => done = true);

        sequence.Play();

        done.Should().BeTrue();
    }
}
