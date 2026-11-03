namespace Axrone.Tween.Tests;

using System.Runtime.Intrinsics;

public class TweenFaultTests
{
    private static TweenEngine Create(out ManualTweenClock clock, int capacity = 16)
    {
        clock = new ManualTweenClock();
        return new TweenEngine(capacity, clock);
    }

    private static TweenSpec Linear(float seconds) =>
        new TweenBuilder().From(0.0f).To(1.0f).DurationSeconds(seconds).Build();

    private static void PlaySlot(TweenStore store, uint index, Action<float>? onUpdate = null, Action? onComplete = null)
    {
        store.Initialize(
            index,
            Vector128.Create(0f, 0f, 0f, 0f),
            Vector128.Create(1f, 1f, 1f, 1f),
            DurationNs.FromSeconds(1f),
            DurationNs.Zero,
            DurationNs.Zero,
            EasingKind.Linear,
            null,
            PlaybackMode.Once,
            1,
            1f,
            1,
            onUpdate,
            null,
            null,
            null,
            null,
            onComplete,
            null,
            null);
    }

    [Fact]
    public void UpdateFault_StaysVisibleWithoutASettledSink()
    {
        using var store = new TweenStore(8);
        store.TryAllocate(out uint index).Should().BeTrue();
        PlaySlot(store, index, onUpdate: _ => throw new InvalidOperationException("user bug"));

        store.FaultCount.Should().Be(0);
        store.LastFault.Should().BeNull();
        store.LastFaultSlot.Should().Be(-1);

        // Tick without the settlement hook: nothing observes the outcome but the store does.
        store.Update(DurationNs.FromSeconds(1.0f), 1.0f).Should().Be(0);

        store.ActiveCount.Should().Be(0);
        store.FaultCount.Should().Be(1);
        store.LastFault.Should().BeAssignableTo<InvalidOperationException>();
        store.LastFaultSlot.Should().Be((int)index);
        store.LastFaultGeneration.Should().Be(1);
    }

    [Fact]
    public void CompletionCallbackFault_StaysVisibleWithoutASettledSink()
    {
        using var store = new TweenStore(8);
        store.TryAllocate(out uint index).Should().BeTrue();
        PlaySlot(store, index, onComplete: () => throw new InvalidOperationException("user bug"));

        store.Update(DurationNs.FromSeconds(1.0f), 1.0f).Should().Be(0);

        store.ActiveCount.Should().Be(0);
        store.FaultCount.Should().Be(1);
        store.LastFault.Should().BeAssignableTo<InvalidOperationException>();
        store.LastFaultSlot.Should().Be((int)index);

        // A healthy run afterwards must not rewrite the record or grow the counter.
        store.TryAllocate(out uint next).Should().BeTrue();
        PlaySlot(store, next);
        store.Update(DurationNs.FromSeconds(1.0f), 1.0f).Should().Be(1);
        store.FaultCount.Should().Be(1);
        store.LastFaultSlot.Should().Be((int)index);
    }

    [Fact]
    public void ForcedCompleteFault_IsRecordedThroughTheEngine()
    {
        using var engine = Create(out _);
        TweenHandle handle = engine.Play(Linear(10.0f) with
        {
            OnComplete = () => throw new InvalidOperationException("user bug"),
        });

        engine.Complete(handle.Id).Should().BeTrue();
        engine.FaultCount.Should().Be(1);
        engine.LastFault.Should().BeAssignableTo<InvalidOperationException>();
    }

    [Fact]
    public void EngineFaultCounters_StayCleanWhenNothingThrows()
    {
        using var engine = Create(out ManualTweenClock clock);

        engine.Play(Linear(1.0f));
        clock.Advance(DurationNs.FromSeconds(1.0f));
        engine.Update();

        engine.FaultCount.Should().Be(0);
        engine.LastFault.Should().BeNull();
        engine.ActiveCount.Should().Be(0);
    }

