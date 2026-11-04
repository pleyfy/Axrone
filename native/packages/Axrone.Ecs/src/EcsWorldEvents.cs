namespace Axrone.Ecs;

/// <summary>
/// Receives a world event payload. Handlers are synchronous: the bus finishes a
/// dispatch before returning to the emitter.
/// </summary>
/// <param name="name">Event that fired.</param>
/// <param name="payload">Emitter payload.</param>
/// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
public delegate void EcsEventCallback<TPayload>(in EcsEventName name, in TPayload payload)
    where TPayload : unmanaged;

/// <summary>
/// Opaque subscription token; unsubscribing twice returns false.
/// </summary>
/// <param name="EventSlot">Interned event slot the handler lives on.</param>
/// <param name="Token">Monotonic registration identity.</param>
public readonly record struct EcsEventSubscription(int EventSlot, long Token);

/// <summary>
/// What happens when a paused event buffer is full. Silent loss is not expressible:
/// every policy records the loss in <see cref="EcsEventMetrics.DroppedCount"/>.
/// </summary>
public enum EcsEventBufferOverflow : byte
{
    /// <summary>Throw <see cref="EcsEventBufferFullException"/> and keep the buffered events.</summary>
    Throw = 0,

    /// <summary>Evict the oldest buffered event, then accept the new one.</summary>
    DropOldest = 1,

    /// <summary>Refuse the newest event.</summary>
    DropNewest = 2,
}

/// <summary>
/// Per-event counters read from <see cref="World.TryGetEventMetrics"/>.
/// </summary>
/// <param name="EmitCount">Accepted emissions, buffered ones included.</param>
/// <param name="InvocationCount">Handler invocations that completed.</param>
/// <param name="BufferedCount">Emissions parked while the world was paused.</param>
/// <param name="DroppedCount">Buffered emissions lost by an overflow policy.</param>
/// <param name="FaultCount">Handler invocations that threw.</param>
/// <param name="TotalNanoseconds">Cumulative dispatch time.</param>
/// <param name="MaxNanoseconds">Longest single dispatch.</param>
/// <param name="PendingCount">Emissions still buffered.</param>
/// <param name="HandlerCount">Live registrations for the event.</param>
/// <param name="LastEmittedTimestamp">Raw <see cref="Stopwatch"/> tick of the last accepted emission.</param>
public readonly record struct EcsEventMetrics(
    long EmitCount,
    long InvocationCount,
    long BufferedCount,
    long DroppedCount,
    long FaultCount,
    long TotalNanoseconds,
    long MaxNanoseconds,
    long PendingCount,
    int HandlerCount,
    long LastEmittedTimestamp);

/// <summary>
/// One live registration inside an event bucket.
/// </summary>
/// <param name="Token">Registration identity.</param>
/// <param name="Handler">Delegate target.</param>
/// <param name="Once">Whether to drop the registration after one invocation.</param>
internal readonly record struct EcsEventRegistration(long Token, Delegate Handler, bool Once);

/// <summary>
/// Type-erased entry point that turns buffered payload bytes back into a typed
/// handler call. Instantiations are generic-at-compile-time; no reflection is used.
/// </summary>
internal interface IEcsEventPayloadBridge
{
    /// <summary>Byte width of the payload shape.</summary>
    int PayloadSize { get; }

    /// <summary>Whether a registration expects this bridge's payload shape.</summary>
    /// <param name="handler">Registered delegate.</param>
    /// <returns>True when <see cref="Invoke"/> can dispatch to it.</returns>
    bool Matches(Delegate handler);

    /// <summary>Invokes one handler with a buffered payload copy.</summary>
    /// <param name="handler">Registered delegate.</param>
    /// <param name="name">Event slot.</param>
    /// <param name="payload">Buffered payload bytes.</param>
    /// <returns>False when the registration expects a different payload shape.</returns>
    bool Invoke(Delegate handler, in EcsEventName name, ReadOnlySpan<byte> payload);
}

