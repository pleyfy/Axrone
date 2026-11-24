namespace Axrone.Event.Tests;

/// <summary>
/// Publishing must never wait forever: a saturated transport times out, and a re-entrant publish
/// on the drain thread fails fast because waiting there would deadlock the only consumer.
/// </summary>
public sealed class TransportBackpressureTests
{
    [Fact]
    public void ReentrantPublishFromDrainHandler_FailsFastInsteadOfFreezing()
    {
        var options = RouterOptions.Default with
        {
            Capacity = 4,
            DispatchBatchSize = 1,
            MaxListeners = 0,
            MaxQueueWaitMs = 300,
        };

        using var router = new EventRouter<int>(options);
        using var entered = new ManualResetEventSlim(false);
        using var release = new ManualResetEventSlim(false);
        bool reentrantThrew = false;

        router.Subscribe((envelope, _) =>
        {
            if (envelope.Payload != 0)
            {
                return;
            }

            entered.Set();
            release.Wait(TimeSpan.FromSeconds(10), CancellationToken.None);

            try
            {
                router.Publish(99);
            }
            catch (EventQueueFullException)
            {
                reentrantThrew = true;
            }
        });

        router.Publish(0);
        entered.Wait(TimeSpan.FromSeconds(10)).Should().BeTrue();

        // The drain thread is inside the handler, so nothing consumes: fill the ring.
        for (int i = 0; i < 4; i++)
        {
            router.TryPublish(i + 1).Should().BeTrue();
        }

        router.QueuedCount.Should().Be(4);

        // A producer that is not the drain thread must time out rather than spin forever.
        Action timed = () => router.Publish(123);
        timed.Should().Throw<EventQueueFullException>();

        release.Set();

        SpinWait.SpinUntil(() => reentrantThrew, TimeSpan.FromSeconds(10)).Should().BeTrue(
            "a re-entrant publish on the drain thread must fail fast, never deadlock");
    }

    [Fact]
    public void PublishResult_DistinguishesAcceptedFilteredBufferedAndStopped()
    {
        using var router = new EventRouter<int>(RouterOptions.Default with { MaxListeners = 0 });
        router.Subscribe((_, _) => { });
        router.AddFilter(new RejectFilter(13));

        router.TryPublishWithResult(1).Status.Should().Be(EventPublishStatus.Accepted);
        router.TryPublishWithResult(13).Status.Should().Be(EventPublishStatus.Filtered);

        router.Pause();
        router.TryPublishWithResult(2).Status.Should().Be(EventPublishStatus.Buffered);
        router.Resume();

        router.Complete();
        EventPublishResult stopped = router.TryPublishWithResult(3);
        stopped.Status.Should().Be(EventPublishStatus.NotRunning);
        stopped.ShouldRetry.Should().BeFalse();
    }

    private sealed class RejectFilter(int rejected) : IEventFilter<int>
    {
        public bool ShouldProcess(in EventEnvelope<int> envelope) => envelope.Payload != rejected;
    }
}
