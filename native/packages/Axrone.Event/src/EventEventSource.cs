namespace Axrone.Event;

using System.Diagnostics.Tracing;

/// <summary>
/// Structured diagnostics for event routers.
/// </summary>
/// <remarks>
/// Cold paths only — fault and lifecycle transitions. Dispatch and dead letters are counted in
/// <see cref="EventTelemetry"/>, not traced. Follows the house pattern in
/// <c>Axrone.Batching</c>.
/// </remarks>
[EventSource(Name = "Axrone-Event")]
public sealed class EventEventSource : EventSource
{
    /// <summary>Shared instance.</summary>
    public static readonly EventEventSource Log = new();

    private EventEventSource()
        : base(EventSourceSettings.EtwSelfDescribingEventFormat)
    {
    }

    /// <summary>Terminal fault captured.</summary>
    [Event(1, Level = EventLevel.Error)]
    public void FaultOccurred(string exceptionType, string message)
    {
        if (IsEnabled())
        {
            WriteEvent(1, exceptionType ?? string.Empty, message ?? string.Empty);
        }
    }

    /// <summary>Lifecycle state changed.</summary>
    [Event(2, Level = EventLevel.Informational)]
    public void StateTransition(int oldState, int newState)
    {
        if (IsEnabled())
        {
            WriteEvent(2, oldState, newState);
        }
    }

    /// <summary>Subscription bound exceeded while the policy is warn.</summary>
    [Event(3, Level = EventLevel.Warning)]
    public void MaxListenersExceeded(string eventType, int subscriptionCount, int maxListeners)
    {
        if (IsEnabled())
        {
            WriteEvent(3, eventType ?? string.Empty, subscriptionCount, maxListeners);
        }
    }
}
