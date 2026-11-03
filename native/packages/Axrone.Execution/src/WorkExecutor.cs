namespace Axrone.Execution;

using System.Runtime.ExceptionServices;

/// <summary>
/// One ring slot of the executor's queue: a Vyukov-style sequence gate plus an
/// unmanaged command. Top-level because generic owners forbid explicit layout
/// on nested types.
/// </summary>
/// <typeparam name="TCommand">Command type.</typeparam>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
internal struct RingSlot<TCommand> where TCommand : unmanaged
{
    /// <summary>Sequence gate: slot is claimable when it equals the claim cursor.</summary>
    public long Sequence;

    /// <summary>Command payload. Cleared after processing.</summary>
    public TCommand Item;
}

/// <summary>
/// The executor's shared cursors, one per 128-byte line: producers CAS
/// <see cref="Head"/>, the single consumer owns <see cref="Tail"/>, both sides
/// read the lifecycle <see cref="State"/>, and <see cref="ConsumerToken"/>
/// arbitrates who currently holds the consumer role. Explicit layout keeps
/// every hot word on its own line, so producer traffic and consumer traffic
/// cannot false-share; the remainder of the block is padding.
/// </summary>
[StructLayout(LayoutKind.Explicit, Size = 512)]
internal struct PaddedControlBlock
{
    /// <summary>Producer claim cursor.</summary>
    [FieldOffset(0)]
    public long Head;

    /// <summary>Consumer position. Written only by the ring's single consumer.</summary>
    [FieldOffset(128)]
    public long Tail;

    /// <summary>Lifecycle state, as <see cref="PumpState"/>.</summary>
    [FieldOffset(256)]
    public int State;

    /// <summary>Consumer lease: 0 = free, 1 = held.</summary>
    [FieldOffset(384)]
    public int ConsumerToken;
}

