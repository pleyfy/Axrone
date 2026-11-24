namespace Axrone.Event;

/// <summary>Handle to an active subscription; disposing unsubscribes.</summary>
/// <remarks>
/// Pausing does not unregister: <see cref="IDisposable.Dispose"/> must still remove the
/// subscription from the owning router after a pause, and must be idempotent.
/// </remarks>
public interface IEventSubscription : IDisposable, IAsyncDisposable
{
    /// <summary>Stable identity of this subscription.</summary>
    Guid SubscriptionId { get; }

    /// <summary>Whether dispatch currently delivers to this subscription.</summary>
    bool IsActive { get; }

    /// <summary>Whether delivery is temporarily suspended without unsubscribing.</summary>
    bool IsPaused { get; }

    /// <summary>Stops delivery without unsubscribing.</summary>
    void Pause();

    /// <summary>Resumes delivery after <see cref="Pause"/>.</summary>
    void Resume();
}
