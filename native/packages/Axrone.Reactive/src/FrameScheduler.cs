namespace Axrone.Reactive;

/// <summary>
/// Schedules reactive work against an explicit clock. Implementations decide where the action
/// runs; <see cref="FrameScheduler"/> runs it on the thread that advances the frame, so time-based
/// operators can stay deterministic and free of OS timers.
/// </summary>
public interface IReactiveScheduler
{
    /// <summary>Monotonic time elapsed since the scheduler started.</summary>
    TimeSpan Now { get; }

    /// <summary>Schedules one action to run when <paramref name="dueTime"/> has elapsed.</summary>
    IDisposable Schedule(Action action, TimeSpan dueTime);

    /// <summary>Schedules a repeating action; the first run is one <paramref name="period"/> away.</summary>
    IDisposable SchedulePeriodic(Action action, TimeSpan period);
}

/// <summary>
/// Frame-driven scheduler. Time only moves when the owner calls <see cref="Advance"/>; no OS
/// timer or background thread is created. Due work is executed on the advancing thread in
/// (due, schedule sequence) order, and actions may schedule or cancel more work re-entrantly.
/// </summary>
/// <remarks>
/// <para>A zero or negative due time means "next advance", never "inline". This keeps dispatch
/// deterministic: nothing runs between frame boundaries.</para>
/// <para>A cancelled or disposed work item stays in the queue until its due time and is then
/// skipped. <see cref="Dispose"/> clears the queue, so a disposed scheduler retains nothing.</para>
/// <para>Action exceptions propagate to the <see cref="Advance"/> caller; a periodic action is
/// rescheduled in a <c>finally</c> so one faulting tick does not silently stop the timer.</para>
/// </remarks>
public sealed class FrameScheduler : IReactiveScheduler, IDisposable
{
    private readonly PriorityQueue<Work, (long DueTicks, long Sequence)> _queue = new();
    private readonly Lock _gate = new();
    private long _nowTicks;
    private long _sequence;
    private int _disposed;

    /// <inheritdoc/>
    public TimeSpan Now
    {
        get
        {
            lock (_gate)
            {
                return TimeSpan.FromTicks(_nowTicks);
            }
        }
    }

    /// <summary>Items still waiting; includes cancelled items until their due time.</summary>
    public int PendingCount
    {
        get
        {
            lock (_gate)
            {
                return _queue.Count;
            }
        }
    }

    /// <inheritdoc/>
    public IDisposable Schedule(Action action, TimeSpan dueTime)
    {
        ArgumentNullException.ThrowIfNull(action);
        return Enqueue(action, dueTime, period: TimeSpan.Zero);
    }

    /// <inheritdoc/>
    public IDisposable SchedulePeriodic(Action action, TimeSpan period)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (period <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(period), period, "Period must be positive.");
        }

        return Enqueue(action, period, period);
    }

    /// <summary>
    /// Advances the clock and runs every action whose due time has been reached.
    /// </summary>
    /// <param name="delta">Elapsed frame time; must not be negative.</param>
    /// <returns>Actions executed during this advance.</returns>
    [SuppressMessage(
        "Reliability",
        "CA2000:Dispose objects before losing scope",
        Justification = "Dequeued work is owned by its returned handle and the scheduler queue, not by Advance.")]
    public int Advance(TimeSpan delta)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (delta < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(delta), delta, "Delta must not be negative.");
        }

        long now;
        lock (_gate)
        {
            _nowTicks += delta.Ticks;
            now = _nowTicks;
        }

        int executed = 0;
        while (true)
        {
            Work work;
            lock (_gate)
            {
                if (!_queue.TryPeek(out Work? head, out (long DueTicks, long Sequence) priority) ||
                    priority.DueTicks > now)
                {
                    break;
                }

                _queue.Dequeue();
                work = head;
            }

            if (Volatile.Read(ref work.Cancelled) != 0)
            {
                continue;
            }

            Action? action = Volatile.Read(ref work.Action);
            if (action is null)
            {
                continue;
            }

            try
            {
                action();
                executed++;
            }
            finally
            {
                if (work.PeriodTicks > 0 && Volatile.Read(ref work.Cancelled) == 0)
                {
                    Reschedule(work);
                }
            }
        }

        return executed;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        lock (_gate)
        {
            while (_queue.TryDequeue(out Work? work, out _))
            {
                Volatile.Write(ref work.Action, null);
            }
        }
    }

    private Work Enqueue(Action action, TimeSpan dueTime, TimeSpan period)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

        long dueTicks = Math.Max(0, dueTime.Ticks);
        var work = new Work(action, period.Ticks);

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            work.DueTicks = _nowTicks + dueTicks;
            long sequence = ++_sequence;
            _queue.Enqueue(work, (work.DueTicks, sequence));
        }

        return work;
    }

    private void Reschedule(Work work)
    {
        lock (_gate)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            work.DueTicks += work.PeriodTicks;
            long sequence = ++_sequence;
            _queue.Enqueue(work, (work.DueTicks, sequence));
        }
    }

    private sealed class Work : IDisposable
    {
        internal Action? Action;
        internal long DueTicks;
        internal long PeriodTicks;
        internal int Cancelled;

        public Work(Action action, long periodTicks)
        {
            Action = action;
            PeriodTicks = periodTicks;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref Cancelled, 1) == 0)
            {
                Volatile.Write(ref Action, null);
            }
        }
    }
}
