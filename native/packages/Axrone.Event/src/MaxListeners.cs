namespace Axrone.Event;

/// <summary>Reaction when a router exceeds its configured subscription bound.</summary>
public enum MaxListenersPolicy
{
    /// <summary>Retain the subscription, raise <see cref="EventRouter{TEvent}.MaxListenersExceeded"/>, and log a warning event.</summary>
    Warn = 0,

    /// <summary>Reject the subscription with <see cref="MaxListenersExceededException"/>.</summary>
    Throw = 1
}

/// <summary>Typed warning payload raised when a subscription is registered past the bound.</summary>
public sealed class MaxListenersExceededEventArgs : EventArgs
{
    /// <summary>Creates a warning payload.</summary>
    /// <param name="eventType">Event type whose router exceeded the bound.</param>
    /// <param name="subscriptionCount">Subscriptions registered on the router after the addition.</param>
    /// <param name="maxListeners">Configured bound.</param>
    public MaxListenersExceededEventArgs(Type eventType, int subscriptionCount, int maxListeners)
    {
        EventType = eventType;
        SubscriptionCount = subscriptionCount;
        MaxListeners = maxListeners;
    }

    /// <summary>Event type whose router exceeded the bound.</summary>
    public Type EventType { get; }

    /// <summary>Subscriptions registered on the router after the addition.</summary>
    public int SubscriptionCount { get; }

    /// <summary>Configured bound.</summary>
    public int MaxListeners { get; }
}

/// <summary>Raised when <see cref="MaxListenersPolicy.Throw"/> rejects a subscription past the bound.</summary>
public sealed class MaxListenersExceededException : InvalidOperationException
{
    /// <summary>Creates a max-listeners failure.</summary>
    public MaxListenersExceededException()
    {
    }

    /// <summary>Creates a max-listeners failure with a message.</summary>
    /// <param name="message">Failure description.</param>
    public MaxListenersExceededException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a max-listeners failure with a message and inner failure.</summary>
    /// <param name="message">Failure description.</param>
    /// <param name="innerException">Underlying failure.</param>
    public MaxListenersExceededException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    internal MaxListenersExceededException(string message, Type eventType, int subscriptionCount, int maxListeners)
        : base(message)
    {
        EventType = eventType;
        SubscriptionCount = subscriptionCount;
        MaxListeners = maxListeners;
    }

    /// <summary>Event type whose router rejected the subscription.</summary>
    public Type? EventType { get; }

    /// <summary>Subscription count that would have been reached.</summary>
    public int SubscriptionCount { get; }

    /// <summary>Configured bound.</summary>
    public int MaxListeners { get; }
}
