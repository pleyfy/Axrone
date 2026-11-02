namespace Axrone.Reactive;

/// <summary>
/// Replays the last N values to late subscribers, then forwards future values. The replay
/// buffer is a ring sized at construction; notifications write the ring without allocating.
/// A concurrent publish may interleave with the replay of a new subscriber; values inside
/// the replay retain buffer order.
/// </summary>
/// <typeparam name="T">Notification type.</typeparam>
public sealed class ReplaySubject<T> : ObservableBase<T>, IObserver<T>
{
    private readonly T[] _buffer;
    private readonly Lock _gate = new();
    private int _head;
    private int _count;
    private int _closed;

    /// <summary>Creates a replay subject with a bounded history.</summary>
    /// <param name="bufferSize">Number of values replayed to late subscribers.</param>
    public ReplaySubject(int bufferSize = 10)
        : this(bufferSize, SubjectOptions.Default)
    {
    }

    public ReplaySubject(int bufferSize, in SubjectOptions options)
        : base(options)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(bufferSize, 1, nameof(bufferSize));
        _buffer = new T[bufferSize];
    }

    /// <summary>Gets the replay capacity.</summary>
    public int BufferSize => _buffer.Length;

    /// <summary>Publishes and records a value.</summary>
    public void OnNext(T value)
    {
        lock (_gate)
        {
            if (_closed != 0 || IsTerminated)
            {
                return;
            }

            _buffer[_head] = value;
            _head = (_head + 1) % _buffer.Length;
            if (_count < _buffer.Length)
            {
                _count++;
            }
        }

        Publish(value);
    }

    /// <summary>Delivers a terminal fault.</summary>
    public void OnError(Exception error)
    {
        lock (_gate)
        {
            if (_closed != 0)
            {
                return;
            }

            _closed = 1;
        }

        Fault(error);
    }

    /// <summary>Delivers completion.</summary>
    public void OnCompleted()
    {
        lock (_gate)
        {
            if (_closed != 0)
            {
                return;
            }

            _closed = 1;
        }

        Complete();
    }

    /// <inheritdoc/>
    public override IDisposable Subscribe(IObserver<T> observer) =>
        Subscribe(observer, ObservationPriority.Normal);

    /// <inheritdoc/>
    public override IDisposable Subscribe(IObserver<T> observer, ObservationPriority priority)
    {
        ArgumentNullException.ThrowIfNull(observer);
        T[] replay = Snapshot();

        if (IsTerminated)
        {
            for (int index = 0; index < replay.Length; index++)
            {
                observer.OnNext(replay[index]);
            }

            return base.Subscribe(observer, priority);
        }

        IDisposable subscription = base.Subscribe(observer, priority);
        for (int index = 0; index < replay.Length && !IsTerminated; index++)
        {
            observer.OnNext(replay[index]);
        }

        return subscription;
    }

    private T[] Snapshot()
    {
        lock (_gate)
        {
            if (_count == 0)
            {
                return [];
            }

            var snapshot = new T[_count];
            int start = (_head - _count + _buffer.Length) % _buffer.Length;
            for (int index = 0; index < _count; index++)
            {
                snapshot[index] = _buffer[(start + index) % _buffer.Length];
            }

            return snapshot;
        }
    }

    /// <inheritdoc/>
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            lock (_gate)
            {
                _closed = 1;
            }
        }

        base.Dispose(disposing);
    }
}
