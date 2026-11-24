namespace Axrone.Event.Tests;

public sealed class CompositionParityTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    [Fact]
    public void SubscriptionGroup_DisposesEveryTrackedHandleAsOneUnit()
    {
        using var router = new EventRouter<int>(64);
        using var group = new EventSubscriptionGroup();

        IEventSubscription first = group.Track(router.Subscribe((_, _) => { }));
        IEventSubscription second = group.Track(router.Subscribe((_, _) => { }));

        group.Count.Should().Be(2);
        router.SubscriberCount.Should().Be(2);

        group.DisposeAll().Should().Be(2);
        group.Count.Should().Be(0);
        first.IsActive.Should().BeFalse();
        second.IsActive.Should().BeFalse();
        router.SubscriberCount.Should().Be(0);
        group.DisposeAll().Should().Be(0);
    }

    [Fact]
    public void SubscriptionGroup_PrunesIndividuallyDisposedHandles()
    {
        using var router = new EventRouter<int>(64);
        using var group = new EventSubscriptionGroup();
        IEventSubscription first = group.Track(router.Subscribe((_, _) => { }));
        IEventSubscription second = group.Track(router.Subscribe((_, _) => { }));

        first.Dispose();

        group.Prune().Should().Be(1);
        group.Count.Should().Be(1);
        group.Remove(second).Should().BeTrue();
        group.Remove(second).Should().BeFalse();
        second.IsActive.Should().BeTrue();
    }

    [Fact]
    public void SubscriptionGroup_TrackAfterDispose_ThrowsAndReleasesTheHandle()
    {
        using var router = new EventRouter<int>(64);
        var group = new EventSubscriptionGroup();
        group.Dispose();

        IEventSubscription subscription = router.Subscribe((_, _) => { });

        var act = () => group.Track(subscription);
        act.Should().Throw<ObjectDisposedException>();
        subscription.IsActive.Should().BeFalse();
    }

    [Fact]
    public void Namespace_IsolatesPayloadsFromTheDefaultChannel()
    {
        using var bus = new EventBus(64);
        var namespaced = new EventNamespace<UiNamespace>(bus);
        int namespacedValue = 0;
        int plainValue = 0;

        using var namespacedSub = namespaced.Subscribe<int>(
            (envelope, _) => Volatile.Write(ref namespacedValue, envelope.Payload));
        using var plainSub = bus.Subscribe<int>(
            (envelope, _) => Volatile.Write(ref plainValue, envelope.Payload));

        namespaced.PublishImmediate(5).Should().Be(1);

        Volatile.Read(ref namespacedValue).Should().Be(5);
        Volatile.Read(ref plainValue).Should().Be(0);
        namespaced.TryPublish(6).Should().BeTrue();
        namespaced.Publish(7);
        SpinWait.SpinUntil(() => Volatile.Read(ref namespacedValue) == 7, Wait).Should().BeTrue();
        Volatile.Read(ref plainValue).Should().Be(0);
        namespaced.Router<int>().SubscriberCount.Should().Be(1);
        bus.Router<int>().SubscriberCount.Should().Be(1);
    }

    [Fact]
    public void Namespace_SubscribeOnce_DeliversExactlyOnce()
    {
        using var bus = new EventBus(64);
        var namespaced = new EventNamespace<UiNamespace>(bus);
        int count = 0;

        using var subscription = namespaced.SubscribeOnce<int>((_, _) => Interlocked.Increment(ref count));

        namespaced.PublishImmediate(1).Should().Be(1);
        namespaced.PublishImmediate(2).Should().Be(0);
        count.Should().Be(1);
    }

    [Fact]
    public async Task SubscriptionGroup_DisposeAsyncReleasesEveryTrackedHandle()
    {
        await using var router = new EventRouter<int>(64);
        var group = new EventSubscriptionGroup();
        IEventSubscription first = group.Track(router.Subscribe((_, _) => { }));
        IEventSubscription second = group.Track(router.Subscribe((_, _) => { }));

        await group.DisposeAsync();

        first.IsActive.Should().BeFalse();
        second.IsActive.Should().BeFalse();
        group.Count.Should().Be(0);
    }

    [Fact]
    public void FanIn_MergesEverySourceIntoTheDestination()
    {
        using var left = new EventRouter<int>(64);
        using var right = new EventRouter<int>(64);
        using var target = new EventRouter<int>(64);
        using var fanIn = new EventFanIn<int>(target, left, right);

        var received = new List<int>();
        var gate = new object();
        using var subscription = target.Subscribe((envelope, _) =>
        {
            lock (gate)
            {
                received.Add(envelope.Payload);
            }
        });

        left.PublishImmediate(1).Should().Be(1);
        right.PublishImmediate(2).Should().Be(1);

        SpinWait.SpinUntil(
            () =>
            {
                lock (gate)
                {
                    return received.Count == 2;
                }
            },
            Wait).Should().BeTrue();

        lock (gate)
        {
            received.OrderBy(static value => value).Should().Equal(1, 2);
        }

        fanIn.Count.Should().Be(2);
        fanIn.ForwardedCount.Should().Be(2);
    }

    [Fact]
    public void BusPipe_ForwardsAcrossBusesAndRouters()
    {
        using var source = new EventBus(64);
        using var target = new EventBus(64);
        using var pipe = source.Pipe<int, string>(target, static value => value.ToString());
        var gate = new object();
        string? received = null;
        using var subscription = target.Subscribe<string>((envelope, _) =>
        {
            lock (gate)
            {
                received = envelope.Payload;
            }
        });

        source.PublishImmediate(9).Should().Be(1);
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
            received.Should().Be("9");
        }

        using var router = new EventRouter<int>(64);
        using var routerTarget = new EventBus(64);
        using var routerPipe = router.Pipe(routerTarget, static value => value * 2);
        var routerReceived = new StrongBox<int?>(null);
        using var routerSubscription = routerTarget.Subscribe<int>((envelope, _) =>
        {
            lock (routerReceived)
            {
                routerReceived.Value = envelope.Payload;
            }
        });

        router.PublishImmediate(4).Should().Be(1);
        SpinWait.SpinUntil(
            () =>
            {
                lock (routerReceived)
                {
                    return routerReceived.Value.HasValue;
                }
            },
            Wait).Should().BeTrue();

        lock (routerReceived)
        {
            routerReceived.Value.Should().Be(8);
        }
    }

    [Fact]
    public void FanIn_BusSourcesMergeIntoBusDestination()
    {
        using var left = new EventBus(64);
        using var right = new EventBus(64);
        using var target = new EventBus(64);
        using var fanIn = new EventFanIn<int>(target, left, right);
        int received = 0;
        using var subscription = target.Subscribe<int>((_, _) => Interlocked.Increment(ref received));

        left.PublishImmediate(1);
        right.PublishImmediate(2);

        SpinWait.SpinUntil(() => Volatile.Read(ref received) == 2, Wait).Should().BeTrue();
        fanIn.Count.Should().Be(2);
        fanIn.ForwardedCount.Should().Be(2);
    }

    [Fact]
    public void EventEmitters_CreateReturnsStandaloneEmitter()
    {
        using var router = EventEmitters.Create<int>(64);
        using var subscription = router.Subscribe((_, _) => { });

        EventEmitters.IsEmitter(router).Should().BeTrue();
        router.PublishImmediate(1).Should().Be(1);
    }

    [Fact]
    public void EventFilters_IncludeAndExcludeGateThePublishPath()
    {
        using var router = new EventRouter<int>(64);
        int received = 0;
        using var subscription = router.Subscribe((_, _) => received++);

        router.AddFilter(EventFilters.Include<int>(static value => value > 0));
        router.PublishImmediate(-1).Should().Be(0);
        router.PublishImmediate(1).Should().Be(1);

        router.AddFilter(EventFilters.Exclude<int>(static value => value == 2));
        router.PublishImmediate(2).Should().Be(0);
        router.PublishImmediate(3).Should().Be(1);

        received.Should().Be(2);
    }

    [Fact]
    public void EventUtils_DeterministicCombinators()
    {
        List<int> filtered = [];
        Action<int> where = EventUtils.Where<int>(static value => value % 2 == 0, filtered.Add);
        where(1);
        where(2);
        filtered.Should().Equal(2);

        string? transformed = null;
        Action<int> select = EventUtils.Select<int, string>(static value => $"v{value}", value => transformed = value);
        select(7);
        transformed.Should().Be("v7");

        Exception? captured = null;
        Action<int> safe = EventUtils.CatchErrors<int>(
            static _ => throw new InvalidOperationException("boom"),
            (error, _) => captured = error);
        safe(1);
        captured.Should().BeOfType<InvalidOperationException>();
    }

    [Fact]
    public void EventUtils_TimeBasedCombinatorsUseInjectedClock()
    {
        var clock = new ManualTimestampProvider();
        int throttled = 0;
        Action<int> throttle = EventUtils.Throttle<int>(_ => throttled++, TimeSpan.FromSeconds(2), clock);

        throttle(1);
        throttled.Should().Be(1);
        clock.Advance(TimeSpan.FromSeconds(1));
        throttle(2);
        throttled.Should().Be(1);
        clock.Advance(TimeSpan.FromSeconds(1));
        throttle(3);
        throttled.Should().Be(2);

        int limited = 0;
        Action<int> rateLimit = EventUtils.RateLimit<int>(_ => limited++, 2, TimeSpan.FromSeconds(10), clock);

        rateLimit(1);
        rateLimit(2);
        rateLimit(3);
        limited.Should().Be(2);
        clock.Advance(TimeSpan.FromSeconds(10));
        rateLimit(4);
        limited.Should().Be(3);
    }

    [Fact]
    public void EventUtils_AdaptersBindToRouterHandlers()
    {
        using var router = new EventRouter<int>(64);
        int sync = 0;
        int async = 0;

        using var syncSub = router.Subscribe(EventUtils.AsHandler<int>(_ => sync++));
        using var asyncSub = router.SubscribeAsync(EventUtils.ToAsync<int>(_ => async++));

        router.PublishImmediate(1).Should().Be(2);
        sync.Should().Be(1);
        async.Should().Be(1);
    }

    private readonly struct UiNamespace
    {
    }

    private sealed class ManualTimestampProvider : TimeProvider
    {
        private long _timestamp;

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => Volatile.Read(ref _timestamp);

        public override DateTimeOffset GetUtcNow() =>
            DateTimeOffset.UnixEpoch + TimeSpan.FromTicks(Volatile.Read(ref _timestamp));

        public void Advance(TimeSpan delta) => Interlocked.Add(ref _timestamp, delta.Ticks);
    }
}
