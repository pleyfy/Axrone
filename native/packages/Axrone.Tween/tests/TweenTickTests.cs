namespace Axrone.Tween.Tests;

public class TweenTickTests
{
    private static uint Play(TweenStore store, TweenSpec spec)
    {
        store.TryAllocate(out uint index).Should().BeTrue();
        store.Initialize(
            index,
            spec.Start,
            spec.End,
            spec.Duration,
            spec.Delay,
            spec.RepeatDelay,
            spec.Easing,
            spec.CustomEasing,
            spec.Mode,
            spec.LoopCount,
            spec.TimeScale,
            spec.ChannelCount,
            spec.OnUpdateFloat,
            spec.OnUpdateVector2,
            spec.OnUpdateVector3,
            spec.OnUpdateVector4,
            spec.OnStart,
            spec.OnComplete,
            spec.OnStepComplete,
            spec.OnKill);
        return index;
    }

    private static TweenSpec Linear(float from, float to, float seconds, Action<float>? onUpdate = null, Action? onComplete = null) =>
        new TweenBuilder()
            .From(from)
            .To(to)
            .DurationSeconds(seconds)
            .Ease(EasingKind.Linear)
            .OnUpdate(onUpdate ?? (_ => { }))
            .OnComplete(onComplete ?? (() => { }))
            .Build();

    [Fact]
    public void Linear_ProgressesAndCompletes()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        bool done = false;
        Play(store, Linear(0f, 10f, 1f, v => seen.Add(v), () => done = true));

        store.Update(DurationNs.FromSeconds(0.5f), 1f).Should().Be(0);
        seen.Should().Equal(5f);
        store.ActiveCount.Should().Be(1);

        store.Update(DurationNs.FromSeconds(0.5f), 1f).Should().Be(1);
        seen.Should().Equal(5f, 10f);
        done.Should().BeTrue();
        store.ActiveCount.Should().Be(0);
    }

    [Fact]
    public void Delay_HoldsPlayback()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        var spec = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .DelaySeconds(0.5f)
            .OnUpdate(v => seen.Add(v))
            .OnComplete(() => { })
            .Build();
        Play(store, spec);

        store.Update(DurationNs.FromSeconds(0.25f), 1f).Should().Be(0);
        seen.Should().BeEmpty();

        store.Update(DurationNs.FromSeconds(0.5f), 1f).Should().Be(0);
        seen.Should().Equal(2.5f);
    }

    [Fact]
    public void Loop_ReplaysExtraPlaythrough()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        var spec = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .Mode(PlaybackMode.Loop)
            .Loops(2)
            .OnUpdate(v => seen.Add(v))
            .OnComplete(() => { })
            .Build();
        Play(store, spec);

        store.Update(DurationNs.FromSeconds(1f), 1f).Should().Be(0);
        store.ActiveCount.Should().Be(1);
        store.Update(DurationNs.FromSeconds(1f), 1f).Should().Be(1);
        store.ActiveCount.Should().Be(0);
        seen.Should().Equal(10f, 10f);
    }

    [Fact]
    public void PingPong_ReversesDirection()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        var spec = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(1f)
            .Mode(PlaybackMode.PingPong)
            .Loops(2)
            .OnUpdate(v => seen.Add(v))
            .OnComplete(() => { })
            .Build();
        Play(store, spec);

        store.Update(DurationNs.FromSeconds(1f), 1f).Should().Be(0);
        store.Update(DurationNs.FromSeconds(0.5f), 1f).Should().Be(0);
        seen.Should().Equal(10f, 5f);
    }

    [Fact]
    public void EaseInQuad_ShapesProgress()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        var spec = new TweenBuilder()
            .From(0f)
            .To(4f)
            .DurationSeconds(1f)
            .Ease(EasingKind.EaseInQuad)
            .OnUpdate(v => seen.Add(v))
            .OnComplete(() => { })
            .Build();
        Play(store, spec);

        store.Update(DurationNs.FromSeconds(0.5f), 1f);

        seen.Should().Equal(1f);
    }

    [Fact]
    public void Paused_SkipsAdvance()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        Play(store, Linear(0f, 10f, 1f, v => seen.Add(v)));
        store.SetState(0, TweenState.Paused);

        store.Update(DurationNs.FromSeconds(1f), 1f).Should().Be(0);
        seen.Should().BeEmpty();
        store.ActiveCount.Should().Be(1);
    }

    [Fact]
    public void WarmUpdate_AllocatesNothing()
    {
        using var store = new TweenStore(4);
        var spec = new TweenBuilder()
            .From(0f)
            .To(1f)
            .DurationSeconds(100f)
            .OnUpdate(static (float _) => { })
            .OnComplete(static () => { })
            .Build();
        Play(store, spec);

        store.Update(DurationNs.FromSeconds(0.1f), 1f);
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1_000; i++)
        {
            store.Update(DurationNs.FromMilliseconds(1f), 1f);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void ThrowingCallback_FaultsOnlyItsTween()
    {
        using var store = new TweenStore(8);
        var good = new List<float>();
        Play(store, Linear(0f, 10f, 1f, _ => throw new InvalidOperationException("user fault")));
        Play(store, Linear(0f, 10f, 1f, v => good.Add(v)));

        store.Update(DurationNs.FromSeconds(1f), 1f).Should().Be(1);
        good.Should().Equal(10f);
        store.ActiveCount.Should().Be(0);
    }

    [Fact]
    public void ZeroDuration_CompletesImmediately()
    {
        using var store = new TweenStore(8);
        bool done = false;
        Play(store, Linear(0f, 5f, 0f, null, () => done = true));

        store.Update(DurationNs.FromSeconds(0.016f), 1f).Should().Be(1);
        done.Should().BeTrue();
    }

    [Fact]
    public void GlobalTimeScale_ScalesDelta()
    {
        using var store = new TweenStore(8);
        var seen = new List<float>();
        Play(store, Linear(0f, 10f, 1f, v => seen.Add(v)));

        store.Update(DurationNs.FromSeconds(0.5f), 2f).Should().Be(1);
        seen.Should().Equal(10f);
    }

    [Fact]
    public void ConcurrentUpdate_ThrowsInsteadOfTearing()
    {
        using var store = new TweenStore(8);
        using var entered = new ManualResetEventSlim(false);
        using var release = new ManualResetEventSlim(false);
        var spec = new TweenBuilder()
            .From(0f)
            .To(10f)
            .DurationSeconds(10f)
            .OnUpdate((float _) =>
            {
                entered.Set();
                release.Wait(TimeSpan.FromSeconds(15));
            })
            .OnComplete(() => { })
            .Build();
        Play(store, spec);

        Exception? background = null;
        var ticker = new Thread(() =>
        {
            try
            {
                store.Update(DurationNs.FromSeconds(0.016f), 1f);
            }
            catch (Exception ex)
            {
                background = ex;
            }
        });
        ticker.Start();
        entered.Wait(TimeSpan.FromSeconds(15)).Should().BeTrue();

        var act = () => store.Update(DurationNs.FromSeconds(0.016f), 1f);
        act.Should().Throw<InvalidOperationException>();

        release.Set();
        ticker.Join(TimeSpan.FromSeconds(15)).Should().BeTrue();
        background.Should().BeNull();
    }
}