/// <summary>
/// Payload bridge for one unmanaged shape, cached per closed generic.
/// </summary>
/// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
internal sealed class EcsEventPayloadBridge<TPayload> : IEcsEventPayloadBridge
    where TPayload : unmanaged
{
    /// <summary>Shared instance; one per payload type, allocated at first use.</summary>
    public static readonly EcsEventPayloadBridge<TPayload> Instance = new();

    /// <inheritdoc/>
    public int PayloadSize => Unsafe.SizeOf<TPayload>();

    /// <inheritdoc/>
    public bool Matches(Delegate handler) => handler is EcsEventCallback<TPayload>;

    /// <inheritdoc/>
    public bool Invoke(Delegate handler, in EcsEventName name, ReadOnlySpan<byte> payload)
    {
        if (handler is not EcsEventCallback<TPayload> typed)
        {
            return false;
        }

        TPayload value = Unsafe.ReadUnaligned<TPayload>(ref MemoryMarshal.GetReference(payload));
        typed(in name, in value);
        return true;
    }
}

/// <summary>Outcome of parking one payload into a paused buffer.</summary>
internal enum EcsEventParkResult : byte
{
    /// <summary>Stored.</summary>
    Written = 0,

    /// <summary>Stored after evicting the oldest buffered entry.</summary>
    EvictedOldest = 1,

    /// <summary>Refused: the buffer is full and the policy drops the newest entry.</summary>
    RefusedNewest = 2,

    /// <summary>Refused: the buffer is full and the policy throws.</summary>
    Full = 3,
}

/// <summary>
/// Bounded FIFO of payloads parked while the world is paused. The ring is allocated
/// once per event on the first parked emission and pinned, so the flush path never
/// moves the heap.
/// </summary>
internal sealed class EcsEventBuffer
{
    /// <summary>Inline payload budget per slot; larger shapes are rejected with a typed error.</summary>
    internal const int SlotBytes = 64;

    private readonly byte[] _payloads;
    private readonly int[] _sizes;
    private readonly IEcsEventPayloadBridge[] _bridges;
    private readonly Lock _gate = new();
    private readonly int _capacity;
    private int _head;
    private int _count;

    internal EcsEventBuffer(int capacity)
    {
        _capacity = capacity;
        _payloads = GC.AllocateArray<byte>(capacity * SlotBytes, pinned: true);
        _sizes = GC.AllocateArray<int>(capacity, pinned: true);
        _bridges = new IEcsEventPayloadBridge[capacity];
    }

    internal int Count => Volatile.Read(ref _count);

    /// <summary>Stores one payload, applying the overflow policy when the ring is full.</summary>
    internal EcsEventParkResult TryPark(
        ReadOnlySpan<byte> payload,
        IEcsEventPayloadBridge bridge,
        EcsEventBufferOverflow policy)
    {
        lock (_gate)
        {
            bool evicted = false;
            if (_count == _capacity)
            {
                switch (policy)
                {
                    case EcsEventBufferOverflow.DropNewest:
                        return EcsEventParkResult.RefusedNewest;

                    case EcsEventBufferOverflow.DropOldest:
                        DiscardHead();
                        evicted = true;
                        break;

                    default:
                        return EcsEventParkResult.Full;
                }
            }

            int tail = (_head + _count) % _capacity;
            int offset = tail * SlotBytes;
            payload.CopyTo(_payloads.AsSpan(offset, payload.Length));
            _sizes[tail] = payload.Length;
            _bridges[tail] = bridge;
            _count++;
            return evicted ? EcsEventParkResult.EvictedOldest : EcsEventParkResult.Written;
        }
    }

    /// <summary>Copies the head entry into a stack buffer and consumes it.</summary>
    internal bool TryReadHead(Span<byte> scratch, out IEcsEventPayloadBridge? bridge, out int size)
    {
        lock (_gate)
        {
            if (_count == 0)
            {
                bridge = null;
                size = 0;
                return false;
            }

            size = _sizes[_head];
            bridge = _bridges[_head];
            int offset = _head * SlotBytes;
            _payloads.AsSpan(offset, size).CopyTo(scratch[..size]);
            _bridges[_head] = null!;
            Advance();
            return true;
        }
    }

    /// <summary>Releases every buffered entry.</summary>
    /// <returns>The number of entries dropped.</returns>
    internal int Clear()
    {
        lock (_gate)
        {
            int dropped = _count;
            Array.Clear(_bridges);
            _head = 0;
            Volatile.Write(ref _count, 0);
            return dropped;
        }
    }

