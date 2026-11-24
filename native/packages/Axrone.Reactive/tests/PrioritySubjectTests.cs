namespace Axrone.Reactive.Tests;

internal sealed class RecordingObserver<T> : IObserver<T>
{
    private readonly Lock _gate = new();
    private readonly List<T> _values = new();
    private Exception? _error;
    private bool _completed;

    public IReadOnlyList<T> Values
    {
        get
        {
            lock (_gate)
            {
                return [.. _values];
            }
        }
    }

    public Exception? Error
    {
        get
        {
            lock (_gate)
            {
                return _error;
            }
        }
    }

    public bool Completed
    {
        get
        {
            lock (_gate)
            {
                return _completed;
            }
        }
    }

    public void OnNext(T value)
    {
        lock (_gate)
        {
            _values.Add(value);
        }
    }

    public void OnError(Exception error)
    {
        lock (_gate)
        {
            _error = error;
        }
    }

    public void OnCompleted()
    {
        lock (_gate)
        {
            _completed = true;
        }
    }
}

internal sealed class CountingObserver<T> : IObserver<T>
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

public class PrioritySubjectTests
{
    [Fact]
    public void PriorityOrdersDeliveryBeforeRegistrationOrder()
    {
        using var subject = new Subject<string>();
        var log = new List<string>();
        var normalFirst = new DelegateObserver<string>(_ => log.Add("normal-1"));
        var low = new DelegateObserver<string>(_ => log.Add("low"));
        var high = new DelegateObserver<string>(_ => log.Add("high"));
        var normalSecond = new DelegateObserver<string>(_ => log.Add("normal-2"));

        using var first = subject.Subscribe(normalFirst, ObservationPriority.Normal);
        using var second = subject.Subscribe(low, ObservationPriority.Low);
        using var third = subject.Subscribe(high, ObservationPriority.High);
        using var fourth = subject.Subscribe(normalSecond, ObservationPriority.Normal);

        subject.OnNext("value");

        log.Should().Equal("high", "normal-1", "normal-2", "low");
    }

    [Fact]
    public void RemovingAHighPriorityObserverPreservesRemainingOrder()
    {
        using var subject = new Subject<int>();
        var log = new List<string>();
        var high = new DelegateObserver<int>(_ => log.Add("high"));
        var normal = new DelegateObserver<int>(_ => log.Add("normal"));
        using var highSubscription = subject.Subscribe(high, ObservationPriority.High);
        using var normalSubscription = subject.Subscribe(normal, ObservationPriority.Normal);

        highSubscription.Dispose();
        subject.OnNext(1);

        log.Should().Equal("normal");
        subject.SubscriberCount.Should().Be(1);
    }

    [Fact]
    public void BehaviorSubjectDeliversCurrentAtTheRequestedPriority()
    {
        using var subject = new BehaviorSubject<int>(5);
        var recorder = new RecordingObserver<int>();
        using var subscription = subject.Subscribe(recorder, ObservationPriority.High);

        subject.OnNext(6);

        recorder.Values.Should().Equal(5, 6);
    }

    [Fact]
    public void PrioritySnapshotDoesNotAllocatePerPublish()
    {
        using var subject = new Subject<int>();
        var high = new CountingObserver<int>();
        var normal = new CountingObserver<int>();
        var low = new CountingObserver<int>();
        using var highSubscription = subject.Subscribe(high, ObservationPriority.High);
        using var normalSubscription = subject.Subscribe(normal, ObservationPriority.Normal);
        using var lowSubscription = subject.Subscribe(low, ObservationPriority.Low);

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
        high.Count.Should().Be(1200);
        normal.Count.Should().Be(1200);
        low.Count.Should().Be(1200);
    }

    [Fact]
    public void ReplaySubject_ReplayAndLiveDeliveryKeepPriorityOrder()
    {
        using var subject = new ReplaySubject<int>(2);
        subject.OnNext(1);
        var log = new List<string>();

        using var normal = subject.Subscribe(new DelegateObserver<int>(_ => log.Add("normal")), ObservationPriority.Normal);
        using var high = subject.Subscribe(new DelegateObserver<int>(_ => log.Add("high")), ObservationPriority.High);

        subject.OnNext(2);

        log.Should().Equal("normal", "high", "high", "normal");
    }

    [Fact]
    public void AsyncSubject_TerminalDeliveryKeepsPriorityOrder()
    {
        using var subject = new AsyncSubject<int>();
        var log = new List<string>();

        using var normal = subject.Subscribe(new DelegateObserver<int>(_ => log.Add("normal")), ObservationPriority.Normal);
        using var high = subject.Subscribe(new DelegateObserver<int>(_ => log.Add("high")), ObservationPriority.High);

        subject.OnNext(1);
        subject.OnCompleted();

        log.Should().Equal("high", "normal");
    }

    [Fact]
    public void EverySubject_ExposesThePriorityCapability()
    {
        using var subject = new Subject<int>();
        using var behavior = new BehaviorSubject<int>(0);
        using var replay = new ReplaySubject<int>(1);
        using var async = new AsyncSubject<int>();

        subject.Should().BeAssignableTo<IPriorityObservable<int>>();
        behavior.Should().BeAssignableTo<IPriorityObservable<int>>();
        replay.Should().BeAssignableTo<IPriorityObservable<int>>();
        async.Should().BeAssignableTo<IPriorityObservable<int>>();
    }

    private sealed class DelegateObserver<T> : IObserver<T>
    {
        private readonly Action<T> _onNext;

        public DelegateObserver(Action<T> onNext) => _onNext = onNext;

        public void OnNext(T value) => _onNext(value);

        public void OnError(Exception error) => throw error;

        public void OnCompleted()
        {
        }
    }
}
