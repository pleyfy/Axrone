namespace Axrone.Reactive.Tests;

using FluentAssertions;
using Xunit;

public sealed class ObservationBuilderTests
{
    [Fact]
    public void FiltersTransformsAndPreservesPriorityOrder()
    {
        using var subject = new Subject<int>();
        var high = new TestObserver<string>();
        var low = new TestObserver<string>();
        var order = new List<string>();
        using var first = subject.Observe()
            .Filter(value => value % 2 == 0)
            .Transform(value => $"v{value}")
            .Subscribe(new DelegateObserver<string>(value =>
            {
                order.Add("high");
                high.OnNext(value);
            }));
        using var second = subject.Observe(new ObservationOptions(ObservationPriority.Low))
            .Subscribe(new DelegateObserver<int>(_ => order.Add("low")));

        subject.OnNext(1);
        subject.OnNext(2);
        subject.OnNext(4);

        high.Values.Should().Equal("v2", "v4");
        order.Should().Equal("low", "high", "low", "high", "low");
    }

    [Fact]
    public void OnceUnsubscribesAfterFirstValue()
    {
        using var subject = new Subject<int>();
        var observer = new TestObserver<int>();
        using var subscription = subject.Observe().Once().Subscribe(observer);

        subject.OnNext(1);
        subject.OnNext(2);

        observer.Values.Should().Equal(1);
        subject.SubscriberCount.Should().Be(0);
    }

    [Fact]
    public void DebouncesAndThrottlesWithInjectedTime()
    {
        var time = new ManualTimeProvider();
        using var subject = new Subject<int>();
        var debounced = new TestObserver<int>();
        using var debounceSubscription = subject.Observe(ObservationOptions.Default, time)
            .Debounce(10)
            .Subscribe(debounced);

        subject.OnNext(1);
        subject.OnNext(2);
        time.Advance(9);
        debounced.Values.Should().BeEmpty();
        time.Advance(1);
        debounced.Values.Should().Equal(2);
        debounceSubscription.Dispose();

        var throttled = new TestObserver<int>();
        using var throttleSubscription = subject.Observe(ObservationOptions.Default, time)
            .Throttle(10)
            .Subscribe(throttled);

        subject.OnNext(1);
        subject.OnNext(2);
        time.Advance(10);
        subject.OnNext(3);
        throttled.Values.Should().Equal(1, 3);
    }

    [Fact]
    public void ReplaysValuesToLateSubscribers()
    {
        using var subject = new Subject<int>();
        ObservationBuilder<int> builder = subject.Observe().Replay(2);
        var first = new TestObserver<int>();
        using (builder.Subscribe(first))
        {
            subject.OnNext(1);
            subject.OnNext(2);
            subject.OnNext(3);
        }

        var late = new TestObserver<int>();
        using var lateSubscription = builder.Subscribe(late);
        late.Values.Should().Equal(2, 3);
        subject.OnNext(4);
        late.Values.Should().Equal(2, 3, 4);
    }

    [Fact]
    public void RoutesCallbackErrorsAndThrowsForThrowMode()
    {
        using var subject = new Subject<int>();
        Exception? captured = null;
        using var subscription = subject.Observe()
            .ErrorHandling(ObservationErrorHandling.Callback, error => captured = error)
            .Subscribe(new ActionObserver<int>(_ => throw new InvalidOperationException("boom")));

        subject.OnNext(1);
        captured.Should().BeOfType<InvalidOperationException>();

        using var throwSubject = new Subject<int>();
        using var throwSubscription = throwSubject.Observe()
            .Subscribe(new ActionObserver<int>(_ => throw new InvalidOperationException("boom")));
        FluentActions.Invoking(() => throwSubject.OnNext(1))
            .Should().Throw<ObserverExecutionError>();
    }

    [Fact]
    public void BuffersValuesAndFlushesRemainder()
    {
        using var subject = new Subject<int>();
        var observer = new TestObserver<int[]>();
        using var subscription = subject.Observe().Buffer(2).Subscribe(observer);

        subject.OnNext(1);
        subject.OnNext(2);
        subject.OnNext(3);
        subject.OnCompleted();

        observer.Values.Should().HaveCount(2);
        observer.Values[0].Should().Equal(1, 2);
        observer.Values[1].Should().Equal(3);
    }

    [Fact]
    public void WrapsFilterAndTransformFailures()
    {
        using var subject = new Subject<int>();
        using var filterSubscription = subject.Observe()
            .Filter(_ => throw new InvalidOperationException("filter"))
            .Subscribe(new TestObserver<int>());
        FluentActions.Invoking(() => subject.OnNext(1)).Should().Throw<FilterError>();

        using var transformSubject = new Subject<int>();
        using var transformSubscription = transformSubject.Observe()
            .Transform<int>(_ => throw new InvalidOperationException("transform"))
            .Subscribe(new TestObserver<int>());
        FluentActions.Invoking(() => transformSubject.OnNext(1)).Should().Throw<TransformError>();
    }

    [Fact]
    public void WarmNotificationsDoNotAllocate()
    {
        using var subject = new Subject<int>();
        var counter = new AllocationCountingObserver<int>();
        using var subscription = subject.Observe()
            .Filter(value => value >= 0)
            .Transform(value => value + 1)
            .Subscribe(counter);
        for (int i = 0; i < 32; i++)
        {
            subject.OnNext(i);
        }

        counter.Count = 0;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 256; i++)
        {
            subject.OnNext(i);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0);
        counter.Count.Should().Be(256);
    }

    [Fact]
    public void BuilderRejectsInvalidArguments()
    {
        using var subject = new Subject<int>();
        FluentActions.Invoking(() => subject.Observe().Filter(null!)).Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => subject.Observe().Buffer(0)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => subject.Observe().Replay(0)).Should().Throw<ArgumentOutOfRangeException>();
    }
}

internal sealed class DelegateObserver<T> : IObserver<T>
{
    private readonly Action<T> _onNext;

    public DelegateObserver(Action<T> onNext) => _onNext = onNext;

    public void OnNext(T value) => _onNext(value);

    public void OnError(Exception error) => throw error;

    public void OnCompleted()
    {
    }
}

internal sealed class AllocationCountingObserver<T> : IObserver<T>
{
    public int Count;

    public void OnNext(T value)
    {
        _ = value;
        Count++;
    }

    public void OnError(Exception error) => throw error;

    public void OnCompleted()
    {
    }
}