    private void DiscardHead()
    {
        _bridges[_head] = null!;
        Advance();
    }

    private void Advance()
    {
        _head = _head + 1 == _capacity ? 0 : _head + 1;
        _count--;
    }
}


/// <summary>
/// Registrations and counters for one interned event name.
/// </summary>
internal sealed class EcsEventBucket
{
    internal static readonly EcsEventRegistration[] EmptyRegistrations = [];

    internal EcsEventRegistration[] Registrations = EmptyRegistrations;
    internal long EmitCount;
    internal long InvocationCount;
    internal long BufferedCount;
    internal long DroppedCount;
    internal long FaultCount;
    internal long TotalNanoseconds;
    internal long MaxNanoseconds;
    internal long LastEmittedTimestamp;
    internal ExceptionDispatchInfo? LastFault;
    internal EcsEventBuffer? Buffer;
}

/// <summary>
/// World event runtime: interned-name buckets, copy-on-write registration arrays,
/// a paused-state buffer and per-event counters. Registration mutates under one
/// gate; dispatch reads a published snapshot and takes no lock.
/// </summary>
internal sealed class EcsEventRuntime
{
    /// <summary>Re-entrancy ceiling, matching the reference emitter.</summary>
    internal const int MaxDispatchDepth = 32;

    private readonly Lock _gate = new();
    private EcsEventBucket?[] _buckets = new EcsEventBucket?[64];
    private long _nextToken;
    private int _paused;
    private int _flushing;
    private int _flushRequested;
    private int _bufferCapacity = 1000;
    private int _overflow = (int)EcsEventBufferOverflow.Throw;

    [ThreadStatic]
    private static int s_threadDispatchDepth;

    internal bool IsPaused => Volatile.Read(ref _paused) != 0;

    internal int BufferCapacity
    {
        get => Volatile.Read(ref _bufferCapacity);
        set => Volatile.Write(ref _bufferCapacity, value);
    }

    internal EcsEventBufferOverflow Overflow
    {
        get => (EcsEventBufferOverflow)Volatile.Read(ref _overflow);
        set => Volatile.Write(ref _overflow, (int)value);
    }

    internal EcsEventBucket? Find(in EcsEventName name)
    {
        EcsEventBucket?[] buckets = Volatile.Read(ref _buckets);
        return (uint)name.Value < (uint)buckets.Length ? buckets[name.Value] : null;
    }

    internal EcsEventBucket GetOrAdd(in EcsEventName name)
    {
        EcsEventBucket? bucket = Find(in name);
        if (bucket is not null)
        {
            return bucket;
        }

        lock (_gate)
        {
            return GetOrAddLocked(in name);
        }
    }

    private EcsEventBucket GetOrAddLocked(in EcsEventName name)
    {
        EcsEventBucket?[] buckets = Volatile.Read(ref _buckets);
        if ((uint)name.Value >= (uint)buckets.Length)
        {
            int grown = buckets.Length;
            while ((uint)name.Value >= (uint)grown)
            {
                grown *= 2;
            }

            Array.Resize(ref buckets, grown);
            Volatile.Write(ref _buckets, buckets);
        }

        ref EcsEventBucket? slot = ref buckets[name.Value];
        EcsEventBucket? bucket = Volatile.Read(ref slot);
        if (bucket is null)
        {
            bucket = new EcsEventBucket();
            Volatile.Write(ref slot, bucket);
        }

        return bucket;
    }

    internal EcsEventSubscription Subscribe<TPayload>(
        in EcsEventName name,
        EcsEventCallback<TPayload> handler,
        bool once)
        where TPayload : unmanaged
    {
        lock (_gate)
        {
            EcsEventBucket bucket = GetOrAddLocked(in name);
            long token = ++_nextToken;
            EcsEventRegistration[] current = bucket.Registrations;
            EcsEventRegistration[] next = new EcsEventRegistration[current.Length + 1];
            Array.Copy(current, next, current.Length);
            next[^1] = new EcsEventRegistration(token, handler, once);
            Volatile.Write(ref bucket.Registrations, next);
            return new EcsEventSubscription(name.Value, token);
        }
    }

