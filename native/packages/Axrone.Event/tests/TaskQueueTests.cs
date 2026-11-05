namespace Axrone.Event.Tests;

using FluentAssertions;

public sealed class TaskQueueTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    private static void WaitUntil(Func<bool> condition)
    {
        SpinWait.SpinUntil(condition, Wait).Should().BeTrue("the scheduler must reach the expected state");
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
        peak.Should().BeGreaterThan(1, "the limit is a bound, not a serial queue");
        handles.Should().OnlyContain(handle => handle.State == EventTaskState.Completed);
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
    public void DoubleCompletion_IsImpossibleUnderRace()
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

            handle.State.Should().Be(EventTaskState.Timeout, "the deadline wins the single terminal transition");
            SpinWait.SpinUntil(() => resultTask.IsFaulted, Wait).Should().BeTrue("the handle faults exactly once");
            resultTask.Exception!.InnerException!.Should().BeOfType<TimeoutException>();
            scheduler.Cancel(handle.Id).Should().BeFalse("terminal handles accept no further transition");

            scheduler.Dispose();
        }
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
    public void SubmittingManyTasks_DoesNotBuyThreadsPerTask()
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
        }
        finally
        {
            scheduler.Dispose();
        }
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
}
