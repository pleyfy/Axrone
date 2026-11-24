namespace Axrone.Event;

/// <summary>Outcome of a non-blocking publish attempt.</summary>
public enum EventPublishStatus
{
    /// <summary>Enqueued in the transport.</summary>
    Accepted = 0,

    /// <summary>Held in the pause buffer until <c>Resume</c>/<c>Flush</c>.</summary>
    Buffered = 1,

    /// <summary>Rejected by a publish-gate filter; not delivered and not retried.</summary>
    Filtered = 2,

    /// <summary>Transport or pause buffer is full; retry later.</summary>
    Backpressured = 3,

    /// <summary>Router is completing, terminated or faulted; the payload was not accepted.</summary>
    NotRunning = 4,
}

/// <summary>
/// Result of <see cref="EventRouter{TEvent}.TryPublishWithResult"/> and the bus
/// facade. Lets a producer distinguish backpressure from an intentional filter.
/// </summary>
public readonly record struct EventPublishResult(EventPublishStatus Status)
{
    /// <summary>Whether the payload was accepted (delivered or buffered).</summary>
    public bool IsAccepted => Status is EventPublishStatus.Accepted or EventPublishStatus.Buffered;

    /// <summary>Whether a filter intentionally discarded the payload.</summary>
    public bool IsFiltered => Status is EventPublishStatus.Filtered;

    /// <summary>Whether the caller should retry when the transport drains.</summary>
    public bool ShouldRetry => Status is EventPublishStatus.Backpressured;
}
