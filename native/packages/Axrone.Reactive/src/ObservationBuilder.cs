namespace Axrone.Reactive;

public readonly record struct ObservationBuilder<T>
{
    private readonly IObservable<T> _source;
    private readonly ObservationOptions _options;
    private readonly TimeProvider? _timeProvider;

    public ObservationBuilder(
        IObservable<T> source,
        in ObservationOptions options = default,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        _source = source;
        _options = ResolveOptions(in options);
        _timeProvider = timeProvider;
    }

    public ObservationBuilder<T> Filter(Func<T, bool> predicate)
    {
        ArgumentNullException.ThrowIfNull(predicate);
        return new ObservationBuilder<T>(_source.Where(WrapFilter(predicate)), _options, _timeProvider);
    }

    public ObservationBuilder<TResult> Transform<TResult>(Func<T, TResult> selector)
    {
        ArgumentNullException.ThrowIfNull(selector);
        return new ObservationBuilder<TResult>(_source.Select(WrapTransform(selector)), _options, _timeProvider);
    }

    public ObservationBuilder<T> Once() => new(_source, WithOnce(in _options), _timeProvider);

    public ObservationBuilder<T> Debounce(int milliseconds) =>
        new(_source, WithDebounce(in _options, milliseconds), _timeProvider);

    public ObservationBuilder<T> Throttle(int milliseconds) =>
        new(_source, WithThrottle(in _options, milliseconds), _timeProvider);

    public ObservationBuilder<T> Replay(int bufferSize)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(bufferSize, 1, nameof(bufferSize));
        return new ObservationBuilder<T>(
            new ReplayObservable<T>(_source, bufferSize),
            _options,
            _timeProvider);
    }

    public ObservationBuilder<T> WeakReference() =>
        new(_source, WithWeakReference(in _options), _timeProvider);

    public ObservationBuilder<T> ErrorHandling(ObservationErrorHandling handling, Action<Exception>? onError = null) =>
        new(_source, WithErrorHandling(in _options, handling, onError), _timeProvider);

    public ObservationBuilder<T[]> Buffer(int count, int flushIntervalMs = 1000)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1, nameof(count));
        ArgumentOutOfRangeException.ThrowIfNegative(flushIntervalMs, nameof(flushIntervalMs));
        IObservable<T[]> source = flushIntervalMs == 0
            ? _source.Buffer(count)
            : _source.Buffer(count, TimeSpan.FromMilliseconds(flushIntervalMs), _timeProvider);
        return new ObservationBuilder<T[]>(source, _options, _timeProvider);
    }

    public ObservationBuilder<T> Take(int count) => new(_source.Take(count), _options, _timeProvider);

    public ObservationBuilder<T> Skip(int count) => new(_source.Skip(count), _options, _timeProvider);

    public IDisposable Subscribe(IObserver<T> observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        IObservable<T> source = _source;
        if (_options.DebounceMs > 0)
        {
            source = source.Debounce(TimeSpan.FromMilliseconds(_options.DebounceMs), _timeProvider);
        }

        if (_options.ThrottleMs > 0)
        {
            source = source.Throttle(TimeSpan.FromMilliseconds(_options.ThrottleMs), _timeProvider);
        }

        var wrapper = new ObservationObserver<T>(observer, in _options);
        IDisposable upstream = source is IPriorityObservable<T> observable
            ? observable.Subscribe(wrapper, _options.Priority)
            : source.Subscribe(wrapper);
        wrapper.Attach(upstream);
        return wrapper;
    }

    public IDisposable Subscribe(Action<T> onNext, Action<Exception>? onError = null, Action? onCompleted = null)
    {
        ArgumentNullException.ThrowIfNull(onNext);
        return Subscribe(new ActionObserver<T>(onNext, onError, onCompleted));
    }

    private static ObservationOptions ResolveOptions(in ObservationOptions options) =>
        options == default ? ObservationOptions.Default : options.Normalize();

    private static Func<T, bool> WrapFilter(Func<T, bool> predicate) => value =>
    {
        try
        {
            return predicate(value);
        }
        catch (Exception error)
        {
            throw new FilterError(error);
        }
    };

    private static Func<T, TResult> WrapTransform<TResult>(Func<T, TResult> selector) => value =>
    {
        try
        {
            return selector(value);
        }
        catch (Exception error)
        {
            throw new TransformError(value, error);
        }
    };

    private static ObservationOptions WithOnce(in ObservationOptions options) => new(
        options.Priority,
        true,
        options.DebounceMs,
        options.ThrottleMs,
        options.Buffering,
        options.Replay,
        options.WeakReference,
        options.ErrorHandling,
        options.OnError);

    private static ObservationOptions WithWeakReference(in ObservationOptions options) => new(
        options.Priority,
        options.Once,
        options.DebounceMs,
        options.ThrottleMs,
        options.Buffering,
        options.Replay,
        true,
        options.ErrorHandling,
        options.OnError);

    private static ObservationOptions WithDebounce(in ObservationOptions options, int milliseconds) => new(
        options.Priority,
        options.Once,
        Math.Max(0, milliseconds),
        options.ThrottleMs,
        options.Buffering,
        options.Replay,
        options.WeakReference,
        options.ErrorHandling,
        options.OnError);

    private static ObservationOptions WithThrottle(in ObservationOptions options, int milliseconds) => new(
        options.Priority,
        options.Once,
        options.DebounceMs,
        Math.Max(0, milliseconds),
        options.Buffering,
        options.Replay,
        options.WeakReference,
        options.ErrorHandling,
        options.OnError);

    private static ObservationOptions WithErrorHandling(
        in ObservationOptions options,
        ObservationErrorHandling handling,
        Action<Exception>? onError) => new(
        options.Priority,
        options.Once,
        options.DebounceMs,
        options.ThrottleMs,
        options.Buffering,
        options.Replay,
        options.WeakReference,
        handling,
        onError ?? options.OnError);
}

