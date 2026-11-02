namespace Axrone.Event;

/// <summary>
/// Merges several same-type routers into one destination. Each source gets an independent
/// <see cref="EventForwarder{TEvent}"/>, so hop limits, backpressure, and dead letters keep
/// working per source.
/// </summary>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventFanIn<TEvent> : IDisposable
{
    private readonly EventForwarder<TEvent>[] _forwarders;
    private int _disposed;

    /// <summary>Fans router sources into a router destination.</summary>
    /// <param name="target">Destination router.</param>
    /// <param name="sources">Source routers.</param>
    public EventFanIn(EventRouter<TEvent> target, params EventRouter<TEvent>[] sources)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(sources);

        _forwarders = new EventForwarder<TEvent>[sources.Length];
        for (int i = 0; i < sources.Length; i++)
        {
            _forwarders[i] = new EventForwarder<TEvent>(sources[i], target);
        }
    }

    /// <summary>Fans bus sources into a bus destination.</summary>
    /// <param name="target">Destination bus.</param>
    /// <param name="sources">Source buses.</param>
    public EventFanIn(EventBus target, params EventBus[] sources)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(sources);

        _forwarders = new EventForwarder<TEvent>[sources.Length];
        for (int i = 0; i < sources.Length; i++)
        {
            _forwarders[i] = new EventForwarder<TEvent>(sources[i], target);
        }
    }

    /// <summary>Forwarders owned by the fan-in.</summary>
    public int Count => _forwarders.Length;

    /// <summary>Envelopes delivered to the destination across every source.</summary>
    public long ForwardedCount
    {
        get
        {
            long total = 0;
            for (int i = 0; i < _forwarders.Length; i++)
            {
                total += _forwarders[i].ForwardedCount;
            }

            return total;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        for (int i = 0; i < _forwarders.Length; i++)
        {
            _forwarders[i].Dispose();
        }
    }
}
