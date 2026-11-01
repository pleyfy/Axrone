namespace Axrone.Event.Tests;

public sealed class ForwardingTests
{
    [Fact]
    public void RouterToRouter_ForwardsStampedEnvelopeAndHopCount()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        var received = new List<EventEnvelope<int>>();
        using var subscription = target.Subscribe((envelope, _) =>
        {
            lock (received)
            {
                received.Add(envelope);
            }
        });
        using var forwarder = new EventForwarder<int>(source, target);

        source.Publish(42);

        WaitFor(() =>
        {
            lock (received)
            {
                return received.Count == 1;
            }
        }).Should().BeTrue();

        lock (received)
        {
            received[0].Payload.Should().Be(42);
            received[0].IsStamped.Should().BeTrue();
            received[0].Metadata.ForwardCount.Should().Be(1);
        }

        forwarder.ForwardedCount.Should().Be(1);
        forwarder.FilteredCount.Should().Be(0);
        forwarder.LoopDropCount.Should().Be(0);
        forwarder.BackpressureDropCount.Should().Be(0);
        forwarder.FailureCount.Should().Be(0);
    }

    [Fact]
    public void Dispose_StopsForwarding()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        var count = 0;
        using var subscription = target.Subscribe((_, _) => Interlocked.Increment(ref count));
        var forwarder = new EventForwarder<int>(source, target);

        source.Publish(1);
        WaitFor(() => Volatile.Read(ref count) == 1).Should().BeTrue();

        forwarder.Dispose();

        source.Publish(2);
        Thread.Sleep(100);
        Volatile.Read(ref count).Should().Be(1);
    }

    [Fact]
    public void Filter_DropsBeforeForwarding()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        var received = new List<int>();
        using var subscription = target.Subscribe((envelope, _) =>
        {
            lock (received)
            {
                received.Add(envelope.Payload);
            }
        });
        using var forwarder = new EventForwarder<int>(
            source,
            target,
            new DelegateFilter<int>(envelope => envelope.Payload >= 10));

        source.Publish(5);
        source.Publish(50);

        WaitFor(() =>
        {
            lock (received)
            {
                return received.Count == 1;
            }
        }).Should().BeTrue();

        lock (received)
        {
            received.Should().Equal(50);
        }

        forwarder.FilteredCount.Should().Be(1);
        forwarder.ForwardedCount.Should().Be(1);
    }

    [Fact]
    public void Transform_MapsPayloadType()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<string>(64);
        var received = new List<string>();
        using var subscription = target.Subscribe((envelope, _) =>
        {
            lock (received)
            {
                received.Add(envelope.Payload);
            }
        });
        using var forwarder = new EventForwarder<int, string>(
            source,
            target,
            value => $"v{value}");

        source.Publish(7);

        WaitFor(() =>
        {
            lock (received)
            {
                return received.Count == 1;
            }
        }).Should().BeTrue();

        lock (received)
        {
            received.Should().Equal("v7");
        }
    }

    [Fact]
    public void BusToRouterAndRouterToBus_Forward()
    {
        using var sourceBus = new EventBus(64);
        using var targetRouter = new EventRouter<int>(64);
        var routerCount = 0;
        using var routerSubscription = targetRouter.Subscribe((_, _) => Interlocked.Increment(ref routerCount));
        using var busToRouter = new EventForwarder<int>(sourceBus, targetRouter);

        sourceBus.Publish(11);
        WaitFor(() => Volatile.Read(ref routerCount) == 1).Should().BeTrue();

        using var sourceRouter = new EventRouter<int>(64);
        using var targetBus = new EventBus(64);
        var busCount = 0;
        using var busSubscription = targetBus.Subscribe<int>((_, _) => Interlocked.Increment(ref busCount));
        using var routerToBus = new EventForwarder<int>(sourceRouter, targetBus);

        sourceRouter.Publish(12);
        WaitFor(() => Volatile.Read(ref busCount) == 1).Should().BeTrue();
    }

    [Fact]
    public void Loop_IsBoundedByHopCountAndDeadLettered()
    {
        using var routerA = new EventRouter<int>(64);
        using var routerB = new EventRouter<int>(64);
        int receivedA = 0;
        int receivedB = 0;
        using var subscriptionA = routerA.Subscribe((_, _) => Interlocked.Increment(ref receivedA));
        using var subscriptionB = routerB.Subscribe((_, _) => Interlocked.Increment(ref receivedB));

        var options = new EventForwardingOptions(MaxHops: 4, Priority: EventPriority.Normal);
        using var aToB = new EventForwarder<int>(routerA, routerB, filter: null, options: options);
        using var bToA = new EventForwarder<int>(routerB, routerA, filter: null, options: options);

        routerA.Publish(1);

        WaitFor(() => aToB.LoopDropCount == 1).Should().BeTrue();
        WaitFor(() => routerA.QueuedCount == 0 && routerB.QueuedCount == 0).Should().BeTrue();
        Thread.Sleep(50);

        aToB.ForwardedCount.Should().Be(2);
        bToA.ForwardedCount.Should().Be(2);
        bToA.LoopDropCount.Should().Be(0);
        Volatile.Read(ref receivedA).Should().Be(3);
        Volatile.Read(ref receivedB).Should().Be(2);

        List<DeadLetterEntry<int>> dead = routerB.DrainDeadLetters();
        dead.Should().ContainSingle(entry => entry.Reason == DeadLetterReason.ForwardingLoop);
    }

    [Fact]
    public void CompletedTarget_DeadLettersBackpressure()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        target.Complete();
        using var forwarder = new EventForwarder<int>(source, target);

        source.Publish(1);

        WaitFor(() => forwarder.BackpressureDropCount == 1).Should().BeTrue();
        forwarder.ForwardedCount.Should().Be(0);

        List<DeadLetterEntry<int>> dead = target.DrainDeadLetters();
        dead.Should().ContainSingle(entry => entry.Reason == DeadLetterReason.ForwardingBackpressure);
    }

    [Fact]
    public void TransformFailure_DeadLettersAsForwardingFailure()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<string>(64);
        using var forwarder = new EventForwarder<int, string>(
            source,
            target,
            _ => throw new InvalidOperationException("transform boom"));

        source.Publish(1);

        WaitFor(() => forwarder.FailureCount == 1).Should().BeTrue();
        List<DeadLetterEntry<string>> dead = target.DrainDeadLetters();
        dead.Should().ContainSingle(entry => entry.Reason == DeadLetterReason.ForwardingFailed);
        dead[0].Error.Should().Contain("transform boom");
    }

    [Fact]
    public void FilterFailure_DeadLettersAsForwardingFailure()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        using var forwarder = new EventForwarder<int>(
            source,
            target,
            new ThrowingFilter());

        source.Publish(1);

        WaitFor(() => forwarder.FailureCount == 1).Should().BeTrue();
        target.DrainDeadLetters().Should().ContainSingle(entry =>
            entry.Reason == DeadLetterReason.ForwardingFailed);
    }

    [Fact]
    public void InvalidMaxHops_IsRejected()
    {
        using var source = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);

        var create = () => new EventForwarder<int>(
            source,
            target,
            options: new EventForwardingOptions(MaxHops: 0, Priority: EventPriority.Normal));

        create.Should().Throw<ArgumentOutOfRangeException>();
    }

    private static bool WaitFor(Func<bool> condition) =>
        SpinWait.SpinUntil(condition, TimeSpan.FromSeconds(5));

    private sealed class DelegateFilter<TEvent>(Func<EventEnvelope<TEvent>, bool> predicate)
        : IEventFilter<TEvent>
    {
        public bool ShouldProcess(in EventEnvelope<TEvent> envelope) => predicate(envelope);
    }

    private sealed class ThrowingFilter : IEventFilter<int>
    {
        public bool ShouldProcess(in EventEnvelope<int> envelope) =>
            throw new InvalidOperationException("filter boom");
    }
}
