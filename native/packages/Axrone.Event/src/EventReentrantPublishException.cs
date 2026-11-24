namespace Axrone.Event;

/// <summary>
/// Raised when a handler keeps publishing back into the same router beyond
/// <see cref="RouterOptions.MaxReentrantDepth"/>.
/// </summary>
/// <remarks>
/// The router cannot drain the queue while the handler is running, so an unbounded feedback
/// loop is a silent CPU sink. This exception makes the loop visible instead of deferring forever.
/// </remarks>
public sealed class EventReentrantPublishException : InvalidOperationException
{
    /// <summary>Creates a re-entrant-depth failure.</summary>
    public EventReentrantPublishException()
    {
    }

    /// <summary>Creates a re-entrant-depth failure with a message.</summary>
    /// <param name="message">Failure description.</param>
    public EventReentrantPublishException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a re-entrant-depth failure with a message and inner failure.</summary>
    /// <param name="message">Failure description.</param>
    /// <param name="innerException">Underlying failure.</param>
    public EventReentrantPublishException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    internal EventReentrantPublishException(string message, int maxDepth)
        : base(message)
    {
        MaxDepth = maxDepth;
    }

    /// <summary>Configured depth limit that rejected the publish.</summary>
    public int MaxDepth { get; }
}
