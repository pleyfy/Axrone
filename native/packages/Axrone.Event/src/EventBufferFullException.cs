namespace Axrone.Event;

/// <summary>
/// Raised when a paused router's bounded buffer cannot accept another envelope.
/// </summary>
/// <remarks>
/// The blocking publish surface throws this failure instead of dropping work silently; the
/// non-blocking surface reports the same condition by returning false.
/// </remarks>
public sealed class EventBufferFullException : InvalidOperationException
{
    /// <summary>Creates a buffer-full failure.</summary>
    public EventBufferFullException()
    {
    }

    /// <summary>Creates a buffer-full failure with a message.</summary>
    /// <param name="message">Failure description.</param>
    public EventBufferFullException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a buffer-full failure with a message and inner failure.</summary>
    /// <param name="message">Failure description.</param>
    /// <param name="innerException">Underlying failure.</param>
    public EventBufferFullException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    internal EventBufferFullException(string message, Type eventType, int capacity)
        : base(message)
    {
        EventType = eventType;
        Capacity = capacity;
    }

    /// <summary>Event type whose paused buffer rejected the envelope.</summary>
    public Type? EventType { get; }

    /// <summary>Configured capacity of the rejecting buffer.</summary>
    public int Capacity { get; }
}
