namespace Axrone.Reactive.Tests;

/// <summary>Frame-driven operator contracts: no OS timer, no work between advances.</summary>
public sealed class FrameSchedulerOperatorTests
{
    [Fact]
    public void Debounce_EmitsOnlyAfterTheSchedulerAdvancesPastTheDueTime()
    {
        using var scheduler = new FrameScheduler();
        using var source = new Subject<int>();
        var values = new List<int>();
        using IDisposable subscription = source
            .Debounce(TimeSpan.FromMilliseconds(10), scheduler)
            .Subscribe(new Observer<int>(values.Add));

        source.OnNext(1);
        scheduler.Advance(TimeSpan.FromMilliseconds(5));
        values.Should().BeEmpty();

        scheduler.Advance(TimeSpan.FromMilliseconds(5));
        values.Should().Equal(1);

        source.OnNext(2);
        source.OnNext(3);
        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        values.Should().Equal(1, 3);
    }

    [Fact]
    public void Throttle_UsesSchedulerTimeForTheLeadingEdge()
    {
        using var scheduler = new FrameScheduler();
        using var source = new Subject<int>();
        var values = new List<int>();
        using IDisposable subscription = source
            .Throttle(TimeSpan.FromMilliseconds(10), scheduler)
            .Subscribe(new Observer<int>(values.Add));

        source.OnNext(1);
        source.OnNext(2);
        values.Should().Equal(1);

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        source.OnNext(3);
        values.Should().Equal(1, 3);
    }

    [Fact]
    public void Interval_EmitsOncePerPeriodOnAdvance()
    {
        using var scheduler = new FrameScheduler();
        var values = new List<long>();
        using IDisposable subscription = Observable
            .Interval(TimeSpan.FromMilliseconds(10), scheduler)
            .Subscribe(new Observer<long>(values.Add));

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        values.Should().Equal(0L);

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        values.Should().Equal(0L, 1L);
    }

    [Fact]
    public void Timer_OneShotCompletesAfterTheDueTime()
    {
        using var scheduler = new FrameScheduler();
        var values = new List<long>();
        var observer = new Observer<long>(values.Add);
        using IDisposable subscription = Observable
            .Timer(TimeSpan.FromMilliseconds(5), scheduler)
            .Subscribe(observer);

        scheduler.Advance(TimeSpan.FromMilliseconds(4));
        values.Should().BeEmpty();

        scheduler.Advance(TimeSpan.FromMilliseconds(1));
        values.Should().Equal(0L);
        observer.Completed.Should().BeTrue();

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        values.Should().Equal(0L);
    }

    [Fact]
    public void Timer_PeriodicEmitsOnEachPeriod()
    {
        using var scheduler = new FrameScheduler();
        var values = new List<long>();
        using IDisposable subscription = Observable
            .Timer(TimeSpan.FromMilliseconds(5), TimeSpan.FromMilliseconds(10), scheduler)
            .Subscribe(new Observer<long>(values.Add));

        scheduler.Advance(TimeSpan.FromMilliseconds(5));
        values.Should().Equal(0L);

        scheduler.Advance(TimeSpan.FromMilliseconds(10));
        values.Should().Equal(0L, 1L);
    }

    private sealed class Observer<T>(Action<T> onNext) : IObserver<T>
    {
        public bool Completed;

        public void OnNext(T value) => onNext(value);

        public void OnError(Exception error)
        {
        }

        public void OnCompleted() => Completed = true;
    }
}
