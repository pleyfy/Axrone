namespace Axrone.Event;

using Axrone.Event.Internal;

/// <summary>
/// Forwards envelopes from a source router or bus to a destination with optional filtering and
/// payload transformation. Backpressure and loop drops are recorded in the destination's
/// dead-letter queue; hop count rides on <see cref="EventMetadata.ForwardCount"/>.
/// </summary>
/// <typeparam name="TSource">Source payload type.</typeparam>
/// <typeparam name="TTarget">Destination payload type.</typeparam>
public sealed class EventForwarder<TSource, TTarget> : IDisposable
{
    private readonly IEventSubscription? _subscription;
    private readonly IForwardTarget<TTarget> _target;
    private readonly Func<TSource, TTarget> _transform;
    private readonly IEventFilter<TSource>? _filter;
    private readonly int _maxHops;

    private long _forwarded;
    private long _filtered;
    private long _loopDropped;
    private long _backpressureDropped;
    private long _failed;
    private int _disposed;

    /// <summary>Forwards router to router.</summary>
    public EventForwarder(
        EventRouter<TSource> source,
        EventRouter<TTarget> target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter = null,
        EventForwardingOptions? options = null)
        : this(
            new RouterSourceAdapter<TSource>(source),
            new RouterForwardTarget<TTarget>(target),
            transform,
            filter,
            options)
    {
    }

    /// <summary>Forwards bus to bus.</summary>
    public EventForwarder(
        EventBus source,
        EventBus target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter = null,
        EventForwardingOptions? options = null)
        : this(
            new BusSourceAdapter<TSource>(source),
            new BusForwardTarget<TTarget>(target),
            transform,
            filter,
            options)
    {
    }

    /// <summary>Forwards bus to router.</summary>
    public EventForwarder(
        EventBus source,
        EventRouter<TTarget> target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter = null,
        EventForwardingOptions? options = null)
        : this(
            new BusSourceAdapter<TSource>(source),
            new RouterForwardTarget<TTarget>(target),
            transform,
            filter,
            options)
    {
    }

    /// <summary>Forwards router to bus.</summary>
    public EventForwarder(
        EventRouter<TSource> source,
        EventBus target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter = null,
        EventForwardingOptions? options = null)
        : this(
            new RouterSourceAdapter<TSource>(source),
            new BusForwardTarget<TTarget>(target),
            transform,
            filter,
            options)
    {
    }

    private EventForwarder(
        IEventSourceAdapter<TSource> source,
        IForwardTarget<TTarget> target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter,
        EventForwardingOptions? options)
    {
        ArgumentNullException.ThrowIfNull(transform);

        EventForwardingOptions resolved = options ?? EventForwardingOptions.Default;
        if (resolved.MaxHops < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxHops must be positive.");
        }

        _target = target;
        _transform = transform;
        _filter = filter;
        _maxHops = resolved.MaxHops;
        _subscription = source.Subscribe(
            (envelope, token) => OnSourceEvent(in envelope, token),
            resolved.Priority);
    }

    /// <summary>Envelopes delivered to the destination.</summary>
    public long ForwardedCount => Interlocked.Read(ref _forwarded);

    /// <summary>Envelopes rejected by the filter.</summary>
    public long FilteredCount => Interlocked.Read(ref _filtered);

    /// <summary>Envelopes dropped after exceeding <see cref="EventForwardingOptions.MaxHops"/>.</summary>
    public long LoopDropCount => Interlocked.Read(ref _loopDropped);

    /// <summary>Envelopes rejected by destination backpressure.</summary>
    public long BackpressureDropCount => Interlocked.Read(ref _backpressureDropped);

    /// <summary>Filter or transform failures.</summary>
    public long FailureCount => Interlocked.Read(ref _failed);

