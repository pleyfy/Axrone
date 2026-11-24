namespace Axrone.Event.Hub;

using Axrone.Utility.Backoff;
using Axrone.Utility.Backoff.SpinPolicies;

using System.Runtime.InteropServices;
using System.Threading.Tasks.Sources;

public abstract class EventHubContext<TEvent>
{
    internal abstract void RecycleWaiter(int nodeIndex);
}

internal sealed class EventWaiterNode<TEvent> : IValueTaskSource<TEvent>, IDisposable
{
    internal const int ExecutionIdle = 0;
    internal const int ExecutionWaiting = 1;
    internal const int ExecutionSignaled = 2;
    internal const int ExecutionCancelled = 3;
    internal const int ExecutionFaulted = 4;

    internal const int ModeAsync = 0;
    internal const int ModeSync = 1;

    internal const int BitWaiterDetached = 1;
    internal const int BitConsumerDone = 2;

    private ManualResetValueTaskSourceCore<TEvent> _sourceCore;
    internal readonly ManualResetEventSlim SyncSignal;
    internal readonly int Index;
    internal readonly EventHubContext<TEvent> Context;

    internal int NextIndex;
    internal int OperationMode;
    internal int ExecutionState;
    internal int OwnerFlags;
    internal TEvent SyncValue;
    internal CancellationTokenRegistration CancellationReg;

    public EventWaiterNode(int index, EventHubContext<TEvent> context)
    {
        Index = index;
        Context = context;
        SyncSignal = new ManualResetEventSlim(false, 0);
        NextIndex = -1;
        ExecutionState = ExecutionIdle;
        OperationMode = ModeAsync;
        OwnerFlags = 0;
        SyncValue = default!;
        _sourceCore = new ManualResetValueTaskSourceCore<TEvent>
        {
            RunContinuationsAsynchronously = true
        };
    }

