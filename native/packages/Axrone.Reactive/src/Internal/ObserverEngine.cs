namespace Axrone.Reactive.Internal;

using System.Buffers;
using System.Numerics;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;

/// <summary>Zero-allocation observer contract used by the internal hot registry.</summary>
internal interface IValueObserver<T>
{
    void OnNext(in T value, nint context);

    void OnError(Exception error, nint context);

    void OnCompleted(nint context);
}

/// <summary>Stack-capable predicate evaluated before an observer is invoked.</summary>
internal interface IObserverFilter<T> where T : allows ref struct
{
    bool ShouldDeliver(scoped ref readonly T value, uint slotTopicMask, nint context);
}

/// <summary>Contention backoff for slot reclamation and terminal drain.</summary>
internal interface IBackoffPolicy
{
    static abstract void Backoff(ref int spinCount);
}

internal readonly struct AdaptiveSpinBackoffPolicy : IBackoffPolicy
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Backoff(ref int spinCount)
    {
        int count = ++spinCount;
        if (count <= 16)
        {
            Thread.SpinWait(1 << Math.Min(count, 6));
        }
        else if ((count & 7) != 0)
        {
            Thread.Yield();
        }
        else
        {
            Thread.Sleep(0);
        }
    }
}

/// <summary>Cold-path telemetry; the null sink is eliminated by the JIT.</summary>
internal interface IObserverMetricsSink
{
    static abstract void OnPublished(uint deliveredCount);

    static abstract void OnSubscribed(uint slotIndex, uint activeSubscribers);

    static abstract void OnUnsubscribed(uint slotIndex, uint activeSubscribers);

    static abstract void OnObserverFault(Exception exception, uint slotIndex);
}

