namespace Axrone.Reactive;

/// <summary>
/// Hot broadcast hub: both observer and observable. Late subscribers see only future values.
/// </summary>
/// <remarks>
/// Allocation audit: one node per subscription; zero per notification. Thread-safe for
/// concurrent publishes with interleaved per-observer delivery, like the base.
/// </remarks>
/// <typeparam name="T">Notification type.</typeparam>
public sealed class Subject<T> : ObservableBase<T>, IObserver<T>
{
    private readonly SubjectOptions _options;

    public Subject()
        : this(SubjectOptions.Default)
    {
    }

    public Subject(in SubjectOptions options)
    {
        _options = options.MaxObservers > 0 ? options.Normalize() : SubjectOptions.Default;
    }

    public override IDisposable Subscribe(IObserver<T> observer, ObservationPriority priority)
    {
        ArgumentNullException.ThrowIfNull(observer);
        if (!IsTerminated && SubscriberCount >= _options.MaxObservers)
        {
            ReactiveThrowHelper.ThrowMaxObserversExceeded(_options.MaxObservers, SubscriberCount);
        }

        return base.Subscribe(observer, priority);
    }

    protected override bool PropagateObserverErrors => _options.ErrorPropagation;

    /// <summary>Publishes to current subscribers; ignored once terminated.</summary>
    public void OnNext(T value) => Publish(value);

    /// <summary>Delivers a terminal fault.</summary>
    public void OnError(Exception error) => Fault(error);

    /// <summary>Delivers completion.</summary>
    public void OnCompleted()
    {
        Complete();
        if (_options.AutoComplete)
        {
            Dispose();
        }
    }
}

internal static class ReactiveThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMaxObserversExceeded(int maxObservers, int currentCount) =>
        throw new MaxObserversExceededError(maxObservers, currentCount);
}
