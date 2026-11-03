namespace Axrone.Tween.Tests;

public class TweenEngineTests
{
    private static TweenEngine Create(out ManualTweenClock clock)
    {
        clock = new ManualTweenClock();
        return new TweenEngine(16, clock);
    }

    private static TweenSpec Linear(float from, float to, float seconds, Action<float>? onUpdate = null) =>
        new TweenBuilder()
            .From(from)
            .To(to)
            .DurationSeconds(seconds)
            .OnUpdate(onUpdate ?? (_ => { }))
            .OnComplete(() => { })
            .Build();

    [Fact]
    public void PlayTick_CompletesThroughManualClock()
    {
        using var engine = Create(out ManualTweenClock clock);
        var seen = new List<float>();
        engine.Play(Linear(0f, 10f, 1f, v => seen.Add(v)));

        clock.Advance(DurationNs.FromSeconds(0.5f));
        engine.Update();
        clock.Advance(DurationNs.FromSeconds(0.5f));
        engine.Update();

        seen.Should().Equal(5f, 10f);
        engine.ActiveCount.Should().Be(0);
    }

    [Fact]
    public void TryPlay_Full_ReturnsFalse()
    {
        using var engine = new TweenEngine(1);
        engine.TryPlay(Linear(0f, 1f, 10f), out _).Should().BeTrue();
        engine.TryPlay(Linear(0f, 1f, 10f), out TweenHandle handle).Should().BeFalse();
        handle.IsValid.Should().BeFalse();
    }

    [Fact]
    public void Handle_RoutesLifecycle()
    {
        using var engine = Create(out _);
        var handle = engine.Play(Linear(0f, 10f, 10f));

        handle.IsValid.Should().BeTrue();
        handle.State.Should().Be(TweenState.Playing);
        handle.Pause().Should().BeTrue();
        handle.State.Should().Be(TweenState.Paused);
        handle.Resume().Should().BeTrue();
        handle.Cancel().Should().BeTrue();
        handle.State.Should().Be(TweenState.Inactive);
        handle.Cancel().Should().BeFalse();
    }

    [Fact]
    public void Complete_FinishesImmediatelyWithFinalCallbacks()
    {
        using var engine = Create(out ManualTweenClock clock);
        var seen = new List<float>();
        int steps = 0;
        bool done = false;
        var handle = engine.Play(new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .OnUpdate(seen.Add)
            .OnStepComplete(() => steps++)
            .OnComplete(() => done = true)
            .Build());

        clock.Advance(DurationNs.FromSeconds(0.25f));
        engine.Update();
        seen.Should().Equal(2.5f);

        handle.Complete().Should().BeTrue();
        seen.Should().Equal(2.5f, 10f);
        steps.Should().Be(1);
        done.Should().BeTrue();
        engine.ActiveCount.Should().Be(0);
        handle.State.Should().Be(TweenState.Inactive);
        handle.Complete().Should().BeFalse();

        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();
        seen.Should().Equal(2.5f, 10f);
    }

    [Fact]
    public void Complete_PausedTween_Finishes()
    {
        using var engine = Create(out _);
        bool done = false;
        var handle = engine.Play(new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .OnComplete(() => done = true)
            .Build());

        handle.Pause().Should().BeTrue();
        handle.Complete().Should().BeTrue();
        done.Should().BeTrue();
        engine.ActiveCount.Should().Be(0);
        handle.State.Should().Be(TweenState.Inactive);
    }

    [Fact]
    public void Complete_StaleIdentity_ReturnsFalse()
    {
        using var engine = Create(out ManualTweenClock clock);
        var handle = engine.Play(Linear(0f, 10f, 1f));
        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();

        handle.Complete().Should().BeFalse();
    }

    [Fact]
    public async Task Complete_SettlesAwaitersAsCompleted()
    {
        using var engine = Create(out _);
        var handle = engine.Play(Linear(0f, 10f, 10f));

        Task<bool> pending = engine.AwaitAsync(handle.Id);
        handle.Complete().Should().BeTrue();

        (await pending).Should().BeTrue();
    }

    [Fact]
    public void Complete_StopsScheduling()
    {
        using var engine = Create(out _);
        engine.Complete();

        engine.TryPlay(Linear(0f, 1f, 1f), out _).Should().BeFalse();
    }

    [Fact]
    public void Fault_Propagates()
    {
        using var engine = Create(out _);
        engine.Complete(new InvalidOperationException("engine fault"));

        var act = () => engine.Update();

        act.Should().Throw<InvalidOperationException>().WithMessage("engine fault");
    }

    [Fact]
    public void Restart_ReplaysFromZero()
    {
        using var engine = Create(out ManualTweenClock clock);
        var seen = new List<float>();
        var handle = engine.Play(Linear(0f, 10f, 1f, v => seen.Add(v)));

        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();
        seen.Should().Equal(10f);

        handle.Restart().Should().BeFalse();

        var replay = engine.Play(Linear(0f, 10f, 1f, v => seen.Add(v)));
        clock.Advance(DurationNs.FromSeconds(0.5f));
        engine.Update();
        replay.Restart().Should().BeTrue();
        clock.Advance(DurationNs.FromSeconds(0.5f));
        engine.Update();
        seen.Should().Equal(10f, 5f, 5f);
    }

    [Fact]
    public void Goto_JumpsPlayhead()
    {
        using var engine = Create(out ManualTweenClock clock);
        var seen = new List<float>();
        var handle = engine.Play(Linear(0f, 10f, 1f, v => seen.Add(v)));

        handle.Goto(DurationNs.FromSeconds(0.75f)).Should().BeTrue();
        clock.Advance(DurationNs.FromSeconds(0.016f));
        engine.Update();

        seen.Should().ContainSingle().Which.Should().BeApproximately(7.66f, 1e-3f);
    }

    [Fact]
    public void Controls_RejectStaleIdentities()
    {
        using var engine = Create(out ManualTweenClock clock);
        var handle = engine.Play(Linear(0f, 10f, 1f));
        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();

        handle.Restart().Should().BeFalse();
        handle.Goto(DurationNs.Zero).Should().BeFalse();
        handle.Rewind().Should().BeFalse();
    }

    [Fact]
    public void StepCallback_FiresPerPlaythrough()
    {
        using var engine = Create(out ManualTweenClock clock);
        int steps = 0;
        bool done = false;
        var spec = new TweenBuilder()
            .From(0f)
            .To(1f)
            .DurationSeconds(1f)
            .Loops(2)
            .OnStepComplete(() => steps++)
            .OnComplete(() => done = true)
            .Build();
        engine.Play(spec);

        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();
        clock.Advance(DurationNs.FromSeconds(1f));
        engine.Update();

        steps.Should().Be(2);
        done.Should().BeTrue();
    }

    [Fact]
    public void KillCallback_FiresOnCancelOnly()
    {
        using var engine = Create(out ManualTweenClock clock);
        bool killed = false;
        bool done = false;
        var spec = new TweenBuilder()
            .From(0f)
            .To(1f)
            .DurationSeconds(10f)
            .OnKill(() => killed = true)
            .OnComplete(() => done = true)
            .Build();
        var handle = engine.Play(spec);

        handle.Cancel().Should().BeTrue();
        killed.Should().BeTrue();
        done.Should().BeFalse();

        var finished = engine.Play(spec);
        clock.Advance(DurationNs.FromSeconds(10f));
        engine.Update();
        finished.State.Should().Be(TweenState.Inactive);
    }
}
