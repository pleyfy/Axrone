namespace Axrone.Ecs.Tests;

using System.Collections.Concurrent;
using System.Runtime.ExceptionServices;

internal readonly struct EcsEventProbe(int first, int second)
{
    internal readonly int First = first;
    internal readonly int Second = second;
}

internal readonly struct EcsEventWideProbe(long a, long b, long c, long d, long e, long f, long g, long h, long i)
{
    internal readonly long A = a;
    internal readonly long B = b;
    internal readonly long C = c;
    internal readonly long D = d;
    internal readonly long E = e;
    internal readonly long F = f;
    internal readonly long G = g;
    internal readonly long H = h;
    internal readonly long I = i;
}

public sealed class EcsWorldEventsTests : IDisposable
{
    private readonly World _world;
    private readonly EcsEventName _tick = EcsEventNames.Intern("test.tick");
    private readonly EcsEventName _other = EcsEventNames.Intern("test.other");

    public EcsWorldEventsTests() => _world = new World();

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void On_Delivers_Payload_In_Registration_Order()
    {
        List<string> order = [];
        _world.On(in _tick, (in EcsEventName _, in EcsEventProbe value) => order.Add($"a{value.First}"));
        _world.On(in _tick, (in EcsEventName _, in EcsEventProbe value) => order.Add($"b{value.Second}"));

        _world.EmitSync(_tick, new EcsEventProbe(1, 2)).Should().BeTrue();

        order.Should().Equal("a1", "b2");
    }

    [Fact]
    public void Same_Delegate_Twice_Is_Two_Registrations()
    {
        EcsEventCallback<EcsEventProbe> handler = static (in EcsEventName _, in EcsEventProbe _) => { };
        int calls = 0;
        handler = (in EcsEventName _, in EcsEventProbe _) => calls++;

        _world.On(in _tick, handler);
        _world.On(in _tick, handler);

        _world.EmitSync(_tick, default(EcsEventProbe));
        calls.Should().Be(2);

        _world.OffHandlers(in _tick, handler).Should().Be(2);
        _world.EmitSync(_tick, default(EcsEventProbe));
        calls.Should().Be(2);
    }