internal readonly struct NullObserverMetricsSink : IObserverMetricsSink
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnPublished(uint deliveredCount)
    {
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnSubscribed(uint slotIndex, uint activeSubscribers)
    {
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnUnsubscribed(uint slotIndex, uint activeSubscribers)
    {
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnObserverFault(Exception exception, uint slotIndex)
    {
    }
}

internal enum ObserverFaultBehavior : byte
{
    /// <summary>Report the fault, skip that observer, keep dispatching.</summary>
    IsolateObserver = 0,

    /// <summary>Complete the engine with the fault after the current dispatch unwinds, then rethrow.</summary>
    FaultEngine = 1,

    /// <summary>Rethrow to the publisher immediately; no terminal notification.</summary>
    Propagate = 2,
}

internal enum ObserverEngineStatus : byte
{
    Active = 0,
    Completing = 1,
    Completed = 2,
    Faulted = 3,
    Disposed = 4,
}

/// <summary>8-byte generation-tagged slot handle.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly struct SubscriptionToken : IEquatable<SubscriptionToken>
{
    public SubscriptionToken(uint slotIndex, uint generation)
    {
        SlotIndex = slotIndex;
        Generation = generation;
    }

    public uint SlotIndex { get; }

    public uint Generation { get; }

    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Generation != 0u;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(SubscriptionToken other) =>
        SlotIndex == other.SlotIndex && Generation == other.Generation;

    public override bool Equals(object? obj) => obj is SubscriptionToken other && Equals(other);

    public override int GetHashCode() => HashCode.Combine(SlotIndex, Generation);

    public static bool operator ==(SubscriptionToken left, SubscriptionToken right) => left.Equals(right);

    public static bool operator !=(SubscriptionToken left, SubscriptionToken right) => !left.Equals(right);
}

/// <summary>Result of one publish call.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct PublishReceipt(uint DeliveredCount, ObserverEngineStatus Status);

/// <summary>Non-generic control surface used by the subscription handle.</summary>
internal interface IObserverEngine
{
    bool IsSubscribed(SubscriptionToken token);

    bool Unsubscribe(SubscriptionToken token);
}

/// <summary>
/// 16-byte, non-generic subscription handle. The engine's payload, backoff and metrics types are
/// deliberately absent from this type so consumers never carry policy generics.
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal readonly struct ObserverSubscription : IDisposable, IEquatable<ObserverSubscription>
{
    private readonly IObserverEngine? _engine;
    private readonly SubscriptionToken _token;

    internal ObserverSubscription(IObserverEngine engine, SubscriptionToken token)
    {
        _engine = engine;
        _token = token;
    }

    public SubscriptionToken Token => _token;

    public bool IsActive => _engine is not null && _engine.IsSubscribed(_token);

    public void Dispose() => _engine?.Unsubscribe(_token);

    public bool Equals(ObserverSubscription other) =>
        ReferenceEquals(_engine, other._engine) && _token == other._token;

    public override bool Equals(object? obj) => obj is ObserverSubscription other && Equals(other);

    public override int GetHashCode() => HashCode.Combine(_engine, _token);
}

/// <summary>Immutable engine configuration.</summary>
internal readonly record struct ObserverEngineOptions
{
    public const uint AllTopicsMask = 0xFFFF_FFFFu;

    public ObserverEngineOptions()
    {
    }

    public int MaxObservers { get; init; } = 64;

    public int MaxSubscribers { get; init; } = 64;

    public uint DefaultTopicMask { get; init; } = AllTopicsMask;

    public ObserverFaultBehavior FaultBehavior { get; init; } = ObserverFaultBehavior.IsolateObserver;
}

/// <summary>64-byte, cache-line isolated slot control block.</summary>
[StructLayout(LayoutKind.Explicit, Size = 64)]
internal struct SlotControlBlock
{
    public const ulong GenerationMask = 0x0000_0000_FFFF_FFFFUL;
    public const ulong StateMask = 0x0000_000F_0000_0000UL;
    public const ulong CallersMask = 0xFFFF_FFF0_0000_0000UL;

    public const ulong StateFree = 0UL << 32;
    public const ulong StateClaimed = 1UL << 32;
    public const ulong StateActive = 2UL << 32;
    public const ulong StateUnsubscribing = 3UL << 32;
    public const ulong StateReclaiming = 4UL << 32;

    public const ulong OneCaller = 1UL << 36;

    [FieldOffset(0)]
    public ulong StateAndGen;

    [FieldOffset(8)]
    public nint Context;

    [FieldOffset(16)]
    public uint TopicMask;

    [FieldOffset(20)]
    public byte Priority;
}

/// <summary>False-sharing free lifecycle words on separate cache lines.</summary>
[StructLayout(LayoutKind.Explicit, Size = 192)]
internal struct EngineLifecycleState
{
    public const ulong ClosingFlag = 1UL << 63;
    public const ulong ActiveCountMask = ClosingFlag - 1UL;

    [FieldOffset(0)]
    public ulong InFlightGate;

    [FieldOffset(64)]
    public int Status;

    [FieldOffset(68)]
    public int ActiveSubscribers;

    [FieldOffset(72)]
    public uint SearchHint;

    [FieldOffset(128)]
    public int IsFullyDrained;
}

/// <summary>
/// Hot observer registry: generation-tagged slots, per-priority FIFO order snapshots, and an
/// in-flight gate that makes unsubscribe, completion and drain deterministic without ever blocking
/// the observer that is currently executing.
/// </summary>
/// <remarks>
/// <para><b>Unsubscribe is non-blocking.</b> It clears the slot from the dispatch order and marks
/// it unsubscribing; an already-running callback finishes normally and the slot is reclaimed by the
/// last pin release. A callback may therefore dispose its own subscription (or any other) without
/// deadlocking.</para>
/// <para><b>Terminal calls from a callback are rejected.</b> <see cref="Complete(Exception?)"/>,
/// <see cref="Dispose()"/>, <see cref="DisposeAsync"/> and <see cref="DrainAsync"/> throw
/// <see cref="InvalidOperationException"/> when the target engine is anywhere on the current
/// thread's dispatch stack, including a nested engine that is dispatching it. Terminal forwarding
/// to an unrelated engine remains allowed. On the same thread the engine never blocks a callback
/// waiting for its own in-flight dispatch.</para>
/// <para><b>Drain is multi-waiter.</b> <see cref="DrainAsync"/> hands every waiter the same
/// completion task, so concurrent drains share one signal.</para>
/// </remarks>
internal class ObserverEngine<T, TBackoffPolicy, TMetricsSink> : IObserverEngine, IDisposable, IAsyncDisposable
    where TBackoffPolicy : IBackoffPolicy
    where TMetricsSink : IObserverMetricsSink
{
    private const int PriorityCount = 3;

    [ThreadStatic]
    private static ObserverEngine<T, TBackoffPolicy, TMetricsSink>?[]? t_dispatchStack;

    [ThreadStatic]
    private static int t_dispatchDepth;

    private readonly SlotControlBlock[] _slots;
    private readonly IValueObserver<T>?[] _observers;
    private readonly Lock _subscriptionGate = new();
    private readonly Lock _drainGate = new();
    private readonly uint _slotMask;
    private readonly uint _defaultTopicMask;
    private readonly ObserverFaultBehavior _faultBehavior;
    private readonly int _maxSubscribers;

    private int[][] _order = [Array.Empty<int>(), Array.Empty<int>(), Array.Empty<int>()];
    private EngineLifecycleState _lifecycle;
    private TaskCompletionSource<bool>? _drainSignal;
    private ExceptionDispatchInfo? _terminalFault;
    private int _observerFaultCount;
    private int _disposed;

    public ObserverEngine()
        : this(new ObserverEngineOptions())
    {
    }

    public ObserverEngine(in ObserverEngineOptions options)
    {
        int maxObservers = options.MaxObservers;
        if (maxObservers < 2 || maxObservers > 65536 || !BitOperations.IsPow2((uint)maxObservers))
        {
            ThrowHelper.ThrowInvalidMaxObservers(maxObservers);
        }

        _slots = GC.AllocateArray<SlotControlBlock>(maxObservers, pinned: true);
        _observers = new IValueObserver<T>?[maxObservers];
        _slotMask = (uint)maxObservers - 1u;
        _maxSubscribers = options.MaxSubscribers <= 0
            ? maxObservers
            : Math.Min(options.MaxSubscribers, maxObservers);
        _defaultTopicMask = options.DefaultTopicMask == 0u
            ? ObserverEngineOptions.AllTopicsMask
            : options.DefaultTopicMask;
        _faultBehavior = options.FaultBehavior;
        Volatile.Write(ref _lifecycle.Status, (int)ObserverEngineStatus.Active);
    }

    public ObserverEngineStatus Status
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (ObserverEngineStatus)Volatile.Read(ref _lifecycle.Status);
    }

    public int ActiveSubscriberCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Volatile.Read(ref _lifecycle.ActiveSubscribers);
    }

    public int Capacity => _slots.Length;

    public int ObserverFaultCount => Volatile.Read(ref _observerFaultCount);

    public Exception? TerminalError => Volatile.Read(ref _terminalFault)?.SourceException;

    public ObserverSubscription Subscribe(
        IValueObserver<T> observer,
        byte priority = 1,
        nint context = 0,
        uint topicMask = 0u)
    {
        ArgumentNullException.ThrowIfNull(observer);
        if (priority >= PriorityCount)
        {
            ThrowHelper.ThrowInvalidPriority(priority);
        }

        EnsureActive();
        if (!TrySubscribeCore(observer, priority, context, topicMask == 0u ? _defaultTopicMask : topicMask, out SubscriptionToken token))
        {
            EnsureActive();
            ThrowHelper.ThrowCapacityExceeded(Capacity, Status);
        }

        return new ObserverSubscription(this, token);
    }

    public bool TrySubscribe(
        IValueObserver<T> observer,
        out SubscriptionToken token,
        byte priority = 1,
        nint context = 0,
        uint topicMask = 0u)
    {
        ArgumentNullException.ThrowIfNull(observer);
        if (priority >= PriorityCount)
        {
            ThrowHelper.ThrowInvalidPriority(priority);
        }

        if (Status != ObserverEngineStatus.Active)
        {
            token = default;
            return false;
        }

        return TrySubscribeCore(observer, priority, context, topicMask == 0u ? _defaultTopicMask : topicMask, out token);
    }

    private bool TrySubscribeCore(
        IValueObserver<T> observer,
        byte priority,
        nint context,
        uint effectiveTopicMask,
        out SubscriptionToken token)
    {
        if (!TryEnterInFlightGate())
        {
            token = default;
            return false;
        }

        try
        {
            for (uint i = 0; i < (uint)_slots.Length; i++)
            {
                uint slotIndex = (Volatile.Read(ref _lifecycle.SearchHint) + i) & _slotMask;
                ref SlotControlBlock block = ref _slots[slotIndex];
                ulong current = Volatile.Read(ref block.StateAndGen);

                if ((current & (SlotControlBlock.StateMask | SlotControlBlock.CallersMask)) != SlotControlBlock.StateFree)
                {
                    continue;
                }

                uint nextGeneration = (uint)current + 1u;
                if (nextGeneration == 0u)
                {
                    nextGeneration = 1u;
                }

                ulong claimed = nextGeneration | SlotControlBlock.StateClaimed;
                if (Interlocked.CompareExchange(ref block.StateAndGen, claimed, current) != current)
                {
                    continue;
                }

                block.Context = context;
                block.TopicMask = effectiveTopicMask;
                block.Priority = priority;
                Volatile.Write(ref _observers[slotIndex], observer);

                lock (_subscriptionGate)
                {
                    if (Volatile.Read(ref _lifecycle.Status) != (int)ObserverEngineStatus.Active ||
                        Volatile.Read(ref _lifecycle.ActiveSubscribers) >= _maxSubscribers)
                    {
                        Volatile.Write(ref _observers[slotIndex], null);
                        block.Context = 0;
                        block.TopicMask = 0u;
                        Volatile.Write(ref block.StateAndGen, nextGeneration | SlotControlBlock.StateFree);
                        token = default;
                        return false;
                    }

                    Volatile.Write(ref block.StateAndGen, nextGeneration | SlotControlBlock.StateActive);
                    AddToOrderLocked((int)slotIndex, priority);
                    Volatile.Write(ref _lifecycle.SearchHint, (slotIndex + 1u) & _slotMask);
                    Interlocked.Increment(ref _lifecycle.ActiveSubscribers);
                }

                TMetricsSink.OnSubscribed(slotIndex, (uint)ActiveSubscriberCount);
                token = new SubscriptionToken(slotIndex, nextGeneration);
                return true;
            }

            token = default;
            return false;
        }
        finally
        {
            ExitInFlightGate();
        }
    }

    public bool IsSubscribed(SubscriptionToken token)
    {
        uint slotIndex = token.SlotIndex;
        if (slotIndex >= (uint)_slots.Length || token.Generation == 0u)
        {
            return false;
        }

        ulong state = Volatile.Read(ref _slots[slotIndex].StateAndGen);
        return (uint)state == token.Generation &&
               (state & SlotControlBlock.StateMask) == SlotControlBlock.StateActive;
    }

    /// <summary>
    /// Stops future deliveries for the subscription. A callback already executing on the slot is
    /// allowed to finish; the slot is reclaimed when the last pin is released. Never blocks the
    /// calling thread, so an observer may dispose itself from inside <c>OnNext</c>.
    /// </summary>
    public bool Unsubscribe(SubscriptionToken token)
    {
        uint slotIndex = token.SlotIndex;
        if (slotIndex >= (uint)_slots.Length || token.Generation == 0u)
        {
            return false;
        }

        ref SlotControlBlock block = ref _slots[slotIndex];
        lock (_subscriptionGate)
        {
            ulong current = Volatile.Read(ref block.StateAndGen);
            if ((uint)current != token.Generation ||
                (current & SlotControlBlock.StateMask) != SlotControlBlock.StateActive)
            {
                return false;
            }

            RemoveFromOrderLocked((int)slotIndex, block.Priority);

            // A publisher may pin the slot between the read and the CAS; retry with the fresh
            // caller count instead of abandoning the unsubscribe (which would leak the slot).
            int spinCount = 0;
            while (true)
            {
                ulong unsubscribing = (current & ~SlotControlBlock.StateMask) | SlotControlBlock.StateUnsubscribing;
                if (Interlocked.CompareExchange(ref block.StateAndGen, unsubscribing, current) == current)
                {
                    break;
                }

                current = Volatile.Read(ref block.StateAndGen);
                if ((uint)current != token.Generation ||
                    (current & SlotControlBlock.StateMask) != SlotControlBlock.StateActive)
                {
                    return false;
                }

                TBackoffPolicy.Backoff(ref spinCount);
            }

            uint remaining = (uint)Interlocked.Decrement(ref _lifecycle.ActiveSubscribers);
            TMetricsSink.OnUnsubscribed((uint)slotIndex, remaining);
        }

        TryFinalizeSlot((int)slotIndex, token.Generation);
        return true;
    }

    public PublishReceipt Publish(in T item, uint topicMask = ObserverEngineOptions.AllTopicsMask)
    {
        EnsureActive();
        PassThroughFilter filter = default;
        if (!TryPublishFilteredCore(in item, in filter, topicMask, out uint delivered, out Exception? terminalFault))
        {
            EnsureActive();
            return new PublishReceipt(0u, Status);
        }

        if (terminalFault is not null)
        {
            Complete(terminalFault);
            ExceptionDispatchInfo.Capture(terminalFault).Throw();
        }

        return new PublishReceipt(delivered, ObserverEngineStatus.Active);
    }

    public bool TryPublish(in T item, out uint deliveredCount, uint topicMask = ObserverEngineOptions.AllTopicsMask)
    {
        PassThroughFilter filter = default;
        if (!TryPublishFilteredCore(in item, in filter, topicMask, out deliveredCount, out Exception? terminalFault))
        {
            return false;
        }

        if (terminalFault is not null)
        {
            Complete(terminalFault);
            ExceptionDispatchInfo.Capture(terminalFault).Throw();
        }

        return true;
    }

    public PublishReceipt PublishFiltered<TFilter>(
        in T item,
        scoped ref readonly TFilter filter,
        uint topicMask = ObserverEngineOptions.AllTopicsMask)
        where TFilter : IObserverFilter<T>, allows ref struct
    {
        EnsureActive();
        if (!TryPublishFilteredCore(in item, in filter, topicMask, out uint delivered, out Exception? terminalFault))
        {
            EnsureActive();
            return new PublishReceipt(0u, Status);
        }

        if (terminalFault is not null)
        {
            Complete(terminalFault);
            ExceptionDispatchInfo.Capture(terminalFault).Throw();
        }

        return new PublishReceipt(delivered, ObserverEngineStatus.Active);
    }

    private bool TryPublishFilteredCore<TFilter>(
        in T item,
        scoped ref readonly TFilter filter,
        uint topicMask,
        out uint deliveredCount,
        out Exception? terminalFault)
        where TFilter : IObserverFilter<T>, allows ref struct
    {
        terminalFault = null;
        if (!TryEnterInFlightGate())
        {
            deliveredCount = 0u;
            return false;
        }

        PushDispatchFrame();
        uint delivered = 0u;

        try
        {
            for (int priority = 0; priority < PriorityCount; priority++)
            {
                int[] order = Volatile.Read(ref _order[priority]);
                if (order.Length == 0)
                {
                    continue;
                }

                // Pin the whole snapshot before invoking anyone: a subscription disposed by an
                // earlier observer still receives the event that was already in flight.
                int[] pinned = ArrayPool<int>.Shared.Rent(order.Length);
                int pinnedCount = 0;
                try
                {
                    for (int i = 0; i < order.Length; i++)
                    {
                        int slotIndex = order[i];
                        ref SlotControlBlock block = ref _slots[slotIndex];
                        if (TryAcquireSlotPin(ref block))
                        {
                            pinned[pinnedCount++] = slotIndex;
                        }
                    }

                    for (int i = 0; i < pinnedCount; i++)
                    {
                        int slotIndex = pinned[i];
                        ref SlotControlBlock block = ref _slots[slotIndex];

                        try
                        {
                            uint slotTopic = block.TopicMask;
                            if ((slotTopic & topicMask) == 0u)
                            {
                                continue;
                            }

                            nint context = block.Context;
                            if (!filter.ShouldDeliver(in item, slotTopic, context))
                            {
                                continue;
                            }

                            IValueObserver<T>? observer = Volatile.Read(ref _observers[slotIndex]);
                            if (observer is null)
                            {
                                continue;
                            }

                            observer.OnNext(in item, context);
                            delivered++;
                        }
                        catch (Exception exception)
                        {
                            if (_faultBehavior == ObserverFaultBehavior.Propagate)
                            {
                                throw;
                            }

                            Interlocked.Increment(ref _observerFaultCount);
                            TMetricsSink.OnObserverFault(exception, (uint)slotIndex);

                            if (_faultBehavior == ObserverFaultBehavior.FaultEngine)
                            {
                                terminalFault ??= exception;
                            }
                        }
                    }
                }
                finally
                {
                    for (int i = 0; i < pinnedCount; i++)
                    {
                        int slotIndex = pinned[i];
                        ref SlotControlBlock block = ref _slots[slotIndex];
                        ReleaseSlotPin(ref block, slotIndex);
                    }

                    ArrayPool<int>.Shared.Return(pinned);
                }
            }

            TMetricsSink.OnPublished(delivered);
            deliveredCount = delivered;
            return true;
        }
        finally
        {
            PopDispatchFrame();
            ExitInFlightGate();
        }
    }

    /// <summary>
    /// Completes the engine, notifies every observer exactly once and refuses further work.
    /// Throws when called from inside this engine's own dispatch; use <see cref="DrainAsync"/>
    /// from the producer side instead.
    /// </summary>
    public bool Complete(Exception? error = null)
    {
        if (IsDispatching(this))
        {
            ThrowHelper.ThrowTerminalFromCallback();
        }

        int previous = Interlocked.CompareExchange(
            ref _lifecycle.Status,
            (int)ObserverEngineStatus.Completing,
            (int)ObserverEngineStatus.Active);
        if (previous != (int)ObserverEngineStatus.Active)
        {
            return false;
        }

        if (error is not null)
        {
            Interlocked.CompareExchange(ref _terminalFault, ExceptionDispatchInfo.Capture(error), null);
        }

        // Close the gate and account for this completion operation itself.
        Interlocked.Add(ref _lifecycle.InFlightGate, EngineLifecycleState.ClosingFlag + 1UL);

        int spinCount = 0;
        while ((Volatile.Read(ref _lifecycle.InFlightGate) & EngineLifecycleState.ActiveCountMask) != 1UL)
        {
            TBackoffPolicy.Backoff(ref spinCount);
        }

        int[][] orders;
        lock (_subscriptionGate)
        {
            orders = _order;
            _order = [Array.Empty<int>(), Array.Empty<int>(), Array.Empty<int>()];
        }

        PushDispatchFrame();
        try
        {
            for (int priority = 0; priority < PriorityCount; priority++)
            {
                int[] order = orders[priority];
                for (int i = 0; i < order.Length; i++)
                {
                    int slotIndex = order[i];
                    ref SlotControlBlock block = ref _slots[slotIndex];
                    ulong current = Volatile.Read(ref block.StateAndGen);
                    if ((current & SlotControlBlock.StateMask) != SlotControlBlock.StateActive)
                    {
                        continue;
                    }

                    uint generation = (uint)current;
                    IValueObserver<T>? observer = Volatile.Read(ref _observers[slotIndex]);
                    nint context = block.Context;

                    if (!TryRetireSlot(ref block, slotIndex, generation))
                    {
                        continue;
                    }

                    if (observer is null)
                    {
                        continue;
                    }

                    try
                    {
                        if (error is not null)
                        {
                            observer.OnError(error, context);
                        }
                        else
                        {
                            observer.OnCompleted(context);
                        }
                    }
                    catch (Exception exception)
                    {
                        Interlocked.Increment(ref _observerFaultCount);
                        TMetricsSink.OnObserverFault(exception, (uint)slotIndex);
                    }
                }
            }

            Volatile.Write(
                ref _lifecycle.Status,
                error is not null ? (int)ObserverEngineStatus.Faulted : (int)ObserverEngineStatus.Completed);
        }
        finally
        {
            PopDispatchFrame();
            ExitInFlightGate();
        }

        return true;
    }

    /// <summary>
    /// Completes the engine if needed and waits until every in-flight publish and terminal
    /// notification has settled. All concurrent callers share one completion signal.
    /// </summary>
    public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
    {
        if (IsDispatching(this))
        {
            ThrowHelper.ThrowTerminalFromCallback();
        }

        if (Volatile.Read(ref _lifecycle.Status) == (int)ObserverEngineStatus.Active)
        {
            Complete();
        }

        if (Volatile.Read(ref _lifecycle.IsFullyDrained) != 0)
        {
            return;
        }

        Task wait;
        lock (_drainGate)
        {
            if (Volatile.Read(ref _lifecycle.IsFullyDrained) != 0)
            {
                return;
            }

            _drainSignal ??= new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            wait = _drainSignal.Task;
        }

        await wait.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!disposing)
        {
            return;
        }

        if (IsDispatching(this))
        {
            ThrowHelper.ThrowTerminalFromCallback();
        }

        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        Volatile.Write(ref _lifecycle.Status, (int)ObserverEngineStatus.Disposed);
    }

    public async ValueTask DisposeAsync()
    {
        if (IsDispatching(this))
        {
            ThrowHelper.ThrowTerminalFromCallback();
        }

        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        await DrainAsync(CancellationToken.None).ConfigureAwait(false);
        Volatile.Write(ref _lifecycle.Status, (int)ObserverEngineStatus.Disposed);
    }

    private void PushDispatchFrame()
    {
        ObserverEngine<T, TBackoffPolicy, TMetricsSink>?[]? stack = t_dispatchStack;
        if (stack is null)
        {
            stack = new ObserverEngine<T, TBackoffPolicy, TMetricsSink>[8];
            t_dispatchStack = stack;
        }
        else if (t_dispatchDepth == stack.Length)
        {
            Array.Resize(ref stack, stack.Length * 2);
            t_dispatchStack = stack;
        }

        stack[t_dispatchDepth++] = this;
    }

    private static void PopDispatchFrame()
    {
        ObserverEngine<T, TBackoffPolicy, TMetricsSink>?[]? stack = t_dispatchStack;
        if (stack is not null && t_dispatchDepth > 0)
        {
            stack[--t_dispatchDepth] = null;
        }
    }

    private static bool IsDispatching(ObserverEngine<T, TBackoffPolicy, TMetricsSink> engine)
    {
        ObserverEngine<T, TBackoffPolicy, TMetricsSink>?[]? stack = t_dispatchStack;
        if (stack is null)
        {
            return false;
        }

        for (int index = 0; index < t_dispatchDepth; index++)
        {
            if (ReferenceEquals(stack[index], engine))
            {
                return true;
            }
        }

        return false;
    }

    private void AddToOrderLocked(int slotIndex, byte priority)
    {
        int[] current = _order[priority];
        var next = new int[current.Length + 1];
        Array.Copy(current, next, current.Length);
        next[^1] = slotIndex;
        Volatile.Write(ref _order[priority], next);
    }

    private void RemoveFromOrderLocked(int slotIndex, byte priority)
    {
        int[] current = _order[priority];
        int index = Array.IndexOf(current, slotIndex);
        if (index < 0)
        {
            return;
        }

        if (current.Length == 1)
        {
            Volatile.Write(ref _order[priority], Array.Empty<int>());
            return;
        }

        var next = new int[current.Length - 1];
        Array.Copy(current, 0, next, 0, index);
        Array.Copy(current, index + 1, next, index, current.Length - index - 1);
        Volatile.Write(ref _order[priority], next);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private bool TryEnterInFlightGate()
    {
        if ((Volatile.Read(ref _lifecycle.InFlightGate) & EngineLifecycleState.ClosingFlag) != 0UL)
        {
            return false;
        }

        ulong state = Interlocked.Increment(ref _lifecycle.InFlightGate);
        if ((state & EngineLifecycleState.ClosingFlag) != 0UL)
        {
            ExitInFlightGate();
            return false;
        }

        return true;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ExitInFlightGate()
    {
        ulong remaining = Interlocked.Decrement(ref _lifecycle.InFlightGate);
        if (remaining == EngineLifecycleState.ClosingFlag)
        {
            SignalFullyDrained();
        }
    }

    private void SignalFullyDrained()
    {
        Volatile.Write(ref _lifecycle.IsFullyDrained, 1);
        lock (_drainGate)
        {
            _drainSignal?.TrySetResult(true);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool TryAcquireSlotPin(ref SlotControlBlock block)
    {
        while (true)
        {
            ulong state = Volatile.Read(ref block.StateAndGen);
            if ((state & SlotControlBlock.StateMask) != SlotControlBlock.StateActive)
            {
                return false;
            }

            ulong next = state + SlotControlBlock.OneCaller;
            if (Interlocked.CompareExchange(ref block.StateAndGen, next, state) == state)
            {
                return true;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ReleaseSlotPin(ref SlotControlBlock block, int slotIndex)
    {
        ulong remaining = Interlocked.Add(ref block.StateAndGen, unchecked((ulong)(-(long)SlotControlBlock.OneCaller)));
        if ((remaining & SlotControlBlock.CallersMask) == 0UL &&
            (remaining & SlotControlBlock.StateMask) == SlotControlBlock.StateUnsubscribing)
        {
            TryFinalizeSlot(slotIndex, (uint)remaining);
        }
    }

    private void TryFinalizeSlot(int slotIndex, uint generation)
    {
        ref SlotControlBlock block = ref _slots[slotIndex];
        while (true)
        {
            ulong current = Volatile.Read(ref block.StateAndGen);
            if ((uint)current != generation ||
                (current & SlotControlBlock.StateMask) != SlotControlBlock.StateUnsubscribing ||
                (current & SlotControlBlock.CallersMask) != 0UL)
            {
                return;
            }

            ulong reclaiming = (current & ~SlotControlBlock.StateMask) | SlotControlBlock.StateReclaiming;
            if (Interlocked.CompareExchange(ref block.StateAndGen, reclaiming, current) != current)
            {
                continue;
            }

            Volatile.Write(ref _observers[slotIndex], null);
            block.Context = 0;
            block.TopicMask = 0u;
            block.Priority = 0;
            Volatile.Write(ref block.StateAndGen, generation | SlotControlBlock.StateFree);
            return;
        }
    }

    /// <summary>Marks an active slot as unsubscribing and reclaims it immediately when unpinned.</summary>
    private bool TryRetireSlot(ref SlotControlBlock block, int slotIndex, uint generation)
    {
        while (true)
        {
            ulong current = Volatile.Read(ref block.StateAndGen);
            if ((uint)current != generation ||
                (current & SlotControlBlock.StateMask) != SlotControlBlock.StateActive)
            {
                return false;
            }

            ulong unsubscribing = (current & ~SlotControlBlock.StateMask) | SlotControlBlock.StateUnsubscribing;
            if (Interlocked.CompareExchange(ref block.StateAndGen, unsubscribing, current) != current)
            {
                continue;
            }

            uint remaining = (uint)Interlocked.Decrement(ref _lifecycle.ActiveSubscribers);
            TMetricsSink.OnUnsubscribed((uint)slotIndex, remaining);
            TryFinalizeSlot(slotIndex, generation);
            return true;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EnsureActive()
    {
        int status = Volatile.Read(ref _lifecycle.Status);
        if (status == (int)ObserverEngineStatus.Active)
        {
            return;
        }

        if (status == (int)ObserverEngineStatus.Faulted)
        {
            _terminalFault?.Throw();
            ThrowHelper.ThrowEngineFaulted();
        }

        ThrowHelper.ThrowNotActive((ObserverEngineStatus)status);
    }

    private readonly struct PassThroughFilter : IObserverFilter<T>
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool ShouldDeliver(scoped ref readonly T value, uint slotTopicMask, nint context) => true;
    }
}

/// <summary>Default monomorphized engine.</summary>
internal sealed class ObserverEngine<T> : ObserverEngine<T, AdaptiveSpinBackoffPolicy, NullObserverMetricsSink>
{
    public ObserverEngine()
        : base()
    {
    }

    public ObserverEngine(in ObserverEngineOptions options)
        : base(in options)
    {
    }
}

/// <summary>Cold-path exception throwers, kept out of the hot methods.</summary>
internal static class ThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidMaxObservers(int value) =>
        throw new ArgumentOutOfRangeException(
            nameof(value),
            value,
            "MaxObservers must be a power of two between 2 and 65536.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidPriority(byte priority) =>
        throw new ArgumentOutOfRangeException(nameof(priority), priority, "Priority must be 0, 1 or 2.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowCapacityExceeded(int capacity, ObserverEngineStatus status) =>
        throw new InvalidOperationException(
            $"Unable to subscribe: engine status is '{status}' with capacity {capacity}.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEngineFaulted() =>
        throw new InvalidOperationException("The observer engine is in a terminal faulted state.");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowNotActive(ObserverEngineStatus status) =>
        throw new InvalidOperationException($"The observer engine is not active (status: {status}).");

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowTerminalFromCallback() =>
        throw new InvalidOperationException(
            "Complete, Dispose and DisposeAsync cannot be called from inside an observer callback. " +
            "Return from the callback first; the engine never waits for itself.");
}
