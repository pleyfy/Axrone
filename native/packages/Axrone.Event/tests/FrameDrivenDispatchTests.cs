namespace Axrone.Event.Tests;

/// <summary>
/// Frame-driven dispatch makes delivery deterministic: nothing runs until the owner pumps, and a
/// background bus refuses a second consumer.
/// </summary>
public sealed class FrameDrivenDispatchTests
{
    [Fact]
    public void FrameDrivenBus_DispatchesOnlyWhenPumped()
    {
        using var bus = new EventBus(
            RouterOptions.Default with { MaxListeners = 0 },
            EventDispatchMode.FrameDriven);

        bus.Dispatcher.WorkerStartCount.Should().Be(0);

        int calls = 0;
        using IEventSubscription subscription = bus.Subscribe<int>((_, _) => calls++);

        bus.Publish(1);
        calls.Should().Be(0, "frame-driven mode must not dispatch on its own");

        bus.Pump().Should().Be(1);
        calls.Should().Be(1);
    }

    [Fact]
    public void FrameDrivenBus_DrainsRepeatedPasses()
    {
        using var bus = new EventBus(
            RouterOptions.Default with { MaxListeners = 0, DispatchBatchSize = 1 },
            EventDispatchMode.FrameDriven);

        int calls = 0;
        using IEventSubscription subscription = bus.Subscribe<int>((_, _) => calls++);

        bus.Publish(1);
        bus.Publish(2);
        bus.Publish(3);

        bus.Pump(maxBatches: 8).Should().Be(3);
        calls.Should().Be(3);
    }

    [Fact]
    public void FrameDrivenBus_HonorsTimeBudgetOverload()
    {
        using var bus = new EventBus(
            RouterOptions.Default with { MaxListeners = 0, DispatchBatchSize = 1 },
            EventDispatchMode.FrameDriven);

        int calls = 0;
        using IEventSubscription subscription = bus.Subscribe<int>((_, _) => calls++);

        bus.Publish(1);
        bus.Publish(2);

        bus.Pump(TimeSpan.FromMilliseconds(50)).Should().Be(2);
        calls.Should().Be(2);
    }

    [Fact]
    public void BackgroundBus_RefusesManualPump()
    {
        using var bus = new EventBus();
        Action pump = () => bus.Pump();

        pump.Should().Throw<InvalidOperationException>();
    }
}