    internal bool Unsubscribe(in EcsEventSubscription subscription)
    {
        lock (_gate)
        {
            if ((uint)subscription.EventSlot >= (uint)_buckets.Length)
            {
                return false;
            }

            EcsEventBucket? bucket = _buckets[subscription.EventSlot];
            return bucket is not null && RemoveByToken(bucket, subscription.Token);
        }
    }

    internal int UnsubscribeAll(in EcsEventName name)
    {
        lock (_gate)
        {
            if ((uint)name.Value >= (uint)_buckets.Length)
            {
                return 0;
            }

            EcsEventBucket? bucket = _buckets[name.Value];
            if (bucket is null || bucket.Registrations.Length == 0)
            {
                return 0;
            }

            int removed = bucket.Registrations.Length;
            Volatile.Write(ref bucket.Registrations, EcsEventBucket.EmptyRegistrations);
            return removed;
        }
    }

    internal int UnsubscribeHandler<TPayload>(in EcsEventName name, EcsEventCallback<TPayload> handler)
        where TPayload : unmanaged
    {
        lock (_gate)
        {
            if ((uint)name.Value >= (uint)_buckets.Length)
            {
                return 0;
            }

            EcsEventBucket? bucket = _buckets[name.Value];
            if (bucket is null)
            {
                return 0;
            }

            int removed = 0;
            EcsEventRegistration[] current = bucket.Registrations;
            EcsEventRegistration[] next = new EcsEventRegistration[current.Length];
            int kept = 0;
            for (int i = 0; i < current.Length; i++)
            {
                if (Equals(current[i].Handler, handler))
                {
                    removed++;
                    continue;
                }

                next[kept++] = current[i];
            }

            if (removed > 0)
            {
                if (kept == 0)
                {
                    Volatile.Write(ref bucket.Registrations, EcsEventBucket.EmptyRegistrations);
                }
                else if (kept < next.Length)
                {
                    Array.Resize(ref next, kept);
                    Volatile.Write(ref bucket.Registrations, next);
                }
            }

            return removed;
        }
    }

    internal void Pause()
    {
        Interlocked.Exchange(ref _paused, 1);
    }

    internal void SetPaused(bool value) => Interlocked.Exchange(ref _paused, value ? 1 : 0);

    /// <summary>
    /// Delivers parked events. One pump runs at a time: a nested or concurrent request raises a
    /// request flag and the running pump takes another pass, so no parked event waits for an
    /// unrelated call. Each pass is budgeted by the pending count at its start, so a handler that
    /// parks new events cannot livelock the pump.
    /// </summary>
    internal int FlushAll(bool respectPaused)
    {
        if (Interlocked.CompareExchange(ref _flushing, 1, 0) != 0)
        {
            Volatile.Write(ref _flushRequested, 1);
            return 0;
        }

        int dispatched = 0;
        try
        {
            while (true)
            {
                Volatile.Write(ref _flushRequested, 0);
                int budget = CountPending();
                if (budget == 0)
                {
                    break;
                }

                dispatched += FlushPass(budget, respectPaused);
                if (Volatile.Read(ref _flushRequested) == 0 || (respectPaused && IsPaused))
                {
                    break;
                }
            }
        }
        finally
        {
            Volatile.Write(ref _flushing, 0);
        }

        return dispatched;
    }

    internal int CountPending()
    {
        int pending = 0;
        EcsEventBucket?[] buckets = Volatile.Read(ref _buckets);
        for (int slot = 0; slot < buckets.Length; slot++)
        {
            pending += buckets[slot]?.Buffer?.Count ?? 0;
        }

        return pending;
    }

    private int FlushPass(int budget, bool respectPaused)
    {
        int dispatched = 0;
        EcsEventBucket?[] buckets = Volatile.Read(ref _buckets);
        for (int slot = 0; slot < buckets.Length && budget > 0; slot++)
        {
            EcsEventBucket? bucket = buckets[slot];
            EcsEventBuffer? buffer = bucket is null ? null : Volatile.Read(ref bucket.Buffer);
            if (bucket is null || buffer is null || buffer.Count == 0)
            {
                continue;
            }

            dispatched += FlushBucket(bucket, new EcsEventName(slot), respectPaused, ref budget);
        }

        return dispatched;
    }

