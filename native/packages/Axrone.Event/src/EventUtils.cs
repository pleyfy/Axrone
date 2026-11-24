namespace Axrone.Event;

/// <summary>
/// Deterministic handler combinators. Every combinator allocates its state once at construction;
/// invoking the returned delegate allocates nothing. Time-based combinators read an injected
/// <see cref="TimeProvider"/> so tests stay deterministic.
/// </summary>
public static class EventUtils
{
    /// <summary>Runs the callback only when the payload satisfies the predicate.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="predicate">Payload gate.</param>
    /// <param name="callback">Callback to invoke.</param>
    public static Action<TEvent> Where<TEvent>(Func<TEvent, bool> predicate, Action<TEvent> callback)
    {
        ArgumentNullException.ThrowIfNull(predicate);
        ArgumentNullException.ThrowIfNull(callback);

        return message =>
        {
            if (predicate(message))
            {
                callback(message);
            }
        };
    }

    /// <summary>Transforms the payload before invoking the callback.</summary>
    /// <typeparam name="TSource">Incoming payload type.</typeparam>
    /// <typeparam name="TTarget">Transformed payload type.</typeparam>
    /// <param name="transform">Payload transform.</param>
    /// <param name="callback">Callback to invoke.</param>
    public static Action<TSource> Select<TSource, TTarget>(
        Func<TSource, TTarget> transform,
        Action<TTarget> callback)
    {
        ArgumentNullException.ThrowIfNull(transform);
        ArgumentNullException.ThrowIfNull(callback);

        return message => callback(transform(message));
    }

    /// <summary>Routes callback failures to a handler instead of propagating them.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="callback">Callback to guard.</param>
    /// <param name="errorHandler">Failure sink.</param>
    public static Action<TEvent> CatchErrors<TEvent>(
        Action<TEvent> callback,
        Action<Exception, TEvent> errorHandler)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ArgumentNullException.ThrowIfNull(errorHandler);

        return message =>
        {
            try
            {
                callback(message);
            }
            catch (Exception ex)
            {
                errorHandler(ex, message);
            }
        };
    }

    /// <summary>Suppresses invocations that arrive sooner than the interval.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="callback">Callback to gate.</param>
    /// <param name="interval">Minimum spacing; zero disables gating.</param>
    /// <param name="timeProvider">Clock to read; defaults to <see cref="TimeProvider.System"/>.</param>
    public static Action<TEvent> Throttle<TEvent>(
        Action<TEvent> callback,
        TimeSpan interval,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(callback);

        TimeProvider clock = timeProvider ?? TimeProvider.System;
        long intervalTicks = interval > TimeSpan.Zero ? interval.Ticks : 0;
        if (intervalTicks == 0)
        {
            return callback;
        }

        var gate = new Lock();
        long lastTimestamp = long.MinValue;

        return message =>
        {
            lock (gate)
            {
                long now = clock.GetTimestamp();
                if (lastTimestamp != long.MinValue &&
                    clock.GetElapsedTime(lastTimestamp, now).Ticks < intervalTicks)
                {
                    return;
                }

                lastTimestamp = now;
            }

            callback(message);
        };
    }

    /// <summary>Allows at most a fixed number of invocations inside a sliding window.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="callback">Callback to gate.</param>
    /// <param name="maxCalls">Invocations allowed inside the window; must be positive.</param>
    /// <param name="window">Sliding window; zero or negative disables gating.</param>
    /// <param name="timeProvider">Clock to read; defaults to <see cref="TimeProvider.System"/>.</param>
    public static Action<TEvent> RateLimit<TEvent>(
        Action<TEvent> callback,
        int maxCalls,
        TimeSpan window,
        TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(callback);
        if (maxCalls < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(maxCalls), "maxCalls must be positive.");
        }

        TimeProvider clock = timeProvider ?? TimeProvider.System;
        long windowTicks = window > TimeSpan.Zero ? window.Ticks : 0;
        if (windowTicks == 0)
        {
            return callback;
        }

        var gate = new Lock();
        var timestamps = new long[maxCalls];
        int head = 0;
        int count = 0;

        return message =>
        {
            lock (gate)
            {
                long now = clock.GetTimestamp();
                while (count > 0 && clock.GetElapsedTime(timestamps[head], now).Ticks >= windowTicks)
                {
                    head = (head + 1) % maxCalls;
                    count--;
                }

                if (count == maxCalls)
                {
                    return;
                }

                timestamps[(head + count) % maxCalls] = now;
                count++;
            }

            callback(message);
        };
    }

    /// <summary>Adapts a payload callback to a router handler; the token is observed and ignored.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="callback">Payload callback.</param>
    public static Action<EventEnvelope<TEvent>, CancellationToken> AsHandler<TEvent>(Action<TEvent> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return (envelope, _) => callback(envelope.Payload);
    }

    /// <summary>Wraps a payload callback in a completed-value-task handler.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="callback">Payload callback.</param>
    public static Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> ToAsync<TEvent>(Action<TEvent> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return (envelope, _) =>
        {
            callback(envelope.Payload);
            return ValueTask.CompletedTask;
        };
    }
}
