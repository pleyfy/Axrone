namespace Axrone.Reactive;

public sealed class ObservableGroup<T> : IDisposable
{
    private readonly Lock _gate = new();
    private Subject<T>[] _subjects = [];
    private bool _disposed;

    public int Count => Volatile.Read(ref _subjects).Length;

    public void Add(Subject<T> subject)
    {
        ArgumentNullException.ThrowIfNull(subject);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            Subject<T>[] current = _subjects;
            if (Array.IndexOf(current, subject) >= 0)
            {
                return;
            }

            var next = new Subject<T>[current.Length + 1];
            Array.Copy(current, next, current.Length);
            next[^1] = subject;
            Volatile.Write(ref _subjects, next);
        }
    }

    public bool Remove(Subject<T> subject)
    {
        ArgumentNullException.ThrowIfNull(subject);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            Subject<T>[] current = _subjects;
            int index = Array.IndexOf(current, subject);
            if (index < 0)
            {
                return false;
            }

            var next = new Subject<T>[current.Length - 1];
            Array.Copy(current, 0, next, 0, index);
            Array.Copy(current, index + 1, next, index, current.Length - index - 1);
            Volatile.Write(ref _subjects, next);
            return true;
        }
    }

    public int Notify(T value)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);
        Subject<T>[] snapshot = Volatile.Read(ref _subjects);
        for (int i = 0; i < snapshot.Length; i++)
        {
            snapshot[i].OnNext(value);
        }

        return snapshot.Length;
    }

    public void CompleteAll()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);
        Subject<T>[] snapshot = Volatile.Read(ref _subjects);
        for (int i = 0; i < snapshot.Length; i++)
        {
            snapshot[i].OnCompleted();
        }
    }

    public IDisposable SubscribeAll(IObserver<T> observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);
        Subject<T>[] snapshot = Volatile.Read(ref _subjects);
        var subscriptions = new IDisposable[snapshot.Length];
        for (int i = 0; i < snapshot.Length; i++)
        {
            subscriptions[i] = snapshot[i].Subscribe(observer);
        }

        return new CompositeSubscription(subscriptions);
    }

    public IObservable<T> Merge()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);
        Subject<T>[] snapshot = Volatile.Read(ref _subjects);
        return new AnonymousObservable<T>(observer => new MergeSink(snapshot, observer));
    }

    public Enumerator GetEnumerator() => new(Volatile.Read(ref _subjects));

    public void Dispose()
    {
        Subject<T>[] snapshot;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            snapshot = Volatile.Read(ref _subjects);
            Volatile.Write(ref _subjects, []);
        }

        for (int i = 0; i < snapshot.Length; i++)
        {
            snapshot[i].Dispose();
        }

        GC.SuppressFinalize(this);
    }

    [SuppressMessage("Design", "CA1034:Nested types should not be visible", Justification = "The enumerator is scoped to the group type.")]
    public ref struct Enumerator
    {
        private readonly Subject<T>[] _subjects;
        private int _index;

        internal Enumerator(Subject<T>[] subjects)
        {
            _subjects = subjects;
            _index = -1;
        }

        public Subject<T> Current => _subjects[_index];

        public bool MoveNext()
        {
            _index++;
            return (uint)_index < (uint)_subjects.Length;
        }
    }

    private sealed class MergeSink : IObserver<T>, IDisposable
    {
        private readonly IObserver<T> _downstream;
        private readonly IDisposable[] _subscriptions;
        private int _remaining;
        private int _disposed;

        public MergeSink(Subject<T>[] subjects, IObserver<T> downstream)
        {
            _downstream = downstream;
            _subscriptions = new IDisposable[subjects.Length];
            _remaining = subjects.Length;
            for (int i = 0; i < subjects.Length; i++)
            {
                _subscriptions[i] = subjects[i].Subscribe(this);
            }
        }

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _disposed) == 0)
            {
                _downstream.OnNext(value);
            }
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                foreach (IDisposable subscription in _subscriptions)
                {
                    subscription.Dispose();
                }

                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Interlocked.Decrement(ref _remaining) == 0 && Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _downstream.OnCompleted();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                foreach (IDisposable subscription in _subscriptions)
                {
                    subscription.Dispose();
                }
            }
        }
    }
}

public sealed class ObservableConnection<TSource, TResult> : IDisposable
{
    private readonly IObservable<TSource> _source;
    private readonly Subject<TResult> _target;
    private readonly Func<TSource, TResult> _transform;
    private readonly Lock _gate = new();
    private IDisposable? _subscription;
    private bool _disposed;

    public ObservableConnection(
        IObservable<TSource> source,
        Subject<TResult> target,
        Func<TSource, TResult> transform)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(transform);
        _source = source;
        _target = target;
        _transform = transform;
    }

    public Subject<TResult> Target => _target;

    public bool IsConnected
    {
        get
        {
            lock (_gate)
            {
                return _subscription is not null;
            }
        }
    }

    public bool Connect()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_subscription is not null)
            {
                return false;
            }

            _subscription = _source.Subscribe(new ConnectionObserver(this));
            return true;
        }
    }

    public bool Disconnect()
    {
        lock (_gate)
        {
            if (_disposed && _subscription is null)
            {
                return false;
            }

            IDisposable? subscription = _subscription;
            _subscription = null;
            subscription?.Dispose();
            return subscription is not null;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _subscription?.Dispose();
            _subscription = null;
        }

        GC.SuppressFinalize(this);
    }

    private sealed class ConnectionObserver : IObserver<TSource>
    {
        private readonly ObservableConnection<TSource, TResult> _owner;

        public ConnectionObserver(ObservableConnection<TSource, TResult> owner) => _owner = owner;

        public void OnNext(TSource value)
        {
            try
            {
                _owner._target.OnNext(_owner._transform(value));
            }
            catch (Exception error)
            {
                _owner._target.OnError(error);
            }
        }

        public void OnError(Exception error) => _owner._target.OnError(error);

        public void OnCompleted() => _owner._target.OnCompleted();
    }
}

