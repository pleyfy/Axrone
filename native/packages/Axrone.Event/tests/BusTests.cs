namespace Axrone.Event.Tests;

public class BusTests
{
    [Fact]
    public void Types_RouteIndependently()
    {
        using var bus = new EventBus(64);
        var ints = 0;
        var strings = 0;
        using var subInt = bus.Subscribe<int>((_, _) => Interlocked.Increment(ref ints));
        using var subStr = bus.Subscribe<string>((_, _) => Interlocked.Increment(ref strings));

        bus.Publish(1);
        bus.Publish("a");

        SpinWait.SpinUntil(() => Volatile.Read(ref ints) == 1 && Volatile.Read(ref strings) == 1, TimeSpan.FromSeconds(5))
            .Should().BeTrue();
    }

    [Fact]
    public void Router_ExposesNonBlockingPath()
    {
        using var bus = new EventBus(64);

        bus.Router<int>().TryPublish(7).Should().BeTrue();
        bus.Router<int>().QueuedCount.Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public void Sequences_ArePerType()
    {
        using var bus = new EventBus(64);
        var intBox = new StrongBox<EventEnvelope<int>?>(null);
        var stringBox = new StrongBox<EventEnvelope<string>?>(null);
        using var subInt = bus.Subscribe<int>((envelope, _) =>
        {
            lock (intBox)
            {
                intBox.Value = envelope;
            }
        });
        using var subStr = bus.Subscribe<string>((envelope, _) =>
        {
            lock (stringBox)
            {
                stringBox.Value = envelope;
            }
        });

        bus.Publish(1);
        bus.Publish("a");

        SpinWait.SpinUntil(() =>
        {
            lock (intBox)
                lock (stringBox)
                {
                    return intBox.Value.HasValue && stringBox.Value.HasValue;
                }
        }, TimeSpan.FromSeconds(5)).Should().BeTrue();

        lock (intBox)
            lock (stringBox)
            {
                intBox.Value!.Value.Metadata.Sequence.Should().Be(1);
                stringBox.Value!.Value.Metadata.Sequence.Should().Be(1);
            }
    }

    [Fact]
    public void UseAfterDispose_Throws()
    {
        var bus = new EventBus(64);
        bus.Dispose();

        var act = () => bus.Publish(1);
        act.Should().Throw<ObjectDisposedException>();
    }
}
