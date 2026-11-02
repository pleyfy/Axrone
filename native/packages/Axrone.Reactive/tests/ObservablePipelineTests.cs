namespace Axrone.Reactive.Tests;

using FluentAssertions;
using Xunit;

public sealed class ObservablePipelineTests
{
    [Fact]
    public void GroupNotifiesAndDisposesSubjects()
    {
        using var first = new Subject<int>();
        using var second = new Subject<int>();
        using var group = ObservablePipeline.Group(first, second);
        var observer = new TestObserver<int>();
        using var subscription = group.SubscribeAll(observer);

        group.Count.Should().Be(2);
        int enumerated = 0;
        foreach (Subject<int> current in group)
        {
            current.Should().NotBeNull();
            enumerated++;
        }

        enumerated.Should().Be(2);
        group.Notify(5).Should().Be(2);
        observer.Values.Should().Equal(5, 5);
        group.Remove(second).Should().BeTrue();
        group.Count.Should().Be(1);
        group.CompleteAll();
        observer.Completed.Should().BeTrue();
        group.Dispose();
        first.IsTerminated.Should().BeTrue();
    }

    [Fact]
    public void GroupNotificationsDoNotAllocateWhenWarm()
    {
        using var first = new Subject<int>();
        using var second = new Subject<int>();
        using var group = ObservablePipeline.Group(first, second);
        var firstObserver = new AllocationCountingObserver<int>();
        var secondObserver = new AllocationCountingObserver<int>();
        using var firstSubscription = first.Subscribe(firstObserver);
        using var secondSubscription = second.Subscribe(secondObserver);
        for (int i = 0; i < 32; i++)
        {
            group.Notify(i);
        }

        firstObserver.Count = 0;
        secondObserver.Count = 0;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 256; i++)
        {
            group.Notify(i);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0);
        firstObserver.Count.Should().Be(256);
        secondObserver.Count.Should().Be(256);
    }

    [Fact]
    public void MergeForwardsValuesAndCompletesAfterEverySource()
    {
        using var first = new Subject<int>();
        using var second = new Subject<int>();
        using var group = ObservablePipeline.Group(first, second);
        var observer = new TestObserver<int>();
        using var subscription = group.Merge().Subscribe(observer);

        first.OnNext(1);
        second.OnNext(2);
        first.OnCompleted();
        observer.Completed.Should().BeFalse();
        second.OnCompleted();
        observer.Values.Should().Equal(1, 2);
        observer.Completed.Should().BeTrue();
    }

    [Fact]
    public void ConnectionConnectsOnceAndRoutesErrors()
    {
        using var source = new Subject<int>();
        using var target = new Subject<string>();
        var observer = new TestObserver<string>();
        using var targetSubscription = target.Subscribe(observer);
        using var connection = ObservablePipeline.Connect(source, target, value => $"v{value}");

        connection.Connect().Should().BeTrue();
        connection.Connect().Should().BeFalse();
        connection.IsConnected.Should().BeTrue();
        source.OnNext(1);
        observer.Values.Should().Equal("v1");

        connection.Disconnect().Should().BeTrue();
        connection.Disconnect().Should().BeFalse();
        source.OnNext(2);
        observer.Values.Should().Equal("v1");

        connection.Connect().Should().BeTrue();
        source.OnError(new InvalidOperationException("fault"));
        observer.Error.Should().BeOfType<InvalidOperationException>();
        connection.Dispose();
    }

    [Fact]
    public void ChainComposesFiltersTransformsAndLimits()
    {
        using var source = new Subject<int>();
        var observer = new TestObserver<string>();
        using var subscription = source.Chain()
            .Filter(value => value % 2 == 0)
            .Map(value => $"v{value}")
            .Take(2)
            .Subscribe(observer);

        source.OnNext(1);
        source.OnNext(2);
        source.OnNext(4);
        source.OnNext(6);

        observer.Values.Should().Equal("v2", "v4");
        observer.Completed.Should().BeTrue();
        source.SubscriberCount.Should().Be(0);
    }

    [Fact]
    public void ChainSupportsBufferingAndPredicateTakeUntil()
    {
        using var source = new Subject<int>();
        var buffered = new TestObserver<int[]>();
        using var bufferSubscription = source.Chain().Buffer(2).Subscribe(buffered);
        source.OnNext(1);
        source.OnNext(2);
        source.OnNext(3);
        source.OnCompleted();
        buffered.Values.Should().HaveCount(2);
        buffered.Values[0].Should().Equal(1, 2);
        buffered.Values[1].Should().Equal(3);

        using var secondSource = new Subject<int>();
        var taken = new TestObserver<int>();
        using var takeSubscription = secondSource.Chain().TakeUntil(value => value == 2).Subscribe(taken);
        secondSource.OnNext(1);
        secondSource.OnNext(2);
        secondSource.OnNext(3);
        taken.Values.Should().Equal(1);
        taken.Completed.Should().BeTrue();
    }

    [Fact]
    public void PipeAppliesTheTransformation()
    {
        using var source = new Subject<int>();
        var observer = new TestObserver<int>();
        using var subscription = source.Pipe(stream => stream.Select(value => value * 2)).Subscribe(observer);
        source.OnNext(3);
        observer.Values.Should().Equal(6);
    }

    [Fact]
    public void CompositeSubscriptionDisposesEveryChildOnce()
    {
        int disposed = 0;
        var composite = new CompositeSubscription(
        [
            new ActionDisposable(() => disposed++),
            new ActionDisposable(() => disposed++),
        ]);
        composite.Dispose();
        composite.Dispose();
        disposed.Should().Be(2);
    }
}
