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
    public Subject()
        : this(SubjectOptions.Default)
    {
    }

    public Subject(in SubjectOptions options)
        : base(options)
    {
    }

    /// <summary>Publishes to current subscribers; ignored once terminated.</summary>
    public void OnNext(T value) => Publish(value);

    /// <summary>Delivers a terminal fault.</summary>
    public void OnError(Exception error) => Fault(error);

    /// <summary>Delivers completion.</summary>
    public void OnCompleted() => Complete();
}