    private int FlushBucket(
        EcsEventBucket bucket,
        in EcsEventName name,
        bool respectPaused,
        ref int budget)
    {
        int dispatched = 0;
        EcsEventBuffer buffer = Volatile.Read(ref bucket.Buffer)!;
        Span<byte> scratch = stackalloc byte[EcsEventBuffer.SlotBytes];

        while (budget > 0 && buffer.TryReadHead(scratch, out IEcsEventPayloadBridge? bridge, out int size))
        {
            budget--;
            if (bridge is null)
            {
                continue;
            }

            EcsEventRegistration[] registrations = Volatile.Read(ref bucket.Registrations);
            bool hasOnce = false;
            for (int i = 0; i < registrations.Length; i++)
            {
                EcsEventRegistration registration = registrations[i];
                hasOnce |= registration.Once;
                try
                {
                    if (bridge.Invoke(registration.Handler, in name, scratch[..size]))
                    {
                        dispatched++;
                        _ = Interlocked.Increment(ref bucket.InvocationCount);
                    }
                }
                catch (Exception error) when (error is not IEcsEventBusError)
                {
                    RecordFault(bucket, error);
                }
                catch (Exception error) when (error is IEcsEventBusError)
                {
                    _ = Interlocked.Increment(ref bucket.DroppedCount);
                    RecordFault(bucket, error);
                }
            }

            if (hasOnce)
            {
                RemoveExpiredOnce(bucket, registrations, bridge);
            }

            if (respectPaused && IsPaused)
            {
                break;
            }
        }

        return dispatched;
    }

    internal bool Dispatch<TPayload>(in EcsEventName name, in TPayload payload)
        where TPayload : unmanaged
    {
        EcsEventBucket bucket = GetOrAdd(in name);
        if (IsPaused)
        {
            return BufferEvent(bucket, in name, in payload);
        }

        _ = Interlocked.Increment(ref bucket.EmitCount);
        Volatile.Write(ref bucket.LastEmittedTimestamp, Stopwatch.GetTimestamp());

        EcsEventRegistration[] registrations = Volatile.Read(ref bucket.Registrations);
        if (registrations.Length == 0)
        {
            return false;
        }

        int depth = ++s_threadDispatchDepth;
        if (depth > MaxDispatchDepth)
        {
            s_threadDispatchDepth = depth - 1;
            EcsThrowHelper.ThrowDispatchDepthExceeded(depth);
        }

        long started = Stopwatch.GetTimestamp();
        bool invoked = false;
        bool faulted = false;
        bool hasOnce = false;
        try
        {
            for (int i = 0; i < registrations.Length; i++)
            {
                EcsEventRegistration registration = registrations[i];
                if (registration.Handler is not EcsEventCallback<TPayload> typed)
                {
                    continue;
                }

                invoked = true;
                hasOnce |= registration.Once;
                try
                {
                    typed(in name, in payload);
                    _ = Interlocked.Increment(ref bucket.InvocationCount);
                }
                catch (Exception error) when (error is not IEcsEventBusError)
                {
                    faulted = true;
                    RecordFault(bucket, error);
                }
            }
        }
        finally
        {
            s_threadDispatchDepth = depth - 1;
            long elapsed = (Stopwatch.GetTimestamp() - started) * 1_000_000_000L / Stopwatch.Frequency;
            _ = Interlocked.Add(ref bucket.TotalNanoseconds, elapsed);
            long max = Volatile.Read(ref bucket.MaxNanoseconds);
            while (elapsed > max && Interlocked.CompareExchange(ref bucket.MaxNanoseconds, elapsed, max) != max)
            {
                max = Volatile.Read(ref bucket.MaxNanoseconds);
            }
        }

        if (hasOnce)
        {
            RemoveExpiredOnce(bucket, registrations, EcsEventPayloadBridge<TPayload>.Instance);
        }

        return invoked && !faulted;
    }

    internal void Dispose()
    {
        lock (_gate)
        {
            for (int i = 0; i < _buckets.Length; i++)
            {
                EcsEventBucket? bucket = _buckets[i];
                if (bucket is null)
                {
                    continue;
                }

                Volatile.Write(ref bucket.Registrations, EcsEventBucket.EmptyRegistrations);
                EcsEventBuffer? buffer = Volatile.Read(ref bucket.Buffer);
                if (buffer is not null)
                {
                    int lost = buffer.Clear();
                    _ = Interlocked.Add(ref bucket.DroppedCount, lost);
                }
            }
        }
    }

