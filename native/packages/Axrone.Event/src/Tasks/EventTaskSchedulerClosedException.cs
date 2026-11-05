namespace Axrone.Event;

/// <summary>Raised when a task scheduler no longer accepts submissions.</summary>
public sealed class EventTaskSchedulerClosedException : InvalidOperationException
{
    /// <summary>Creates a closed-scheduler failure.</summary>
    public EventTaskSchedulerClosedException()
    {
    }

    /// <summary>Creates a closed-scheduler failure with a message.</summary>
    /// <param name="message">Failure description.</param>
    public EventTaskSchedulerClosedException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a closed-scheduler failure with a message and inner failure.</summary>
    /// <param name="message">Failure description.</param>
    /// <param name="innerException">Underlying failure.</param>
    public EventTaskSchedulerClosedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
