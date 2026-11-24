namespace Axrone.Event.Tests;

public sealed class SchedulerTests
{
    private struct CollectingDispatcher : IEventDispatcher<int>
    {
        public List<int> Values;
        public EventScheduler<int>? ReentrantScheduler;
        public int NestedResult;

        public void Dispatch(in ScheduledEvent<int> item)
        {
            Values.Add(item.Envelope.Payload);

            if (item.Envelope.Payload == 1 && ReentrantScheduler is not null)
            {
                ReentrantScheduler.TrySchedule(2);
                var nested = new CollectingDispatcher { Values = Values };
                NestedResult = ReentrantScheduler.DispatchImmediate(ref nested);
            }
        }
    }

    [Fact]
    public void Drain_OrdersByPriorityThenFifo()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(8));
        scheduler.TrySchedule(1, EventPriority.Normal).Should().BeTrue();
        scheduler.TrySchedule(2, EventPriority.High).Should().BeTrue();
        scheduler.TrySchedule(3, EventPriority.Low).Should().BeTrue();
        scheduler.TrySchedule(4, EventPriority.High).Should().BeTrue();
        scheduler.TrySchedule(5, EventPriority.Normal).Should().BeTrue();

        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        int dispatched = scheduler.Drain(ref dispatcher);

        dispatched.Should().Be(5);
        dispatcher.Values.Should().Equal(2, 4, 1, 5, 3);
        scheduler.Count.Should().Be(0);
        scheduler.ScheduledCount.Should().Be(5);
        scheduler.DequeuedCount.Should().Be(5);
    }

    [Fact]
    public void Drain_IsDeterministicAcrossRuns()
    {
        List<int> first = RunOrder();
        List<int> second = RunOrder();
        List<int> third = RunOrder();

        first.Should().Equal(second);
        second.Should().Equal(third);
        first.Should().Equal(3, 4, 1, 5, 2);
    }

    [Fact]
    public void Backpressure_RejectsFullLaneButKeepsOtherLanesOpen()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(2));

        scheduler.TrySchedule(1, EventPriority.High).Should().BeTrue();
        scheduler.TrySchedule(2, EventPriority.High).Should().BeTrue();
        scheduler.TrySchedule(3, EventPriority.High).Should().BeFalse();
        scheduler.TrySchedule(4, EventPriority.Normal).Should().BeTrue();
        scheduler.CountInLane(EventPriority.High).Should().Be(2);
        scheduler.CountInLane(EventPriority.Normal).Should().Be(1);

        var act = () => scheduler.Schedule(5, EventPriority.High);
        act.Should().Throw<EventQueueFullException>()
            .Which.Should().Match<EventQueueFullException>(failure =>
                failure.Priority == EventPriority.High && failure.Capacity == 2);
    }

    [Fact]
    public void Complete_StopsEnqueueButKeepsQueuedWork()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(4));
        scheduler.TrySchedule(7).Should().BeTrue();

        scheduler.Complete();

        scheduler.IsCompleted.Should().BeTrue();
        scheduler.TrySchedule(8).Should().BeFalse();
        var act = () => scheduler.Schedule(9);
        act.Should().Throw<InvalidOperationException>();

        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        scheduler.Drain(ref dispatcher).Should().Be(1);
        dispatcher.Values.Should().Equal(7);
    }

    [Fact]
    public void Clear_DiscardsEveryLane()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(4));
        scheduler.TrySchedule(1, EventPriority.High);
        scheduler.TrySchedule(2, EventPriority.Normal);
        scheduler.TrySchedule(3, EventPriority.Low);

        scheduler.Clear().Should().Be(3);
        scheduler.Count.Should().Be(0);

        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        scheduler.Drain(ref dispatcher).Should().Be(0);
        dispatcher.Values.Should().BeEmpty();
    }

    [Fact]
    public void Drain_HonorsMaxItems()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(8));
        for (int i = 0; i < 5; i++)
        {
            scheduler.TrySchedule(i);
        }

        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        scheduler.Drain(ref dispatcher, maxItems: 2).Should().Be(2);
        scheduler.Count.Should().Be(3);
        dispatcher.Values.Should().Equal(0, 1);
    }

    [Fact]
    public void DispatchImmediate_GuardsReentrancyAndDrainsNewWork()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(8));
        scheduler.TrySchedule(1);

        var dispatcher = new CollectingDispatcher
        {
            Values = new List<int>(),
            ReentrantScheduler = scheduler
        };
        int dispatched = scheduler.DispatchImmediate(ref dispatcher);

        dispatched.Should().Be(2);
        dispatcher.Values.Should().Equal(1, 2);
        dispatcher.NestedResult.Should().Be(0);
    }

    [Fact]
    public void InvalidPriority_IsRejected()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(4));

        var schedule = () => scheduler.TrySchedule(1, (EventPriority)9);
        schedule.Should().Throw<ArgumentOutOfRangeException>();

        var count = () => scheduler.CountInLane((EventPriority)9);
        count.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NegativeDrainLimit_IsRejected()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(4));
        var dispatcher = new CollectingDispatcher { Values = new List<int>() };

        var drain = () => scheduler.Drain(ref dispatcher, maxItems: -1);
        drain.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void ScheduledPayload_IsStampedBeforeDispatch()
    {
        var scheduler = new EventScheduler<int>(8);
        scheduler.Schedule(7);

        scheduler.TryDequeue(out ScheduledEvent<int> item).Should().BeTrue();

        item.Envelope.IsStamped.Should().BeTrue();
        item.Envelope.Metadata.EventId.Should().NotBe(Guid.Empty);
        item.Envelope.Metadata.CorrelationId.Should().Be(item.Envelope.Metadata.EventId);
        item.Envelope.Metadata.Sequence.Should().BeGreaterThan(0);
        item.Envelope.Metadata.Timestamp.Should().BeGreaterThan(0);
    }

    private static List<int> RunOrder()
    {
        var scheduler = new EventScheduler<int>(new EventSchedulerOptions(8));
        scheduler.TrySchedule(1, EventPriority.Normal);
        scheduler.TrySchedule(2, EventPriority.Low);
        scheduler.TrySchedule(3, EventPriority.High);
        scheduler.TrySchedule(4, EventPriority.High);
        scheduler.TrySchedule(5, EventPriority.Normal);

        var dispatcher = new CollectingDispatcher { Values = new List<int>() };
        scheduler.Drain(ref dispatcher);
        return dispatcher.Values;
    }
}
