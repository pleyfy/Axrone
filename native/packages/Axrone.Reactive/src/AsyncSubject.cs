namespace Axrone.Reactive;

/// <summary>
/// Emits only the final value, and only when completion arrives. Late subscribers after a
/// successful completion receive that value followed by completion; a fault carries no value.
/// Notification stores the latest value without touching subscribers.
/// </summary>
/// <typeparam name="T">Notification type.</typeparam>
public sealed class AsyncSubject<T> : ObservableBase<T>, IObserver<T>
{
    private T _value = default!;
    private bool _hasValue;
    private int _completed;

    public AsyncSubject()
        : this(SubjectOptions.Default)
    {
    }

    public AsyncSubject(in SubjectOptions options)
        : base(options)
    {
    }

    /// <summary>Stores the latest value without emitting it.</summary>
    public void OnNext(T value)
    {
        if (Volatile.Read(ref _completed) != 0 || IsTerminated)
        {
            return;
        }

        _value = value;
        _hasValue = true;
        Thread.MemoryBarrier();
    }

    /// <summary>Delivers a terminal fault; no value is emitted.</summary>
    public void OnError(Exception error)
    {
        if (Interlocked.Exchange(ref _completed, 1) != 0)
        {
            return;
        }

        Fault(error);
    }

    /// <summary>Emits the last value, then completes; completes empty when no value arrived.</summary>
    public void OnCompleted()
    {
        if (Interlocked.Exchange(ref _completed, 1) != 0)
        {
            return;
        }

        if (_hasValue)
        {
            Publish(_value);
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

        if (IsTerminated && !IsFaulted && _hasValue)
        {
            observer.OnNext(_value);
        }

        return base.Subscribe(observer, priority);
    }

    /// <inheritdoc/>
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _completed, 1);
        }

        base.Dispose(disposing);
    }
}
