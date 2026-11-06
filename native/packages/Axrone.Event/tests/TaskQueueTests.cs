namespace Axrone.Event.Tests;

using FluentAssertions;

public sealed class TaskQueueTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    private static readonly EventTaskState[] RaceTerminalStates =
        [EventTaskState.Completed, EventTaskState.Timeout];

    private static void WaitUntil(Func<bool> condition)
    {
        SpinWait.SpinUntil(condition, Wait).Should().BeTrue("the scheduler must reach the expected state");
    }

    private static async Task SettleAsync()
    {
        await Task.Run(static async () =>
        {
            for (int i = 0; i < 16; i++)
            {
                await Task.Yield();
            }
        });
    }

    [Fact]
    public async Task Submit_CompletesAndReportsStats()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithMetrics().WithTaskTimeout(TimeSpan.Zero).Build(),
            clock);

        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            await Task.Yield();
            return 42;
        });

        (await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait)).Should().Be(42);
        scheduler.IsIdle.Should().BeTrue();

        EventTaskStats stats = scheduler.GetStats();
        stats.CompletedCount.Should().Be(1);
        stats.FailedCount.Should().Be(0);
        stats.TotalProcessed.Should().Be(1);
        scheduler.GetTaskMetrics(default).Should().BeNull("invalid ids never carry metrics");
    }

    [Fact]
    public async Task Lanes_OrderImmediateHighNormalLowIdle()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());
        var order = new List<string>();

        EventTaskHandle first = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
        });

        while (first.State != EventTaskState.Running)
        {
            await Task.Yield();
        }

        _ = scheduler.Submit(Body(order, "low"), EventTaskPriority.Low);
        _ = scheduler.Submit(Body(order, "idle"), EventTaskPriority.Idle);
        _ = scheduler.Submit(Body(order, "normal"), EventTaskPriority.Normal);
        _ = scheduler.Submit(Body(order, "high"), EventTaskPriority.High);
        _ = scheduler.Submit(Body(order, "immediate"), EventTaskPriority.Immediate);

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);

        lock (order)
        {
            order.Should().Equal("immediate", "high", "normal", "low", "idle");
        }

        first.State.Should().Be(EventTaskState.Completed);

        static Func<CancellationToken, ValueTask<string>> Body(List<string> order, string name)
        {
            return token =>
            {
                lock (order)
                {
                    order.Add(name);
                }

                return ValueTask.FromResult(name);
            };
        }
    }

    [Fact]
    public async Task Cancel_Pending_TransitionsToCancelledAndFaultsHandle()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle blocker = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
        });
        EventTaskHandle victim = scheduler.Submit(async token =>
        {
            await Task.Yield();
            return 1;
        });

        while (blocker.State != EventTaskState.Running)
        {
            await Task.Yield();
        }

        scheduler.Cancel(victim.Id).Should().BeTrue();
        victim.State.Should().Be(EventTaskState.Cancelled);

        Func<Task> act = async () => await victim.AwaitAsync<int>();
        await act.Should().ThrowAsync<OperationCanceledException>();

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        scheduler.GetStats().CompletedCount.Should().Be(1);
    }

    [Fact]
    public async Task Cancel_Running_ObservesTokenThroughCooperativeCancellation()
    {
        var started = new ManualResetEventSlim(false);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            started.Set();
            await Task.Delay(Timeout.Infinite, token).ConfigureAwait(false);
            return 0;
        });

        started.Wait(Wait).Should().BeTrue();
        WaitUntil(() => handle.State == EventTaskState.Running);

        scheduler.Cancel(handle.Id).Should().BeTrue("the first cancel request on a running body is observed");
        scheduler.Cancel(handle.Id).Should().BeFalse("a second cancel request is not the first");

        Func<Task> act = async () => await handle.AwaitAsync<int>();
        await act.Should().ThrowAsync<OperationCanceledException>();
        WaitUntil(() => handle.State == EventTaskState.Cancelled);
        WaitUntil(() => scheduler.IsIdle);
    }

    [Fact]
    public async Task Cancel_RunningBodyThatIgnoresToken_StaysRunningUntilDeadline()
    {
        var started = new ManualResetEventSlim(false);
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMilliseconds(100)).Build(),
            clock);

        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            started.Set();
            await Task.Delay(TimeSpan.FromSeconds(1), CancellationToken.None).ConfigureAwait(false);
            return 0;
        }, EventTaskPriority.Normal, TimeSpan.FromMilliseconds(100));

        started.Wait(Wait).Should().BeTrue();
        WaitUntil(() => handle.State == EventTaskState.Running);

        scheduler.Cancel(handle.Id).Should().BeTrue();
        handle.State.Should().Be(EventTaskState.Running, "the body ignores the token; the deadline decides");

        clock.Advance(TimeSpan.FromMilliseconds(150));
        scheduler.AdvanceDueWork().Should().Be(1);
        handle.State.Should().Be(EventTaskState.Timeout);

        Func<Task> act = async () => await handle.AwaitAsync<int>();
        await act.Should().ThrowAsync<TimeoutException>();
        scheduler.GetStats().FailedCount.Should().Be(1);

        scheduler.Dispose();
    }

    [Fact]
    public async Task Retry_BackoffBudgetExhaustsThenFailsWithLastError()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithRetries(2)
                .WithRetryDelay(TimeSpan.FromMilliseconds(50))
                .WithTaskTimeout(TimeSpan.Zero)
                .Build(),
            clock);

        int attempts = 0;
        EventTaskHandle handle = scheduler.Submit(token =>
        {
            int attempt = Interlocked.Increment(ref attempts);
            return ValueTask.FromException<int>(new InvalidOperationException($"boom {attempt}"));
        });

        WaitUntil(() => Volatile.Read(ref attempts) == 1);
        scheduler.DelayedRetryCount.Should().Be(1);

        clock.Advance(TimeSpan.FromMilliseconds(49));
        scheduler.AdvanceDueWork().Should().Be(0, "the first backoff step is not due yet");
        clock.Advance(TimeSpan.FromMilliseconds(1));
        scheduler.AdvanceDueWork().Should().Be(1);

        WaitUntil(() => Volatile.Read(ref attempts) == 2);
        WaitUntil(() => scheduler.DelayedRetryCount == 1);

        clock.Advance(TimeSpan.FromMilliseconds(99));
        scheduler.AdvanceDueWork().Should().Be(0, "the second step needs two base delays");
        clock.Advance(TimeSpan.FromMilliseconds(1));
        scheduler.AdvanceDueWork().Should().Be(1);

        WaitUntil(() => handle.State == EventTaskState.Failed);
        Volatile.Read(ref attempts).Should().Be(3, "one run plus two retries");

        Func<Task> act = async () => await handle.AwaitAsync<int>();
        (await act.Should().ThrowAsync<InvalidOperationException>())
            .Which.Message.Should().Be("boom 3");

        scheduler.GetTaskMetrics(handle.Id).Should().BeNull("metrics are disabled by default");
    }

    [Fact]
    public async Task Timeout_TransitionsToTimeoutAndCountsAsFailure()
    {
        var started = new ManualResetEventSlim(false);
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMilliseconds(10)).Build(),
            clock);

        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            started.Set();
            await Task.Delay(TimeSpan.FromSeconds(1), CancellationToken.None).ConfigureAwait(false);
            return 0;
        });

        started.Wait(Wait).Should().BeTrue();
        WaitUntil(() => handle.State == EventTaskState.Running);

        clock.Advance(TimeSpan.FromMilliseconds(11));
        scheduler.AdvanceDueWork().Should().Be(1);

        handle.State.Should().Be(EventTaskState.Timeout);

        EventTaskStats stats = scheduler.GetStats();
        stats.FailedCount.Should().Be(1);
        stats.TotalProcessed.Should().Be(1);
        scheduler.ActiveCount.Should().Be(1, "the body still runs; its slot frees on completion");

        scheduler.Dispose();
    }

    [Fact]
    public async Task ConcurrencyLimit_CapsRunningBodiesNotThreads()
    {
        int running = 0;
        int maxObserved = 0;
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(3).WithTaskTimeout(TimeSpan.Zero).Build());

        var handles = new EventTaskHandle[24];
        for (int i = 0; i < handles.Length; i++)
        {
            handles[i] = scheduler.Submit(async token =>
            {
                int now = Interlocked.Increment(ref running);
                int previous = Volatile.Read(ref maxObserved);
                while (now > previous && Interlocked.CompareExchange(ref maxObserved, now, previous) != previous)
                {
                    previous = Volatile.Read(ref maxObserved);
                }

                await Task.Yield();
                Interlocked.Decrement(ref running);
                return i;
            });
        }

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);

        int peak = Volatile.Read(ref maxObserved);
        peak.Should().BeLessThanOrEqualTo(3, "the limit bounds running bodies");
        handles.Should().OnlyContain(handle => handle.State == EventTaskState.Completed);
    }

    [Fact]
    public async Task ConcurrencyLimit_StartsUpToLimitBodiesInParallel()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int started = 0;
        int maxObserved = 0;
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(3).WithTaskTimeout(TimeSpan.Zero).Build());

        var handles = new EventTaskHandle[6];
        for (int i = 0; i < handles.Length; i++)
        {
            handles[i] = scheduler.Submit(async token =>
            {
                int now = Interlocked.Increment(ref started);
                int previous = Volatile.Read(ref maxObserved);
                while (now > previous && Interlocked.CompareExchange(ref maxObserved, now, previous) != previous)
                {
                    previous = Volatile.Read(ref maxObserved);
                }

                await gate.Task.ConfigureAwait(false);
                return i;
            });
        }

        WaitUntil(() => Volatile.Read(ref maxObserved) >= 3);
        int peak = Volatile.Read(ref maxObserved);
        peak.Should().Be(3, "bodies wait at the gate, so the run-set cannot grow beyond the limit");
        scheduler.QueuedCount.Should().Be(3, "the remaining submissions wait for a free slot");

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        handles.Should().OnlyContain(handle => handle.State == EventTaskState.Completed);
    }

    [Fact]
    public async Task DrainAsync_CompletesEveryRoundWhenLateBodiesYield()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(3).WithTaskTimeout(TimeSpan.Zero).Build());
        int? timedOutRound = null;

        for (int round = 0; round < 200 && timedOutRound is null; round++)
        {
            for (int i = 0; i < 8; i++)
            {
                _ = scheduler.Submit(async token =>
                {
                    await Task.Yield();
                    return i;
                });
            }

            using var budget = new CancellationTokenSource(Wait);
            try
            {
                await scheduler.DrainAsync().AsTask().WaitAsync(budget.Token);
            }
            catch (OperationCanceledException)
            {
                timedOutRound = round;
            }

            timedOutRound.Should().BeNull($"round {round} must drain within the budget");
            scheduler.IsIdle.Should().BeTrue($"round {round} must be fully drained");
        }
    }

    [Fact]
    public async Task DrainAsync_ResolvesDeterministicallyAfterAllWork()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(4).WithTaskTimeout(TimeSpan.Zero).Build());

        for (int i = 0; i < 100; i++)
        {
            _ = scheduler.Submit(async token =>
            {
                await Task.Yield();
                return i;
            });
        }

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);

        scheduler.IsIdle.Should().BeTrue();
        EventTaskStats stats = scheduler.GetStats();
        stats.CompletedCount.Should().Be(100);
        stats.ActiveCount.Should().Be(0);
        stats.QueuedCount.Should().Be(0);
    }

    [Fact]
    public async Task DoubleCompletion_IsImpossibleUnderRace()
    {
        for (int round = 0; round < 50; round++)
        {
            var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
            var scheduler = new EventTaskScheduler(
                new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMilliseconds(1)).Build(),
                clock);

            var started = new ManualResetEventSlim(false);
            EventTaskHandle handle = scheduler.Submit(async token =>
            {
                started.Set();
                await Task.Delay(TimeSpan.FromMilliseconds(20), CancellationToken.None).ConfigureAwait(false);
                return 7;
            });

            started.Wait(Wait).Should().BeTrue();
            Task<int> resultTask = handle.AwaitAsync<int>().AsTask();
            _ = resultTask.ContinueWith(static (task, _) => _ = task.Exception, null, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

            clock.Advance(TimeSpan.FromMilliseconds(2));
            _ = scheduler.AdvanceDueWork();
            _ = scheduler.Cancel(handle.Id);
            _ = scheduler.Cancel(handle.Id);

            handle.State.Should().BeOneOf(
                RaceTerminalStates,
                "only the deadline and the body completion contend here; the body ignores its token, so the two Cancel calls are no-ops and can never yield Cancelled or Failed");

            WaitUntil(() => scheduler.IsIdle);

            EventTaskStats stats = scheduler.GetStats();
            (stats.CompletedCount + stats.FailedCount).Should().Be(1,
                "exactly one terminal transition may be counted, whichever of the deadline and the body won the compare-exchange");
            stats.TotalProcessed.Should().Be(1, "the aggregate counter sees the same single terminal transition");

            if (handle.State == EventTaskState.Completed)
            {
                (await resultTask).Should().Be(7, "the body won, so the handle carries its result");
                stats.CompletedCount.Should().Be(1);
                stats.FailedCount.Should().Be(0);
            }
            else
            {
                SpinWait.SpinUntil(() => resultTask.IsFaulted, Wait).Should().BeTrue("the losing path still faults exactly once");
                resultTask.Exception!.InnerException!.Should().BeOfType<TimeoutException>();
                stats.FailedCount.Should().Be(1, "a deadline terminal transition is counted as a failure");
                stats.CompletedCount.Should().Be(0, "the late body completion may not add a second terminal transition");
            }

            scheduler.Cancel(handle.Id).Should().BeFalse("terminal handles accept no further transition");

            scheduler.Dispose();
        }
    }

    [Fact]
    public async Task TerminalTransition_DeadlineWinsWhenBodyIsStillParked()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMilliseconds(1)).Build(),
            clock);
        var park = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        try
        {
            EventTaskHandle handle = scheduler.Submit(async token =>
            {
                entered.SetResult();
                await park.Task.ConfigureAwait(false);
                return 7;
            });

            await entered.Task.WaitAsync(Wait);
            WaitUntil(() => handle.State == EventTaskState.Running);

            clock.Advance(TimeSpan.FromMilliseconds(2));
            scheduler.AdvanceDueWork().Should().Be(1);

            handle.State.Should().Be(EventTaskState.Timeout, "no racing body completion exists yet, so the deadline is the only transition");
            EventTaskStats afterDeadline = scheduler.GetStats();
            afterDeadline.FailedCount.Should().Be(1);
            afterDeadline.CompletedCount.Should().Be(0);
            afterDeadline.TotalProcessed.Should().Be(1);

            Task<int> deadlineResult = handle.AwaitAsync<int>().AsTask();
            deadlineResult.IsFaulted.Should().BeTrue("the deadline resolves the handle exactly once");
            deadlineResult.Exception!.InnerException!.Should().BeOfType<TimeoutException>();

            park.SetResult();
            WaitUntil(() => scheduler.IsIdle);

            EventTaskStats afterBody = scheduler.GetStats();
            afterBody.CompletedCount.Should().Be(0, "the late body completion lost the transition and must not count");
            afterBody.FailedCount.Should().Be(1, "the single terminal transition stays the deadline one");
            afterBody.TotalProcessed.Should().Be(1);
            scheduler.Cancel(handle.Id).Should().BeFalse();
        }
        finally
        {
            park.TrySetResult();
            scheduler.Dispose();
        }
    }

    [Fact]
    public async Task TerminalTransition_BodyWinsWhenDeadlineHasNotFired()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMinutes(5)).Build(),
            clock);

        var park = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            await park.Task.ConfigureAwait(false);
            return 7;
        });

        park.SetResult();
        (await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait)).Should().Be(7);

        handle.State.Should().Be(EventTaskState.Completed, "the body finished while the deadline was still five minutes away");
        EventTaskStats afterBody = scheduler.GetStats();
        afterBody.CompletedCount.Should().Be(1);
        afterBody.FailedCount.Should().Be(0);
        afterBody.TotalProcessed.Should().Be(1);

        clock.Advance(TimeSpan.FromMinutes(6));
        scheduler.AdvanceDueWork().Should().Be(0, "a finished task is no longer in the deadline table");

        EventTaskStats afterAdvance = scheduler.GetStats();
        afterAdvance.CompletedCount.Should().Be(1);
        afterAdvance.FailedCount.Should().Be(0, "the late clock advance may not convert a completed task into a timeout");
        afterAdvance.TotalProcessed.Should().Be(1);
        scheduler.Cancel(handle.Id).Should().BeFalse();

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
    }

    [Fact]
    public async Task Complete_CancelsQueuedAndStopsSubmissions()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle blocker = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
        });
        while (blocker.State != EventTaskState.Running)
        {
            await Task.Yield();
        }

        var queued = new EventTaskHandle[8];
        for (int i = 0; i < queued.Length; i++)
        {
            int index = i;
            queued[i] = scheduler.Submit(token => ValueTask.FromResult(index));
        }

        scheduler.Complete();

        queued.Should().OnlyContain(handle => handle.State == EventTaskState.Cancelled);
        scheduler.QueuedCount.Should().Be(0);
        scheduler.IsClosed.Should().BeTrue();

        Func<EventTaskHandle> act = () => scheduler.Submit(token => ValueTask.FromResult(0));
        act.Should().Throw<EventTaskSchedulerClosedException>();

        gate.SetResult();
        WaitUntil(() => scheduler.IsIdle);
    }

    [Fact]
    public async Task DisposeAsync_JoinsRunningBodyAndLeavesNoQueue()
    {
        var started = new ManualResetEventSlim(false);
        var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.FromMilliseconds(1)).Build());

        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            started.Set();
            await Task.Delay(TimeSpan.FromSeconds(30), token).ConfigureAwait(false);
            return 1;
        });

        started.Wait(Wait).Should().BeTrue();
        WaitUntil(() => handle.State == EventTaskState.Running);

        var disposal = scheduler.DisposeAsync();
        WaitUntil(() => handle.State == EventTaskState.Cancelled);
        await disposal.AsTask().WaitAsync(Wait);
        WaitUntil(() => scheduler.ActiveCount == 0);
        scheduler.IsIdle.Should().BeTrue();

        Func<Task> act = async () => await handle.AwaitAsync<int>();
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task SlotPool_RecyclesEntryObjectsAcrossSubmissions()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithMaxQueueSize(2).WithTaskTimeout(TimeSpan.Zero).Build());

        var seen = new HashSet<long>();
        for (int i = 0; i < 50; i++)
        {
            int index = i;
            EventTaskHandle handle = scheduler.Submit(token => ValueTask.FromResult(index));
            (await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait)).Should().Be(i);
            seen.Add(handle.Id.Value).Should().BeTrue("ids are unique per issue");
        }

        seen.Count.Should().Be(50);
        scheduler.GetStats().ActiveCount.Should().Be(0);
    }

    [Fact]
    public async Task QueueFull_RejectsBeyondCapacityAndTrySubmitReportsFalse()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithMaxQueueSize(2)
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .Build());

        EventTaskHandle blocker = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
        });
        while (blocker.State != EventTaskState.Running)
        {
            await Task.Yield();
        }

        _ = scheduler.Submit(token => ValueTask.FromResult(1));
        _ = scheduler.Submit(token => ValueTask.FromResult(2));

        Func<EventTaskHandle> act = () => scheduler.Submit(token => ValueTask.FromResult(3));
        act.Should().Throw<EventQueueFullException>();

        scheduler.TrySubmit(token => ValueTask.FromResult(4), EventTaskPriority.Normal, null, out EventTaskHandle rejected)
            .Should().BeFalse();
        rejected.IsValid.Should().BeFalse();
        rejected.Cancel().Should().BeFalse("rejected submissions do not own a slot");

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        scheduler.GetStats().CompletedCount.Should()
            .Be(3, "six submissions but only three survived the capacity policy, so completions drop with them");
    }

    [Fact]
    public async Task OptionsBuilder_RejectsInvalidConcurrencyAndBuildsValidOptions()
    {
        var act = () => new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(-1).Build();
        act.Should().Throw<InvalidOperationException>().WithMessage("*ConcurrencyLimit*");

        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(2).WithTaskTimeout(TimeSpan.Zero).Build());
        scheduler.ConcurrencyLimit.Should().Be(2);
        EventTaskHandle handle = scheduler.Submit<object?, int>(SyncBody, default(object));
        (await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait)).Should().Be(5);
    }

    private static ValueTask<int> SyncBody(object? state, CancellationToken token) => ValueTask.FromResult(5);

    [Fact]
    public async Task Metrics_FlagDisabled_SkipsPerTaskSnapshots()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle handle = scheduler.Submit(token => ValueTask.FromResult(1));
        await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait);

        scheduler.GetTaskMetrics(handle.Id).Should().BeNull();
        scheduler.GetAllTaskMetrics().Should().BeEmpty();
    }

    [Fact]
    public async Task Metrics_FlagEnabled_RecordsStatesAndPrunesOnGc()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithMetrics()
                .WithGcInterval(TimeSpan.FromMilliseconds(1000))
                .WithTaskTimeout(TimeSpan.Zero)
                .Build(),
            clock);

        EventTaskHandle handle = scheduler.Submit(token => ValueTask.FromResult(1));
        await handle.AwaitAsync<int>().AsTask().WaitAsync(Wait);

        EventTaskMetrics? metrics = scheduler.GetTaskMetrics(handle.Id);
        metrics.Should().NotBeNull();
        metrics!.Value.State.Should().Be(EventTaskState.Completed);
        metrics.Value.RetryCount.Should().Be(0);
        scheduler.GetAllTaskMetrics().Should().HaveCount(1);

        clock.Advance(TimeSpan.FromMilliseconds(5000));
        scheduler.CollectGarbage().Should().Be(1);
        scheduler.GetTaskMetrics(handle.Id).Should().BeNull("stale metrics are pruned by the gc pass");

        scheduler.ClearMetrics();
        scheduler.GetStats().CompletedCount.Should().Be(0);
    }

    [Fact]
    public async Task CancelBatch_AndCancelAll_ReportAffectedTasks()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle blocker = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
        });
        while (blocker.State != EventTaskState.Running)
        {
            await Task.Yield();
        }

        var ids = new EventTaskId[5];
        for (int i = 0; i < ids.Length; i++)
        {
            int index = i;
            ids[i] = scheduler.Submit(token => ValueTask.FromResult(index)).Id;
        }

        scheduler.CancelBatch(ids.AsSpan(0, 2)).Should().Be(2);
        scheduler.CancelAll().Should().Be(3, "the remaining queued tasks cancel; the running body only gets a signal");

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        scheduler.IsIdle.Should().BeTrue();
    }

    [Fact]
    public async Task SubmittingManyTasks_DoesNotBuyThreadsPerTask()
    {
        int threadsBefore = Process.GetCurrentProcess().Threads.Count;

        var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(8).WithTaskTimeout(TimeSpan.Zero).Build());

        try
        {
            for (int i = 0; i < 2000; i++)
            {
                int index = i;
                _ = scheduler.Submit(token => ValueTask.FromResult(index));
            }

            int threadsAfter = Process.GetCurrentProcess().Threads.Count;
            (threadsAfter - threadsBefore).Should().BeLessThan(32, "the task queue never buys threads per task");
            scheduler.ActiveCount.Should().BeLessThanOrEqualTo(8);

            await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
            scheduler.GetStats().CompletedCount.Should().Be(2000, "every submitted body actually ran");
        }
        finally
        {
            scheduler.Dispose();
        }
    }

    [Fact]
    public async Task QueuedBacklog_StillCompletesWhileRunningWorkExceedsQueueCapacity()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithMaxQueueSize(4)
                .WithConcurrencyLimit(2)
                .WithTaskTimeout(TimeSpan.Zero)
                .Build());

        _ = scheduler.Submit(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
            return 0;
        });
        _ = scheduler.Submit(async token =>
        {
            await gate.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
            return 1;
        });
        WaitUntil(() => scheduler.ActiveCount == 2);

        for (int i = 0; i < 4; i++)
        {
            int index = i;
            _ = scheduler.SubmitBound(SyncBody, index);
        }

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        scheduler.GetStats().CompletedCount.Should().Be(6, "running bodies do not consume queue capacity");
    }

    [Fact]
    public async Task HotPath_SubmitWithHoistedStaticBody_AllocatesNothingInSteadyState()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        Func<object?, CancellationToken, ValueTask<object?>> body = SyncBoundBody;
        object? state = new object();

        for (int i = 0; i < 256; i++)
        {
            _ = scheduler.SubmitBound(body, state);
        }

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int completed = 0;
        for (int i = 0; i < 512; i++)
        {
            EventTaskHandle handle = scheduler.SubmitBound(body, state);
            completed += handle.State == EventTaskState.Completed ? 1 : 0;
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0, "pooled slots and providers keep the steady bound-body submit at zero bytes");
        completed.Should().Be(512);

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);

        static ValueTask<object?> SyncBoundBody(object? state, CancellationToken token) => ValueTask.FromResult<object?>(null);
    }

    [Fact]
    public async Task DrainAsync_SequentialDrainsEachBlockUntilTheirOwnIdleSignal()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        for (int round = 0; round < 3; round++)
        {
            var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _ = scheduler.Submit(async token =>
            {
                await gate.Task.ConfigureAwait(false);
                return round;
            });
            WaitUntil(() => scheduler.ActiveCount == 1);

            Task drain = scheduler.DrainAsync().AsTask();
            drain.IsCompleted.Should().BeFalse($"round {round}: the drain must block, not poll to idle");

            gate.SetResult();
            await drain.WaitAsync(Wait);
            scheduler.IsIdle.Should().BeTrue($"round {round} drained");
        }
    }

    [Fact]
    public async Task DrainAsync_ConcurrentBlockedDrainsAllWakeOnSingleIdleSignal()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = scheduler.Submit(async token =>
        {
            await gate.Task.ConfigureAwait(false);
            return 0;
        });
        WaitUntil(() => scheduler.ActiveCount == 1);

        var t1 = scheduler.DrainAsync().AsTask();
        var t2 = scheduler.DrainAsync().AsTask();
        var t3 = scheduler.DrainAsync().AsTask();
        (t1.IsCompleted || t2.IsCompleted || t3.IsCompleted).Should().BeFalse("all three drainers must be parked");

        gate.SetResult();
        await Task.WhenAll(t1, t2, t3).WaitAsync(Wait);
        scheduler.IsIdle.Should().BeTrue();
    }

    [Fact]
    public void DrainWaiters_ReserveFreshSignalPerClaimAndRejectStaleRelease()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.Zero).Build());

        long first = scheduler.ClaimWaiter();
        scheduler.WaitCount.Should().Be(1, "a claim registers the waiter before any idle read");
        scheduler.PrepareWaiterSignal(first).IsCompleted.Should().BeFalse("a parking claim yields a blocking signal");
        scheduler.ReleaseWaiter(first);
        scheduler.WaitCount.Should().Be(0, "an idle-detected claim is dropped, never completed");

        long second = scheduler.ClaimWaiter();
        second.Should().NotBe(first, "every claim carries a fresh epoch token");
        Task secondSignal = scheduler.PrepareWaiterSignal(second);
        secondSignal.IsCompleted.Should().BeFalse("a recycled slot hands back a blocking signal");
        scheduler.SignalDrainWaiters();
        secondSignal.IsCompleted.Should().BeTrue("the idle signal wakes the parked waiter");
        scheduler.WaitCount.Should().Be(0, "signals deregister as they wake");

        long third = scheduler.ClaimWaiter();
        third.Should().NotBe(second, "a woken slot is reusable");
        Task thirdSignal = scheduler.PrepareWaiterSignal(third);
        thirdSignal.IsCompleted.Should().BeFalse(
            "a recycled slot must hand back a blocking signal, never the previous claim's completed task");

        scheduler.ReleaseWaiter(first);
        scheduler.ReleaseWaiter(second);
        scheduler.WaitCount.Should().Be(1, "stale tokens cannot steal the live claim");
        thirdSignal.IsCompleted.Should().BeFalse("stale tokens cannot complete another waiter's signal");

        scheduler.SignalDrainWaiters();
        thirdSignal.IsCompleted.Should().BeTrue("the live claim still wakes normally");
        scheduler.WaitCount.Should().Be(0);
    }

    [Fact]
    public void DrainWaiters_SignalLandingBeforeMaterializationStillWakes()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.Zero).Build());

        long token = scheduler.ClaimWaiter();
        scheduler.SignalDrainWaiters();
        scheduler.PrepareWaiterSignal(token).IsCompleted.Should().BeTrue(
            "an idle signal that lands before the wait is materialized must not be lost");
        scheduler.WaitCount.Should().Be(0);

        long reused = scheduler.ClaimWaiter();
        reused.Should().NotBe(token, "the slot is reusable under a fresh epoch token");
        scheduler.PrepareWaiterSignal(reused).IsCompleted.Should().BeFalse(
            "the fresh claim parks again instead of inheriting the earlier wake");
        scheduler.ReleaseWaiter(reused);
    }

    [Fact]
    public void DrainWaiters_ClaimAndReleaseAllocateNothing()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithTaskTimeout(TimeSpan.Zero).Build());

        for (int i = 0; i < 64; i++)
        {
            scheduler.ReleaseWaiter(scheduler.ClaimWaiter());
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 512; i++)
        {
            scheduler.ReleaseWaiter(scheduler.ClaimWaiter());
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0,
            "the idle drain path registers and drops claims without allocating a signal");
    }

    [Fact]
    public void GetAllTaskMetrics_DoesNotQueueBehindTheSchedulingGate()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithMetrics().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        for (int i = 0; i < 4; i++)
        {
            int index = i;
            _ = scheduler.Submit(async token =>
            {
                await gate.Task.ConfigureAwait(false);
                return index;
            });
        }

        scheduler.GetAllTaskMetrics().Should().HaveCount(4);

        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var reported = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = Task.Run(async () =>
        {
            await start.Task.ConfigureAwait(false);
            reported.TrySetResult(scheduler.GetAllTaskMetrics().Count);
        });

        bool finished;
        lock (scheduler.Gate)
        {
            start.SetResult();
            finished = SpinWait.SpinUntil(() => reported.Task.IsCompleted, Wait);
        }

        finished.Should().BeTrue("a metrics snapshot must never queue behind the submit gate");
    }

    [Fact]
    public async Task Submit_KeepsFlowingWhileMetricsAreSnapshotted()
    {
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithMetrics().WithConcurrencyLimit(4).WithTaskTimeout(TimeSpan.Zero).Build());
        using var stop = new CancellationTokenSource();
        Task hammer = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                scheduler.GetAllTaskMetrics();
                await Task.Yield();
            }
        });

        for (int i = 0; i < 200; i++)
        {
            _ = scheduler.SubmitBound(SyncBody, null);
        }

        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        stop.Cancel();
        await hammer;
        scheduler.GetStats().CompletedCount.Should().Be(200, "concurrent metric snapshots never stall the producer");
    }

    [Fact]
    public async Task DisposeAsync_WithToken_AbandonsWaitForStubbornBodyAndRemainsObservable()
    {
        var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(2).WithTaskTimeout(TimeSpan.Zero).Build());
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        EventTaskHandle handle = scheduler.Submit(async token =>
        {
            await release.Task.WaitAsync(Wait, CancellationToken.None).ConfigureAwait(false);
            return 1;
        });
        Task<int> body = handle.AwaitAsync<int>().AsTask();
        _ = body.ContinueWith(
            static (task, _) => _ = task.Exception, null, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
        WaitUntil(() => scheduler.ActiveCount == 1);

        using var budget = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        await scheduler.DisposeAsync(budget.Token);

        scheduler.IsClosed.Should().BeTrue("abandoning the idle wait still finalises the closure");
        scheduler.GetStats().ActiveCount.Should().Be(1, "the stubborn body remains observable instead of vanishing");
        scheduler.WaitCount.Should().Be(0, "the abandoned drainer deregisters its waiter");

        release.SetException(new TimeoutException("the body never observed cancellation"));
        (await body.ContinueWith(
            static (task, _) => task.IsFaulted, null, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default))
            .Should().BeTrue("the abandoned body surfaces its failure instead of hanging the disposal");
    }

    [Fact]
    public async Task Metrics_RegistryScanStaysBoundedByCreatedSlots()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithMetrics()
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .Build(),
            clock);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = scheduler.Submit(async token =>
        {
            await gate.Task.ConfigureAwait(false);
            return -1;
        });
        WaitUntil(() => scheduler.ActiveCount == 1);

        for (int i = 0; i < 8; i++)
        {
            int index = i;
            _ = scheduler.Submit(async token =>
            {
                await gate.Task.ConfigureAwait(false);
                return index;
            });
        }

        scheduler.CreatedSlotCount.Should().Be(9, "each live task owns a slot");
        scheduler.MetricsRegistryLength.Should().Be(scheduler.CreatedSlotCount, "the registry mirrors created slots, never the capacity table");
        scheduler.GetAllTaskMetrics().Should().HaveCount(9);

        gate.SetResult();
        await scheduler.DrainAsync().AsTask().WaitAsync(Wait);
        scheduler.WaitCount.Should().Be(0, "drains release their waiter slots");

        clock.Advance(TimeSpan.FromMinutes(5));
        scheduler.CollectGarbage().Should().Be(9, "the bounded registry walk prunes every terminal metric");
        scheduler.GetAllTaskMetrics().Should().BeEmpty("pruned metrics leave the live snapshot");
    }

    [Fact]
    public async Task DrainWaiter_WakesWhenCancelDropsTheLastDelayedRetry()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .WithRetries(maxRetries: 3)
                .WithRetryDelay(TimeSpan.FromHours(1))
                .Build(),
            clock);

        EventTaskHandle handle = scheduler.SubmitVoid(async token =>
        {
            await Task.Yield();
            throw new InvalidOperationException("park this retry");
        });
        WaitUntil(() => scheduler.DelayedRetryCount == 1);

        long token = scheduler.ClaimWaiter();
        Task signal = scheduler.PrepareWaiterSignal(token);
        await SettleAsync();
        signal.IsCompleted.Should().BeFalse(
            "live retry work exists, so a registered waiter must park and unrelated pumps must not wake it");

        scheduler.Cancel(handle.Id).Should().BeTrue();

        signal.IsCompleted.Should().BeTrue(
            "Cancel dropped the last live work and must wake the registered drain waiter itself, not via an unrelated pump");
        scheduler.WaitCount.Should().Be(0, "waking deregisters the waiter");
        scheduler.IsIdle.Should().BeTrue();
        scheduler.ReleaseWaiter(token);
    }

    [Fact]
    public async Task DrainWaiter_WakesWhenCancelBatchDropsTheLastDelayedRetries()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .WithRetries(maxRetries: 3)
                .WithRetryDelay(TimeSpan.FromHours(1))
                .Build(),
            clock);

        var ids = new EventTaskId[2];
        for (int i = 0; i < ids.Length; i++)
        {
            ids[i] = scheduler.SubmitVoid(async token =>
            {
                await Task.Yield();
                throw new InvalidOperationException("park these retries");
            }).Id;
        }

        WaitUntil(() => scheduler.ActiveCount == 0 && scheduler.DelayedRetryCount == 2);

        long token = scheduler.ClaimWaiter();
        Task signal = scheduler.PrepareWaiterSignal(token);
        await SettleAsync();
        signal.IsCompleted.Should().BeFalse(
            "two parked retries are live work, so a registered waiter must park and unrelated pumps must not wake it");

        scheduler.CancelBatch(ids).Should().Be(2);

        signal.IsCompleted.Should().BeTrue(
            "CancelBatch dropped the last live work and must wake the registered drain waiter itself");
        scheduler.WaitCount.Should().Be(0, "waking deregisters the waiter");
        scheduler.IsIdle.Should().BeTrue();
        scheduler.ReleaseWaiter(token);
    }

    [Fact]
    public async Task DrainWaiter_WakesWhenCancelAllDropsTheLastDelayedRetries()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .WithRetries(maxRetries: 3)
                .WithRetryDelay(TimeSpan.FromHours(1))
                .Build(),
            clock);

        for (int i = 0; i < 3; i++)
        {
            _ = scheduler.SubmitVoid(async token =>
            {
                await Task.Yield();
                throw new InvalidOperationException("park these retries");
            });
        }

        WaitUntil(() => scheduler.ActiveCount == 0 && scheduler.DelayedRetryCount == 3);

        long token = scheduler.ClaimWaiter();
        Task signal = scheduler.PrepareWaiterSignal(token);
        await SettleAsync();
        signal.IsCompleted.Should().BeFalse(
            "three parked retries are live work, so a registered waiter must park and unrelated pumps must not wake it");

        scheduler.CancelAll().Should().Be(3);

        signal.IsCompleted.Should().BeTrue(
            "CancelAll dropped the last live work and must wake the registered drain waiter itself");
        scheduler.WaitCount.Should().Be(0, "waking deregisters the waiter");
        scheduler.IsIdle.Should().BeTrue();
        scheduler.ReleaseWaiter(token);
    }

    [Fact]
    public async Task DrainWaiter_StaysParkedWhileABodyRunsAfterQueuedCancel()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder().WithConcurrencyLimit(1).WithTaskTimeout(TimeSpan.Zero).Build());

        EventTaskHandle blocker = scheduler.SubmitVoid(async token =>
        {
            await gate.Task.ConfigureAwait(false);
        });
        EventTaskHandle queued = scheduler.Submit(async token => ValueTask.FromResult(1));
        WaitUntil(() => scheduler.ActiveCount == 1 && scheduler.QueuedCount == 1);
        blocker.State.Should().Be(EventTaskState.Running);

        long token = scheduler.ClaimWaiter();
        Task signal = scheduler.PrepareWaiterSignal(token);
        signal.IsCompleted.Should().BeFalse("a running body and a queued task are live work");

        scheduler.Cancel(queued.Id).Should().BeTrue();
        signal.IsCompleted.Should().BeFalse(
            "cancelling a queued task while a body still runs must not claim idleness");

        gate.SetResult();
        Func<Task> awaitDrain = async () => await signal.ConfigureAwait(false);
        await awaitDrain.Should().NotThrowAsync(
            "when the last running body finishes, the completion path wakes the registered waiter");
        scheduler.ReleaseWaiter(token);
    }

    [Fact]
    public async Task DrainAsync_WakesWhenAnotherThreadCancelsAllRemainingWork()
    {
        var clock = new ManualTimeProvider(DateTimeOffset.UnixEpoch);
        using var scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .WithRetries(maxRetries: 3)
                .WithRetryDelay(TimeSpan.FromHours(1))
                .Build(),
            clock);

        var handles = new EventTaskHandle[3];
        for (int i = 0; i < handles.Length; i++)
        {
            handles[i] = scheduler.SubmitVoid(async token =>
            {
                await Task.Yield();
                throw new InvalidOperationException("park these retries");
            });
        }

        WaitUntil(() => scheduler.ActiveCount == 0 && scheduler.DelayedRetryCount == 3);

        var parked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var budget = new CancellationTokenSource(Wait);

        Task drainer = Task.Run(async () =>
        {
            parked.SetResult();
            await scheduler.DrainAsync(budget.Token).ConfigureAwait(false);
        });
        _ = drainer.ContinueWith(static (task, _) => _ = task.Exception, null, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);

        await parked.Task.WaitAsync(Wait);
        WaitUntil(() => scheduler.DrainParkCount == 1);

        Task canceller = Task.Run(() =>
        {
            scheduler.CancelAll();
            cancelled.SetResult();
        });

        await cancelled.Task.WaitAsync(Wait);
        await canceller;
        Func<Task> awaitDrain = async () => await drainer.ConfigureAwait(false);
        await awaitDrain.Should().NotThrowAsync(
            "the drain waiter parked on thread A must be woken by thread B's CancelAll, without an unrelated pump");
        scheduler.IsIdle.Should().BeTrue();
        scheduler.WaitCount.Should().Be(0);
        handles.Should().OnlyContain(handle => handle.State == EventTaskState.Cancelled);
    }
}