    private static bool RemoveByToken(EcsEventBucket bucket, long token)
    {
        EcsEventRegistration[] current = bucket.Registrations;
        int match = -1;
        for (int i = 0; i < current.Length; i++)
        {
            if (current[i].Token == token)
            {
                match = i;
                break;
            }
        }

        if (match < 0)
        {
            return false;
        }

        if (current.Length == 1)
        {
            Volatile.Write(ref bucket.Registrations, EcsEventBucket.EmptyRegistrations);
            return true;
        }

        EcsEventRegistration[] next = new EcsEventRegistration[current.Length - 1];
        Array.Copy(current, 0, next, 0, match);
        Array.Copy(current, match + 1, next, match, current.Length - match - 1);
        Volatile.Write(ref bucket.Registrations, next);
        return true;
    }

    private static void RecordFault(EcsEventBucket bucket, Exception error)
    {
        _ = Interlocked.Increment(ref bucket.FaultCount);
        if (Volatile.Read(ref bucket.LastFault) is null)
        {
            _ = Interlocked.CompareExchange(ref bucket.LastFault, ExceptionDispatchInfo.Capture(error), null);
        }
    }

    /// <summary>
    /// Drops once-registrations that actually took part in the dispatch that just finished.
    /// Entries registered afterwards, or once-handlers waiting for a different payload shape,
    /// stay subscribed.
    /// </summary>
    private void RemoveExpiredOnce(
        EcsEventBucket bucket,
        EcsEventRegistration[] dispatched,
        IEcsEventPayloadBridge bridge)
    {
        lock (_gate)
        {
            EcsEventRegistration[] current = bucket.Registrations;
            int keep = 0;
            for (int i = 0; i < current.Length; i++)
            {
                if (!IsExpired(current[i], dispatched, bridge))
                {
                    keep++;
                }
            }

            if (keep == current.Length)
            {
                return;
            }

            if (keep == 0)
            {
                Volatile.Write(ref bucket.Registrations, EcsEventBucket.EmptyRegistrations);
                return;
            }

            EcsEventRegistration[] next = new EcsEventRegistration[keep];
            int written = 0;
            for (int i = 0; i < current.Length; i++)
            {
                if (!IsExpired(current[i], dispatched, bridge))
                {
                    next[written++] = current[i];
                }
            }

            Volatile.Write(ref bucket.Registrations, next);
        }
    }

    private static bool IsExpired(
        in EcsEventRegistration candidate,
        EcsEventRegistration[] dispatched,
        IEcsEventPayloadBridge bridge)
    {
        if (!candidate.Once || !bridge.Matches(candidate.Handler))
        {
            return false;
        }

        for (int i = 0; i < dispatched.Length; i++)
        {
            if (dispatched[i].Token == candidate.Token)
            {
                return true;
            }
        }

        return false;
    }

    private bool BufferEvent<TPayload>(EcsEventBucket bucket, in EcsEventName name, in TPayload payload)
        where TPayload : unmanaged
    {
        EcsEventPayloadBridge<TPayload> bridge = EcsEventPayloadBridge<TPayload>.Instance;
        int size = bridge.PayloadSize;
        if (size > EcsEventBuffer.SlotBytes)
        {
            EcsThrowHelper.ThrowEventPayloadTooLarge(typeof(TPayload).Name, size, EcsEventBuffer.SlotBytes);
        }

        EcsEventBuffer? buffer = Volatile.Read(ref bucket.Buffer);
        if (buffer is null)
        {
            lock (_gate)
            {
                buffer = Volatile.Read(ref bucket.Buffer);
                if (buffer is null)
                {
                    buffer = new EcsEventBuffer(BufferCapacity);
                    Volatile.Write(ref bucket.Buffer, buffer);
                }
            }
        }

        ReadOnlySpan<byte> bytes = MemoryMarshal.CreateReadOnlySpan(
            ref Unsafe.As<TPayload, byte>(ref Unsafe.AsRef(in payload)),
            size);
        EcsEventParkResult result = buffer.TryPark(bytes, bridge, Overflow);
        switch (result)
        {
            case EcsEventParkResult.Written:
                _ = Interlocked.Increment(ref bucket.BufferedCount);
                break;

            case EcsEventParkResult.EvictedOldest:
                _ = Interlocked.Increment(ref bucket.BufferedCount);
                _ = Interlocked.Increment(ref bucket.DroppedCount);
                break;

            case EcsEventParkResult.RefusedNewest:
                _ = Interlocked.Increment(ref bucket.DroppedCount);
                return false;

            default:
                EcsThrowHelper.ThrowEventBufferFull(name, BufferCapacity);
                return false;
        }

        _ = Interlocked.Increment(ref bucket.EmitCount);
        Volatile.Write(ref bucket.LastEmittedTimestamp, Stopwatch.GetTimestamp());
        return true;
    }
}

