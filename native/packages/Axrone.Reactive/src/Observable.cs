namespace Axrone.Reactive;

/// <summary>
/// Cold observable factories: each subscription runs the sequence independently.
/// </summary>
public static partial class Observable
{
    /// <summary>Emits one value, then completes.</summary>
    public static IObservable<T> Return<T>(T value) => new ReturnObservable<T>(value);

    /// <summary>Completes without emitting.</summary>
    public static IObservable<T> Empty<T>() => EmptyObservable<T>.Instance;

    /// <summary>Never emits nor terminates.</summary>
    public static IObservable<T> Never<T>() => NeverObservable<T>.Instance;

    /// <summary>Terminates with the given error.</summary>
    public static IObservable<T> Throw<T>(Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        return new ThrowObservable<T>(error);
    }

    /// <summary>Emits a range, then completes.</summary>
    public static IObservable<int> Range(int start, int count)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 0, nameof(count));
        return new RangeObservable(start, count);
    }

    private sealed class ReturnObservable<T> : IObservable<T>
    {
        private readonly T _value;

        public ReturnObservable(T value) => _value = value;

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            observer.OnNext(_value);
            observer.OnCompleted();
            return NoopDisposable.Instance;
        }
    }

    private sealed class EmptyObservable<T> : IObservable<T>
    {
        public static readonly EmptyObservable<T> Instance = new();

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            observer.OnCompleted();
            return NoopDisposable.Instance;
        }
    }

    private sealed class NeverObservable<T> : IObservable<T>
    {
        public static readonly NeverObservable<T> Instance = new();

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            return NoopDisposable.Instance;
        }
    }

    private sealed class ThrowObservable<T> : IObservable<T>
    {
        private readonly Exception _error;

        public ThrowObservable(Exception error) => _error = error;

        public IDisposable Subscribe(IObserver<T> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            observer.OnError(_error);
            return NoopDisposable.Instance;
        }
    }

    private sealed class RangeObservable : IObservable<int>
    {
        private readonly int _start;
        private readonly int _count;

        public RangeObservable(int start, int count)
        {
            _start = start;
            _count = count;
        }

        public IDisposable Subscribe(IObserver<int> observer)
        {
            ArgumentNullException.ThrowIfNull(observer);
            for (int i = 0; i < _count; i++)
            {
                observer.OnNext(_start + i);
            }

            observer.OnCompleted();
            return NoopDisposable.Instance;
        }
    }

    private sealed class NoopDisposable : IDisposable
    {
        public static readonly NoopDisposable Instance = new();

        public void Dispose()
        {
        }
    }
}