/// <summary>
/// Threaded variant of the command-pump library: a multi-producer /
/// single-consumer ring drained by its own dedicated background thread instead
/// of by the caller's thread. The ring, the enqueue receipts, the blocking
/// enqueue loop, the fault containment and the disposal ladder all mirror
/// <see cref="CommandPump{TCommand, TContext, TProcessor, TBackoff, TTelemetry}"/>
/// so queue wrappers, telemetry sinks and backoff policies are shared verbatim;
/// the only thing this type adds is the thread.
/// </summary>
/// <remarks>
/// <para>
/// <b>No in-repo consumer yet.</b> The type exists to make the staged-work
/// surface complete before the first CPU-bound stage needs it. It is reserved
/// for CPU-bound staged work that can be scheduled off the caller's thread —
/// mesh/geometry preparation, descriptor packing, simulation ticks, decode.
/// </para>
/// <para>
/// <b>MUST NOT be used to drain GL commands.</b> GL submission is thread-affine:
/// only the thread that owns the context may issue commands, and the render
/// loop must observe submission order relative to the frame. Anything that
/// touches the context stays on
/// <see cref="CommandPump{TCommand, TContext, TProcessor, TBackoff, TTelemetry}"/>,
/// pumped by the render thread. This executor exists for the work that must
/// happen <i>before</i> the render thread ever sees the command.
/// </para>
/// <para>
/// Threading contract: any number of producer threads may call
/// <see cref="TryEnqueue"/>, <see cref="Enqueue"/> or
/// <see cref="TryEnqueueBatch"/> concurrently (lock-free CAS claim). Exactly
/// ONE consumer walks the ring at a time; the dedicated worker holds the
/// consumer lease, and <see cref="ExecuteBatch{TDirectContext, TDirectProcessor}"/>
/// borrows it from the worker, so the two never claim the same tail. Producer
/// faults never exist; processor exceptions are contained the same way the pump
/// contains them: the executor moves to <see cref="PumpState.Faulted"/>, reports
/// <see cref="IExecutorTelemetry.FaultEncountered"/>, keeps the original stack
/// through <see cref="ExceptionDispatchInfo"/>, and rethrows it out of
/// <see cref="DrainAsync"/>. The worker stops touching the ring after a fault,
/// and producers are refused with <see cref="EnqueueStatus.Closed"/>.
/// </para>
/// <para>
/// Backing memory is 64-byte aligned native memory released by
/// <see cref="Dispose"/>. Complete and drain before disposing; work still
/// queued at dispose time is dropped if the worker cannot finish inside the
/// join window.
/// </para>
/// <para>
/// Completion race, same contract as
/// <see cref="CommandPump{TCommand, TContext, TProcessor, TBackoff, TTelemetry}"/>'s
/// drain: <see cref="TryEnqueue"/> reads the lifecycle before it claims, so a
/// producer that was already inside its CAS when <see cref="Complete"/> ran can
/// publish one final command after the worker has parked. Hosts that need a hard
/// hand-off must fence or quiesce their producers before completing.
/// </para>
/// </remarks>
/// <typeparam name="TCommand">Command type. Unmanaged so the ring backs onto native memory.</typeparam>
/// <typeparam name="TContext">Worker-owned consumer context, constructed by the executor. May not be a ref struct.</typeparam>
/// <typeparam name="TProcessor">Static processing kernel run on the worker thread. Structs devirtualize at the call site.</typeparam>
/// <typeparam name="TBackoff">Spin policy for the blocking enqueue and the worker's idle loop (our Utility backoff).</typeparam>
/// <typeparam name="TTelemetry">Cold-path telemetry sink.</typeparam>
public sealed class WorkExecutor<TCommand, TContext, TProcessor, TBackoff, TTelemetry> : ICommandExecutor<TCommand>
    where TCommand : unmanaged
    where TContext : class, new()
    where TProcessor : ICommandProcessor<TCommand, TContext>
    where TBackoff : struct, ISpinBackoff
    where TTelemetry : IExecutorTelemetry
{
    private static readonly TimeSpan s_disposeJoinTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan s_asyncDisposeJoinTimeout = TimeSpan.FromMilliseconds(500);

    private readonly nuint _capacity;
    private readonly nuint _mask;

    // Ring address rides as an integer so the async lifecycle members stay in
    // safe code, mirroring the pump: only pointer arithmetic is marked unsafe.
    private readonly nuint _slots;
    private readonly Thread _workerThread;
    private readonly TaskCompletionSource _drainCompletion;

    private PaddedControlBlock _controlBlock;

    // Not readonly: the worker hands its context to TProcessor.Process by writable ref.
    private TContext _context;
    private ExceptionDispatchInfo? _faultInfo;
    private int _disposed;
    private int _affinityResult;

    /// <summary>Ring slot capacity.</summary>
    public nuint Capacity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _capacity;
    }

    /// <summary>
    /// Coded outcome of the worker's startup pinning attempt. <see cref="AffinityResult.NotAttempted"/>
    /// until the worker reports, and stays unpinned-but-explained when the OS declines the mask, the
    /// platform has no affinity ABI, or the deployment is missing it.
    /// </summary>
    internal AffinityResult WorkerAffinity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (AffinityResult)Volatile.Read(ref _affinityResult);
    }

    /// <summary>Lifecycle state.</summary>
    public PumpState State
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (PumpState)Volatile.Read(ref _controlBlock.State);
    }

    /// <summary>
    /// Approximate queued depth (head minus consumer tail). Racy by design:
    /// producers observe a stale tail. Exact only when producers are quiescent.
    /// </summary>
    public nuint Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get
        {
            long diff = Volatile.Read(ref _controlBlock.Head) - Volatile.Read(ref _controlBlock.Tail);
            return diff > 0 ? (nuint)diff : 0;
        }
    }

    /// <summary>
    /// Creates an executor and starts its worker. The ring starts pre-filled:
    /// every slot sequence reads as immediately claimable, the lifecycle opens
    /// as <see cref="PumpState.Running"/>, and commands may be enqueued as soon
    /// as the constructor returns.
    /// </summary>
    /// <param name="options">
    /// Sizing and thread shape. Defaults to 1024 slots on a background thread
    /// named <c>Axrone-ExecutorWorker</c> with no affinity request.
    /// </param>
    /// <remarks>
    /// An idle worker spins under <typeparamref name="TBackoff"/> rather than
    /// parking: a parking handshake would need a second synchronization object
    /// on the producer's hot path, which is the path that actually has to stay
    /// cheap. Hosts that create executors per unit of work should
    /// <see cref="Complete"/> them instead of leaving them spinning.
    /// </remarks>
    public unsafe WorkExecutor(ExecutorOptions? options = null)
    {
        options ??= new ExecutorOptions();

        _capacity = (nuint)options.Capacity;
        _mask = _capacity - 1;

        nuint slotBytes = (nuint)options.Capacity * (nuint)sizeof(RingSlot<TCommand>);
        _slots = (nuint)NativeMemory.AlignedAlloc(slotBytes, 64);

        var slots = (RingSlot<TCommand>*)_slots;
        for (nuint i = 0; i < _capacity; i++)
        {
            slots[i].Sequence = (long)i;
            slots[i].Item = default;
        }

        _context = new TContext();
        _controlBlock.State = (int)PumpState.Running;
        _drainCompletion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        int affinity = options.ProcessorAffinity;
        _workerThread = new Thread(WorkerEntryPoint)
        {
            Name = options.ThreadName,
            Priority = options.Priority,
            IsBackground = true,
        };

        _workerThread.Start(affinity);
    }

    /// <summary>
    /// Attempts to enqueue one command. Lock-free; safe from any producer
    /// thread. Every state other than <see cref="PumpState.Running"/> —
    /// draining, stopped, <b>faulted</b>, or disposed — refuses through
    /// <see cref="EnqueueStatus.Closed"/>, so a faulted executor never accepts
    /// more work and no producer has to branch on the fault itself.
    /// </summary>
    /// <param name="item">The command to queue.</param>
    /// <returns>The claim receipt (sequence) or the refusal reason.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public unsafe EnqueueResult TryEnqueue(in TCommand item)
    {
        if (Volatile.Read(ref _controlBlock.State) != (int)PumpState.Running)
            return new EnqueueResult(-1, EnqueueStatus.Closed);

        var slots = (RingSlot<TCommand>*)_slots;
        long head = Volatile.Read(ref _controlBlock.Head);
        while (true)
        {
            nuint index = (nuint)(head & (long)_mask);
            RingSlot<TCommand>* slot = slots + index;
            long diff = Volatile.Read(ref slot->Sequence) - head;

            if (diff == 0)
            {
                if (Interlocked.CompareExchange(ref _controlBlock.Head, head + 1, head) == head)
                {
                    slot->Item = item;
                    Volatile.Write(ref slot->Sequence, head + 1);
                    TTelemetry.ItemEnqueued();
                    return new EnqueueResult(head, EnqueueStatus.Enqueued);
                }

                head = Volatile.Read(ref _controlBlock.Head);
            }
            else if (diff < 0)
            {
                TTelemetry.QueueSaturated();
                return new EnqueueResult(-1, EnqueueStatus.QueueFull);
            }
            else
            {
                head = Volatile.Read(ref _controlBlock.Head);
            }
        }
    }

    /// <summary>
    /// Enqueues a span of commands, stopping at the first refusal.
    /// </summary>
    /// <param name="items">Commands to queue.</param>
    /// <returns>Commands accepted before the first refusal.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public nuint TryEnqueueBatch(params ReadOnlySpan<TCommand> items)
    {
        nuint accepted = 0;
        nuint length = (nuint)items.Length;
        for (nuint i = 0; i < length; i++)
        {
            if (!TryEnqueue(in items[(int)i]).IsEnqueued)
                break;

            accepted++;
        }

        return accepted;
    }

    /// <summary>
    /// Enqueues one command, spinning with <typeparamref name="TBackoff"/>
    /// while the ring is full. Cancellation and executor closure abort the
    /// wait, and every retry round that loses the race for a slot reports
    /// <see cref="IExecutorTelemetry.ContentionDetected"/> before backing off.
    /// </summary>
    /// <param name="item">The command to queue.</param>
    /// <param name="cancellationToken">Aborts the wait.</param>
    /// <returns>The claim receipt, or a closed refusal.</returns>
    public EnqueueResult Enqueue(in TCommand item, CancellationToken cancellationToken = default)
    {
        TBackoff.Initialize(out int spin);
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            EnqueueResult result = TryEnqueue(in item);
            if (result.Status != EnqueueStatus.QueueFull)
                return result;

            TTelemetry.ContentionDetected();
            TBackoff.Advance(ref spin);
        }
    }

    /// <summary>
    /// Drains up to <paramref name="maxBatch"/> queued commands through
    /// <typeparamref name="TDirectProcessor"/> with a caller-owned context,
    /// instead of the worker's own <typeparamref name="TProcessor"/>. The caller
    /// borrows the ring's single-consumer lease and spins under
    /// <typeparamref name="TBackoff"/> until the worker hands it over, so the two
    /// consumers can never claim the same tail; the lease is returned before the
    /// method returns, including on a processor throw.
    /// </summary>
    /// <param name="context">Caller-owned context, threaded by ref.</param>
    /// <param name="maxBatch">Maximum commands to process.</param>
    /// <returns>Commands processed; zero when the ring is empty.</returns>
    /// <remarks>
    /// A <typeparamref name="TDirectProcessor"/> exception propagates to the
    /// caller and leaves the ring untouched — the faulting command stays
    /// claimed, so the next drain sees the same head of queue. The executor's own
    /// lifecycle is untouched: a direct drain is the caller's business, the
    /// worker's fault containment only covers <typeparamref name="TProcessor"/>.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public unsafe nuint ExecuteBatch<TDirectContext, TDirectProcessor>(
        ref TDirectContext context,
        nuint maxBatch)
        where TDirectContext : allows ref struct
        where TDirectProcessor : ICommandProcessor<TCommand, TDirectContext>
    {
        TBackoff.Initialize(out int spin);
        while (!TryEnterConsumer())
        {
            if (Count == 0)
                return 0;

            TBackoff.Advance(ref spin);
        }

        try
        {
            var slots = (RingSlot<TCommand>*)_slots;
            nuint processed = 0;
            long tail = _controlBlock.Tail;

            while (processed < maxBatch)
            {
                nuint index = (nuint)(tail & (long)_mask);
                RingSlot<TCommand>* slot = slots + index;
                if (Volatile.Read(ref slot->Sequence) - (tail + 1) != 0)
                    break;

                TDirectProcessor.Process(ref slot->Item, ref context);

                slot->Item = default;
                Volatile.Write(ref slot->Sequence, tail + (long)_mask + 1);
                tail++;
                processed++;
            }

            _controlBlock.Tail = tail;
            return processed;
        }
        finally
        {
            ExitConsumer();
        }
    }

    /// <summary>
    /// Refuses further enqueues; already queued work still drains. Pass a
    /// <paramref name="fault"/> to retire the executor with a terminal
    /// <see cref="PumpState.Faulted"/> — the fault is captured, reported
    /// through <see cref="IExecutorTelemetry.FaultEncountered"/>, and rethrown
    /// out of <see cref="DrainAsync"/>. Idempotent, and inert once the
    /// lifecycle has left <see cref="PumpState.Running"/>.
    /// </summary>
    /// <param name="fault">The fault to retire the executor with, or null to drain.</param>
    public void Complete(Exception? fault = null)
    {
        int current = Volatile.Read(ref _controlBlock.State);
        if (current != (int)PumpState.Running)
            return;

        if (fault is null)
        {
            Interlocked.CompareExchange(ref _controlBlock.State, (int)PumpState.Draining, (int)PumpState.Running);
            return;
        }

        if (Interlocked.CompareExchange(ref _controlBlock.State, (int)PumpState.Faulted, (int)PumpState.Running) != (int)PumpState.Running)
            return;

        Volatile.Write(ref _faultInfo, ExceptionDispatchInfo.Capture(fault));
        TTelemetry.FaultEncountered(fault);
        _drainCompletion.TrySetException(fault);
    }

    /// <summary>
    /// Completes, then awaits the worker's terminal transition: the executor
    /// reports <see cref="PumpState.Stopped"/> once the ring is empty, or the
    /// captured fault propagates with its original stack intact.
    /// </summary>
    /// <param name="cancellationToken">Aborts the wait.</param>
    /// <returns>A task that completes when the worker has stopped draining.</returns>
    /// <exception cref="Exception">
    /// Whatever the processor threw, or the fault handed to
    /// <see cref="Complete"/>, rethrown through the captured
    /// <see cref="ExceptionDispatchInfo"/>.
    /// </exception>
    public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
    {
        Complete();

        if (Volatile.Read(ref _controlBlock.State) == (int)PumpState.Stopped)
            return;

        Volatile.Read(ref _faultInfo)?.Throw();

        await _drainCompletion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Completes, waits up to three seconds for the worker to finish draining,
    /// then releases the ring's native memory. Anything still queued when the
    /// join window expires is dropped.
    /// </summary>
    /// <remarks>
    /// Idempotent. A self-join is detected and skipped, so a processor that
    /// tears its own executor down from the worker thread does not deadlock. When
    /// the worker outlives the join window the ring is left allocated rather than
    /// freed under a live thread: a leak is recoverable, a use-after-free is not.
    /// </remarks>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;

        Complete();
        JoinWorker(s_disposeJoinTimeout);
        ReleaseNativeMemory();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Drains on the calling async context, swallows a processor fault (a
    /// shutdown path must not throw), waits 500 ms for the worker, and releases
    /// the ring's native memory. Idempotent.
    /// </summary>
    [SuppressMessage(
        "Design",
        "CA1031:Do not catch general exception types",
        Justification = "Teardown path: the fault is already captured on the executor and reported through telemetry, and must not escape DisposeAsync.")]
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;

        try
        {
            await DrainAsync().ConfigureAwait(false);
        }
        catch
        {
            // Teardown: the fault was already reported through telemetry and is
            // captured on the executor, so it must not escape DisposeAsync.
        }

        JoinWorker(s_asyncDisposeJoinTimeout);
        ReleaseNativeMemory();
        GC.SuppressFinalize(this);
    }

    /// <summary>Backstop for undisposed executors. Frees native memory only.</summary>
    ~WorkExecutor()
    {
        ReleaseNativeMemory();
    }

    private void WorkerEntryPoint(object? parameter)
    {
        int affinity = parameter is int coreId ? coreId : -1;
        if (affinity >= 0)
        {
            // Best effort by design: a hard affinity guarantee is platform specific (process CPU
            // sets, cgroup cpusets, IRQL on Windows), and a refused mask must degrade to normal
            // scheduling rather than fail the worker. The answer is never dropped: it is published
            // on WorkerAffinity, so "the OS declined", "this platform has no ABI" and "the ABI is
            // missing from the deployment" stay distinguishable from a successful pin.
            AffinityResult result = ThreadAffinityScope.PinCurrentThread(affinity);
            Volatile.Write(ref _affinityResult, (int)result);
        }

        TBackoff.Initialize(out int spin);

        while (true)
        {
            if (!TryEnterConsumer())
            {
                TBackoff.Advance(ref spin);
                continue;
            }

            try
            {
                if (TryDequeueAndProcess())
                {
                    TBackoff.Reset(ref spin);
                    continue;
                }

                if (Volatile.Read(ref _controlBlock.State) == (int)PumpState.Faulted)
                    return;

                if (IsDrainTerminal())
                {
                    OnDrainTerminal();
                    return;
                }
            }
            finally
            {
                ExitConsumer();
            }

            TBackoff.Advance(ref spin);
        }
    }

    [SuppressMessage(
        "Design",
        "CA1031:Do not catch general exception types",
        Justification = "Fault containment: an arbitrary processor exception is captured with its stack, reported through telemetry, and rethrown to the drain caller.")]
    private unsafe bool TryDequeueAndProcess()
    {
        var slots = (RingSlot<TCommand>*)_slots;
        long tail = _controlBlock.Tail;
        nuint index = (nuint)(tail & (long)_mask);
        RingSlot<TCommand>* slot = slots + index;
        if (Volatile.Read(ref slot->Sequence) - (tail + 1) != 0)
            return false;

        try
        {
            TProcessor.Process(ref slot->Item, ref _context);
        }
        catch (Exception ex)
        {
            OnExecutionFault(ex);
            return false;
        }

        slot->Item = default;
        Volatile.Write(ref slot->Sequence, tail + (long)_mask + 1);
        Volatile.Write(ref _controlBlock.Tail, tail + 1);
        TTelemetry.ItemDequeued();
        return true;
    }

    private void OnExecutionFault(Exception ex)
    {
        Volatile.Write(ref _faultInfo, ExceptionDispatchInfo.Capture(ex));
        TTelemetry.FaultEncountered(ex);
        Volatile.Write(ref _controlBlock.State, (int)PumpState.Faulted);
        _drainCompletion.TrySetException(ex);
    }

    private void OnDrainTerminal()
    {
        if (Interlocked.CompareExchange(ref _controlBlock.State, (int)PumpState.Stopped, (int)PumpState.Draining) == (int)PumpState.Draining)
            _drainCompletion.TrySetResult();
    }

    private bool IsDrainTerminal()
    {
        if (Volatile.Read(ref _controlBlock.State) < (int)PumpState.Draining)
            return false;

        return Volatile.Read(ref _controlBlock.Tail) >= Volatile.Read(ref _controlBlock.Head);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private bool TryEnterConsumer() =>
        Volatile.Read(ref _controlBlock.ConsumerToken) == 0 &&
        Interlocked.CompareExchange(ref _controlBlock.ConsumerToken, 1, 0) == 0;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ExitConsumer() => Volatile.Write(ref _controlBlock.ConsumerToken, 0);

    private void JoinWorker(TimeSpan timeout)
    {
        if (_workerThread.IsAlive && Environment.CurrentManagedThreadId != _workerThread.ManagedThreadId)
            _workerThread.Join(timeout);
    }

    private unsafe void ReleaseNativeMemory()
    {
        Volatile.Write(ref _controlBlock.State, (int)PumpState.Disposed);

        // A consumer may still be walking the ring: never free underneath one.
        if (_workerThread.IsAlive || Volatile.Read(ref _controlBlock.ConsumerToken) != 0)
            return;

        NativeMemory.AlignedFree((void*)_slots);
    }
}