public static class ObservationBuilderExtensions
{
    public static ObservationBuilder<T> Observe<T>(this IObservable<T> source) => new(source);

    public static ObservationBuilder<T> Observe<T>(this IObservable<T> source, in ObservationOptions options) =>
        new(source, in options);

    public static ObservationBuilder<T> Observe<T>(
        this IObservable<T> source,
        in ObservationOptions options,
        TimeProvider timeProvider) => new(source, in options, timeProvider);
}

internal sealed class ActionObserver<T> : IObserver<T>
{
    private readonly Action<T> _onNext;
    private readonly Action<Exception>? _onError;
    private readonly Action? _onCompleted;

    public ActionObserver(Action<T> onNext, Action<Exception>? onError = null, Action? onCompleted = null)
    {
        _onNext = onNext;
        _onError = onError;
        _onCompleted = onCompleted;
    }

    public void OnNext(T value) => _onNext(value);

    public void OnError(Exception error) => _onError?.Invoke(error);

    public void OnCompleted() => _onCompleted?.Invoke();
}

internal sealed class ObservationObserver<T> : IObserver<T>, IDisposable
{
    private readonly IObserver<T>? _downstream;
    private readonly WeakReference<IObserver<T>>? _weak;
    private readonly bool _once;
    private readonly ObservationErrorHandling _handling;
    private readonly Action<Exception>? _onError;
    private IDisposable? _upstream;
    private int _disposed;

    public ObservationObserver(IObserver<T> observer, in ObservationOptions options)
    {
        if (options.WeakReference)
        {
            _weak = new WeakReference<IObserver<T>>(observer);
        }
        else
        {
            _downstream = observer;
        }

        _once = options.Once;
        _handling = options.ErrorHandling;
        _onError = options.OnError;
    }

    public void Attach(IDisposable upstream)
    {
        _upstream = upstream;
        if (Volatile.Read(ref _disposed) != 0)
        {
            upstream.Dispose();
        }
    }

    public void OnNext(T value)
    {
        if (Volatile.Read(ref _disposed) != 0 || !TryGetTarget(out IObserver<T>? target))
        {
            return;
        }

        try
        {
            target!.OnNext(value);
        }
        catch (Exception error)
        {
            Handle(error, value);
            return;
        }

        if (_once)
        {
            Dispose();
        }
    }

    public void OnError(Exception error)
    {
        if (Volatile.Read(ref _disposed) != 0 || !TryGetTarget(out IObserver<T>? target))
        {
            return;
        }

        try
        {
            target!.OnError(error);
        }
        catch (Exception downstreamError)
        {
            Handle(downstreamError, error);
        }
    }

    public void OnCompleted()
    {
        if (Volatile.Read(ref _disposed) != 0 || !TryGetTarget(out IObserver<T>? target))
        {
            return;
        }

        try
        {
            target!.OnCompleted();
        }
        catch (Exception error)
        {
            Handle(error, null);
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _upstream?.Dispose();
        }
    }

    private bool TryGetTarget(out IObserver<T>? target)
    {
        if (_weak is null)
        {
            target = _downstream;
            return true;
        }

        return _weak.TryGetTarget(out target);
    }

    private void Handle(Exception error, object? value)
    {
        _ = value;
        switch (_handling)
        {
            case ObservationErrorHandling.Silent:
                return;
            case ObservationErrorHandling.Callback:
                _onError?.Invoke(error);
                return;
            default:
                throw new ObserverExecutionError(0, value, error);
        }
    }
}

[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable", Justification = "The replay subject lifetime is owned by the active subscriptions.")]
internal sealed class ReplayObservable<T> : IObservable<T>
{
    private readonly IObservable<T> _source;
    private readonly ReplaySubject<T> _subject;
    private readonly Lock _gate = new();
    private IDisposable? _upstream;
    private int _subscribers;

    public ReplayObservable(IObservable<T> source, int bufferSize)
    {
        _source = source;
        _subject = new ReplaySubject<T>(bufferSize);
    }

    public IDisposable Subscribe(IObserver<T> observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        lock (_gate)
        {
            if (_upstream is null)
            {
                _upstream = _source.Subscribe(new Forwarder(_subject));
            }

            _subscribers++;
        }

        IDisposable inner = _subject.Subscribe(observer);
        return new ActionDisposable(() =>
        {
            inner.Dispose();
            Release();
        });
    }

    private void Release()
    {
        lock (_gate)
        {
            if (--_subscribers > 0)
            {
                return;
            }

            _upstream?.Dispose();
            _upstream = null;
        }
    }

    private sealed class Forwarder : IObserver<T>
    {
        private readonly ReplaySubject<T> _subject;

        public Forwarder(ReplaySubject<T> subject) => _subject = subject;

        public void OnNext(T value) => _subject.OnNext(value);

        public void OnError(Exception error) => _subject.OnError(error);

        public void OnCompleted() => _subject.OnCompleted();
    }
}
