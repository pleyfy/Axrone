namespace Axrone.Event.Internal;

using Axrone.Event.Hub;

internal static class ThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEngineTerminated()
    {
        throw new InvalidOperationException("The event router has completed and no longer accepts publishes.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowObjectDisposed(string objectName)
    {
        throw new ObjectDisposedException(objectName);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidOperation(string message) =>
        throw new InvalidOperationException(message);

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentOutOfRange(string paramName, string message)
    {
        throw new ArgumentOutOfRangeException(paramName, message);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static T ThrowArgumentOutOfRange<T>(string paramName)
    {
        throw new ArgumentOutOfRangeException(paramName, "Value provided violates operational constraints.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentOutOfRange(string paramName)
    {
        throw new ArgumentOutOfRangeException(paramName, "Value provided violates operational constraints.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEventCompleted()
    {
        throw new InvalidOperationException("The event engine has entered the completed state.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEventFaulted(Exception? inner)
    {
        throw new InvalidOperationException("The event engine has terminated due to an unrecoverable fault.", inner);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowWaitCapacityExceeded()
    {
        throw new InvalidOperationException("Exceeded maximum pre-allocated concurrent asynchronous waiters.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSubscriberCapacityExceeded()
    {
        throw new InvalidOperationException("Exceeded maximum pre-allocated synchronous subscriber capacity.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidToken()
    {
        throw new ArgumentException("Provided subscription token does not match active registration metadata.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidReadState(ReadStatus status)
    {
        throw new InvalidOperationException($"Attempted to read value from non-successful read status: {status}.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowConcurrencyConflict(long expected, long actual)
    {
        throw new InvalidOperationException($"Optimistic concurrency violation: expected stream version {expected}, found {actual}.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowBufferFull(Type eventType, int capacity)
    {
        throw new EventBufferFullException(
            $"The paused buffer for {eventType.Name} is full ({capacity} slots).",
            eventType,
            capacity);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMaxListenersExceeded(Type eventType, int subscriptionCount, int maxListeners)
    {
        throw new MaxListenersExceededException(
            $"The {eventType.Name} router would exceed its listener bound: {subscriptionCount} registered, {maxListeners} allowed.",
            eventType,
            subscriptionCount,
            maxListeners);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentNegative(string paramName)
    {
        throw new ArgumentOutOfRangeException(paramName, "Value must be non-negative.");
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowQueueFull(EventPriority priority, int capacity)
    {
        throw new EventQueueFullException(
            $"The {priority} event scheduler lane is full ({capacity} slots).",
            priority,
            capacity);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowReentrantDepthExceeded(int maxDepth)
    {
        throw new EventReentrantPublishException(
            $"Re-entrant publish depth exceeded {maxDepth}; a handler is publishing back into the same router.",
            maxDepth);
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowTimerCapacity(EventPriority priority, int capacity)
    {
        throw new EventQueueFullException(
            $"The {priority} timer table is full ({capacity} timers).",
            priority,
            capacity);
    }
}
