namespace Axrone.Event.Tests;

/// <summary>
/// Executable contract proof: a minimal synchronous bus over <see cref="IEventBus"/> proving the
/// surface is implementable and that stamping belongs to the publish edge. E2 replaces the stub
/// with ring transport; these facts become the conformance baseline.
/// </summary>
public class BusContractTests
{
    private sealed class StubSubscription : IEventSubscription
    {
        private const int Active = 1;
        private const int Paused = 2;
        private const int Disposed = 3;

        private readonly Action _onDispose;
        private int _state = Active;

        public StubSubscription(Guid id, Action onDispose)
        {
            SubscriptionId = id;
            _onDispose = onDispose;
        }

        public Guid SubscriptionId { get; }
        public bool IsActive => Volatile.Read(ref _state) == Active;
        public bool IsPaused => Volatile.Read(ref _state) == Paused;

        public void Pause() => Interlocked.CompareExchange(ref _state, Paused, Active);
        public void Resume() => Interlocked.CompareExchange(ref _state, Active, Paused);

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _state, Disposed) != Disposed)
            {
                _onDispose();
            }
        }

        public ValueTask DisposeAsync()
        {
            Dispose();
            return ValueTask.CompletedTask;
        }
    }

    private sealed class StubEventBus : IEventBus
    {
        private readonly Dictionary<Type, List<(StubSubscription Subscription, object Handler)>> _handlers = new();
        private long _sequence;

        public void Publish<TEvent>(in TEvent message)
        {
            var id = Guid.NewGuid();
            var stamped = new EventEnvelope<TEvent>(
                new EventMetadata(id, id, Guid.Empty, Interlocked.Increment(ref _sequence), 1, 0, Stopwatch.GetTimestamp()),
                message);
            PublishEnvelope(in stamped);
        }

        public void PublishEnvelope<TEvent>(in EventEnvelope<TEvent> envelope)
        {
            if (!_handlers.TryGetValue(typeof(TEvent), out var list))
            {
                return;
            }

            foreach (var (subscription, handler) in list.ToArray())
            {
                if (!subscription.IsActive)
                {
                    continue;
                }

                ((Action<EventEnvelope<TEvent>, CancellationToken>)handler)(envelope, CancellationToken.None);
            }
        }

        public int PublishBatch<TEvent>(ReadOnlySpan<TEvent> items)
        {
            int count = 0;
            for (int i = 0; i < items.Length; i++)
            {
                Publish(in items[i]);
                count++;
            }

            return count;
        }

        public IEventSubscription Subscribe<TEvent>(Action<EventEnvelope<TEvent>, CancellationToken> handler)
        {
            if (!_handlers.TryGetValue(typeof(TEvent), out var list))
            {
                list = new List<(StubSubscription, object)>();
                _handlers[typeof(TEvent)] = list;
            }

            StubSubscription? subscription = null;
            subscription = new StubSubscription(Guid.NewGuid(), () => list.RemoveAll(entry => entry.Subscription == subscription));
            list.Add((subscription, handler));
            return subscription;
        }

        public IEventSubscription SubscribeAsync<TEvent>(Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler)
        {
            Action<EventEnvelope<TEvent>, CancellationToken> sync =
                (envelope, ct) => handler(envelope, ct).GetAwaiter().GetResult();
            return Subscribe(sync);
        }
    }

    [Fact]
    public void Publish_StampsAndDelivers()
    {
        IEventBus bus = new StubEventBus();
        EventEnvelope<string>? received = null;
        using var sub = bus.Subscribe<string>((envelope, _) => received = envelope);

        bus.Publish("hello");

        received.HasValue.Should().BeTrue();
        received!.Value.Payload.Should().Be("hello");
        received!.Value.IsStamped.Should().BeTrue();
        received!.Value.Metadata.Sequence.Should().Be(1);
    }

    [Fact]
    public void Dispose_Unsubscribes()
    {
        IEventBus bus = new StubEventBus();
        var count = 0;
        var sub = bus.Subscribe<int>((_, _) => count++);
        bus.Publish(1);
        sub.Dispose();
        bus.Publish(2);

        count.Should().Be(1);
    }

    [Fact]
    public void PauseAndResume_GateDelivery()
    {
        IEventBus bus = new StubEventBus();
        var count = 0;
        using var sub = bus.Subscribe<int>((_, _) => count++);

        sub.Pause();
        bus.Publish(1);
        sub.Resume();
        bus.Publish(2);

        count.Should().Be(1);
    }

    [Fact]
    public void SubscribeAsync_Delivers()
    {
        IEventBus bus = new StubEventBus();
        var count = 0;
        using var sub = bus.SubscribeAsync<int>((_, _) =>
        {
            count++;
            return ValueTask.CompletedTask;
        });

        bus.Publish(9);

        count.Should().Be(1);
    }
}
