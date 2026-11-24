namespace Axrone.Event.Tests;

/// <summary>
/// Contract proof that pausing never strands a registry entry: dispose and unsubscribe must both
/// release a paused subscription exactly once.
/// </summary>
public sealed class SubscriptionLifecycleTests
{
    [Fact]
    public void PauseThenDispose_UnsubscribesExactlyOnce()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with { MaxListeners = 0 });
        int calls = 0;

        IEventSubscription subscription = router.Subscribe((_, _) => calls++);
        router.SubscriberCount.Should().Be(1);

        subscription.Pause();
        subscription.IsActive.Should().BeFalse();
        subscription.IsPaused.Should().BeTrue();

        subscription.Dispose();

        router.SubscriberCount.Should().Be(0);
        router.HasSubscription(subscription.SubscriptionId).Should().BeFalse();
        router.PublishImmediate(1).Should().Be(0);
        calls.Should().Be(0);
    }

    [Fact]
    public void UnsubscribeAfterPause_RemovesSubscriptionAndReturnsTrue()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with { MaxListeners = 0 });
        IEventSubscription subscription = router.Subscribe((_, _) => { });

        subscription.Pause();
        bool removed = router.Unsubscribe(subscription.SubscriptionId);

        removed.Should().BeTrue();
        router.SubscriberCount.Should().Be(0);
        router.Unsubscribe(subscription.SubscriptionId).Should().BeFalse();
    }

    [Fact]
    public void DisposeAfterPause_IsIdempotent()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with { MaxListeners = 0 });
        IEventSubscription subscription = router.Subscribe((_, _) => { });

        subscription.Pause();
        subscription.Dispose();
        subscription.Dispose();

        router.SubscriberCount.Should().Be(0);
    }
}
