using Axrone.Event.Hub;
using FluentAssertions;
using Xunit;

namespace Axrone.Event.Tests;

public class HubTests
{
    private readonly struct EvenFilter : Hub.IEventFilter<int>
    {
        public bool ShouldProcess(scoped in int evt) => evt % 2 == 0;
    }

    private readonly struct SumConsumer : Hub.IEventConsumer<int>
    {
        private readonly List<int> _seen;

        public SumConsumer(List<int> seen) => _seen = seen;

        public void OnEvent(scoped in int evt) => _seen.Add(evt);
    }

    [Fact]
    public void Publish_Dispatches_Inline_To_Subscribers()
    {
        using var hub = new EventHub<int>();
        var seen = new List<int>();
        SubscriptionToken token = hub.Subscribe(new SumConsumer(seen));

        PublishResult result = hub.Publish(7);
        result.DispatchedSubscribers.Should().Be(1);
        seen.Should().ContainSingle().Which.Should().Be(7);

        hub.Unsubscribe(token).Should().BeTrue();
        hub.Publish(8);
        seen.Should().ContainSingle();
    }

    [Fact]
    public void Filtered_Subscription_Skips_Nonmatching()
    {
        using var hub = new EventHub<int>();
        var seen = new List<int>();
        hub.SubscribeFiltered(new SumConsumer(seen), new EvenFilter());

        hub.Publish(3);
        hub.Publish(4);
        seen.Should().ContainSingle().Which.Should().Be(4);
    }

    [Fact]
    public void Unsubscribe_Rejects_Stale_Token()
    {
        using var hub = new EventHub<int>();
        SubscriptionToken token = hub.Subscribe(_ => { });
        hub.Unsubscribe(token).Should().BeTrue();
        hub.Unsubscribe(token).Should().BeFalse();
    }

    [Fact]
    public void Subscriber_Capacity_Is_Enforced()
    {
        var options = new EventHubOptions { MaxSubscribers = 1, WaiterPoolCapacity = 1 };
        using var hub = new EventHub<int>(options);
        hub.Subscribe(_ => { });
        Action full = () => hub.Subscribe(_ => { });
        full.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public async Task ReadNextAsync_Receives_Published_Event()
    {
        using var hub = new EventHub<int>();
        ValueTask<int> pending = hub.ReadNextAsync();
        hub.Publish(42);
        (await pending).Should().Be(42);
    }

    [Fact]
    public void Complete_Blocks_Further_Publishes()
    {
        using var hub = new EventHub<int>();
        hub.Complete();
        Action publish = () => hub.Publish(1);
        publish.Should().Throw<InvalidOperationException>();
    }
}
