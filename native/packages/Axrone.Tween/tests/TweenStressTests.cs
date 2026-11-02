namespace Axrone.Tween.Tests;

using System.Collections.Concurrent;

public class TweenStressTests
{
    private sealed class OutcomeLedger
    {
        private readonly ConcurrentDictionary<long, byte> _submitted = new();
        private readonly ConcurrentDictionary<long, byte> _completed = new();
        private readonly ConcurrentDictionary<long, byte> _killed = new();
        private long _sequence;
        private int _violations;

        public TweenSpec TrackedSpec(float seconds, out long token)
        {
            long captured = Interlocked.Increment(ref _sequence);
            token = captured;
            return new TweenBuilder()
                .From(0.0f)
                .To(1.0f)
                .DurationSeconds(seconds)
                .OnComplete(() => Record(_completed, captured))
                .OnKill(() => Record(_killed, captured))
                .Build();
        }

        public void Submitted(long token) => _submitted.TryAdd(token, 0);

        public int SubmittedCount => _submitted.Count;

        public int CompletedCount => _completed.Count;

        public int KilledCount => _killed.Count;

        public void Verify()
        {
            _completed.Count.Should().BeGreaterThan(0);
            _killed.Count.Should().BeGreaterThan(0);
            Volatile.Read(ref _violations).Should().Be(0);
            (_completed.Count + _killed.Count).Should().Be(_submitted.Count);
            foreach (long token in _submitted.Keys)
            {
                (_completed.ContainsKey(token) ^ _killed.ContainsKey(token)).Should().BeTrue();
            }
        }

        private void Record(ConcurrentDictionary<long, byte> side, long token)
        {
            if (!side.TryAdd(token, 0))
            {
                Interlocked.Increment(ref _violations);
            }
        }
    }

    /// <summary>
    /// Runs after the concurrent storm with no pump racing: every outcome below is driven by
    /// explicit ticks, so the completed/killed counts are computed by the test instead of by
    /// which thread happened to win a race.
    /// </summary>
    private static void VerifyDeterministicLifecycleTail(TweenEngine engine, OutcomeLedger ledger)
    {
        int completedBefore = ledger.CompletedCount;
        int killedBefore = ledger.KilledCount;
        int submittedBefore = ledger.SubmittedCount;

        TweenSpec natural = ledger.TrackedSpec(0.1f, out long naturalToken);
        TweenHandle naturalHandle = engine.Play(natural);
        ledger.Submitted(naturalToken);
        engine.Update(DurationNs.FromSeconds(0.1f));
        naturalHandle.State.Should().Be(TweenState.Inactive);

        TweenSpec forced = ledger.TrackedSpec(10.0f, out long forcedToken);
        TweenHandle forcedHandle = engine.Play(forced);
        ledger.Submitted(forcedToken);
        engine.Update(DurationNs.FromSeconds(1.0f));
        forcedHandle.Pause().Should().BeTrue();
        forcedHandle.Complete().Should().BeTrue();
        forcedHandle.State.Should().Be(TweenState.Inactive);

        TweenSpec killed = ledger.TrackedSpec(10.0f, out long killedToken);
        TweenHandle killedHandle = engine.Play(killed);
        ledger.Submitted(killedToken);
        killedHandle.Cancel().Should().BeTrue();
        killedHandle.State.Should().Be(TweenState.Inactive);

        ledger.CompletedCount.Should().Be(completedBefore + 2);
        ledger.KilledCount.Should().Be(killedBefore + 1);
        ledger.SubmittedCount.Should().Be(submittedBefore + 3);
        engine.ActiveCount.Should().Be(0);
    }

    private static bool TryTrackedPlay(TweenEngine engine, OutcomeLedger ledger, ConcurrentBag<TweenHandle> live, float seconds)
    {
        TweenSpec spec = ledger.TrackedSpec(seconds, out long token);
        if (engine.TryPlay(spec, out TweenHandle handle))
        {
            ledger.Submitted(token);
            live.Add(handle);
            return true;
        }

        return false;
    }

