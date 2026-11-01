namespace Axrone.Event.Tests;

public sealed class PriorityDispatchTests
{
    [Fact]
    public void ImmediateDispatch_OrdersHighNormalLowThenRegistration()
    {
        using var router = new EventRouter<int>(64);
        var order = new List<string>();

        using var low = router.Subscribe(Record(order, "low"), EventPriority.Low);
        using var high1 = router.Subscribe(Record(order, "high1"), EventPriority.High);
        using var normal = router.Subscribe(Record(order, "normal"), EventPriority.Normal);
        using var high2 = router.Subscribe(Record(order, "high2"), EventPriority.High);

        int delivered = router.PublishImmediate(1);

        delivered.Should().Be(4);
        order.Should().Equal("high1", "high2", "normal", "low");
        router.IncompleteImmediateDispatches.Should().Be(0);
    }

    [Fact]
    public void DeferredDispatch_UsesTheSamePriorityOrder()
    {
        using var router = new EventRouter<int>(64);
        var order = new List<string>();
        var gate = new object();

        using var low = router.Subscribe(RecordLocked(order, gate, "low"), EventPriority.Low);
        using var high = router.Subscribe(RecordLocked(order, gate, "high"), EventPriority.High);
        using var normal = router.Subscribe(RecordLocked(order, gate, "normal"), EventPriority.Normal);

        router.Publish(1);

        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return order.Count == 3;
                }
            },
            TimeSpan.FromSeconds(5)).Should().BeTrue();

        lock (gate)
        {
            order.Should().Equal("high", "normal", "low");
        }
    }

    [Fact]
    public void SamePriority_KeepsRegistrationOrderAcrossRuns()
    {
        List<string> first = RunRegistrationOrder();
        List<string> second = RunRegistrationOrder();
        List<string> third = RunRegistrationOrder();

        first.Should().Equal("a", "b", "c");
        first.Should().Equal(second);
        second.Should().Equal(third);
    }

    [Fact]
    public void PausedHighPrioritySubscription_IsSkipped()
    {
        using var router = new EventRouter<int>(64);
        var order = new List<string>();

        using var high = router.Subscribe(Record(order, "high"), EventPriority.High);
        using var normal = router.Subscribe(Record(order, "normal"), EventPriority.Normal);
        high.Pause();

        router.PublishImmediate(1).Should().Be(1);
        order.Should().Equal("normal");
    }

    [Fact]
    public void ImmediateDispatch_AppliesPublishFilters()
    {
        using var router = new EventRouter<int>(64);
        var count = 0;
        router.AddFilter(new DelegateFilter<int>(envelope => envelope.Payload > 0));
        using var subscription = router.Subscribe((_, _) => count++);

        router.PublishImmediate(-1).Should().Be(0);
        router.PublishImmediate(1).Should().Be(1);
        count.Should().Be(1);
        router.QueuedCount.Should().Be(0);
    }

    [Fact]
    public void ReentrantImmediatePublish_DefersInsteadOfRecursing()
    {
        using var router = new EventRouter<int>(64);
        var received = new List<int>();
        var gate = new object();
        int nestedResult = -1;

        using var subscription = router.Subscribe(
            (envelope, _) =>
            {
                lock (gate)
                {
                    received.Add(envelope.Payload);
                }

                if (envelope.Payload == 1)
                {
                    nestedResult = router.PublishImmediate(2);
                }
            });

        router.PublishImmediate(1).Should().Be(1);
        nestedResult.Should().Be(0);
        router.ReentrantDeferredPublishes.Should().Be(1);
        router.ReentrantDroppedPublishes.Should().Be(0);

        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received.Count == 2;
                }
            },
            TimeSpan.FromSeconds(5)).Should().BeTrue();

        lock (gate)
        {
            received.Should().Equal(1, 2);
        }
    }

    [Fact]
    public void CrossRouterImmediatePublish_IsDeferredWhileDispatching()
    {
        using var routerA = new EventRouter<int>(64);
        using var routerB = new EventRouter<int>(64);
        int nestedResult = -1;
        int receivedB = 0;

        using var subscriptionA = routerA.Subscribe((envelope, _) =>
        {
            if (envelope.Payload == 1)
            {
                nestedResult = routerB.PublishImmediate(2);
            }
        });
        using var subscriptionB = routerB.Subscribe((_, _) => Interlocked.Increment(ref receivedB));

        routerA.PublishImmediate(1).Should().Be(1);
        nestedResult.Should().Be(0);
        routerB.ReentrantDeferredPublishes.Should().Be(1);

        SpinWait.SpinUntil(() => Volatile.Read(ref receivedB) == 1, TimeSpan.FromSeconds(5))
            .Should().BeTrue();
    }

    [Fact]
    public void AsyncImmediateHandlerFault_DeadLettersAfterCompletion()
    {
        using var router = new EventRouter<int>(64);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var subscription = router.SubscribeAsync(
            async (_, _) =>
            {
                await gate.Task.ConfigureAwait(false);
                throw new InvalidOperationException("async boom");
            });

        router.PublishImmediate(5).Should().Be(1);
        router.IncompleteImmediateDispatches.Should().Be(1);
        router.DeadLetterCount.Should().Be(0);

        gate.SetResult();

        SpinWait.SpinUntil(() => router.DeadLetterCount == 1, TimeSpan.FromSeconds(5)).Should().BeTrue();

        List<DeadLetterEntry<int>> dead = router.DrainDeadLetters();
        dead.Should().ContainSingle();
        dead[0].Reason.Should().Be(DeadLetterReason.HandlerException);
        dead[0].Error.Should().Contain("async boom");
    }

    [Fact]
    public void ImmediateDispatch_ThrowsAfterCompleteButTryVariantReturnsZero()
    {
        using var router = new EventRouter<int>(64);
        router.Complete();

        var immediate = () => router.PublishImmediate(1);
        immediate.Should().Throw<InvalidOperationException>();
        router.TryPublishImmediate(1).Should().Be(0);
    }

    [Fact]
    public void BusPriorityOverloads_ApplyToTheEventTypeRouter()
    {
        using var bus = new EventBus(64);
        var order = new List<string>();

        using var low = bus.Subscribe<int>(Record(order, "low"), EventPriority.Low);
        using var high = bus.Subscribe<int>(Record(order, "high"), EventPriority.High);

        bus.PublishImmediate(1).Should().Be(2);
        order.Should().Equal("high", "low");
    }

    [Fact]
    public void InvalidPriority_IsRejectedBySubscription()
    {
        using var router = new EventRouter<int>(64);

        var subscribe = () => router.Subscribe((_, _) => { }, (EventPriority)7);

        subscribe.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void PrioritySubscriptionCountTracksTheOrderedTable()
    {
        using var router = new EventRouter<int>(64);
        using var high = router.Subscribe((_, _) => { }, EventPriority.High);
        using var low = router.Subscribe((_, _) => { }, EventPriority.Low);

        router.SubscriberCount.Should().Be(2);
        low.Dispose();
        router.SubscriberCount.Should().Be(1);
        high.Dispose();
        router.SubscriberCount.Should().Be(0);
    }

    private static List<string> RunRegistrationOrder()
    {
        using var router = new EventRouter<int>(64);
        var order = new List<string>();
        using var a = router.Subscribe(Record(order, "a"), EventPriority.High);
        using var b = router.Subscribe(Record(order, "b"), EventPriority.High);
        using var c = router.Subscribe(Record(order, "c"), EventPriority.High);
        router.PublishImmediate(1);
        return order;
    }

    private static Action<EventEnvelope<int>, CancellationToken> Record(
        List<string> order,
        string label) =>
        (_, _) => order.Add(label);

    private static Action<EventEnvelope<int>, CancellationToken> RecordLocked(
        List<string> order,
        object gate,
        string label) =>
        (_, _) =>
        {
            lock (gate)
            {
                order.Add(label);
            }
        };

    private sealed class DelegateFilter<TEvent>(Func<EventEnvelope<TEvent>, bool> predicate)
        : IEventFilter<TEvent>
    {
        public bool ShouldProcess(in EventEnvelope<TEvent> envelope) => predicate(envelope);
    }
}
