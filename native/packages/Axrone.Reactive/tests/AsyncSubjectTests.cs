namespace Axrone.Reactive.Tests;

public class AsyncSubjectTests
{
    [Fact]
    public void OnlyTheLastValueIsEmittedOnCompletion()
    {
        using var subject = new AsyncSubject<int>();
        var observer = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(observer);

        subject.OnNext(1);
        subject.OnNext(2);
        observer.Values.Should().BeEmpty();

        subject.OnCompleted();

        observer.Values.Should().Equal(2);
        observer.Completed.Should().BeTrue();
    }

    [Fact]
    public void LateSubscriberAfterCompletionReceivesValueThenCompletion()
    {
        using var subject = new AsyncSubject<int>();
        subject.OnNext(42);
        subject.OnCompleted();

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().Equal(42);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void FaultEmitsErrorWithoutValue()
    {
        using var subject = new AsyncSubject<int>();
        subject.OnNext(9);
        var fault = new InvalidOperationException("async fault");
        subject.OnError(fault);

        var early = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(early);
        var late = new RecordingObserver<int>();
        using var lateSubscription = subject.Subscribe(late);

        early.Values.Should().BeEmpty();
        early.Error.Should().BeSameAs(fault);
        late.Values.Should().BeEmpty();
        late.Error.Should().BeSameAs(fault);
        subject.IsFaulted.Should().BeTrue();
    }

    [Fact]
    public void CompletionWithoutAValueCompletesEmpty()
    {
        using var subject = new AsyncSubject<int>();
        subject.OnCompleted();

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().BeEmpty();
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void ValuesAfterCompletionAreIgnored()
    {
        using var subject = new AsyncSubject<int>();
        subject.OnNext(1);
        subject.OnCompleted();
        subject.OnNext(2);

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().Equal(1);
    }

    [Fact]
    public void AsyncSubjectEnforcesMaxObservers()
    {
        using var subject = new AsyncSubject<int>(new SubjectOptions(maxObservers: 1));
        var first = new RecordingObserver<int>();
        using var firstSubscription = subject.Subscribe(first);

        FluentActions.Invoking(() => subject.Subscribe(new RecordingObserver<int>()))
            .Should().Throw<MaxObserversExceededError>()
            .Which.MaxObservers.Should().Be(1);

        subject.OnNext(5);
        subject.OnCompleted();
        first.Values.Should().Equal(5);
        first.Completed.Should().BeTrue();

        var late = new RecordingObserver<int>();
        using var lateSubscription = subject.Subscribe(late);
        late.Values.Should().Equal(5);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void AsyncSubjectCountsSwallowedObserverFaultsAndKeepsDelivering()
    {
        using var subject = new AsyncSubject<int>(new SubjectOptions(errorPropagation: false));
        int received = 0;
        bool completed = false;
        using var failing = subject.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));
        using var healthy = subject.Subscribe(new ActionObserver<int>(
            _ => received++,
            onCompleted: () => completed = true));

        subject.OnNext(7);
        subject.OnCompleted();

        subject.ObserverFaultCount.Should().Be(1);
        received.Should().Be(1);
        completed.Should().BeTrue();
    }

    [Fact]
    public void AsyncSubjectPropagatesObserverFaultsOnCompletion()
    {
        using var subject = new AsyncSubject<int>();
        using var failing = subject.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));
        subject.OnNext(7);

        FluentActions.Invoking(subject.OnCompleted).Should().Throw<InvalidOperationException>();
        subject.ObserverFaultCount.Should().Be(0);
    }

    [Fact]
    public void AsyncPublishDoesNotAllocate()
    {
        using var subject = new AsyncSubject<int>();
        for (int index = 0; index < 200; index++)
        {
            subject.OnNext(index);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int index = 0; index < 1000; index++)
        {
            subject.OnNext(index);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0);
    }

    [Fact]
    public void AsyncAllocationGuardDetectsAKnownAllocation()
    {
        using var subject = new AsyncSubject<int[]>();

        long before = GC.GetAllocatedBytesForCurrentThread();
        subject.OnNext(new int[16]);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().BeGreaterThan(0);
    }
}
