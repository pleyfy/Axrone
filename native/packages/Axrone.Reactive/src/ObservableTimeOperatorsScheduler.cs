namespace Axrone.Reactive;

/// <summary>
/// Frame-driven variants of the time operators. They use <see cref="IReactiveScheduler.Now"/> and
/// scheduled callbacks instead of an OS timer, so a paused or headless loop produces no work.
/// </summary>
public static partial class ObservableOperators
{
    /// <summary>
    /// Emits the latest value once no newer value arrived for <paramref name="dueTime"/>, measured
    /// by the supplied scheduler. The timer fires when the owner advances the scheduler.
    /// </summary>
    public static IObservable<T> Debounce<T>(
        this IObservable<T> source,
        TimeSpan dueTime,
        IReactiveScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(scheduler);
        if (dueTime <= TimeSpan.Zero)
        {
            return source;
        }

        return new SchedulerDebounceObservable<T>(source, dueTime, scheduler);
    }

    /// <summary>
    /// Emits the first value and then at most one value per <paramref name="interval"/> of
    /// scheduler time. Leading edge; values inside the window are dropped.
    /// </summary>
    public static IObservable<T> Throttle<T>(
        this IObservable<T> source,
        TimeSpan interval,
        IReactiveScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(scheduler);
        if (interval <= TimeSpan.Zero)
        {
            return source;
        }

        return new SchedulerThrottleObservable<T>(source, interval, scheduler);
    }

    private sealed class SchedulerDebounceObservable<T> : IObservable<T>
    {
        private readonly IObservable<T> _source;
        private readonly TimeSpan _dueTime;
        private readonly IReactiveScheduler _scheduler;

        public SchedulerDebounceObservable(IObservable<T> source, TimeSpan dueTime, IReactiveScheduler scheduler)
        {
            _source = source;
            _dueTime = dueTime;
            _scheduler = scheduler;
        }

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            var subscription = new SchedulerDebounceSubscription<T>(_source, observer, _dueTime, _scheduler);
            subscription.Attach();
            return subscription;
        }
    }

    private sealed class SchedulerDebounceSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private readonly TimeSpan _dueTime;
        private readonly IReactiveScheduler _scheduler;
        private readonly Lock _gate = new();
        private IDisposable? _upstream;
        private IDisposable? _timer;
        private T _latest = default!;
        private bool _hasValue;
        private long _version;
        private int _disposed;

        public SchedulerDebounceSubscription(
            IObservable<T> source,
            IObserver<T> downstream,
            TimeSpan dueTime,
            IReactiveScheduler scheduler)
        {
            _source = source;
            _downstream = downstream;
            _dueTime = dueTime;
            _scheduler = scheduler;
        }

        public void Attach()
        {
            IDisposable upstream = _source.Subscribe(this);
            _upstream = upstream;
            if (Volatile.Read(ref _disposed) != 0)
            {
                upstream.Dispose();
            }
        }

        public void OnNext(T value)
        {
            lock (_gate)
            {
                if (_disposed != 0)
                {
                    return;
                }

                _latest = value;
                _hasValue = true;
                long version = ++_version;
                _timer?.Dispose();
                _timer = _scheduler.Schedule(() => OnTimer(version), _dueTime);
            }
        }

        public void OnError(Exception error)
        {
            DisposeCore();
            _downstream.OnError(error);
        }

        public void OnCompleted()
        {
            DisposeCore();
            _downstream.OnCompleted();
        }

        public void Dispose() => DisposeCore();

        private void OnTimer(long version)
        {
            T value;
            lock (_gate)
            {
                if (_disposed != 0 || !_hasValue || version != _version)
                {
                    return;
                }

                value = _latest;
                _hasValue = false;
            }

            try
            {
                _downstream.OnNext(value);
            }
            catch (Exception error)
            {
                _downstream.OnError(error);
            }
        }

        private void DisposeCore()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            _timer?.Dispose();
            _upstream?.Dispose();
            lock (_gate)
            {
                _hasValue = false;
                _latest = default!;
            }
        }
    }

    private sealed class SchedulerThrottleObservable<T> : IObservable<T>
    {
        private readonly IObservable<T> _source;
        private readonly TimeSpan _interval;
        private readonly IReactiveScheduler _scheduler;

        public SchedulerThrottleObservable(IObservable<T> source, TimeSpan interval, IReactiveScheduler scheduler)
        {
            _source = source;
            _interval = interval;
            _scheduler = scheduler;
        }

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            var subscription = new SchedulerThrottleSubscription<T>(_source, observer, _interval, _scheduler);
            subscription.Attach();
            return subscription;
        }
    }

    private sealed class SchedulerThrottleSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private readonly TimeSpan _interval;
        private readonly IReactiveScheduler _scheduler;
        private IDisposable? _upstream;
        private TimeSpan _nextAllowed;
        private bool _hasEmitted;
        private int _disposed;

        public SchedulerThrottleSubscription(
            IObservable<T> source,
            IObserver<T> downstream,
            TimeSpan interval,
            IReactiveScheduler scheduler)
        {
            _source = source;
            _downstream = downstream;
            _interval = interval;
            _scheduler = scheduler;
        }

        public void Attach()
        {
            IDisposable upstream = _source.Subscribe(this);
            _upstream = upstream;
            if (Volatile.Read(ref _disposed) != 0)
            {
                upstream.Dispose();
            }
        }

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            TimeSpan now = _scheduler.Now;
            if (_hasEmitted && now < _nextAllowed)
            {
                return;
            }

            _hasEmitted = true;
            _nextAllowed = now + _interval;
            _downstream.OnNext(value);
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _upstream?.Dispose();
            }

            _downstream.OnError(error);
        }

        public void OnCompleted()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _upstream?.Dispose();
            }

            _downstream.OnCompleted();
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _upstream?.Dispose();
            }
        }
    }
}
