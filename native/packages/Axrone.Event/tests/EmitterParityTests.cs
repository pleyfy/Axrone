namespace Axrone.Event.Tests;

public sealed class EmitterParityTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    [Fact]
    public void SubscribeOnce_ImmediateDispatch_DeliversExactlyOnce()
    {
        using var router = new EventRouter<int>(64);
        int onceCount = 0;
        int normalCount = 0;

        using var once = router.SubscribeOnce((_, _) => Interlocked.Increment(ref onceCount));
        using var normal = router.Subscribe((_, _) => Interlocked.Increment(ref normalCount));

        router.PublishImmediate(1).Should().Be(2);
        router.PublishImmediate(2).Should().Be(1);

        onceCount.Should().Be(1);
        normalCount.Should().Be(2);
        router.SubscriberCount.Should().Be(1);
    }

    [Fact]
    public void SubscribeOnce_DeferredDispatch_RemovesBeforeLaterEnvelopes()
    {
        using var router = new EventRouter<int>(64);
        int onceCount = 0;
        using var once = router.SubscribeOnce((_, _) => Interlocked.Increment(ref onceCount));

        for (int i = 0; i < 16; i++)
        {
            router.Publish(i);
        }

        SpinWait.SpinUntil(
            () => router.QueuedCount == 0 && Volatile.Read(ref onceCount) == 1,
            Wait).Should().BeTrue();

        Thread.Sleep(50);
        Volatile.Read(ref onceCount).Should().Be(1);
        router.DroppedUnsubscribed.Should().Be(15);
    }

    [Fact]
    public void SubscribeOnceAsync_ImmediateDispatch_DeliversExactlyOnce()
    {
        using var router = new EventRouter<int>(64);
        int count = 0;
        using var once = router.SubscribeOnceAsync((_, _) =>
        {
            Interlocked.Increment(ref count);
            return ValueTask.CompletedTask;
        });

        router.PublishImmediate(1).Should().Be(1);
        router.PublishImmediate(2).Should().Be(0);
        count.Should().Be(1);
    }

    [Fact]
    public void Once_PreservesPriorityOrdering()
    {
        using var router = new EventRouter<int>(64);
        var order = new List<string>();

        using var low = router.SubscribeOnce((_, _) => order.Add("low"), EventPriority.Low);
        using var high = router.SubscribeOnce((_, _) => order.Add("high"), EventPriority.High);
        using var normal = router.SubscribeOnce((_, _) => order.Add("normal"), EventPriority.Normal);

        router.PublishImmediate(1).Should().Be(3);
        order.Should().Equal("high", "normal", "low");
    }

    [Fact]
    public void Unsubscribe_ReleasesActiveSubscriptionAndReportsMisses()
    {
        using var router = new EventRouter<int>(64);
        var subscription = router.Subscribe((_, _) => { });

        router.HasSubscription(subscription.SubscriptionId).Should().BeTrue();
        router.Unsubscribe(subscription.SubscriptionId).Should().BeTrue();
        router.Unsubscribe(subscription.SubscriptionId).Should().BeFalse();
        router.Unsubscribe(Guid.NewGuid()).Should().BeFalse();
        subscription.IsActive.Should().BeFalse();
        router.HasSubscription(subscription.SubscriptionId).Should().BeFalse();
    }

    [Fact]
    public void Pipe_ForwardsDeliveredPayloadsToTargetRouter()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<string>(64);
        using var pipe = source.Pipe(target, static value => value.ToString());
        var gate = new object();
        string? received = null;
        using var subscription = target.Subscribe((envelope, _) =>
        {
            lock (gate)
            {
                received = envelope.Payload;
            }
        });

        source.PublishImmediate(42).Should().Be(1);
        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received is not null;
                }
            },
            Wait).Should().BeTrue();

        lock (gate)
        {
            received.Should().Be("42");
        }

        pipe.ForwardedCount.Should().Be(1);
        pipe.LoopDropCount.Should().Be(0);
    }

    [Fact]
    public void Pause_BuffersPublishesAndFlushRepublishesInFifoOrder()
    {
        using var router = CreateRouter(pausedBufferCapacity: 8);
        var order = new List<int>();
        var gate = new object();
        using var subscription = router.Subscribe((envelope, _) =>
        {
            lock (gate)
            {
                order.Add(envelope.Payload);
            }
        });

        router.Pause();
        router.IsPaused.Should().BeTrue();
        router.Publish(1);
        router.Publish(2);
        router.Publish(3);

        router.BufferedCount.Should().Be(3);
        router.QueuedCount.Should().Be(0);

        router.Flush().Should().Be(3);
        router.IsPaused.Should().BeTrue();
        router.BufferedCount.Should().Be(0);

        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return order.Count == 3;
                }
            },
            Wait).Should().BeTrue();

        lock (gate)
        {
            order.Should().Equal(1, 2, 3);
        }
    }

    [Fact]
    public void Pause_BufferedEnvelopesKeepTheirOriginalStamps()
    {
        using var router = CreateRouter(pausedBufferCapacity: 8);
        var sequences = new List<long>();
        var gate = new object();
        using var subscription = router.Subscribe((envelope, _) =>
        {
            lock (gate)
            {
                sequences.Add(envelope.Metadata.Sequence);
            }
        });

        router.Pause();
        router.Publish(10);
        router.Publish(11);
        router.Resume();

        router.IsPaused.Should().BeFalse();
        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return sequences.Count == 2;
                }
            },
            Wait).Should().BeTrue();

        lock (gate)
        {
            sequences.Should().Equal(1L, 2L);
        }

        router.BufferedCount.Should().Be(0);
    }

    [Fact]
    public void Flush_StopsAtTransportBackpressureAndKeepsRemainderBuffered()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with
        {
            Capacity = 2,
            DispatchBatchSize = 1,
            DeadLetterCapacity = 8,
            MeterName = "Axrone.Event.Parity",
            PausedBufferCapacity = 8,
        });
        using var release = new ManualResetEventSlim(false);
        var received = new List<int>();
        var gate = new object();
        using var subscription = router.Subscribe((envelope, token) =>
        {
            lock (gate)
            {
                received.Add(envelope.Payload);
            }

            if (envelope.Payload == 0)
            {
                release.Wait(Wait, token);
            }
        });

        router.Publish(0);
        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received.Count == 1;
                }
            },
            Wait).Should().BeTrue();

        router.Publish(1);
        router.Publish(2);

        router.Pause();
        router.Publish(3);
        router.Publish(4);

        try
        {
            router.Flush().Should().Be(0);
            router.BufferedCount.Should().Be(2);
        }
        finally
        {
            release.Set();
        }

        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received.Count == 3;
                }
            },
            Wait).Should().BeTrue();

        router.Flush().Should().Be(2);
        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received.Count == 5;
                }
            },
            Wait).Should().BeTrue();

        lock (gate)
        {
            received.Should().Equal(0, 1, 2, 3, 4);
        }
    }

    [Fact]
    public void PausedBufferOverflow_BlockingPublishThrowsTypedFailure()
    {
        using var router = CreateRouter(pausedBufferCapacity: 2);
        router.Pause();

        router.Publish(1);
        router.Publish(2);
        router.TryPublish(3).Should().BeFalse();

        var act = () => router.Publish(3);
        act.Should().Throw<EventBufferFullException>()
            .Which.Capacity.Should().Be(2);

        router.BufferedCount.Should().Be(2);
        router.ClearBuffer().Should().Be(2);
        router.BufferedCount.Should().Be(0);
    }

    [Fact]
    public void CopyBufferedEnvelopes_ReturnsSnapshotWithoutDraining()
    {
        using var router = CreateRouter(pausedBufferCapacity: 8);
        router.Pause();
        router.Publish(7);
        router.Publish(8);

        Span<EventEnvelope<int>> view = stackalloc EventEnvelope<int>[4];
        int copied = router.CopyBufferedEnvelopes(view);

        copied.Should().Be(2);
        view[0].Payload.Should().Be(7);
        view[1].Payload.Should().Be(8);
        router.BufferedCount.Should().Be(2);

        Span<EventEnvelope<int>> small = stackalloc EventEnvelope<int>[1];
        router.CopyBufferedEnvelopes(small).Should().Be(1);
        small[0].Payload.Should().Be(7);
        router.BufferedCount.Should().Be(2);

        router.Flush().Should().Be(2);
        router.Flush().Should().Be(0);
        router.ClearBuffer().Should().Be(0);
    }

    [Fact]
    public void PublishBatch_WhilePaused_AcceptsUpToCapacity()
    {
        using var router = CreateRouter(pausedBufferCapacity: 3);
        router.Pause();

        router.TryPublishBatch([1, 2]).Should().Be(2);
        router.TryPublishBatch([3, 4]).Should().Be(1);
        router.BufferedCount.Should().Be(3);

        var act = () => router.PublishBatch([5]);
        act.Should().Throw<EventBufferFullException>();
    }

    [Fact]
    public void MaxListeners_WarnRetainsSubscriptionAndRaisesTypedWarning()
    {
        RouterOptions options = RouterOptions.Default with
        {
            Capacity = 64,
            MaxListeners = 2,
            MaxListenersPolicy = MaxListenersPolicy.Warn,
        };
        using var router = new EventRouter<int>(options);
        MaxListenersExceededEventArgs? captured = null;
        var raised = 0;
        router.MaxListenersExceeded += (_, args) =>
        {
            captured = args;
            raised++;
        };

        using var first = router.Subscribe((_, _) => { });
        using var second = router.Subscribe((_, _) => { });
        using var third = router.Subscribe((_, _) => { });

        router.SubscriberCount.Should().Be(3);
        router.MaxListenersExceededCount.Should().Be(1);
        raised.Should().Be(1);
        captured.Should().NotBeNull();
        captured!.EventType.Should().Be<int>();
        captured.SubscriptionCount.Should().Be(3);
        captured.MaxListeners.Should().Be(2);
    }

    [Fact]
    public void MaxListeners_ThrowRejectsSubscriptionWithTypedFailure()
    {
        RouterOptions options = RouterOptions.Default with
        {
            Capacity = 64,
            MaxListeners = 1,
            MaxListenersPolicy = MaxListenersPolicy.Throw,
        };
        using var router = new EventRouter<int>(options);
        using var first = router.Subscribe((_, _) => { });

        var act = () => router.Subscribe((_, _) => { });

        MaxListenersExceededException failure = act.Should()
            .Throw<MaxListenersExceededException>()
            .Which;
        failure.MaxListeners.Should().Be(1);
        failure.SubscriptionCount.Should().Be(2);
        failure.EventType.Should().Be<int>();
        router.SubscriberCount.Should().Be(1);
        router.MaxListenersExceededCount.Should().Be(0);
    }

    [Fact]
    public void MaxListeners_SetAndReset_UpdateTheBound()
    {
        RouterOptions options = RouterOptions.Default with { Capacity = 64, MaxListeners = 5 };
        using var router = new EventRouter<int>(options);

        router.MaxListeners.Should().Be(5);
        router.SetMaxListeners(1);
        router.MaxListeners.Should().Be(1);
        router.ResetMaxListeners();
        router.MaxListeners.Should().Be(5);

        var act = () => router.SetMaxListeners(-1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void CaptureSubscriptions_ReturnsOrderedImmutableSnapshot()
    {
        using var router = new EventRouter<int>(64);
        using var low = router.Subscribe((_, _) => { }, EventPriority.Low);
        using var highFirst = router.SubscribeOnce((_, _) => { }, EventPriority.High);
        using var normal = router.Subscribe((_, _) => { });

        SubscriptionSnapshot snapshot = router.CaptureSubscriptions();

        snapshot.Count.Should().Be(3);
        var infos = new List<EventSubscriptionInfo>();
        foreach (EventSubscriptionInfo info in snapshot)
        {
            infos.Add(info);
        }

        infos[0].SubscriptionId.Should().Be(highFirst.SubscriptionId);
        infos[0].Priority.Should().Be(EventPriority.High);
        infos[0].IsOnce.Should().BeTrue();
        infos[1].SubscriptionId.Should().Be(normal.SubscriptionId);
        infos[2].SubscriptionId.Should().Be(low.SubscriptionId);
        infos[2].RegistrationSequence.Should().Be(1);
        infos[0].RegistrationSequence.Should().Be(2);
        infos[1].RegistrationSequence.Should().Be(3);

        using var extra = router.Subscribe((_, _) => { });
        snapshot.Count.Should().Be(3);
        router.CaptureSubscriptions().Count.Should().Be(4);
    }

    [Fact]
    public void EmitterSurface_ExposesTypeAndEmitterProbe()
    {
        using var router = new EventRouter<int>(64);

        router.EventType.Should().Be<int>();
        EventEmitters.IsEmitter(router).Should().BeTrue();
        EventEmitters.IsEmitter(new object()).Should().BeFalse();
        EventEmitters.IsEmitter(null).Should().BeFalse();
    }

    [Fact]
    public void Bus_EventTypes_ReportsConfiguredRouters()
    {
        using var bus = new EventBus(64);
        using var intSub = bus.Subscribe<int>((_, _) => { });
        using var stringSub = bus.Subscribe<string>((_, _) => { });

        Type[] types = bus.EventTypes();

        types.Should().Contain(typeof(int)).And.Contain(typeof(string));
    }

    [Fact]
    public void Metrics_CountEmitCallsAndHandlerInvocations()
    {
        using var router = new EventRouter<int>(64);

        router.PublishImmediate(1).Should().Be(0);
        using var subscription = router.Subscribe((_, _) => { });
        router.PublishImmediate(2).Should().Be(1);

        EventMetricsSnapshot metrics = router.Metrics;
        metrics.Emit.Count.Should().Be(2);
        metrics.Execution.Count.Should().Be(1);
        metrics.ExecutionErrors.Should().Be(0);

        router.ResetMetrics();
        router.Metrics.Emit.Count.Should().Be(0);
        router.Metrics.Execution.Count.Should().Be(0);
        router.Metrics.ExecutionErrors.Should().Be(0);
    }

    [Fact]
    public void Metrics_RecordHandlerFailuresAndTimingBounds()
    {
        using var router = new EventRouter<int>(64);
        using var subscription = router.Subscribe(static (_, _) => throw new InvalidOperationException("boom"));

        router.PublishImmediate(1).Should().Be(1);

        EventMetricsSnapshot metrics = router.Metrics;
        metrics.Execution.Count.Should().Be(1);
        metrics.ExecutionErrors.Should().Be(1);
        metrics.Execution.MinMilliseconds.Should().BeGreaterThanOrEqualTo(0d);
        metrics.Execution.MaxMilliseconds.Should().BeGreaterThanOrEqualTo(metrics.Execution.MinMilliseconds);
        metrics.Execution.AverageMilliseconds.Should().BeInRange(
            metrics.Execution.MinMilliseconds,
            metrics.Execution.MaxMilliseconds);
        metrics.Emit.Count.Should().Be(1);
        router.DeadLetterCount.Should().Be(1);
    }

    [Fact]
    public void Metrics_CountBatchPublishOncePerCall()
    {
        using var router = new EventRouter<int>(64);

        router.PublishBatch([1, 2, 3]).Should().Be(3);

        router.Metrics.Emit.Count.Should().Be(1);
    }

    [Fact]
    public void PausedBuffer_UsesPinnedHeapOnlyForShapesWithoutReferences()
    {
        using var valueRouter = CreateRouter(pausedBufferCapacity: 4);
        valueRouter.Pause();
        valueRouter.IsPausedBufferPinned.Should().BeTrue();

        using var referenceRouter = new EventRouter<string>(RouterOptions.Default with
        {
            Capacity = 64,
            PausedBufferCapacity = 4,
        });
        referenceRouter.Pause();
        referenceRouter.IsPausedBufferPinned.Should().BeFalse();
    }

    private static EventRouter<int> CreateRouter(int pausedBufferCapacity) =>
        new(RouterOptions.Default with
        {
            Capacity = 64,
            DispatchBatchSize = 4,
            DeadLetterCapacity = 16,
            MeterName = "Axrone.Event.Parity",
            PausedBufferCapacity = pausedBufferCapacity,
        });
}
