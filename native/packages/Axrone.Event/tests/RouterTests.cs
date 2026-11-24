namespace Axrone.Event.Tests;

public class RouterTests
{
    private sealed class FuncFilter<TEvent>(Func<EventEnvelope<TEvent>, bool> predicate) : IEventFilter<TEvent>
    {
        public bool ShouldProcess(in EventEnvelope<TEvent> envelope) => predicate(envelope);
    }

    private sealed class CountingInterceptor : IEventInterceptor<int>
    {
        public int Publishing;
        public int Published;
        public int Errors;

        public void OnPublishing(in EventEnvelope<int> envelope) => Interlocked.Increment(ref Publishing);
        public void OnPublished(in EventEnvelope<int> envelope) => Interlocked.Increment(ref Published);
        public void OnConsumptionError(in EventEnvelope<int> envelope, Exception exception) => Interlocked.Increment(ref Errors);
    }

    [Fact]
    public void Publish_DeliversStampedInOrder()
    {
        using var router = new EventRouter<int>(64);
        var received = new List<EventEnvelope<int>>();
        using var sub = router.Subscribe((envelope, _) =>
        {
            lock (received)
            {
                received.Add(envelope);
            }
        });

        router.Publish(1);
        router.Publish(2);
        router.Publish(3);

        SpinWait.SpinUntil(() =>
        {
            lock (received)
            {
                return received.Count == 3;
            }
        }, TimeSpan.FromSeconds(5)).Should().BeTrue();

        lock (received)
        {
            received.Select(e => e.Payload).Should().Equal(1, 2, 3);
            received.Select(e => e.Metadata.Sequence).Should().Equal(1L, 2L, 3L);
            received.Should().OnlyContain(e => e.IsStamped);
        }
    }

    [Fact]
    public void TryPublish_NotRunning_ReturnsFalse()
    {
        using var router = new EventRouter<int>(8);
        router.Complete();

        router.TryPublish(1).Should().BeFalse();
    }