/// <summary>
/// World-facing event surface: subscription, emit, pause/resume/drain and per-event metrics.
/// </summary>
public sealed partial class World
{
    private readonly EcsEventRuntime _events = new();

    /// <summary>Whether emissions are currently parked instead of dispatched.</summary>
    public bool EventsPaused => _events.IsPaused;

    /// <summary>
    /// Per-event capacity of the paused buffer. Applied when an event's ring is first created,
    /// which is the one allocation the park path pays per event (capacity x 64 payload bytes on
    /// the pinned heap); set it before pausing to keep that cost out of a frame.
    /// </summary>
    public int EventBufferCapacity
    {
        get => _events.BufferCapacity;
        set
        {
            if (value < 1)
            {
                EcsThrowHelper.ThrowInvalidEventBufferCapacity(value);
            }

            _events.BufferCapacity = value;
        }
    }

    /// <summary>Policy applied when a paused buffer is full.</summary>
    public EcsEventBufferOverflow EventBufferOverflow
    {
        get => _events.Overflow;
        set => _events.Overflow = value;
    }

    /// <summary>Total emissions still parked across every event.</summary>
    public int PendingEventCount => _events.CountPending();

    /// <summary>Registers a handler; the same delegate twice is two registrations.</summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="handler">Synchronous handler.</param>
    /// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
    /// <returns>Token that unsubscribes exactly this registration.</returns>
    public EcsEventSubscription On<TPayload>(in EcsEventName name, EcsEventCallback<TPayload> handler)
        where TPayload : unmanaged
    {
        ValidateWorldOpen(nameof(On));
        ValidateEventName(in name, nameof(On));
        ArgumentNullException.ThrowIfNull(handler);
        return _events.Subscribe(in name, handler, once: false);
    }

    /// <summary>Registers a handler that is dropped after its first invocation.</summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="handler">Synchronous handler.</param>
    /// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
    /// <returns>Token that unsubscribes before the handler ever fires.</returns>
    public EcsEventSubscription Once<TPayload>(in EcsEventName name, EcsEventCallback<TPayload> handler)
        where TPayload : unmanaged
    {
        ValidateWorldOpen(nameof(Once));
        ValidateEventName(in name, nameof(Once));
        ArgumentNullException.ThrowIfNull(handler);
        return _events.Subscribe(in name, handler, once: true);
    }

    /// <summary>Removes one registration; false when the token is already gone.</summary>
    /// <param name="subscription">Token returned by <see cref="On{TPayload}"/> or <see cref="Once{TPayload}"/>.</param>
    /// <returns>Whether a registration was removed.</returns>
    public bool Off(in EcsEventSubscription subscription) => _events.Unsubscribe(in subscription);

    /// <summary>Removes every registration of one delegate, matching the reference emitter.</summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="handler">Delegate whose registrations are removed.</param>
    /// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
    /// <returns>Registrations removed.</returns>
    public int OffHandlers<TPayload>(in EcsEventName name, EcsEventCallback<TPayload> handler)
        where TPayload : unmanaged
    {
        ArgumentNullException.ThrowIfNull(handler);
        return _events.UnsubscribeHandler(in name, handler);
    }

    /// <summary>Removes every registration of one event.</summary>
    /// <param name="name">Interned event name.</param>
    /// <returns>Registrations removed.</returns>
    public int OffAll(in EcsEventName name) => _events.UnsubscribeAll(in name);

    /// <summary>Live registration count for one event.</summary>
    /// <param name="name">Interned event name.</param>
    public int HandlerCount(in EcsEventName name) => _events.Find(in name)?.Registrations.Length ?? 0;