    [Fact]
    public void Off_Token_Is_Idempotent_And_Only_Removes_Its_Own_Registration()
    {
        int calls = 0;
        EcsEventSubscription first = _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => calls++);
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => calls++);

        _world.Off(first).Should().BeTrue();
        _world.Off(first).Should().BeFalse();

        _world.EmitSync(_tick, default(EcsEventProbe));
        calls.Should().Be(1);
    }

    [Fact]
    public void Once_Fires_Once_And_Is_Dropped_Afterwards()
    {
        int calls = 0;
        _world.Once<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => calls++);

        _world.EmitSync(_tick, default(EcsEventProbe));
        _world.EmitSync(_tick, default(EcsEventProbe));

        calls.Should().Be(1);
        _world.HandlerCount(in _tick).Should().Be(0);
    }

    [Fact]
    public void Emit_Without_Subscribers_Reports_False()
    {
        _world.EmitSync(_other, default(EcsEventProbe)).Should().BeFalse();
        _world.OffAll(in _other).Should().Be(0);
    }

    [Fact]
    public async Task Emit_Async_Completes_And_Keeps_Call_Order()
    {
        List<int> order = [];
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) => order.Add(value.First));

        await _world.Emit(_tick, new EcsEventProbe(1, 0));
        _world.EmitSync(_tick, new EcsEventProbe(2, 0));
        await _world.Emit(_tick, new EcsEventProbe(3, 0));

        order.Should().Equal(1, 2, 3);
    }

    [Fact]
    public void Pause_Parks_Events_And_Resume_Delivers_Them_In_Park_Order()
    {
        List<int> seen = [];
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) => seen.Add(value.First));

        _world.PauseEvents();
        _world.EventsPaused.Should().BeTrue();
        _world.EmitSync(_tick, new EcsEventProbe(1, 0)).Should().BeTrue();
        _world.EmitSync(_tick, new EcsEventProbe(2, 0)).Should().BeTrue();
        seen.Should().BeEmpty();
        _world.PendingEventCount.Should().Be(2);

        int delivered = _world.ResumeEvents();

        delivered.Should().Be(2);
        seen.Should().Equal(1, 2);
        _world.PendingEventCount.Should().Be(0);
    }

    [Fact]
    public async Task Mid_Flush_Repark_Stops_Resume_And_Drain_Delivers_The_Rest()
    {
        List<int> seen = [];
        bool gateClosed = false;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) =>
        {
            seen.Add(value.First);
            if (!gateClosed)
            {
                gateClosed = true;
                _world.PauseEvents();
            }
        });

        _world.PauseEvents();
        gateClosed = false;
        _world.EmitSync(_tick, new EcsEventProbe(1, 0));
        _world.EmitSync(_tick, new EcsEventProbe(2, 0));
        _world.EmitSync(_tick, new EcsEventProbe(3, 0));

        _world.ResumeEvents().Should().Be(1);
        seen.Should().Equal(1);
        _world.PendingEventCount.Should().Be(2);

        int drained = await _world.DrainEventsAsync();

        drained.Should().Be(2);
        seen.Should().Equal(1, 2, 3);
    }

    [Fact]
    public async Task Drain_Honours_Cancellation_Before_Dispatching()
    {
        using CancellationTokenSource source = new();
        source.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Drain(_world, source.Token));
        _world.TryGetEventMetrics(_tick, out _).Should().BeFalse();

        static async Task Drain(World world, CancellationToken token)
        {
            _ = await world.DrainEventsAsync(token);
        }
    }

    [Fact]
    public async Task Parked_Events_Are_Delivered_By_Drain_Even_While_Still_Paused()
    {
        List<int> seen = [];
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) => seen.Add(value.First));

        _world.PauseEvents();
        _world.EmitSync(_tick, new EcsEventProbe(7, 0));

        (await _world.DrainEventsAsync()).Should().Be(1);
        seen.Should().Equal(7);
        _world.EventsPaused.Should().BeTrue();
        _world.EmitSync(_tick, new EcsEventProbe(8, 0)).Should().BeTrue();
        seen.Should().Equal(7);
        _world.ResumeEvents().Should().Be(1);
        seen.Should().Equal(7, 8);
    }

    [Fact]
    public void Buffer_Overflow_Throws_By_Default_And_Losses_Are_Counted()
    {
        _world.EventBufferCapacity = 2;
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.PauseEvents();
        _world.EmitSync(_tick, new EcsEventProbe(1, 0));
        _world.EmitSync(_tick, new EcsEventProbe(2, 0));

        _ = ((Action)(() => _world.EmitSync(_tick, new EcsEventProbe(3, 0))))
            .Should().Throw<EcsEventBufferFullException>();

        _world.EventBufferOverflow = EcsEventBufferOverflow.DropOldest;
        _world.EmitSync(_tick, new EcsEventProbe(4, 0));

        _world.EventsPaused.Should().BeTrue();
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.DroppedCount.Should().Be(1);
        metrics.BufferedCount.Should().Be(3);

        List<int> seen = [];
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) => seen.Add(value.First));
        _world.ResumeEvents();
        seen.Should().Equal(2, 4);
    }

    [Fact]
    public void Oversized_Payload_Is_Rejected_Typed_While_Paused()
    {
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.PauseEvents();

        _ = ((Action)(() => _world.EmitSync(_tick, default(EcsEventWideProbe))))
            .Should().Throw<EcsEventPayloadTooLargeException>();

        _world.ResumeEvents();
    }

    [Fact]
    public void Handler_Faults_Are_Counted_Exposed_And_Never_Swallow_Later_Handlers()
    {
        int reached = 0;
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => throw new InvalidOperationException("boom"));
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => reached++);

        _world.EmitSync(_tick, default(EcsEventProbe)).Should().BeFalse();

        reached.Should().Be(1);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.FaultCount.Should().Be(1);
        ExceptionDispatchInfo? fault = _world.GetEventFault(in _tick);
        fault.Should().NotBeNull();
        fault!.SourceException.Should().BeOfType<InvalidOperationException>();
    }

    [Fact]
    public void Metrics_Timing_Grows_With_Work_And_Stays_Zero_Without_It()
    {
        const int Batch = 20_000;
        const long OneSecondNanoseconds = 1_000_000_000L;

        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });

        // Negative control: a live subscription with no emission must not fabricate timing.
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics idle).Should().BeTrue();
        idle.EmitCount.Should().Be(0);
        idle.TotalNanoseconds.Should().Be(0);
        idle.MaxNanoseconds.Should().Be(0);

        for (int i = 0; i < Batch; i++)
        {
            _world.EmitSync(_tick, default(EcsEventProbe));
        }

        _world.TryGetEventMetrics(_tick, out EcsEventMetrics first).Should().BeTrue();
        first.EmitCount.Should().Be(Batch);
        first.InvocationCount.Should().Be(Batch);
        first.HandlerCount.Should().Be(1);
        first.TotalNanoseconds.Should().BeGreaterThan(0);
        first.TotalNanoseconds.Should().BeLessThan(OneSecondNanoseconds);

        for (int i = 0; i < Batch; i++)
        {
            _world.EmitSync(_tick, default(EcsEventProbe));
        }

        _world.TryGetEventMetrics(_tick, out EcsEventMetrics second).Should().BeTrue();
        second.EmitCount.Should().Be(Batch * 2);
        second.InvocationCount.Should().Be(Batch * 2);
        second.TotalNanoseconds.Should().BeGreaterThan(first.TotalNanoseconds);
        second.TotalNanoseconds.Should().BeLessThan(OneSecondNanoseconds);
        second.MaxNanoseconds.Should().BeGreaterThan(0);

        // Per-emit maximum must dominate the per-emit average; an average recorded as the
        // maximum, or a unit slip between ticks and nanoseconds, breaks this immediately.
        (second.MaxNanoseconds * second.EmitCount).Should().BeGreaterThanOrEqualTo(second.TotalNanoseconds);
        second.FaultCount.Should().Be(0);
    }

    [Fact]
    public void Parked_Event_With_No_Handler_Remains_Visible_As_Undelivered()
    {
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.PauseEvents();
        _world.EmitSync(_tick, new EcsEventProbe(1, 0));
        _world.EmitSync(_tick, new EcsEventProbe(2, 0));

        _world.OffAll(in _tick).Should().Be(1);
        _world.ResumeEvents().Should().Be(0);

        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.BufferedCount.Should().Be(2);
        metrics.PendingCount.Should().Be(0);
        metrics.InvocationCount.Should().Be(0);
        metrics.DroppedCount.Should().Be(0);
        metrics.UndeliveredCount.Should().Be(2);
    }

    [Fact]
    public void Parked_Event_For_A_Foreign_Payload_Shape_Is_Counted_Undelivered()
    {
        _world.On<EcsEventWideProbe>(in _tick, static (in EcsEventName _, in EcsEventWideProbe _) => { });
        _world.PauseEvents();
        _world.EmitSync(_tick, default(EcsEventProbe));

        _world.ResumeEvents().Should().Be(0);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.UndeliveredCount.Should().Be(1);
        metrics.InvocationCount.Should().Be(0);
    }

    [Fact]
    public void Parked_Events_Flush_Per_Name_Grouped_By_Slot_Not_By_Global_Park_Order()
    {
        EcsEventName alpha = EcsEventNames.Intern("order.alpha");
        EcsEventName beta = EcsEventNames.Intern("order.beta");
        alpha.Value.Should().BeLessThan(beta.Value);

        List<(int Slot, int Sequence)> delivered = [];
        _world.On<EcsEventProbe>(in alpha, (in EcsEventName name, in EcsEventProbe value) => delivered.Add((name.Value, value.Second)));
        _world.On<EcsEventProbe>(in beta, (in EcsEventName name, in EcsEventProbe value) => delivered.Add((name.Value, value.Second)));

        _world.PauseEvents();
        _world.EmitSync(beta, new EcsEventProbe(0, 1));
        _world.EmitSync(alpha, new EcsEventProbe(0, 2));
        _world.EmitSync(beta, new EcsEventProbe(0, 3));
        _world.EmitSync(alpha, new EcsEventProbe(0, 4));
        _world.PendingEventCount.Should().Be(4);

        _world.ResumeEvents().Should().Be(4);

        // Documented order: ascending interned slot, park order inside each slot — the alpha
        // queue drains completely before beta, even though beta parked first.
        delivered.Should().Equal(
            [(alpha.Value, 2), (alpha.Value, 4), (beta.Value, 1), (beta.Value, 3)]);
    }

    [Fact]
    public async Task Drain_Follows_The_Same_Per_Name_Grouping_As_Resume()
    {
        EcsEventName alpha = EcsEventNames.Intern("drorder.alpha");
        EcsEventName beta = EcsEventNames.Intern("drorder.beta");
        List<(int Slot, int Sequence)> delivered = [];
        _world.On<EcsEventProbe>(in alpha, (in EcsEventName name, in EcsEventProbe value) => delivered.Add((name.Value, value.Second)));
        _world.On<EcsEventProbe>(in beta, (in EcsEventName name, in EcsEventProbe value) => delivered.Add((name.Value, value.Second)));

        _world.PauseEvents();
        _world.EmitSync(beta, new EcsEventProbe(0, 1));
        _world.EmitSync(alpha, new EcsEventProbe(0, 2));

        (await _world.DrainEventsAsync()).Should().Be(2);
        delivered.Should().Equal([(alpha.Value, 2), (beta.Value, 1)]);
        _world.EventsPaused.Should().BeTrue();
    }

    [Fact]
    public async Task Cross_Thread_Emits_Are_Delivered_And_Ordered_Per_Emitting_Thread()
    {
        const int PerThread = 4_000;
        using ManualResetEventSlim gate = new(false);
        ConcurrentQueue<(int Thread, int Sequence)> observed = new();
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) =>
            observed.Enqueue((value.First, value.Second)));

        Task[] emitters =
        [
            Task.Run(() => EmitSequence(_world, _tick, gate, thread: 0, PerThread)),
            Task.Run(() => EmitSequence(_world, _tick, gate, thread: 1, PerThread)),
        ];

        gate.Set();
        await Task.WhenAll(emitters);

        observed.Should().HaveCount(PerThread * 2);
        foreach (int thread in new[] { 0, 1 })
        {
            observed.Where(entry => entry.Thread == thread).Select(entry => entry.Sequence)
                .Should().BeInAscendingOrder("an emitting thread's own events keep call order");
        }

        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.EmitCount.Should().Be(PerThread * 2);
        metrics.InvocationCount.Should().Be(PerThread * 2);

        // The re-entrancy ceiling is scoped to one thread's call stack, so independent
        // concurrent emitters must never be rejected by it.
        metrics.FaultCount.Should().Be(0);
        _world.GetEventFault(in _tick).Should().BeNull();
        _world.HandlerCount(in _tick).Should().Be(1);
    }

    private static void EmitSequence(World world, in EcsEventName name, ManualResetEventSlim gate, int thread, int count)
    {
        gate.Wait();
        for (int sequence = 0; sequence < count; sequence++)
        {
            _ = world.EmitSync(name, new EcsEventProbe(thread, sequence));
        }
    }

    [Fact]
    public void Subscribers_Added_During_Dispatch_Do_Not_Join_That_Dispatch()
    {
        int late = 0;
        bool subscribed = false;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) =>
        {
            if (subscribed)
            {
                return;
            }

            subscribed = true;
            _world.On(in _tick, (in EcsEventName _, in EcsEventProbe _) => late++);
        });

        _world.EmitSync(_tick, default(EcsEventProbe));
        late.Should().Be(0);
        _world.EmitSync(_tick, default(EcsEventProbe));
        late.Should().Be(1);
    }

    [Fact]
    public void Reentrant_Emit_Beyond_The_Depth_Ceiling_Is_A_Typed_Error()
    {
        int depth = 0;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName name, in EcsEventProbe _) =>
        {
            depth++;
            _world.EmitSync(name, default(EcsEventProbe));
        });

        _ = ((Action)(() => _world.EmitSync(_tick, default(EcsEventProbe))))
            .Should().Throw<EcsEventDispatchDepthException>();

        depth.Should().Be(EcsEventRuntime.MaxDispatchDepth);
    }

    [Fact]
    public void Once_For_A_Different_Payload_Shape_Stays_Subscribed()
    {
        int wide = 0;
        _world.Once(in _tick, (in EcsEventName _, in EcsEventProbe _) => { });
        _world.Once(in _tick, (in EcsEventName _, in EcsEventWideProbe _) => wide++);

        _world.EmitSync(_tick, default(EcsEventProbe));
        _world.HandlerCount(in _tick).Should().Be(1);

        _world.EmitSync(_tick, default(EcsEventWideProbe));
        wide.Should().Be(1);
        _world.HandlerCount(in _tick).Should().Be(0);
    }

    [Fact]
    public void Once_Added_During_Dispatch_Survives_That_Dispatch()
    {
        int lateOnce = 0;
        bool armed = false;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) =>
        {
            if (armed)
            {
                return;
            }

            armed = true;
            _world.Once(in _tick, (in EcsEventName _, in EcsEventProbe _) => lateOnce++);
        });

        _world.EmitSync(_tick, default(EcsEventProbe));
        lateOnce.Should().Be(0);
        _world.HandlerCount(in _tick).Should().Be(2);

        _world.EmitSync(_tick, default(EcsEventProbe));
        lateOnce.Should().Be(1);
        _world.HandlerCount(in _tick).Should().Be(1);
    }

    [Fact]
    public void DropNewest_Policy_Loses_The_Incoming_Event_Visibly()
    {
        _world.EventBufferCapacity = 2;
        _world.EventBufferOverflow = EcsEventBufferOverflow.DropNewest;
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.PauseEvents();

        _world.EmitSync(_tick, new EcsEventProbe(1, 0)).Should().BeTrue();
        _world.EmitSync(_tick, new EcsEventProbe(2, 0)).Should().BeTrue();
        _world.EmitSync(_tick, new EcsEventProbe(3, 0)).Should().BeFalse();

        List<int> seen = [];
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) => seen.Add(value.First));
        _world.ResumeEvents();

        seen.Should().Equal(1, 2);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.DroppedCount.Should().Be(1);
        metrics.BufferedCount.Should().Be(2);
    }

    [Fact]
    public void Nested_Resume_From_A_Handler_Delivers_Every_Parked_Event()
    {
        List<int> seen = [];
        bool nested = false;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe value) =>
        {
            seen.Add(value.First);
            if (nested)
            {
                return;
            }

            nested = true;
            _world.ResumeEvents().Should().Be(0);
        });

        _world.PauseEvents();
        _world.EmitSync(_tick, new EcsEventProbe(1, 0));
        _world.EmitSync(_tick, new EcsEventProbe(2, 0));
        _world.EmitSync(_tick, new EcsEventProbe(3, 0));

        _world.ResumeEvents().Should().Be(3);
        seen.Should().Equal(1, 2, 3);
        _world.PendingEventCount.Should().Be(0);
    }

    [Fact]
    public void Dispose_Accounts_For_Parked_Events_It_Discards()
    {
        _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.PauseEvents();
        _world.EmitSync(_tick, default(EcsEventProbe));
        _world.EmitSync(_tick, default(EcsEventProbe));

        _world.Dispose();

        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.DroppedCount.Should().Be(2);
        metrics.InvocationCount.Should().Be(0);
    }

    [Fact]
    public void Unresolved_Symbol_Handles_Print_A_Sentinel_Instead_Of_Throwing()
    {
        EcsEventName.Empty.ToString().Should().Be("<empty>");
        EcsActorTag.Empty.ToString().Should().Be("<empty>");
        EcsActorName.Empty.ToString().Should().Be("<empty>");
        new EcsActorInfo(Entity.Null, EcsActorNames.Intern("sym.print"), EcsActorTag.Empty, 0)
            .ToString().Should().Contain("sym.print");
    }

    [Fact]
    public void Closed_World_Rejects_Subscription_And_Emission_But_Off_Stays_Quiet()
    {
        EcsEventSubscription token = _world.On<EcsEventProbe>(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { });
        _world.Dispose();

        _world.IsClosed.Should().BeTrue();
        _ = ((Action)(() => _world.EmitSync(_tick, default(EcsEventProbe)))).Should().Throw<EcsWorldClosedException>();
        _ = ((Action)(() => _world.On(in _tick, static (in EcsEventName _, in EcsEventProbe _) => { })))
            .Should().Throw<EcsWorldClosedException>();
        _world.Off(token).Should().BeFalse();
        _world.HandlerCount(in _tick).Should().Be(0);
    }

    [Fact]
    public void Dispose_Releases_Registrations_And_Parked_Events()
    {
        _world.PauseEvents();
        _world.EmitSync(_tick, default(EcsEventProbe));
        int live = 0;
        _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => live++);

        _world.Dispose();

        live.Should().Be(0);
        _world.PendingEventCount.Should().Be(0);
        _world.HandlerCount(in _tick).Should().Be(0);
    }

    [Fact]
    public void Unsubscribe_Then_Emit_Delivers_Nothing()
    {
        int calls = 0;
        EcsEventSubscription token = _world.On<EcsEventProbe>(in _tick, (in EcsEventName _, in EcsEventProbe _) => calls++);

        _ = _world.Off(token);

        _world.EmitSync(_tick, default(EcsEventProbe)).Should().BeFalse();
        calls.Should().Be(0);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.EmitCount.Should().Be(1);
    }

    [Fact]
    public void Unresolved_Event_Name_Is_A_Typed_Error()
    {
        EcsEventName empty = default;
        _ = ((Action)(() => _world.EmitSync(empty, default(EcsEventProbe))))
            .Should().Throw<EcsConfigurationException>();
    }

    [Fact]
    public void Payload_Shape_Filtering_Keeps_Foreign_Handlers_Quiet()
    {
        int other = 0;
        _world.On<EcsEventWideProbe>(in _tick, (in EcsEventName _, in EcsEventWideProbe _) => other++);
        _world.EmitSync(_tick, default(EcsEventProbe)).Should().BeFalse();
        other.Should().Be(0);
    }
}
