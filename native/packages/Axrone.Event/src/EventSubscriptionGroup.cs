namespace Axrone.Event;

/// <summary>
/// Tracks subscriptions so a subsystem can release them as one unit. Tracking is explicit;
/// disposing the group disposes every tracked handle and is idempotent.
/// </summary>
public sealed class EventSubscriptionGroup : IDisposable, IAsyncDisposable
{
    private readonly List<IEventSubscription> _subscriptions = new();
    private readonly Lock _gate = new();
    private int _disposed;

    /// <summary>Tracked handles, including handles that were already disposed individually.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _subscriptions.Count;
            }
        }
    }

    /// <summary>Adds a handle to the group and returns it for inline use.</summary>
    /// <param name="subscription">Handle to track.</param>
    /// <returns>The same handle.</returns>
    public IEventSubscription Track(IEventSubscription subscription)
    {
        ArgumentNullException.ThrowIfNull(subscription);

        lock (_gate)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                subscription.Dispose();
                ThrowHelper.ThrowObjectDisposed(nameof(EventSubscriptionGroup));
            }

            _subscriptions.Add(subscription);
        }

        return subscription;
    }

    /// <summary>Stops tracking a handle without disposing it.</summary>
    /// <param name="subscription">Handle to remove.</param>
    public bool Remove(IEventSubscription subscription)
    {
        ArgumentNullException.ThrowIfNull(subscription);

        lock (_gate)
        {
            return _subscriptions.Remove(subscription);
        }
    }

    /// <summary>Removes handles that are no longer active.</summary>
    /// <returns>Handles pruned.</returns>
    public int Prune()
    {
        lock (_gate)
        {
            int removed = 0;
            for (int i = _subscriptions.Count - 1; i >= 0; i--)
            {
                if (!_subscriptions[i].IsActive)
                {
                    _subscriptions.RemoveAt(i);
                    removed++;
                }
            }

            return removed;
        }
    }

    /// <summary>Disposes every tracked handle and clears the group.</summary>
    /// <returns>Handles disposed.</returns>
    public int DisposeAll()
    {
        IEventSubscription[] drained;
        lock (_gate)
        {
            if (_subscriptions.Count == 0)
            {
                return 0;
            }

            drained = _subscriptions.ToArray();
            _subscriptions.Clear();
        }

        for (int i = 0; i < drained.Length; i++)
        {
            drained[i].Dispose();
        }

        return drained.Length;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Interlocked.Exchange(ref _disposed, 1);
        _ = DisposeAll();
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        Interlocked.Exchange(ref _disposed, 1);

        IEventSubscription[] drained;
        lock (_gate)
        {
            drained = _subscriptions.ToArray();
            _subscriptions.Clear();
        }

        for (int i = 0; i < drained.Length; i++)
        {
            await drained[i].DisposeAsync().ConfigureAwait(false);
        }
    }
}