    [Fact]
    public void Publish_AfterComplete_Throws()
    {
        using var router = new EventRouter<int>(8);
        router.Complete();

        var act = () => router.Publish(1);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void Complete_WithFault_RethrowsOriginal()
    {
        using var router = new EventRouter<int>(8);
        router.Complete(new InvalidOperationException("terminal"));

        var act = () => router.Publish(1);
        act.Should().Throw<InvalidOperationException>().WithMessage("terminal");
    }

    [Fact]
    public void Dispose_UnsubscribesDelivery()
    {
        var router = new EventRouter<int>(64);
        var count = 0;
        var sub = router.Subscribe((_, _) => Interlocked.Increment(ref count));
        router.Publish(1);
        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        sub.Dispose();
        router.Publish(2);
        Thread.Sleep(100);
        Volatile.Read(ref count).Should().Be(1);
        router.Dispose();
    }

    [Fact]
    public void Pause_GatesDelivery()
    {
        using var router = new EventRouter<int>(64);
        var count = 0;
        using var sub = router.Subscribe((_, _) => Interlocked.Increment(ref count));

        sub.Pause();
        router.Publish(1);
        SpinWait.SpinUntil(() => router.DroppedPaused == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        sub.Resume();
        router.Publish(2);

        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        Volatile.Read(ref count).Should().Be(1);
    }

    [Fact]
    public void ThrowingHandler_DeadLettersAndIsolates()
    {
        using var router = new EventRouter<int>(64);
        var interceptor = new CountingInterceptor();
        router.AddInterceptor(interceptor);

        var good = 0;
        using var bad = router.Subscribe((_, _) => throw new InvalidOperationException("handler boom"));
        using var ok = router.Subscribe((_, _) => Interlocked.Increment(ref good));

        router.Publish(5);

        SpinWait.SpinUntil(() => router.DeadLetterCount == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        SpinWait.SpinUntil(() => Volatile.Read(ref good) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();

        var dead = router.DrainDeadLetters();
        dead.Should().ContainSingle();
        dead[0].Reason.Should().Be(DeadLetterReason.HandlerException);
        dead[0].Error.Should().Contain("handler boom");
        dead[0].Envelope.Payload.Should().Be(5);
        Volatile.Read(ref interceptor.Errors).Should().Be(1);
        router.DrainDeadLetters().Should().BeEmpty();
    }

    [Fact]
    public void Filter_DropsBeforeTransport()
    {
        using var router = new EventRouter<int>(64);
        var interceptor = new CountingInterceptor();
        router.AddInterceptor(interceptor);
        router.AddFilter(new FuncFilter<int>(envelope => envelope.Payload > 10));

        var count = 0;
        using var sub = router.Subscribe((_, _) => Interlocked.Increment(ref count));
        router.Publish(5);
        router.Publish(50);

        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        Volatile.Read(ref interceptor.Publishing).Should().Be(1);
        Volatile.Read(ref interceptor.Published).Should().Be(1);
    }

    [Fact]
    public void PublishEnvelope_PreservesExistingStamp()
    {
        using var router = new EventRouter<int>(64);
        var box = new StrongBox<EventEnvelope<int>?>(null);
        using var sub = router.Subscribe((envelope, _) =>
        {
            lock (box)
            {
                box.Value = envelope;
            }
        });

        var id = Guid.NewGuid();
        var replay = new EventEnvelope<int>(
            new EventMetadata(id, id, Guid.Empty, 99L, 1, 0, 123L), 7);
        router.PublishEnvelope(in replay);

        SpinWait.SpinUntil(() =>
        {
            lock (box)
            {
                return box.Value.HasValue;
            }
        }, TimeSpan.FromSeconds(5)).Should().BeTrue();

        lock (box)
        {
            box.Value!.Value.Metadata.Sequence.Should().Be(99L);
            box.Value!.Value.Metadata.EventId.Should().Be(id);
            box.Value!.Value.Payload.Should().Be(7);
        }
    }

    [Fact]
    public void NoSubscriber_CountsDropped()
    {
        using var router = new EventRouter<int>(64);
        router.Publish(1);
        router.Publish(2);

        SpinWait.SpinUntil(() => router.DroppedItems == 2, TimeSpan.FromSeconds(5)).Should().BeTrue();
        router.DeadLetterCount.Should().Be(0);
        router.DroppedUnsubscribed.Should().Be(2);
        router.DroppedPaused.Should().Be(0);
    }

    [Fact]
    public void PausedSubscriber_CountsPausedDrops()
    {
        using var router = new EventRouter<int>(64);
        var count = 0;
        using var sub = router.Subscribe((_, _) => Interlocked.Increment(ref count));
        sub.Pause();

        router.Publish(1);
        router.Publish(2);

        SpinWait.SpinUntil(() => router.DroppedPaused == 2, TimeSpan.FromSeconds(5)).Should().BeTrue();
        router.DroppedUnsubscribed.Should().Be(0);
        router.DroppedItems.Should().Be(2);
        Volatile.Read(ref count).Should().Be(0);
    }

    [Fact]
    public void SubscribeAsync_Delivers()
    {
        using var router = new EventRouter<int>(64);
        var count = 0;
        using var sub = router.SubscribeAsync((_, _) =>
        {
            Interlocked.Increment(ref count);
            return ValueTask.CompletedTask;
        });

        router.Publish(1);

        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
    }

    [Fact]
    public void PublishBatch_DeliversOrderedWithDenseSequences()
    {
        using var router = new EventRouter<int>(256);
        var received = new List<EventEnvelope<int>>();
        using var sub = router.Subscribe((envelope, _) =>
        {
            lock (received)
            {
                received.Add(envelope);
            }
        });

        var batch = new int[100];
        for (int i = 0; i < batch.Length; i++)
        {
            batch[i] = i;
        }

        router.PublishBatch(batch).Should().Be(100);

        SpinWait.SpinUntil(() =>
        {
            lock (received)
            {
                return received.Count == 100;
            }
        }, TimeSpan.FromSeconds(15)).Should().BeTrue();

        lock (received)
        {
            received.Select(e => e.Payload).Should().Equal(batch);
            received.Select(e => e.Metadata.Sequence).Should().Equal(Enumerable.Range(1, 100).Select(i => (long)i));
        }
    }

    [Fact]
    public void TryPublishBatch_FiltersWithoutConsumingSlots()
    {
        using var router = new EventRouter<int>(256);
        router.AddFilter(new FuncFilter<int>(envelope => envelope.Payload % 2 == 0));

        var count = 0;
        using var sub = router.Subscribe((_, _) => Interlocked.Increment(ref count));

        var batch = new int[10];
        for (int i = 0; i < batch.Length; i++)
        {
            batch[i] = i;
        }

        router.TryPublishBatch(batch).Should().Be(5);
        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 5, TimeSpan.FromSeconds(15)).Should().BeTrue();
    }

    [Fact]
    public void PublishBatch_RespectsMaxQueueWait()
    {
        using var entered = new ManualResetEventSlim(false);
        using var release = new ManualResetEventSlim(false);
        var options = new RouterOptions(4, 1, 8, "Axrone.Event.BatchTest") { MaxQueueWaitMs = 150 };
        using var router = new EventRouter<int>(options);
        using var subscription = router.Subscribe((_, _) =>
        {
            entered.Set();
            release.Wait(TimeSpan.FromSeconds(10), CancellationToken.None);
        });

        router.Publish(1);
        entered.Wait(TimeSpan.FromSeconds(5)).Should().BeTrue();

        var items = new int[64];
        var watch = Stopwatch.StartNew();
        Action publish = () => router.PublishBatch(items);

        publish.Should().Throw<EventQueueFullException>();
        watch.ElapsedMilliseconds.Should().BeLessThan(2000);
        release.Set();
    }

    [Fact]
    public void FilteredPublish_IsCountedWithoutReachingTransport()
    {
        using var router = new EventRouter<int>(64);
        router.AddFilter(new FuncFilter<int>(envelope => envelope.Payload > 0));

        var count = 0;
        using var subscription = router.Subscribe((_, _) => Interlocked.Increment(ref count));

        router.TryPublish(-1).Should().BeTrue();
        router.FilteredPublishes.Should().Be(1);

        router.Publish(1);
        SpinWait.SpinUntil(() => Volatile.Read(ref count) == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();
        router.FilteredPublishes.Should().Be(1);
    }

    [Fact]
    public void PublishFromAnotherRouterHandler_WaitsOnItsOwnTransport()
    {
        using var entered = new ManualResetEventSlim(false);
        using var release = new ManualResetEventSlim(false);
        var optionsB = new RouterOptions(2, 1, 8, "Axrone.Event.RouterB") { MaxQueueWaitMs = 300 };
        using var routerB = new EventRouter<int>(optionsB);
        using var subscriptionB = routerB.Subscribe((_, _) =>
        {
            entered.Set();
            release.Wait(TimeSpan.FromSeconds(10), CancellationToken.None);
        });

        routerB.Publish(1);
        entered.Wait(TimeSpan.FromSeconds(5), CancellationToken.None).Should().BeTrue();
        routerB.Publish(2);
        routerB.Publish(3);

        using var routerA = new EventRouter<int>(64);
        long elapsed = -1;
        using var subscriptionA = routerA.Subscribe((_, _) =>
        {
            var watch = Stopwatch.StartNew();
            try
            {
                routerB.Publish(4);
            }
            catch (EventQueueFullException)
            {
                Interlocked.Exchange(ref elapsed, watch.ElapsedMilliseconds);
            }
        });

        routerA.PublishImmediate(1);
        release.Set();

        Volatile.Read(ref elapsed).Should().BeGreaterThan(50);
    }

    [Fact]
    public void ReentrantSelfPublish_StopsAtDepthLimit()
    {
        var options = new RouterOptions(64, 1, 1024, "Axrone.Event.ReentrantTest")
        {
            MaxReentrantDepth = 8,
            MaxQueueWaitMs = 1000,
        };
        using var router = new EventRouter<int>(options);
        int calls = 0;
        using var subscription = router.Subscribe((envelope, _) =>
        {
            Interlocked.Increment(ref calls);
            router.TryPublish(envelope.Payload + 1);
        });

        router.PublishImmediate(0);

        SpinWait.SpinUntil(
            () => router.ReentrantDroppedPublishes > 0,
            TimeSpan.FromSeconds(5)).Should().BeTrue();
        calls.Should().BeLessThanOrEqualTo(10);
    }

    [Fact]
    public void PublishBatch_Empty_ReturnsZero()
    {
        using var router = new EventRouter<int>(16);

        router.PublishBatch(ReadOnlySpan<int>.Empty).Should().Be(0);
        router.TryPublishBatch(ReadOnlySpan<int>.Empty).Should().Be(0);
    }
}
