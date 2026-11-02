namespace Axrone.Reactive.Tests;

internal sealed class TestObserver<T> : IObserver<T>
{
    private readonly Lock _gate = new();
    private readonly List<T> _values = new();
    private Exception? _error;

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

    public bool Completed { get; private set; }

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

    public void OnCompleted() => Completed = true;
}
