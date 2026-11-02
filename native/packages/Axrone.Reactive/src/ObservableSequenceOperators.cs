namespace Axrone.Reactive;

public interface IObservableGroup<out TKey, out T> : IObservable<T>
{
    TKey Key { get; }
}

public static class ObservableSequenceOperators
{
    public static IObservable<T> Take<T>(this IObservable<T> source, int count)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfNegative(count, nameof(count));
        if (count == 0)
        {
            return Observable.Empty<T>();
        }

        return new AnonymousObservable<T>(observer =>
        {
            var subscription = new TakeSubscription<T>(source, observer, count);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<T> Skip<T>(this IObservable<T> source, int count)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfNegative(count, nameof(count));
        if (count == 0)
        {
            return source;
        }

        return new AnonymousObservable<T>(observer =>
        {
            var subscription = new SkipSubscription<T>(source, observer, count);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<T> First<T>(this IObservable<T> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return new AnonymousObservable<T>(observer =>
        {
            var subscription = new FirstSubscription<T>(source, observer);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<T> Last<T>(this IObservable<T> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return new AnonymousObservable<T>(observer =>
        {
            var subscription = new LastSubscription<T>(source, observer);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<T[]> Buffer<T>(this IObservable<T> source, int count)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1, nameof(count));
        return new BufferObservable<T>(source, count, TimeSpan.Zero, TimeProvider.System);
    }

    public static IObservable<T[]> Buffer<T>(
        this IObservable<T> source,
        int count,
        TimeSpan flushInterval,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1, nameof(count));
        ArgumentOutOfRangeException.ThrowIfNegative(flushInterval.Ticks, nameof(flushInterval));

        return new BufferObservable<T>(source, count, flushInterval, timeProvider ?? TimeProvider.System);
    }

    public static IObservable<IObservable<T>> Window<T>(this IObservable<T> source, int count)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1, nameof(count));
        return new AnonymousObservable<IObservable<T>>(observer =>
        {
            var subscription = new WindowSubscription<T>(source, observer, count);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<IObservableGroup<TKey, T>> GroupBy<T, TKey>(
        this IObservable<T> source,
        Func<T, TKey> keySelector,
        IEqualityComparer<TKey>? comparer = null)
        where TKey : notnull
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(keySelector);
        return new AnonymousObservable<IObservableGroup<TKey, T>>(observer =>
        {
            var subscription = new GroupBySubscription<T, TKey>(source, observer, keySelector, comparer);
            subscription.Attach();
            return subscription;
        });
    }

    public static IObservable<T> StartWith<T>(this IObservable<T> source, T value)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Observable.Return(value).Concat(source);
    }

    public static IObservable<T> Concat<T>(this IObservable<T> first, IObservable<T> second)
    {
        ArgumentNullException.ThrowIfNull(first);
        ArgumentNullException.ThrowIfNull(second);
        return new AnonymousObservable<T>(observer =>
        {
            var subscription = new ConcatSubscription<T>(first, second, observer);
            subscription.AttachFirst();
            return subscription;
        });
    }

    public static IObservable<TResult> Zip<TFirst, TSecond, TResult>(
        this IObservable<TFirst> first,
        IObservable<TSecond> second,
        Func<TFirst, TSecond, TResult> resultSelector)
    {
        ArgumentNullException.ThrowIfNull(first);
        ArgumentNullException.ThrowIfNull(second);
        ArgumentNullException.ThrowIfNull(resultSelector);
        return new AnonymousObservable<TResult>(observer =>
        {
            var subscription = new ZipSubscription<TFirst, TSecond, TResult>(first, second, observer, resultSelector);
            subscription.Attach();
            return subscription;
        });
    }

    private sealed class TakeSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private int _remaining;
        private int _stopped;
        private IDisposable? _upstream;

        public TakeSubscription(IObservable<T> source, IObserver<T> downstream, int count)
        {
            _source = source;
            _downstream = downstream;
            _remaining = count;
        }

        public void Attach() => _upstream = _source.Subscribe(this);

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _stopped) != 0)
            {
                return;
            }

            _downstream.OnNext(value);
            if (--_remaining <= 0)
            {
                Stop(false);
            }
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

        public void Dispose() => Stop(true);

        private void Stop(bool disposeOnly)
        {
            if (Interlocked.Exchange(ref _stopped, 1) != 0)
            {
                return;
            }

            _upstream?.Dispose();
            if (!disposeOnly)
            {
                _downstream.OnCompleted();
            }
        }
    }

    private sealed class SkipSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private int _remaining;
        private int _disposed;
        private IDisposable? _upstream;

        public SkipSubscription(IObservable<T> source, IObserver<T> downstream, int count)
        {
            _source = source;
            _downstream = downstream;
            _remaining = count;
        }

        public void Attach() => _upstream = _source.Subscribe(this);

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            if (_remaining > 0)
            {
                _remaining--;
                return;
            }

            _downstream.OnNext(value);
        }

        public void OnError(Exception error) => _downstream.OnError(error);

        public void OnCompleted() => _downstream.OnCompleted();

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _upstream?.Dispose();
            }
        }
    }

    private sealed class FirstSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private int _stopped;
        private IDisposable? _upstream;

        public FirstSubscription(IObservable<T> source, IObserver<T> downstream)
        {
            _source = source;
            _downstream = downstream;
        }

        public void Attach() => _upstream = _source.Subscribe(this);

        public void OnNext(T value)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
                _downstream.OnNext(value);
                _downstream.OnCompleted();
            }
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _downstream.OnError(new InvalidOperationException("Sequence contains no elements."));
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

    private sealed class LastSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<T> _downstream;
        private IDisposable? _upstream;
        private T _last = default!;
        private bool _hasValue;
        private int _disposed;

        public LastSubscription(IObservable<T> source, IObserver<T> downstream)
        {
            _source = source;
            _downstream = downstream;
        }

        public void Attach() => _upstream = _source.Subscribe(this);

        public void OnNext(T value)
        {
            _last = value;
            _hasValue = true;
        }

        public void OnError(Exception error) => _downstream.OnError(error);

        public void OnCompleted()
        {
            if (!_hasValue)
            {
                _downstream.OnError(new InvalidOperationException("Sequence contains no elements."));
                return;
            }

            _downstream.OnNext(_last);
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

    private sealed class BufferObservable<T> : IObservable<T[]>
    {
        private readonly IObservable<T> _source;
        private readonly int _count;
        private readonly TimeSpan _flushInterval;
        private readonly TimeProvider _timeProvider;

        public BufferObservable(IObservable<T> source, int count, TimeSpan flushInterval, TimeProvider timeProvider)
        {
            _source = source;
            _count = count;
            _flushInterval = flushInterval;
            _timeProvider = timeProvider;
        }

        public IDisposable Subscribe(IObserver<T[]> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            var subscription = new BufferSubscription(this, observer);
            subscription.Attach();
            return subscription;
        }

        private sealed class BufferSubscription : IObserver<T>, IDisposable
        {
            private readonly BufferObservable<T> _parent;
            private readonly IObserver<T[]> _downstream;
            private readonly List<T> _buffer = new();
            private readonly Lock _gate = new();
            private readonly ITimer? _timer;
            private IDisposable? _upstream;
            private int _disposed;

            public BufferSubscription(BufferObservable<T> parent, IObserver<T[]> downstream)
            {
                _parent = parent;
                _downstream = downstream;
                if (parent._flushInterval > TimeSpan.Zero)
                {
                    _timer = parent._timeProvider.CreateTimer(
                        static state => ((BufferSubscription)state!).Flush(),
                        this,
                        parent._flushInterval,
                        parent._flushInterval);
                }
            }

            public void Attach() => _upstream = _parent._source.Subscribe(this);

            public void OnNext(T value)
            {
                T[]? flush = null;
                lock (_gate)
                {
                    if (_disposed != 0)
                    {
                        return;
                    }

                    _buffer.Add(value);
                    if (_buffer.Count >= _parent._count)
                    {
                        flush = [.. _buffer];
                        _buffer.Clear();
                    }
                }

                if (flush is not null)
                {
                    _downstream.OnNext(flush);
                }
            }

            public void OnError(Exception error)
            {
                DisposeCore();
                _downstream.OnError(error);
            }

            public void OnCompleted()
            {
                T[]? flush = null;
                lock (_gate)
                {
                    if (_buffer.Count > 0)
                    {
                        flush = [.. _buffer];
                        _buffer.Clear();
                    }
                }

                DisposeCore();
                if (flush is not null)
                {
                    _downstream.OnNext(flush);
                }

                _downstream.OnCompleted();
            }

            public void Dispose() => DisposeCore();

            private void Flush()
            {
                T[]? flush = null;
                lock (_gate)
                {
                    if (_disposed != 0 || _buffer.Count == 0)
                    {
                        return;
                    }

                    flush = [.. _buffer];
                    _buffer.Clear();
                }

                _downstream.OnNext(flush);
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
                    _buffer.Clear();
                }
            }
        }
    }

    private sealed class WindowSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<IObservable<T>> _downstream;
        private readonly int _count;
        private IDisposable? _upstream;
        private Subject<T> _window = new();
        private int _inWindow;
        private int _stopped;

        public WindowSubscription(IObservable<T> source, IObserver<IObservable<T>> downstream, int count)
        {
            _source = source;
            _downstream = downstream;
            _count = count;
        }

        public void Attach()
        {
            _downstream.OnNext(_window);
            _upstream = _source.Subscribe(this);
        }

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _stopped) != 0)
            {
                return;
            }

            _window.OnNext(value);
            if (++_inWindow >= _count)
            {
                _window.OnCompleted();
                _window = new Subject<T>();
                _inWindow = 0;
                _downstream.OnNext(_window);
            }
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _window.OnError(error);
                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _window.OnCompleted();
                _downstream.OnCompleted();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
                _window.Dispose();
            }
        }
    }

    private sealed class GroupBySubscription<T, TKey> : IObserver<T>, IDisposable
        where TKey : notnull
    {
        private readonly IObservable<T> _source;
        private readonly IObserver<IObservableGroup<TKey, T>> _downstream;
        private readonly Func<T, TKey> _keySelector;
        private readonly Dictionary<TKey, GroupSubject> _groups;
        private IDisposable? _upstream;
        private int _stopped;

        public GroupBySubscription(
            IObservable<T> source,
            IObserver<IObservableGroup<TKey, T>> downstream,
            Func<T, TKey> keySelector,
            IEqualityComparer<TKey>? comparer)
        {
            _source = source;
            _downstream = downstream;
            _keySelector = keySelector;
            _groups = new Dictionary<TKey, GroupSubject>(comparer);
        }

        public void Attach() => _upstream = _source.Subscribe(this);

        public void OnNext(T value)
        {
            if (Volatile.Read(ref _stopped) != 0)
            {
                return;
            }

            TKey key = _keySelector(value);
            if (!_groups.TryGetValue(key, out GroupSubject? group))
            {
                group = new GroupSubject(key);
                _groups.Add(key, group);
                _downstream.OnNext(group);
            }

            group.OnNext(value);
        }

        public void OnError(Exception error)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                foreach (GroupSubject group in _groups.Values)
                {
                    group.OnError(error);
                }

                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                foreach (GroupSubject group in _groups.Values)
                {
                    group.OnCompleted();
                }

                _downstream.OnCompleted();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _upstream?.Dispose();
                foreach (GroupSubject group in _groups.Values)
                {
                    group.Dispose();
                }

                _groups.Clear();
            }
        }

        private sealed class GroupSubject : IObservableGroup<TKey, T>, IObserver<T>, IDisposable
        {
            private readonly Subject<T> _subject = new();

            public GroupSubject(TKey key) => Key = key;

            public TKey Key { get; }

            public IDisposable Subscribe(IObserver<T> observer) => _subject.Subscribe(observer);

            public void OnNext(T value) => _subject.OnNext(value);

            public void OnError(Exception error) => _subject.OnError(error);

            public void OnCompleted() => _subject.OnCompleted();

            public void Dispose() => _subject.Dispose();
        }
    }

    private sealed class ConcatSubscription<T> : IObserver<T>, IDisposable
    {
        private readonly IObservable<T> _first;
        private readonly IObservable<T> _second;
        private readonly IObserver<T> _downstream;
        private IDisposable? _upstream;
        private int _stage;
        private int _disposed;

        public ConcatSubscription(IObservable<T> first, IObservable<T> second, IObserver<T> downstream)
        {
            _first = first;
            _second = second;
            _downstream = downstream;
        }

        public void AttachFirst() => _upstream = _first.Subscribe(this);

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
                _downstream.OnError(error);
            }
        }

        public void OnCompleted()
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            if (Interlocked.CompareExchange(ref _stage, 1, 0) == 0)
            {
                _upstream?.Dispose();
                _upstream = _second.Subscribe(this);
                return;
            }

            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _downstream.OnCompleted();
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _upstream?.Dispose();
            }
        }
    }

    private sealed class ZipSubscription<TFirst, TSecond, TResult> : IDisposable
    {
        private readonly IObservable<TFirst> _first;
        private readonly IObservable<TSecond> _second;
        private readonly IObserver<TResult> _downstream;
        private readonly Func<TFirst, TSecond, TResult> _selector;
        private readonly Queue<TFirst> _firstQueue = new();
        private readonly Queue<TSecond> _secondQueue = new();
        private readonly Lock _gate = new();
        private IDisposable? _firstSubscription;
        private IDisposable? _secondSubscription;
        private bool _firstCompleted;
        private bool _secondCompleted;
        private int _stopped;

        public ZipSubscription(
            IObservable<TFirst> first,
            IObservable<TSecond> second,
            IObserver<TResult> downstream,
            Func<TFirst, TSecond, TResult> selector)
        {
            _first = first;
            _second = second;
            _downstream = downstream;
            _selector = selector;
        }

        public void Attach()
        {
            _firstSubscription = _first.Subscribe(new FirstObserver(this));
            _secondSubscription = _second.Subscribe(new SecondObserver(this));
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _firstSubscription?.Dispose();
                _secondSubscription?.Dispose();
                lock (_gate)
                {
                    _firstQueue.Clear();
                    _secondQueue.Clear();
                }
            }
        }

        private void FirstNext(TFirst value)
        {
            bool complete = false;
            bool hasResult = false;
            TResult result = default!;
            lock (_gate)
            {
                if (Volatile.Read(ref _stopped) != 0)
                {
                    return;
                }

                _firstQueue.Enqueue(value);
                if (_secondQueue.Count > 0)
                {
                    result = _selector(_firstQueue.Dequeue(), _secondQueue.Dequeue());
                    hasResult = true;
                }
                else if (_firstCompleted)
                {
                    complete = true;
                }
            }

            if (hasResult)
            {
                _downstream.OnNext(result);
            }

            if (complete)
            {
                Complete();
            }
        }

        private void SecondNext(TSecond value)
        {
            bool complete = false;
            bool hasResult = false;
            TResult result = default!;
            lock (_gate)
            {
                if (Volatile.Read(ref _stopped) != 0)
                {
                    return;
                }

                _secondQueue.Enqueue(value);
                if (_firstQueue.Count > 0)
                {
                    result = _selector(_firstQueue.Dequeue(), _secondQueue.Dequeue());
                    hasResult = true;
                }
                else if (_secondCompleted)
                {
                    complete = true;
                }
            }

            if (hasResult)
            {
                _downstream.OnNext(result);
            }

            if (complete)
            {
                Complete();
            }
        }

        private void FirstCompleted()
        {
            bool complete;
            lock (_gate)
            {
                _firstCompleted = true;
                complete = _firstQueue.Count == 0;
            }

            if (complete)
            {
                Complete();
            }
        }

        private void SecondCompleted()
        {
            bool complete;
            lock (_gate)
            {
                _secondCompleted = true;
                complete = _secondQueue.Count == 0;
            }

            if (complete)
            {
                Complete();
            }
        }

        private void Complete()
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _firstSubscription?.Dispose();
                _secondSubscription?.Dispose();
                _downstream.OnCompleted();
            }
        }

        private void Fault(Exception error)
        {
            if (Interlocked.Exchange(ref _stopped, 1) == 0)
            {
                _firstSubscription?.Dispose();
                _secondSubscription?.Dispose();
                _downstream.OnError(error);
            }
        }

        private sealed class FirstObserver : IObserver<TFirst>
        {
            private readonly ZipSubscription<TFirst, TSecond, TResult> _owner;

            public FirstObserver(ZipSubscription<TFirst, TSecond, TResult> owner) => _owner = owner;

            public void OnNext(TFirst value) => _owner.FirstNext(value);

            public void OnError(Exception error) => _owner.Fault(error);

            public void OnCompleted() => _owner.FirstCompleted();
        }

        private sealed class SecondObserver : IObserver<TSecond>
        {
            private readonly ZipSubscription<TFirst, TSecond, TResult> _owner;

            public SecondObserver(ZipSubscription<TFirst, TSecond, TResult> owner) => _owner = owner;

            public void OnNext(TSecond value) => _owner.SecondNext(value);

            public void OnError(Exception error) => _owner.Fault(error);

            public void OnCompleted() => _owner.SecondCompleted();
        }
    }
}