    /// <summary>Dispatches to every handler of matching payload shape, inline and in registration order.</summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="payload">Payload passed by reference.</param>
    /// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
    /// <returns>True when every matched handler ran without throwing; false when nothing was
    /// subscribed or a handler faulted. While paused it reports that the event was parked.</returns>
    public bool EmitSync<TPayload>(in EcsEventName name, in TPayload payload)
        where TPayload : unmanaged
    {
        ValidateWorldOpen(nameof(EmitSync));
        ValidateEventName(in name, nameof(EmitSync));
        return _events.Dispatch(in name, in payload);
    }

    /// <summary>
    /// Async parity of <see cref="EmitSync{TPayload}"/>. Handlers in this port are synchronous
    /// delegates, so the dispatch completes inline and the returned value is already resolved;
    /// ordering across successive calls is therefore strict call order.
    /// </summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="payload">Payload passed by reference.</param>
    /// <typeparam name="TPayload">Unmanaged payload shape.</typeparam>
    /// <returns>The same result <see cref="EmitSync{TPayload}"/> reports.</returns>
    public ValueTask<bool> Emit<TPayload>(in EcsEventName name, in TPayload payload)
        where TPayload : unmanaged => new(EmitSync(in name, in payload));

    /// <summary>Parks subsequent emissions instead of dispatching them. Idempotent.</summary>
    public void PauseEvents() => _events.Pause();

    /// <summary>
    /// Clears the paused flag and dispatches parked events FIFO, event slot ascending,
    /// in the order they were parked. Stops early when a handler pauses again mid-flush;
    /// the remainder stays parked and <see cref="DrainEventsAsync"/> delivers it.
    /// </summary>
    /// <returns>Handler invocations the flush performed.</returns>
    public int ResumeEvents()
    {
        ValidateWorldOpen(nameof(ResumeEvents));
        _events.SetPaused(false);
        return _events.FlushAll(respectPaused: true);
    }

    /// <summary>
    /// Delivers everything already parked, FIFO, whether or not the world is paused.
    /// The pause flag is untouched, so emissions arriving during a drain stay parked.
    /// </summary>
    /// <param name="cancellationToken">Cancellation gate checked before dispatching.</param>
    /// <returns>Handler invocations the drain performed.</returns>
    public ValueTask<int> DrainEventsAsync(CancellationToken cancellationToken = default)
    {
        ValidateWorldOpen(nameof(DrainEventsAsync));
        cancellationToken.ThrowIfCancellationRequested();
        return new ValueTask<int>(_events.FlushAll(respectPaused: false));
    }

    /// <summary>Reads counters for one event.</summary>
    /// <param name="name">Interned event name.</param>
    /// <param name="metrics">Counters when the event was touched.</param>
    /// <returns>False when the event has no bucket yet.</returns>
    public bool TryGetEventMetrics(in EcsEventName name, out EcsEventMetrics metrics)
    {
        EcsEventBucket? bucket = _events.Find(in name);
        if (bucket is null)
        {
            metrics = default;
            return false;
        }

        metrics = new EcsEventMetrics(
            Volatile.Read(ref bucket.EmitCount),
            Volatile.Read(ref bucket.InvocationCount),
            Volatile.Read(ref bucket.BufferedCount),
            Volatile.Read(ref bucket.DroppedCount),
            Volatile.Read(ref bucket.FaultCount),
            Volatile.Read(ref bucket.TotalNanoseconds),
            Volatile.Read(ref bucket.MaxNanoseconds),
            bucket.Buffer?.Count ?? 0,
            bucket.Registrations.Length,
            Volatile.Read(ref bucket.LastEmittedTimestamp));
        return true;
    }

    /// <summary>The fault that first broke this event, with its original stack.</summary>
    /// <param name="name">Interned event name.</param>
    /// <returns>Captured fault, or null when the event never faulted.</returns>
    public ExceptionDispatchInfo? GetEventFault(in EcsEventName name) => _events.Find(in name)?.LastFault;

    private static void ValidateEventName(in EcsEventName name, string operation)
    {
        if (name.Value < 1)
        {
            EcsThrowHelper.ThrowInvalidEventName(operation);
        }
    }
}