    [Fact]
    public async Task UpdateThrow_RetiresOnlyFaultyTween()
    {
        using var engine = Create(out ManualTweenClock clock);
        bool siblingDone = false;
        TweenSpec faulty = Linear(1.0f) with
        {
            OnUpdateFloat = _ => throw new InvalidOperationException("user bug"),
        };
        TweenSpec sibling = Linear(1.0f) with { OnComplete = () => siblingDone = true };

        TweenHandle bad = engine.Play(faulty);
        TweenHandle good = engine.Play(sibling);
        Task<bool> badOutcome = engine.AwaitAsync(bad.Id);
        Task<bool> goodOutcome = engine.AwaitAsync(good.Id);

        clock.Advance(DurationNs.FromSeconds(1.0f));
        engine.Update();

        (await badOutcome).Should().BeFalse();
        (await goodOutcome).Should().BeTrue();
        siblingDone.Should().BeTrue();
        engine.ActiveCount.Should().Be(0);
        bad.State.Should().Be(TweenState.Inactive);
        engine.Cancel(bad.Id).Should().BeFalse();
        engine.Restart(bad.Id).Should().BeFalse();

        clock.Advance(DurationNs.FromSeconds(1.0f));
        engine.Update();
        engine.ActiveCount.Should().Be(0);
    }

    [Fact]
    public async Task CompleteThrow_FreesWithoutCountingCompletion()
    {
        using var engine = Create(out ManualTweenClock clock);
        TweenSpec spec = Linear(1.0f) with
        {
            OnComplete = () => throw new InvalidOperationException("user bug"),
        };

        TweenHandle handle = engine.Play(spec);
        Task<bool> outcome = engine.AwaitAsync(handle.Id);

        clock.Advance(DurationNs.FromSeconds(1.0f));
        engine.Update();

        (await outcome).Should().BeFalse();
        engine.ActiveCount.Should().Be(0);
    }

    [Fact]
    public void StartThrow_ReleasesSlotAndPropagates()
    {
        using var engine = Create(out ManualTweenClock clock);
        TweenSpec spec = Linear(1.0f) with
        {
            OnStart = () => throw new InvalidOperationException("user bug"),
        };

        Action play = () => engine.Play(spec);
        play.Should().Throw<InvalidOperationException>();
        engine.ActiveCount.Should().Be(0);

        TweenHandle healthy = engine.Play(Linear(1.0f));
        healthy.IsValid.Should().BeTrue();
        engine.ActiveCount.Should().Be(1);
    }

    [Fact]
    public async Task KillThrow_ReleasesSlotSettlesAwaitersAndPropagates()
    {
        using var engine = Create(out ManualTweenClock clock);
        TweenSpec spec = Linear(10.0f) with
        {
            OnKill = () => throw new InvalidOperationException("user bug"),
        };

        TweenHandle handle = engine.Play(spec);
        Task<bool> outcome = engine.AwaitAsync(handle.Id);

        Action cancel = () => handle.Cancel();
        cancel.Should().Throw<InvalidOperationException>();
        engine.ActiveCount.Should().Be(0);
        (await outcome).Should().BeFalse();

        TweenHandle healthy = engine.Play(Linear(1.0f));
        healthy.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task ConcurrentUpdate_ThrowsAndPumpRecovers()
    {
        using var engine = Create(out ManualTweenClock clock);
        using var gate = new ManualResetEventSlim(false);
        TweenSpec spec = Linear(10.0f) with
        {
            OnUpdateFloat = _ => { gate.Wait(TimeSpan.FromSeconds(10)); },
        };
        _ = engine.Play(spec);
        clock.Advance(DurationNs.FromSeconds(0.5f));

        Task pump = Task.Run(() => engine.Update());
        Func<Task> rival = () => Task.Run(() => engine.Update());
        await rival.Should().ThrowAsync<InvalidOperationException>();

        gate.Set();
        await pump;
        engine.ActiveCount.Should().Be(1);

        TweenHandle healthy = engine.Play(Linear(0.1f));
        healthy.IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Play_WaitsForSlotThenSucceeds()
    {
        using var engine = Create(out _, capacity: 1);
        TweenHandle occupant = engine.Play(Linear(10.0f));
        _ = Task.Run(() =>
        {
            Thread.Sleep(100);
            occupant.Cancel();
        });

        TweenHandle freed = await Task.Run(() => engine.Play(Linear(0.1f))).WaitAsync(TimeSpan.FromSeconds(10));
        freed.IsValid.Should().BeTrue();
        engine.ActiveCount.Should().Be(1);
    }

    [Fact]
    public void UpdateAfterDispose_DoesNotThrow()
    {
        var engine = Create(out ManualTweenClock clock);
        engine.Play(Linear(10.0f));
        engine.Dispose();

        Action update = () => engine.Update();
        update.Should().NotThrow();
        engine.ActiveCount.Should().Be(1);
    }
}
