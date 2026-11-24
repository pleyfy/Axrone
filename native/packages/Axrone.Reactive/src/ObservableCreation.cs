namespace Axrone.Reactive;

internal sealed class AnonymousObservable<T> : IObservable<T>
{
    private readonly Func<IObserver<T>, IDisposable> _subscribe;

    public AnonymousObservable(Func<IObserver<T>, IDisposable> subscribe) => _subscribe = subscribe;

    public IDisposable Subscribe(IObserver<T> observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        return _subscribe(observer);
    }
}

internal sealed class ActionDisposable : IDisposable
{
    private Action? _action;

    public ActionDisposable(Action action) => _action = action;

    public void Dispose() => Interlocked.Exchange(ref _action, null)?.Invoke();
}

public static partial class Observable
{
    public static IObservable<T> FromEnumerable<T>(
        IEnumerable<T> values,
        TimeSpan interval = default,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (interval <= TimeSpan.Zero)
        {
            return new AnonymousObservable<T>(observer =>
            {
                try
                {
                    foreach (T value in values)
                    {
                        observer.OnNext(value);
                    }

                    observer.OnCompleted();
                }
                catch (Exception error)
                {
                    observer.OnError(error);
                }

                return new ActionDisposable(static () => { });
            });
        }

        return new AnonymousObservable<T>(observer =>
            new EnumerableTimerSubscription<T>(values, interval, timeProvider ?? TimeProvider.System, observer));
    }

    public static IObservable<T> FromArray<T>(T[] values) => FromEnumerable(values);

    public static IObservable<T> FromEvent<T>(
        Action<Action<T>> subscribe,
        Action<Action<T>> unsubscribe,
        bool weakReference = true)
    {
        ArgumentNullException.ThrowIfNull(subscribe);
        ArgumentNullException.ThrowIfNull(unsubscribe);
        return new AnonymousObservable<T>(observer =>
        {
            WeakReference<IObserver<T>>? weak = weakReference ? new WeakReference<IObserver<T>>(observer) : null;
            Action<T> handler = value =>
            {
                if (weak is null)
                {
                    observer.OnNext(value);
                    return;
                }

                if (weak.TryGetTarget(out IObserver<T>? target))
                {
                    target.OnNext(value);
                }
            };
            subscribe(handler);
            return new ActionDisposable(() => unsubscribe(handler));
        });
    }

    public static IObservable<long> Interval(TimeSpan period, TimeProvider? timeProvider = null)
    {
        if (period <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(period), "Interval must be positive.");
        }