    /// <summary>Stops forwarding by releasing the source subscription.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _subscription?.Dispose();
    }

    private void OnSourceEvent(in EventEnvelope<TSource> envelope, CancellationToken cancellationToken)
    {
        _ = cancellationToken;

        if (Volatile.Read(ref _disposed) != 0)
        {
            return;
        }

        if (_filter is not null)
        {
            bool accepted;
            try
            {
                accepted = _filter.ShouldProcess(in envelope);
            }
            catch (Exception ex)
            {
                _target.DeadLetter(
                    new EventEnvelope<TTarget>(envelope.Metadata, default!),
                    DeadLetterReason.ForwardingFailed,
                    $"Forwarding filter failed: {ex.GetType().Name}: {ex.Message}");
                Interlocked.Increment(ref _failed);
                return;
            }

            if (!accepted)
            {
                Interlocked.Increment(ref _filtered);
                return;
            }
        }

        TTarget payload;
        try
        {
            payload = _transform(envelope.Payload);
        }
        catch (Exception ex)
        {
            _target.DeadLetter(
                new EventEnvelope<TTarget>(envelope.Metadata, default!),
                DeadLetterReason.ForwardingFailed,
                $"Forwarding transform failed: {ex.GetType().Name}: {ex.Message}");
            Interlocked.Increment(ref _failed);
            return;
        }

        EventMetadata metadata = envelope.Metadata;
        if (metadata.ForwardCount >= _maxHops)
        {
            _target.DeadLetter(
                new EventEnvelope<TTarget>(metadata, payload),
                DeadLetterReason.ForwardingLoop,
                $"Forwarding hop limit ({_maxHops}) exceeded.");
            Interlocked.Increment(ref _loopDropped);
            return;
        }

        var forwarded = new EventEnvelope<TTarget>(metadata.WithForwarded(), payload);
        if (_target.TryPublish(in forwarded))
        {
            Interlocked.Increment(ref _forwarded);
        }
        else
        {
            _target.DeadLetter(
                in forwarded,
                DeadLetterReason.ForwardingBackpressure,
                "The destination rejected the forwarded envelope.");
            Interlocked.Increment(ref _backpressureDropped);
        }
    }
}

/// <summary>Identity-payload forwarder between routers or buses of the same event type.</summary>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventForwarder<TEvent> : IDisposable
{
    private readonly EventForwarder<TEvent, TEvent> _inner;

    /// <summary>Forwards router to router.</summary>
    public EventForwarder(
        EventRouter<TEvent> source,
        EventRouter<TEvent> target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null)
        : this(new EventForwarder<TEvent, TEvent>(source, target, static payload => payload, filter, options))
    {
    }

    /// <summary>Forwards bus to bus.</summary>
    public EventForwarder(
        EventBus source,
        EventBus target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null)
        : this(new EventForwarder<TEvent, TEvent>(source, target, static payload => payload, filter, options))
    {
    }

    /// <summary>Forwards bus to router.</summary>
    public EventForwarder(
        EventBus source,
        EventRouter<TEvent> target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null)
        : this(new EventForwarder<TEvent, TEvent>(source, target, static payload => payload, filter, options))
    {
    }

    /// <summary>Forwards router to bus.</summary>
    public EventForwarder(
        EventRouter<TEvent> source,
        EventBus target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null)
        : this(new EventForwarder<TEvent, TEvent>(source, target, static payload => payload, filter, options))
    {
    }

    private EventForwarder(EventForwarder<TEvent, TEvent> inner) => _inner = inner;

    /// <summary>Envelopes delivered to the destination.</summary>
    public long ForwardedCount => _inner.ForwardedCount;

    /// <summary>Envelopes rejected by the filter.</summary>
    public long FilteredCount => _inner.FilteredCount;

    /// <summary>Envelopes dropped after exceeding the hop limit.</summary>
    public long LoopDropCount => _inner.LoopDropCount;

    /// <summary>Envelopes rejected by destination backpressure.</summary>
    public long BackpressureDropCount => _inner.BackpressureDropCount;

    /// <summary>Filter or transform failures.</summary>
    public long FailureCount => _inner.FailureCount;

    /// <summary>Stops forwarding by releasing the source subscription.</summary>
    public void Dispose() => _inner.Dispose();
}
