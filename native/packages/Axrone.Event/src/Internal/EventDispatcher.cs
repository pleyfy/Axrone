namespace Axrone.Event.Internal;

/// <summary>
/// Single dispatch worker shared by every router that belongs to the same owner (one per
/// <see cref="EventBus"/>, plus one process-wide instance for standalone routers). Producers only
/// enqueue and signal; the worker visits each registered router in rotating order and drains at
/// most one batch per router per pass, so a hot queue cannot starve its neighbours.
/// </summary>
/// <remarks>
/// The worker parks on a reset event with a signal counter, so a signal racing the park is never
/// lost. Signals are reference-counted for the duration of the set, allowing the event to be
/// disposed deterministically after the worker has exited without racing producers.
/// </remarks>
internal sealed class EventDispatcher : IDisposable, IAsyncDisposable
{
    private static readonly Entry[] Empty = [];

    private readonly Lock _gate = new();
    private readonly ManualResetEventSlim _wake = new(false);
    private readonly Task _worker;
    private Entry[] _entries = Empty;
    private int _cursor;
    private int _workerStarts;
    private int _disposed;
    private int _signalers;
    private long _signals;

    /// <summary>Creates a dispatcher and starts its worker thread.</summary>
    public EventDispatcher()
    {
        _worker = Task.Factory.StartNew(
            WorkerLoop,
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
        _workerStarts = 1;
    }

    /// <summary>Process-wide dispatcher for routers that are not owned by an <see cref="EventBus"/>.</summary>
    public static EventDispatcher Shared { get; } = new();

    /// <summary>Number of worker threads this dispatcher started (always one).</summary>
    public int WorkerStartCount => Volatile.Read(ref _workerStarts);

    /// <summary>Routers currently registered for dispatch.</summary>
    public int RegisteredRouterCount => Volatile.Read(ref _entries).Length;

    /// <summary>Registers a router and its one-batch drain callback.</summary>
    public void Register(object owner, Func<bool> drainOneBatch)
    {
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentNullException.ThrowIfNull(drainOneBatch);

        lock (_gate)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                ThrowHelper.ThrowObjectDisposed(nameof(EventDispatcher));
            }

            Entry[] current = _entries;
            var next = new Entry[current.Length + 1];
            Array.Copy(current, next, current.Length);
            next[^1] = new Entry(owner, drainOneBatch);
            Volatile.Write(ref _entries, next);
        }

        Signal();
    }

    /// <summary>Removes a router from dispatch.</summary>
    public void Unregister(object owner)
    {
        lock (_gate)
        {
            Entry[] current = _entries;
            int index = -1;
            for (int i = 0; i < current.Length; i++)
            {
                if (ReferenceEquals(current[i].Owner, owner))
                {
                    index = i;
                    break;
                }
            }

            if (index < 0)
            {
                return;
            }

            if (current.Length == 1)
            {
                Volatile.Write(ref _entries, Empty);
                return;
            }

            var next = new Entry[current.Length - 1];
            Array.Copy(current, 0, next, 0, index);
            Array.Copy(current, index + 1, next, index, current.Length - index - 1);
            Volatile.Write(ref _entries, next);
        }
    }

    /// <summary>Reports new work and wakes the worker. Allocation-free.</summary>
    public void Signal()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            return;
        }

        Interlocked.Increment(ref _signalers);
        try
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            Interlocked.Increment(ref _signals);
            _wake.Set();
        }
        finally
        {
            Interlocked.Decrement(ref _signalers);
        }
    }

    private void WorkerLoop()
    {
        long consumed = 0;
        while (true)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            bool worked = false;
            Entry[] entries = Volatile.Read(ref _entries);
            int length = entries.Length;
            if (length > 0)
            {
                int cursor = Interlocked.Increment(ref _cursor);
                int start = (int)((uint)cursor % (uint)length);
                for (int n = 0; n < length; n++)
                {
                    if (Volatile.Read(ref _disposed) != 0)
                    {
                        return;
                    }

                    int index = start + n;
                    if (index >= length)
                    {
                        index -= length;
                    }

                    if (entries[index].Drain())
                    {
                        worked = true;
                    }
                }
            }

            if (worked)
            {
                consumed = Volatile.Read(ref _signals);
                continue;
            }

            _wake.Reset();
            long signaled = Volatile.Read(ref _signals);
            if (signaled != consumed)
            {
                consumed = signaled;
                continue;
            }

            if (Volatile.Read(ref _disposed) != 0)
            {
                return;
            }

            _wake.Wait();
            consumed = Volatile.Read(ref _signals);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _wake.Set();
        _worker.GetAwaiter().GetResult();
        WaitForSignalers();
        _wake.Dispose();
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _wake.Set();
        await _worker.ConfigureAwait(false);
        WaitForSignalers();
        _wake.Dispose();
    }

    private void WaitForSignalers()
    {
        var spin = new SpinWait();
        while (Volatile.Read(ref _signalers) != 0)
        {
            spin.SpinOnce();
        }
    }

    private readonly struct Entry
    {
        public Entry(object owner, Func<bool> drain)
        {
            Owner = owner;
            Drain = drain;
        }

        public object Owner { get; }

        public Func<bool> Drain { get; }
    }
}
