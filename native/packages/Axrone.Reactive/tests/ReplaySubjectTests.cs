namespace Axrone.Reactive.Tests;

public class ReplaySubjectTests
{
    [Fact]
    public void LateSubscriberReceivesTheBoundedHistoryThenFutureValues()
    {
        using var subject = new ReplaySubject<int>(3);
        subject.OnNext(1);
        subject.OnNext(2);
        subject.OnNext(3);
        subject.OnNext(4);
        subject.OnNext(5);

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);
        subject.OnNext(6);

        late.Values.Should().Equal(3, 4, 5, 6);
        subject.BufferSize.Should().Be(3);
    }

    [Fact]
    public void PlainSubjectDoesNotReplayHistory()
    {
        using var subject = new Subject<int>();
        subject.OnNext(1);

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);
        subject.OnNext(2);

        late.Values.Should().Equal(2);
    }

    [Fact]
    public void CompletedReplaySubjectDeliversHistoryThenCompletion()
    {
        using var subject = new ReplaySubject<int>(2);
        subject.OnNext(1);
        subject.OnNext(2);
        subject.OnCompleted();

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().Equal(1, 2);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void FaultedReplaySubjectDeliversHistoryThenError()
    {
        using var subject = new ReplaySubject<int>(2);
        subject.OnNext(7);
        var fault = new InvalidOperationException("replay fault");
        subject.OnError(fault);

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().Equal(7);
        late.Error.Should().BeSameAs(fault);
    }

    [Fact]
    public void ValuesAfterCompletionDoNotEnterTheReplayBuffer()
    {
        using var subject = new ReplaySubject<int>(3);
        subject.OnNext(1);
        subject.OnCompleted();
        subject.OnNext(2);

        var late = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(late);

        late.Values.Should().Equal(1);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void InvalidBufferSizeThrows()
    {
        Action create = () => _ = new ReplaySubject<int>(0);
        create.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void ReplaySubjectEnforcesMaxObservers()
    {
        using var subject = new ReplaySubject<int>(2, new SubjectOptions(maxObservers: 2));
        using var first = subject.Subscribe(new RecordingObserver<int>());
        using var second = subject.Subscribe(new RecordingObserver<int>());
        subject.SubscriberCount.Should().Be(2);

        FluentActions.Invoking(() => subject.Subscribe(new RecordingObserver<int>()))
            .Should().Throw<MaxObserversExceededError>()
            .Which.MaxObservers.Should().Be(2);

        subject.OnCompleted();
        var late = new RecordingObserver<int>();
        using var lateSubscription = subject.Subscribe(late);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void ReplayPublishDoesNotAllocate()
    {
        using var subject = new ReplaySubject<int>(8);
        var observer = new CountingObserver<int>();
        using var subscription = subject.Subscribe(observer);

        for (int index = 0; index < 200; index++)
        {
            subject.OnNext(index);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int index = 0; index < 1000; index++)
        {
            subject.OnNext(index);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        observer.Count.Should().Be(1200);
    }

    [Fact]
    public void ReplayAllocationGuardDetectsAKnownAllocation()
    {
        using var subject = new ReplaySubject<int[]>(4);
        var observer = new CountingObserver<int[]>();
        using var subscription = subject.Subscribe(observer);

        long before = GC.GetAllocatedBytesForCurrentThread();
        subject.OnNext(new int[16]);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().BeGreaterThan(0);
        observer.Count.Should().Be(1);
    }
}
