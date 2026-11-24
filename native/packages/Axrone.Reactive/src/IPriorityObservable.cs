namespace Axrone.Reactive;

/// <summary>
/// An observable that can order its observers by <see cref="ObservationPriority"/> instead of
/// plain registration order.
/// </summary>
public interface IPriorityObservable<T> : IObservable<T>
{
    IDisposable Subscribe(IObserver<T> observer, ObservationPriority priority);
}
