namespace Axrone.Event.Tests;

using Axrone.Event.Hub;

/// <summary>
/// The hub must share the router's snapshot contract: a subscriber added by a handler cannot
/// receive the event that created it.
/// </summary>
public sealed class HubSnapshotTests
{
    [Fact]
    public void SubscriberAddedByHandler_DoesNotReceiveTheSamePublish()
    {
        using var hub = new EventHub<int>();
        int lateDeliveries = 0;
        bool subscribed = false;

        hub.Subscribe(_ =>
        {
            if (!subscribed)
            {
                subscribed = true;
                hub.Subscribe(_ => lateDeliveries++);
            }
        });

        hub.Publish(1);
        lateDeliveries.Should().Be(0, "dispatch must read an immutable snapshot");

        hub.Publish(2);
        lateDeliveries.Should().Be(1);
    }
}
