namespace Axrone.Event.Internal;

using System.Diagnostics;
using Axrone.Execution;
using Axrone.Utility.Backoff.SpinPolicies;

/// <summary>
/// Single dispatch seam shared by every router that belongs to the same owner (one per
/// <see cref="EventBus"/>, plus one process-wide instance for standalone routers). Producers only
/// enqueue and signal; the drain visits each registered router in rotating order and drains at
/// most one batch per router per pass, so a hot queue cannot starve its neighbours.
/// </summary>
/// <remarks>
/// <para>
/// The wake queue, its backoff and its lifecycle are <see cref="CommandPump{TCommand,TContext,TProcessor,TBackoff,TTelemetry}"/>
/// from <c>Axrone.Execution</c>; this type only supplies the registration table and the rotating
/// visit order. In <see cref="EventDispatchMode.FrameDriven"/> no worker is created at all and the
/// owning loop calls <see cref="Pump(int)"/>.
/// </para>
/// <para>
/// The worker parks on a reset event after the pump reports no commands, so a signal racing the
/// park is never lost. Signals are reference-counted for the duration of the set, allowing the
/// event to be disposed deterministically after the worker has exited without racing producers.
/// </para>
/// </remarks>
internal sealed class EventDispatcher : IDisposable, IAsyncDisposable
{
    private static readonly Entry[] Empty = [];

    private readonly Lock _gate = new();
    private readonly ManualResetEventSlim _wake = new(false);
    private readonly CommandPump<DrainCommand, DrainContext, DrainProcessor, ProgressiveSpinBackoff, NullExecutorTelemetry> _pump = new();
    private readonly EventDispatchMode _mode;
    private readonly Task? _worker;
    private Entry[] _entries = Empty;
    private int _cursor;
    private int _workerStarts;
    private int _disposed;
    private int _signalers;
    private int _pendingSignal;

    /// <summary>Creates a dispatcher. Background mode starts one worker thread.</summary>
    public EventDispatcher(EventDispatchMode mode)
    {
        if ((uint)mode > (uint)EventDispatchMode.FrameDriven)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(mode));
        }

        _mode = mode;
        if (mode == EventDispatchMode.Background)
        {
            _worker = Task.Factory.StartNew(
                WorkerLoop,
                CancellationToken.None,
                TaskCreationOptions.LongRunning,
                TaskScheduler.Default);
            _workerStarts = 1;
        }
    }

    /// <summary>Process-wide dispatcher for routers that are not owned by an <see cref="EventBus"/>.</summary>
    public static EventDispatcher Shared { get; } = new(EventDispatchMode.Background);

    /// <summary>Number of worker threads this dispatcher started (zero in frame-driven mode).</summary>
    public int WorkerStartCount => Volatile.Read(ref _workerStarts);

    /// <summary>Routers currently registered for dispatch.</summary>
    public int RegisteredRouterCount => Volatile.Read(ref _entries).Length;

    /// <summary>Frame-driven mode this dispatcher was created with.</summary>
    public EventDispatchMode Mode => _mode;

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

    /// <summary>Reports new work. Allocation-free; a no-op in frame-driven mode.</summary>
    public void Signal()
    {
        if (Volatile.Read(ref _disposed) != 0 || _mode == EventDispatchMode.FrameDriven)
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

            if (Interlocked.Exchange(ref _pendingSignal, 1) == 0)
            {
                _pump.TryEnqueue(default);
            }

            _wake.Set();
        }
        finally
        {
            Interlocked.Decrement(ref _signalers);
        }
    }

    /// <summary>
    /// Drains up to <paramref name="maxBatches"/> full passes on the caller thread. Only valid in
    /// <see cref="EventDispatchMode.FrameDriven"/>; a background dispatcher owns its consumer
    /// thread and refuses a second one.
    /// </summary>
    /// <returns>Passes that did work.</returns>
    public int Pump(int maxBatches = 1)
    {
        if (_mode != EventDispatchMode.FrameDriven)
        {
            ThrowHelper.ThrowInvalidOperation("Pump is only available when the bus runs in FrameDriven mode.");
        }

        if (maxBatches < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(maxBatches));
        }

        int passes = 0;
        while (passes < maxBatches && DrainAllOnce())
        {
            passes++;
        }

        return passes;
    }

    /// <summary>
    /// Advances frame-driven dispatch until idle or the elapsed budget is spent.
    /// One pass is always allowed when work exists, so a tiny budget cannot starve
    /// the queue completely.
    /// </summary>
    public int Pump(TimeSpan maxDuration, int maxBatches = int.MaxValue)
    {
        if (_mode != EventDispatchMode.FrameDriven)
        {
            ThrowHelper.ThrowInvalidOperation("Pump is only available when the bus runs in FrameDriven mode.");
        }

        if (maxDuration <= TimeSpan.Zero)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(maxDuration));
        }

        if (maxBatches < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(maxBatches));
        }

        long started = Stopwatch.GetTimestamp();
        int passes = 0;
        while (passes < maxBatches && DrainAllOnce())
        {
            passes++;
            if (Stopwatch.GetElapsedTime(started) >= maxDuration)
            {
                break;
            }
        }

        return passes;
    }

    private void WorkerLoop()
    {
        var context = new DrainContext(this);
        while (Volatile.Read(ref _disposed) == 0)
        {
            if (_pump.Pump(ref context, 256) != 0)
            {
                continue;
            }

            _wake.Wait();
            _wake.Reset();
        }

        // Commands claimed before completion still name a registered router; drain them so a
        // signal racing shutdown is not silently dropped.
        _pump.PumpAll(ref context);
    }

    private bool DrainAllOnce()
    {
        Volatile.Write(ref _pendingSignal, 0);

        Entry[] entries = Volatile.Read(ref _entries);
        int length = entries.Length;
        if (length == 0)
        {
            return false;
        }

        bool worked = false;
        int cursor = Interlocked.Increment(ref _cursor);
        int start = (int)((uint)cursor % (uint)length);
        for (int n = 0; n < length; n++)
        {
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

        return worked;
    }

    /// <summary>Re-queues one drain command when a pass found more work than it consumed.</summary>
    private void ReSignal()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            return;
        }

        if (Interlocked.Exchange(ref _pendingSignal, 1) == 0)
        {
            _pump.TryEnqueue(default);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _pump.Complete();
        _wake.Set();
        _worker?.GetAwaiter().GetResult();
        WaitForSignalers();
        _pump.Dispose();
        _wake.Dispose();
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _pump.Complete();
        _wake.Set();
        if (_worker is not null)
        {
            await _worker.ConfigureAwait(false);
        }

        WaitForSignalers();
        _pump.Dispose();
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

    private struct DrainCommand;

    private struct DrainContext
    {
        public DrainContext(EventDispatcher dispatcher) => Dispatcher = dispatcher;

        public EventDispatcher Dispatcher;
    }

    private struct DrainProcessor : ICommandProcessor<DrainCommand, DrainContext>
    {
        public static void Process(ref DrainCommand command, ref DrainContext context)
        {
            if (context.Dispatcher.DrainAllOnce())
            {
                context.Dispatcher.ReSignal();
            }
        }
    }
}