public sealed class ObservableChain<T>
{
    private readonly IObservable<T> _source;
    private readonly ObservationOptions _options;
    private readonly TimeProvider? _timeProvider;

    public ObservableChain(
        IObservable<T> source,
        in ObservationOptions options = default,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        _source = source;
        _options = options;
        _timeProvider = timeProvider;
    }

    public ObservableChain<T> Filter(Func<T, bool> predicate) => new(_source.Where(predicate), _options, _timeProvider);

    public ObservableChain<TResult> Map<TResult>(Func<T, TResult> selector) =>
        new(_source.Select(selector), _options, _timeProvider);

    public ObservableChain<T> Debounce(int milliseconds) => new(
        _source,
        new ObservationOptions(
            _options.Priority,
            _options.Once,
            Math.Max(0, milliseconds),
            _options.ThrottleMs,
            _options.Buffering,
            _options.Replay,
            _options.WeakReference,
            _options.ErrorHandling,
            _options.OnError),
        _timeProvider);

    public ObservableChain<T> Throttle(int milliseconds) => new(
        _source,
        new ObservationOptions(
            _options.Priority,
            _options.Once,
            _options.DebounceMs,
            Math.Max(0, milliseconds),
            _options.Buffering,
            _options.Replay,
            _options.WeakReference,
            _options.ErrorHandling,
            _options.OnError),
        _timeProvider);

    public ObservableChain<T[]> Buffer(int count, int flushIntervalMs = 1000) => new(
        flushIntervalMs == 0
            ? _source.Buffer(count)
            : _source.Buffer(count, TimeSpan.FromMilliseconds(flushIntervalMs), _timeProvider),
        _options,
        _timeProvider);

    public ObservableChain<T> Take(int count) => new(_source.Take(count), _options, _timeProvider);

    public ObservableChain<T> TakeUntil(Func<T, bool> predicate) => new(
        new AnonymousObservable<T>(observer => new TakeUntilPredicateSink<T>(_source, observer, predicate)),
        _options,
        _timeProvider);

    public IDisposable Subscribe(IObserver<T> observer) =>
        new ObservationBuilder<T>(_source, in _options, _timeProvider).Subscribe(observer);

    public IDisposable Subscribe(Action<T> onNext, Action<Exception>? onError = null, Action? onCompleted = null) =>
        new ObservationBuilder<T>(_source, in _options, _timeProvider).Subscribe(onNext, onError, onCompleted);

    private sealed class TakeUntilPredicateSink<TValue> : IObserver<TValue>, IDisposable
    {
        private readonly IObservable<TValue> _source;
        private readonly IObserver<TValue> _downstream;
        private readonly Func<TValue, bool> _predicate;
        private IDisposable? _upstream;
        private int _stopped;

        public TakeUntilPredicateSink(
            IObservable<TValue> source,
            IObserver<TValue> downstream,
            Func<TValue, bool> predicate)
        {
            _source = source;
            _downstream = downstream;
            _predicate = predicate;
            _upstream = source.Subscribe(this);
        }

        public void OnNext(TValue value)
        {
            if (Volatile.Read(ref _stopped) != 0)
            {
                return;
            }

            if (_predicate(value))
            {
                OnCompleted();
                return;
            }

            _downstream.OnNext(value);
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
                _downstream.OnCompleted();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
            }
        }
    }
}

public static class ObservablePipeline
{
    public static ObservableChain<T> Chain<T>(this IObservable<T> source, in ObservationOptions options = default) =>
        new(source, in options);

    public static ObservableChain<T> Chain<T>(
        this IObservable<T> source,
        in ObservationOptions options,
        TimeProvider timeProvider) => new(source, in options, timeProvider);

    public static IObservable<TResult> Pipe<T, TResult>(
        this IObservable<T> source,
        Func<IObservable<T>, IObservable<TResult>> transform)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(transform);
        return transform(source);
    }

    public static ObservableConnection<TSource, TResult> Connect<TSource, TResult>(
        IObservable<TSource> source,
        Subject<TResult> target,
        Func<TSource, TResult> transform) => new(source, target, transform);

    public static ObservableGroup<T> Group<T>(params Subject<T>[] subjects)
    {
        ArgumentNullException.ThrowIfNull(subjects);
        var group = new ObservableGroup<T>();
        foreach (Subject<T> subject in subjects)
        {
            group.Add(subject);
        }

        return group;
    }
}

internal sealed class CompositeSubscription : IDisposable
{
    private IDisposable[]? _subscriptions;

    public CompositeSubscription(IDisposable[] subscriptions) => _subscriptions = subscriptions;

    public void Dispose()
    {
        IDisposable[]? subscriptions = Interlocked.Exchange(ref _subscriptions, null);
        if (subscriptions is null)
        {
            return;
        }

        foreach (IDisposable subscription in subscriptions)
        {
            subscription.Dispose();
        }
    }
}