    [Fact]
    public async Task SettleRace_ExactlyOncePerTween()
    {
        var ledger = new OutcomeLedger();
        var live = new ConcurrentBag<TweenHandle>();
        using var engine = new TweenEngine(64, new ManualTweenClock());
        var step = DurationNs.FromMilliseconds(16.666f);

        Task pump = Task.Run(() =>
        {
            for (int i = 0; i < 3000; i++)
            {
                engine.Update(step);
            }
        });

        Task[] workers = new Task[4];
        for (int w = 0; w < workers.Length; w++)
        {
            int worker = w;
            workers[w] = Task.Run(() =>
            {
                for (int i = 0; i < 750; i++)
                {
                    TryTrackedPlay(engine, ledger, live, 0.05f + ((i + worker) % 3) * 0.016f);
                    if ((i % 3) == 0 && live.TryTake(out TweenHandle handle))
                    {
                        handle.Cancel();
                    }
                }
            });
        }

        await Task.WhenAll(workers);
        await pump;

        for (int i = 0; i < 200; i++)
        {
            engine.Update(step);
        }

        while (live.TryTake(out TweenHandle handle))
        {
            handle.Cancel();
        }

        for (int i = 0; i < 50; i++)
        {
            engine.Update(step);
        }

        engine.ActiveCount.Should().Be(0);
        ledger.Verify();
    }

    [Fact]
    public async Task LifecycleStorm_NoCorruptionNoLeak()
    {
        var ledger = new OutcomeLedger();
        var live = new ConcurrentBag<TweenHandle>();
        using var engine = new TweenEngine(64, new ManualTweenClock());
        var step = DurationNs.FromMilliseconds(16.666f);

        Task pump = Task.Run(() =>
        {
            for (int i = 0; i < 3000; i++)
            {
                engine.Update(step);
            }
        });

        Task[] workers = new Task[4];
        for (int w = 0; w < workers.Length; w++)
        {
            int worker = w;
            workers[w] = Task.Run(() =>
            {
                for (int i = 0; i < 750; i++)
                {
                    switch ((i + worker) % 7)
                    {
                        case 0:
                            TryTrackedPlay(engine, ledger, live, 0.08f);
                            break;
                        case 1:
                            if (live.TryTake(out TweenHandle kill))
                            {
                                kill.Cancel();
                            }

                            break;
                        case 2:
                            if (live.TryTake(out TweenHandle pause))
                            {
                                pause.Pause();
                                live.Add(pause);
                            }

                            break;
                        case 3:
                            if (live.TryTake(out TweenHandle resume))
                            {
                                resume.Resume();
                                live.Add(resume);
                            }

                            break;
                        case 4:
                            if (live.TryTake(out TweenHandle restart))
                            {
                                restart.Restart();
                                live.Add(restart);
                            }

                            break;
                        case 5:
                            if (live.TryTake(out TweenHandle seek))
                            {
                                seek.Goto(DurationNs.FromMilliseconds((i % 5) * 16));
                                live.Add(seek);
                            }

                            break;
                        default:
                            if (live.TryTake(out TweenHandle query))
                            {
                                _ = query.State;
                                live.Add(query);
                            }

                            break;
                    }
                }
            });
        }

        await Task.WhenAll(workers);
        await pump;

        for (int i = 0; i < 200; i++)
        {
            engine.Update(step);
        }

        while (live.TryTake(out TweenHandle handle))
        {
            handle.Cancel();
        }

        for (int i = 0; i < 50; i++)
        {
            engine.Update(step);
        }

        engine.ActiveCount.Should().Be(0);
        VerifyDeterministicLifecycleTail(engine, ledger);
        ledger.Verify();

        TweenHandle after = engine.Play(
            new TweenBuilder().From(0.0f).To(1.0f).DurationSeconds(0.1f).Build());
        after.IsValid.Should().BeTrue();
        engine.Update(DurationNs.FromSeconds(1.0f));
        engine.ActiveCount.Should().Be(0);
    }
}
