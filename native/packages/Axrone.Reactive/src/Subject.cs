namespace Axrone.Reactive;

/// <summary>
/// Hot broadcast hub: both observer and observable. Late subscribers see only future values.
/// </summary>
/// <remarks>
/// Backed by the shared <see cref="ObservableBase{T}"/> engine: subscription is an O(1) slot
/// claim, publish walks the active slots in priority and registration order, and disposing a
/// subscription from inside a callback is safe because reclamation is deferred to the last pin
/// release.
/// </remarks>
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