        return new AnonymousObservable<long>(observer =>
            new IntervalSubscription(observer, period, timeProvider ?? TimeProvider.System));
    }

    public static IObservable<long> Timer(
        TimeSpan dueTime,
        TimeSpan? period = null,
        TimeProvider? timeProvider = null)
    {
        if (dueTime < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(dueTime), "Due time must be non-negative.");
        }

        if (period is { } interval && interval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(period), "Period must be positive when supplied.");
        }

        return new AnonymousObservable<long>(observer =>
            new TimerSubscription(observer, dueTime, period, timeProvider ?? TimeProvider.System));
    }

    /// <summary>Emits 0,1,2… once per period on a frame-driven scheduler.</summary>
    public static IObservable<long> Interval(TimeSpan period, IReactiveScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(scheduler);
        if (period <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(period), "Interval must be positive.");
        }

        return new AnonymousObservable<long>(observer =>
            new SchedulerIntervalSubscription(observer, period, scheduler));
    }

    /// <summary>Emits 0 after the due time on a frame-driven scheduler.</summary>
    public static IObservable<long> Timer(TimeSpan dueTime, IReactiveScheduler scheduler) =>
        Timer(dueTime, period: null, scheduler);

    /// <summary>Emits 0 after the due time, then 1,2… on each period, on a frame-driven scheduler.</summary>
    public static IObservable<long> Timer(TimeSpan dueTime, TimeSpan? period, IReactiveScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(scheduler);
        if (dueTime < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(dueTime), "Due time must be non-negative.");
        }

        if (period is { } interval && interval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(period), "Period must be positive when supplied.");
        }

        return new AnonymousObservable<long>(observer =>
            new SchedulerTimerSubscription(observer, dueTime, period, scheduler));
    }

    public static IObservable<T> Defer<T>(Func<IObservable<T>> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        return new AnonymousObservable<T>(observer =>
        {
            IObservable<T> source;
            try
            {
                source = factory();
            }
            catch (Exception error)
            {
                observer.OnError(error);
                return new ActionDisposable(static () => { });
            }

            return source.Subscribe(observer);
        });
    }

    private sealed class EnumerableTimerSubscription<T> : IDisposable
    {
        private readonly IObserver<T> _observer;
        private readonly ITimer _timer;
        private T[] _values = [];
        private int _index;
        private int _disposed;

        public EnumerableTimerSubscription(
            IEnumerable<T> values,
            TimeSpan interval,
            TimeProvider timeProvider,
            IObserver<T> observer)
        {
            _observer = observer;
            _values = Materialize(values);
            _timer = timeProvider.CreateTimer(
                static state => ((EnumerableTimerSubscription<T>)state!).OnTimer(),
                this,
                interval,
                interval);
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _timer.Dispose();
            }
        }

        private void OnTimer()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            if (_index < _values.Length)
            {
                T value = _values[_index++];
                try
                {
                    _observer.OnNext(value);
                }
                catch (Exception error)
                {
                    Finish(error);
                    return;
                }

                return;
            }

            Finish(null);
        }

        private void Finish(Exception? error)
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            _timer.Dispose();
            if (error is null)
            {
                _observer.OnCompleted();
            }
            else
            {
                _observer.OnError(error);
            }
        }

        private static T[] Materialize(IEnumerable<T> values)
        {
            var list = new List<T>();
            foreach (T value in values)
            {
                list.Add(value);
            }

            return [.. list];
        }
    }

    private sealed class IntervalSubscription : IDisposable
    {
        private readonly IObserver<long> _observer;
        private readonly ITimer _timer;
        private long _counter;
        private int _disposed;

        public IntervalSubscription(IObserver<long> observer, TimeSpan period, TimeProvider timeProvider)
        {
            _observer = observer;
            _timer = timeProvider.CreateTimer(
                static state => ((IntervalSubscription)state!).OnTimer(),
                this,
                period,
                period);
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _timer.Dispose();
            }
        }

        private void OnTimer()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            try
            {
                _observer.OnNext(_counter++);
            }
            catch (Exception error)
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    _timer.Dispose();
                    _observer.OnError(error);
                }
            }
        }
    }

    private sealed class TimerSubscription : IDisposable
    {
        private readonly IObserver<long> _observer;
        private readonly ITimer _timer;
        private readonly bool _periodic;
        private long _counter;
        private int _disposed;

        public TimerSubscription(
            IObserver<long> observer,
            TimeSpan dueTime,
            TimeSpan? period,
            TimeProvider timeProvider)
        {
            _observer = observer;
            _periodic = period.HasValue;
            _timer = timeProvider.CreateTimer(
                static state => ((TimerSubscription)state!).OnTimer(),
                this,
                dueTime,
                period ?? Timeout.InfiniteTimeSpan);
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _timer.Dispose();
            }
        }

        private void OnTimer()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            try
            {
                _observer.OnNext(_counter++);
                if (!_periodic)
                {
                    if (Interlocked.Exchange(ref _disposed, 1) == 0)
                    {
                        _timer.Dispose();
                        _observer.OnCompleted();
                    }
                }
            }
            catch (Exception error)
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    _timer.Dispose();
                    _observer.OnError(error);
                }
            }
        }
    }

    private sealed class SchedulerIntervalSubscription : IDisposable
    {
        private readonly IObserver<long> _observer;
        private readonly IDisposable _timer;
        private long _counter;
        private int _disposed;

        public SchedulerIntervalSubscription(IObserver<long> observer, TimeSpan period, IReactiveScheduler scheduler)
        {
            _observer = observer;
            _timer = scheduler.SchedulePeriodic(OnTimer, period);
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _timer.Dispose();
            }
        }

        private void OnTimer()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            try
            {
                _observer.OnNext(_counter++);
            }
            catch (Exception error)
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    _timer.Dispose();
                    _observer.OnError(error);
                }
            }
        }
    }

    private sealed class SchedulerTimerSubscription : IDisposable
    {
        private readonly IObserver<long> _observer;
        private readonly TimeSpan? _period;
        private readonly IReactiveScheduler _scheduler;
        private readonly IDisposable _first;
        private IDisposable? _periodic;
        private long _counter;
        private int _disposed;

        public SchedulerTimerSubscription(
            IObserver<long> observer,
            TimeSpan dueTime,
            TimeSpan? period,
            IReactiveScheduler scheduler)
        {
            _observer = observer;
            _period = period;
            _scheduler = scheduler;
            _first = scheduler.Schedule(OnFirst, dueTime);
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _first.Dispose();
                _periodic?.Dispose();
            }
        }

        private void OnFirst()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            Emit();
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            if (_period is { } period)
            {
                _periodic = _scheduler.SchedulePeriodic(OnPeriodic, period);
            }
            else
            {
                try
                {
                    _observer.OnCompleted();
                }
                catch (Exception)
                {
                    // Completion faults have no further channel.
                }
            }
        }

        private void OnPeriodic()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            Emit();
        }

        private void Emit()
        {
            try
            {
                _observer.OnNext(_counter++);
            }
            catch (Exception error)
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    _first.Dispose();
                    _periodic?.Dispose();
                    _observer.OnError(error);
                }
            }
        }
    }
}