    public short Version
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _sourceCore.Version;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Prepare(int mode)
    {
        OperationMode = mode;
        OwnerFlags = 0;
        ExecutionState = ExecutionWaiting;
        if (mode == ModeSync)
        {
            SyncSignal.Reset();
            SyncValue = default!;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TrySignal(scoped in TEvent payload)
    {
        if (Interlocked.CompareExchange(ref ExecutionState, ExecutionSignaled, ExecutionWaiting) == ExecutionWaiting)
        {
            CancellationReg.Dispose();
            if (OperationMode == ModeAsync)
            {
                _sourceCore.SetResult(payload);
            }
            else
            {
                SyncValue = payload;
                SyncSignal.Set();
            }
            return true;
        }
        return false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryCancel(CancellationToken ct)
    {
        if (Interlocked.CompareExchange(ref ExecutionState, ExecutionCancelled, ExecutionWaiting) == ExecutionWaiting)
        {
            if (OperationMode == ModeAsync)
            {
                _sourceCore.SetException(new OperationCanceledException(ct));
            }
            else
            {
                SyncSignal.Set();
            }
            return true;
        }
        return false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryFault(Exception exception)
    {
        if (Interlocked.CompareExchange(ref ExecutionState, ExecutionFaulted, ExecutionWaiting) == ExecutionWaiting)
        {
            CancellationReg.Dispose();
            if (OperationMode == ModeAsync)
            {
                _sourceCore.SetException(exception);
            }
            else
            {
                SyncSignal.Set();
            }
            return true;
        }
        return false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TEvent GetResult(short token)
    {
        try
        {
            return _sourceCore.GetResult(token);
        }
        finally
        {
            _sourceCore.Reset();
            ExecutionState = ExecutionIdle;
            int prev = Interlocked.Or(ref OwnerFlags, BitConsumerDone);
            if ((prev & BitWaiterDetached) != 0)
            {
                Context.RecycleWaiter(Index);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ValueTaskSourceStatus GetStatus(short token) => _sourceCore.GetStatus(token);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void OnCompleted(Action<object?> continuation, object? state, short token, ValueTaskSourceOnCompletedFlags flags) =>
        _sourceCore.OnCompleted(continuation, state, token, flags);

    public void Dispose()
    {
        CancellationReg.Dispose();
        SyncSignal.Dispose();
    }
}

internal sealed class DelegateConsumer<TEvent> : IEventConsumer<TEvent>
{
    private readonly Action<TEvent> _action;

    public DelegateConsumer(Action<TEvent> action)
    {
        _action = action;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void OnEvent(scoped in TEvent evt) => _action(evt);
}

internal sealed class FilteredConsumer<TEvent, TConsumer, TFilter> : IEventConsumer<TEvent>
    where TConsumer : struct, IEventConsumer<TEvent>
    where TFilter : struct, IEventFilter<TEvent>
{
    private TConsumer _consumer;
    private TFilter _filter;

    public FilteredConsumer(TConsumer consumer, TFilter filter)
    {
        _consumer = consumer;
        _filter = filter;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void OnEvent(scoped in TEvent evt)
    {
        if (_filter.ShouldProcess(in evt))
        {
            _consumer.OnEvent(in evt);
        }
    }
}

public class EventHub<TEvent, TBackoff, TMetricsSink> : EventHubContext<TEvent>, IEventHub<TEvent>
    where TBackoff : struct, ISpinBackoff
    where TMetricsSink : struct, IEventMetricsSink
{
    private const int StatusActive = 0;
    private const int StatusCompleting = 1;
    private const int StatusCompleted = 2;
    private const int StatusFaulted = 3;
    private const int StatusDisposed = 4;

    private static readonly Action<object?, CancellationToken> s_cancellationHook = static (state, ct) =>
    {
        var node = Unsafe.As<EventWaiterNode<TEvent>>(state!);
        node.TryCancel(ct);
    };

    // Sequential with trailing size (explicit layout is illegal on generic
    // types): the 128-byte size keeps the producer and consumer zones on
    // isolated cache lines.
    [StructLayout(LayoutKind.Sequential, Size = 128)]
    private struct ProducerHotZone
    {
        public long Sequence;
        public int InFlightOperations;
        public int State;
    }

    [StructLayout(LayoutKind.Sequential, Size = 128)]
    private struct ConsumerHotZone
    {
        public long FreeHeadTagged;
        public long WaitersHeadTagged;
        public int ActiveWaitersCount;
        public int DrainSignaled;
    }

    internal sealed class RegistrationSlot
    {
        public IEventConsumer<TEvent>? Consumer;
        public GenerationId Generation;
        public RegistrationId RegistrationId;
    }

    private ProducerHotZone _producer;
    private ConsumerHotZone _consumer;

    private readonly Lock _gate;
    private readonly EventHubOptions _options;
    private readonly EventWaiterNode<TEvent>[] _waiters;
    private readonly RegistrationSlot[] _slots;

    /// <summary>
    /// Immutable dispatch snapshot. Publish reads this field once, so a subscriber added or
    /// removed by a handler can never observe a half-applied registry and can never receive the
    /// event that created it. Rebuilt on the subscribe/unsubscribe cold path.
    /// </summary>
    private IEventConsumer<TEvent>[] _activeConsumers = [];

    private ExceptionDispatchInfo? _fatalFault;
    private long _registrationIdentity;

    public EventHub() : this(new EventHubOptions()) { }

    public EventHub(EventHubOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;
        _gate = new Lock();

        _producer = default;
        _consumer = default;

        _producer.State = StatusActive;
        _producer.Sequence = 0;
        _producer.InFlightOperations = 0;

        _consumer.FreeHeadTagged = new TaggedNodePointer(0, 0).Packed;
        _consumer.WaitersHeadTagged = TaggedNodePointer.Empty.Packed;

        _waiters = new EventWaiterNode<TEvent>[options.WaiterPoolCapacity];
        for (int i = 0; i < _waiters.Length; i++)
        {
            var node = new EventWaiterNode<TEvent>(i, this)
            {
                NextIndex = (i == _waiters.Length - 1) ? -1 : i + 1
            };
            _waiters[i] = node;
        }

        _slots = new RegistrationSlot[options.MaxSubscribers];
        for (int i = 0; i < _slots.Length; i++)
        {
            _slots[i] = new RegistrationSlot();
        }
    }

    public SequenceNumber Cursor
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(Volatile.Read(ref _producer.Sequence));
    }

    public bool IsTerminated
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Volatile.Read(ref _producer.State) >= StatusCompleted;
    }

    public ActiveSubscriberEnumerable ActiveSubscribers
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(Volatile.Read(ref _activeConsumers));
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public PublishResult Publish(scoped in TEvent eventData)
    {
        AssertPublishState();

        Interlocked.Increment(ref _producer.InFlightOperations);
        try
        {
            long seq = Interlocked.Increment(ref _producer.Sequence);
            var assignedSequence = new SequenceNumber(seq);

            IEventConsumer<TEvent>[] consumers = Volatile.Read(ref _activeConsumers);
            int dispatchedCount = consumers.Length;

            for (int i = 0; i < dispatchedCount; i++)
            {
                consumers[i].OnEvent(in eventData);
            }

            int detachedHead = DetachWaiters();
            int signaledWaiters = 0;

            while (detachedHead != -1)
            {
                var node = _waiters[(uint)detachedHead];
                int next = node.NextIndex;
                node.NextIndex = -1;

                if (node.TrySignal(in eventData))
                {
                    signaledWaiters++;
                }

                int prev = Interlocked.Or(ref node.OwnerFlags, EventWaiterNode<TEvent>.BitWaiterDetached);
                if ((prev & EventWaiterNode<TEvent>.BitConsumerDone) != 0)
                {
                    RecycleWaiter(detachedHead);
                }

                detachedHead = next;
            }

            TMetricsSink.OnPublished(assignedSequence, (nuint)dispatchedCount, (nuint)signaledWaiters);
            return new PublishResult(assignedSequence, dispatchedCount, signaledWaiters);
        }
        finally
        {
            Interlocked.Decrement(ref _producer.InFlightOperations);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void PublishBatch(params ReadOnlySpan<TEvent> events)
    {
        nuint length = (nuint)events.Length;
        for (nuint i = 0; i < length; i++)
        {
            Publish(in events[(int)i]);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void AcceptVisitor<TVisitor>(ref TVisitor visitor, scoped in TEvent evt)
        where TVisitor : struct, IEventVisitor<TEvent>, allows ref struct
    {
        visitor.Visit(in evt);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ValueTask<TEvent> ReadNextAsync(CancellationToken cancellationToken = default)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return ValueTask.FromCanceled<TEvent>(cancellationToken);
        }

        int state = Volatile.Read(ref _producer.State);
        if (state == StatusFaulted)
        {
            _fatalFault?.Throw();
            ThrowHelper.ThrowEventFaulted(null);
        }
        if (state >= StatusCompleted)
        {
            ThrowHelper.ThrowEventCompleted();
        }

        int nodeIndex = RentWaiter();
        var node = _waiters[(uint)nodeIndex];

        node.Prepare(EventWaiterNode<TEvent>.ModeAsync);

        if (cancellationToken.CanBeCanceled)
        {
            node.CancellationReg = cancellationToken.UnsafeRegister(s_cancellationHook, node);
        }

        EnqueueWaiter(nodeIndex);
        TMetricsSink.OnWaiterEnqueued(Volatile.Read(ref _consumer.ActiveWaitersCount));

        return new ValueTask<TEvent>(node, node.Version);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public ReadResult<TEvent> TryReadNext(TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        int state = Volatile.Read(ref _producer.State);
        if (state == StatusFaulted)
        {
            _fatalFault?.Throw();
            ThrowHelper.ThrowEventFaulted(null);
        }
        if (state >= StatusCompleted)
        {
            ThrowHelper.ThrowEventCompleted();
        }

        int nodeIndex = RentWaiter();
        var node = _waiters[(uint)nodeIndex];

        node.Prepare(EventWaiterNode<TEvent>.ModeSync);

        CancellationTokenRegistration registration = default;
        if (cancellationToken.CanBeCanceled)
        {
            registration = cancellationToken.UnsafeRegister(s_cancellationHook, node);
        }

        try
        {
            EnqueueWaiter(nodeIndex);
            TMetricsSink.OnWaiterEnqueued(Volatile.Read(ref _consumer.ActiveWaitersCount));

            bool signaled = node.SyncSignal.Wait(timeout, cancellationToken);
            if (signaled)
            {
                int execState = Volatile.Read(ref node.ExecutionState);
                if (execState == EventWaiterNode<TEvent>.ExecutionSignaled)
                {
                    return ReadResult<TEvent>.Success(node.SyncValue);
                }
                if (execState == EventWaiterNode<TEvent>.ExecutionFaulted)
                {
                    _fatalFault?.Throw();
                    ThrowHelper.ThrowEventFaulted(null);
                }
                if (execState == EventWaiterNode<TEvent>.ExecutionCancelled)
                {
                    throw new OperationCanceledException(cancellationToken);
                }
            }

            if (node.TryCancel(CancellationToken.None))
            {
                return ReadResult<TEvent>.TimedOut();
            }

            node.SyncSignal.Wait(CancellationToken.None);
            return ReadResult<TEvent>.Success(node.SyncValue);
        }
        finally
        {
            registration.Dispose();
            int prev = Interlocked.Or(ref node.OwnerFlags, EventWaiterNode<TEvent>.BitConsumerDone);
            if ((prev & EventWaiterNode<TEvent>.BitConsumerDone) != 0)
            {
                RecycleWaiter(nodeIndex);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryReadNext(out TEvent result, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var readResult = TryReadNext(timeout, cancellationToken);
        return readResult.TryGetValue(out result!);
    }

    public SubscriptionToken Subscribe(IEventConsumer<TEvent> consumer)
    {
        ArgumentNullException.ThrowIfNull(consumer);
        AssertNotDisposed();

        lock (_gate)
        {
            var slots = _slots;
            nuint count = (nuint)slots.Length;

            for (nuint i = 0; i < count; i++)
            {
                var slot = slots[i];
                if (slot.Consumer is null)
                {
                    var registrationId = new RegistrationId(Interlocked.Increment(ref _registrationIdentity));
                    var nextGen = ++slot.Generation;

                    slot.RegistrationId = registrationId;
                    Volatile.Write(ref slot.Consumer, consumer);
                    RebuildActiveConsumersLocked();

                    return new SubscriptionToken(registrationId, new SubscriptionSlotIndex((int)i), nextGen);
                }
            }

            ThrowHelper.ThrowSubscriberCapacityExceeded();
            return default;
        }
    }

    public SubscriptionToken Subscribe(Action<TEvent> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        return Subscribe(new DelegateConsumer<TEvent>(handler));
    }

    public SubscriptionToken SubscribeFiltered<TConsumer, TFilter>(TConsumer consumer, TFilter filter)
        where TConsumer : struct, IEventConsumer<TEvent>
        where TFilter : struct, IEventFilter<TEvent>
    {
        AssertNotDisposed();
        return Subscribe(new FilteredConsumer<TEvent, TConsumer, TFilter>(consumer, filter));
    }

    public bool Unsubscribe(in SubscriptionToken token)
    {
        AssertNotDisposed();

        if ((uint)token.SlotIndex.Value >= (uint)_slots.Length)
        {
            ThrowHelper.ThrowInvalidToken();
        }

        lock (_gate)
        {
            var slot = _slots[(uint)token.SlotIndex.Value];
            if (slot.RegistrationId == token.RegistrationId && slot.Generation == token.Generation)
            {
                Volatile.Write(ref slot.Consumer, null);
                slot.RegistrationId = RegistrationId.None;
                RebuildActiveConsumersLocked();
                return true;
            }
        }

        return false;
    }

    public void Complete(Exception? fault = null)
    {
        int targetState = fault is null ? StatusCompleted : StatusFaulted;
        if (fault is not null)
        {
            _fatalFault = ExceptionDispatchInfo.Capture(fault);
            TMetricsSink.OnFaultRecorded(fault);
        }

        int previous = Interlocked.CompareExchange(ref _producer.State, targetState, StatusActive);
        if (previous != StatusActive)
        {
            return;
        }

        int detachedHead = DetachWaiters();
        while (detachedHead != -1)
        {
            var node = _waiters[(uint)detachedHead];
            int next = node.NextIndex;
            node.NextIndex = -1;

            if (fault is not null)
            {
                node.TryFault(fault);
            }
            else
            {
                node.TryCancel(CancellationToken.None);
            }

            int prev = Interlocked.Or(ref node.OwnerFlags, EventWaiterNode<TEvent>.BitWaiterDetached);
            if ((prev & EventWaiterNode<TEvent>.BitConsumerDone) != 0)
            {
                RecycleWaiter(detachedHead);
            }

            detachedHead = next;
        }
    }

    public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        TMetricsSink.OnDrainPhaseStarted();

        Volatile.Write(ref _consumer.DrainSignaled, 1);
        TBackoff.Initialize(out int spinCycles);

        while (Volatile.Read(ref _producer.InFlightOperations) > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (spinCycles < _options.SpinCyclesBudget)
            {
                TBackoff.Advance(ref spinCycles);
            }
            else
            {
                await Task.Yield();
            }
        }

        TMetricsSink.OnDrainPhaseCompleted();
    }

    /// <summary>
    /// Publishes a new immutable dispatch snapshot. Caller must hold <see cref="_gate"/>.
    /// Allocation happens only on subscribe/unsubscribe, never on publish.
    /// </summary>
    private void RebuildActiveConsumersLocked()
    {
        int active = 0;
        for (int i = 0; i < _slots.Length; i++)
        {
            if (Volatile.Read(ref _slots[i].Consumer) is not null)
            {
                active++;
            }
        }

        if (active == 0)
        {
            Volatile.Write(ref _activeConsumers, []);
            return;
        }

        var next = new IEventConsumer<TEvent>[active];
        int index = 0;
        for (int i = 0; i < _slots.Length; i++)
        {
            IEventConsumer<TEvent>? consumer = Volatile.Read(ref _slots[i].Consumer);
            if (consumer is not null)
            {
                next[index++] = consumer;
            }
        }

        Volatile.Write(ref _activeConsumers, next);
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        int observed = Interlocked.Exchange(ref _producer.State, StatusDisposed);
        if (observed == StatusDisposed)
        {
            return;
        }

        Complete();

        lock (_gate)
        {
            nuint count = (nuint)_slots.Length;
            for (nuint i = 0; i < count; i++)
            {
                Volatile.Write(ref _slots[i].Consumer, null);
                _slots[i].RegistrationId = RegistrationId.None;
            }

            RebuildActiveConsumersLocked();
        }

        if (disposing)
        {
            nuint waiterCount = (nuint)_waiters.Length;
            for (nuint i = 0; i < waiterCount; i++)
            {
                _waiters[i].Dispose();
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Volatile.Read(ref _producer.State) != StatusDisposed)
        {
            await DrainAsync().ConfigureAwait(false);
            Dispose();
        }
        GC.SuppressFinalize(this);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal override void RecycleWaiter(int nodeIndex)
    {
        var node = _waiters[(uint)nodeIndex];
        while (true)
        {
            long currentPacked = Volatile.Read(ref _consumer.FreeHeadTagged);
            var current = new TaggedNodePointer(currentPacked);
            if (current.IsEmpty)
            {
                ReclaimCancelledWaiters();
                currentPacked = Volatile.Read(ref _consumer.FreeHeadTagged);
                current = new TaggedNodePointer(currentPacked);
                if (current.IsEmpty)
                {
                    ThrowHelper.ThrowWaitCapacityExceeded();
                }
            }

            var nextNode = _waiters[(uint)current.Index];
            int nextIndex = nextNode.NextIndex;
            var next = current.WithNextVersion(nextIndex);

            if (Interlocked.CompareExchange(ref _consumer.FreeHeadTagged, next.Packed, currentPacked) == currentPacked)
            {
                node.NextIndex = -1;
                Interlocked.Increment(ref _consumer.ActiveWaitersCount);
                return;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int RentWaiter()
    {
        while (true)
        {
            long currentPacked = Volatile.Read(ref _consumer.FreeHeadTagged);
            var current = new TaggedNodePointer(currentPacked);
            if (current.IsEmpty)
            {
                ReclaimCancelledWaiters();
                currentPacked = Volatile.Read(ref _consumer.FreeHeadTagged);
                current = new TaggedNodePointer(currentPacked);
                if (current.IsEmpty)
                {
                    ThrowHelper.ThrowWaitCapacityExceeded();
                }
            }

            var node = _waiters[(uint)current.Index];
            int nextIndex = node.NextIndex;
            var next = current.WithNextVersion(nextIndex);

            if (Interlocked.CompareExchange(ref _consumer.FreeHeadTagged, next.Packed, currentPacked) == currentPacked)
            {
                node.NextIndex = -1;
                Interlocked.Increment(ref _consumer.ActiveWaitersCount);
                return current.Index;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EnqueueWaiter(int nodeIndex)
    {
        var node = _waiters[(uint)nodeIndex];
        while (true)
        {
            long currentPacked = Volatile.Read(ref _consumer.WaitersHeadTagged);
            var current = new TaggedNodePointer(currentPacked);

            node.NextIndex = current.Index;
            var next = current.WithNextVersion(nodeIndex);

            if (Interlocked.CompareExchange(ref _consumer.WaitersHeadTagged, next.Packed, currentPacked) == currentPacked)
            {
                break;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int DetachWaiters()
    {
        while (true)
        {
            long currentPacked = Volatile.Read(ref _consumer.WaitersHeadTagged);
            var current = new TaggedNodePointer(currentPacked);
            if (current.IsEmpty)
            {
                return -1;
            }

            var detached = current.WithNextVersion(-1);
            if (Interlocked.CompareExchange(ref _consumer.WaitersHeadTagged, detached.Packed, currentPacked) == currentPacked)
            {
                return current.Index;
            }
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void ReclaimCancelledWaiters()
    {
        int head = DetachWaiters();
        if (head < 0)
        {
            return;
        }

        int curr = head;
        int activeHead = -1;
        int activeTail = -1;

        while (curr >= 0)
        {
            var node = _waiters[(uint)curr];
            int next = node.NextIndex;
            node.NextIndex = -1;

            int state = Volatile.Read(ref node.ExecutionState);
            int flags = Interlocked.Or(ref node.OwnerFlags, EventWaiterNode<TEvent>.BitWaiterDetached);

            if ((flags & EventWaiterNode<TEvent>.BitConsumerDone) != 0 &&
                (state == EventWaiterNode<TEvent>.ExecutionCancelled || state == EventWaiterNode<TEvent>.ExecutionFaulted))
            {
                RecycleWaiter(curr);
            }
            else
            {
                Interlocked.And(ref node.OwnerFlags, ~EventWaiterNode<TEvent>.BitWaiterDetached);
                if (activeHead < 0)
                {
                    activeHead = curr;
                    activeTail = curr;
                }
                else
                {
                    _waiters[(uint)activeTail].NextIndex = curr;
                    activeTail = curr;
                }
            }

            curr = next;
        }

        if (activeHead >= 0)
        {
            SpliceWaiters(activeHead, activeTail);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void SpliceWaiters(int activeHead, int activeTail)
    {
        while (true)
        {
            long currentPacked = Volatile.Read(ref _consumer.WaitersHeadTagged);
            var current = new TaggedNodePointer(currentPacked);

            _waiters[(uint)activeTail].NextIndex = current.Index;
            var next = current.WithNextVersion(activeHead);

            if (Interlocked.CompareExchange(ref _consumer.WaitersHeadTagged, next.Packed, currentPacked) == currentPacked)
            {
                break;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void AssertPublishState()
    {
        int state = Volatile.Read(ref _producer.State);
        if (state == StatusActive)
        {
            return;
        }

        if (state == StatusFaulted)
        {
            _fatalFault?.Throw();
            ThrowHelper.ThrowEventFaulted(null);
        }
        if (state >= StatusCompleting)
        {
            ThrowHelper.ThrowEventCompleted();
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void AssertNotDisposed()
    {
        if (Volatile.Read(ref _producer.State) == StatusDisposed)
        {
            ThrowHelper.ThrowObjectDisposed(nameof(EventHub<TEvent, TBackoff, TMetricsSink>));
        }
    }

    public ref struct ActiveSubscriberEnumerator
    {
        private readonly IEventConsumer<TEvent>[] _consumers;
        private int _index;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal ActiveSubscriberEnumerator(IEventConsumer<TEvent>[] consumers)
        {
            _consumers = consumers;
            _index = -1;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool MoveNext()
        {
            int next = _index + 1;
            if ((uint)next < (uint)_consumers.Length)
            {
                _index = next;
                return true;
            }

            return false;
        }

        public IEventConsumer<TEvent> Current
        {
            [MethodImpl(MethodImplOptions.AggressiveInlining)]
            get => _consumers[_index];
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public ActiveSubscriberEnumerator GetEnumerator() => this;
    }

    public readonly struct ActiveSubscriberEnumerable
    {
        private readonly IEventConsumer<TEvent>[] _consumers;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal ActiveSubscriberEnumerable(IEventConsumer<TEvent>[] consumers) => _consumers = consumers;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public ActiveSubscriberEnumerator GetEnumerator() => new(_consumers);
    }
}

public sealed class EventHub<TEvent> : EventHub<TEvent, AdaptiveSpinBackoff, NullMetricsSink>
{
    public EventHub() : base(new EventHubOptions()) { }
    public EventHub(EventHubOptions options) : base(options) { }
}
