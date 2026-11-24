namespace Axrone.Event.Hub;

using System.Globalization;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Threading.Tasks.Sources;
using Axrone.Utility.Backoff;
using Axrone.Utility.Backoff.SpinPolicies;

public interface IEventConsumer<TEvent> where TEvent : allows ref struct
{
    void OnEvent(scoped in TEvent evt);
}

public interface IEventFilter<TEvent> where TEvent : allows ref struct
{
    bool ShouldProcess(scoped in TEvent evt);
}

public interface IEventVisitor<TEvent> where TEvent : allows ref struct
{
    void Visit(scoped in TEvent evt);
}

public interface IEventMetricsSink
{
    static abstract void OnPublished(SequenceNumber sequence, nuint subscriberCount, nuint waitersSignaled);
    static abstract void OnWaiterEnqueued(int poolRemaining);
    static abstract void OnDrainPhaseStarted();
    static abstract void OnDrainPhaseCompleted();
    static abstract void OnFaultRecorded(Exception error);
}

public interface IEventPublisher<TEvent>
{
    SequenceNumber Cursor { get; }
    PublishResult Publish(scoped in TEvent eventData);
    void PublishBatch(params ReadOnlySpan<TEvent> events);
}

public interface IEventSubscriberRegistry<TEvent>
{
    SubscriptionToken Subscribe(IEventConsumer<TEvent> consumer);
    SubscriptionToken Subscribe(Action<TEvent> handler);
    SubscriptionToken SubscribeFiltered<TConsumer, TFilter>(TConsumer consumer, TFilter filter)
        where TConsumer : struct, IEventConsumer<TEvent>
        where TFilter : struct, IEventFilter<TEvent>;
    bool Unsubscribe(in SubscriptionToken token);
}

public interface IEventReader<TEvent>
{
    ValueTask<TEvent> ReadNextAsync(CancellationToken cancellationToken = default);
    ReadResult<TEvent> TryReadNext(TimeSpan timeout, CancellationToken cancellationToken = default);
    bool TryReadNext(out TEvent result, TimeSpan timeout, CancellationToken cancellationToken = default);
}

public interface IEventHubLifecycle : IDisposable, IAsyncDisposable
{
    bool IsTerminated { get; }
    void Complete(Exception? fault = null);
    ValueTask DrainAsync(CancellationToken cancellationToken = default);
}

public interface IEventHub<TEvent> :
    IEventPublisher<TEvent>,
    IEventSubscriberRegistry<TEvent>,
    IEventReader<TEvent>,
    IEventHubLifecycle
{
}

public readonly struct NullMetricsSink : IEventMetricsSink
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnPublished(SequenceNumber sequence, nuint subscriberCount, nuint waitersSignaled) { }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnWaiterEnqueued(int poolRemaining) { }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnDrainPhaseStarted() { }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnDrainPhaseCompleted() { }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void OnFaultRecorded(Exception error) { }
}

[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct SequenceNumber(long Value) :
    IComparable<SequenceNumber>,
    IEquatable<SequenceNumber>,
    IComparisonOperators<SequenceNumber, SequenceNumber, bool>,
    IIncrementOperators<SequenceNumber>,
    IAdditionOperators<SequenceNumber, long, SequenceNumber>
{
    public static SequenceNumber Zero => new(0L);

    public bool IsInitialized
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Value > 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(SequenceNumber other) => Value.CompareTo(other.Value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public override string ToString() => Value.ToString(CultureInfo.InvariantCulture);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(SequenceNumber left, SequenceNumber right) => left.Value > right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(SequenceNumber left, SequenceNumber right) => left.Value < right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(SequenceNumber left, SequenceNumber right) => left.Value >= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(SequenceNumber left, SequenceNumber right) => left.Value <= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SequenceNumber operator ++(SequenceNumber value) => new(value.Value + 1);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SequenceNumber operator +(SequenceNumber left, long right) => new(left.Value + right);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct WaiterSlotIndex(int Value) :
    IComparable<WaiterSlotIndex>,
    IEquatable<WaiterSlotIndex>,
    IComparisonOperators<WaiterSlotIndex, WaiterSlotIndex, bool>
{
    public static WaiterSlotIndex Invalid => new(-1);

    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Value >= 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(WaiterSlotIndex other) => Value.CompareTo(other.Value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(WaiterSlotIndex left, WaiterSlotIndex right) => left.Value > right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(WaiterSlotIndex left, WaiterSlotIndex right) => left.Value < right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(WaiterSlotIndex left, WaiterSlotIndex right) => left.Value >= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(WaiterSlotIndex left, WaiterSlotIndex right) => left.Value <= right.Value;
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SubscriptionSlotIndex(int Value) :
    IComparable<SubscriptionSlotIndex>,
    IEquatable<SubscriptionSlotIndex>,
    IComparisonOperators<SubscriptionSlotIndex, SubscriptionSlotIndex, bool>
{
    public static SubscriptionSlotIndex Invalid => new(-1);

    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Value >= 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(SubscriptionSlotIndex other) => Value.CompareTo(other.Value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(SubscriptionSlotIndex left, SubscriptionSlotIndex right) => left.Value > right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(SubscriptionSlotIndex left, SubscriptionSlotIndex right) => left.Value < right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(SubscriptionSlotIndex left, SubscriptionSlotIndex right) => left.Value >= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(SubscriptionSlotIndex left, SubscriptionSlotIndex right) => left.Value <= right.Value;
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct GenerationId(uint Value) :
    IComparable<GenerationId>,
    IEquatable<GenerationId>,
    IComparisonOperators<GenerationId, GenerationId, bool>,
    IIncrementOperators<GenerationId>
{
    public static GenerationId None => new(0U);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(GenerationId other) => Value.CompareTo(other.Value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(GenerationId left, GenerationId right) => left.Value > right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(GenerationId left, GenerationId right) => left.Value < right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(GenerationId left, GenerationId right) => left.Value >= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(GenerationId left, GenerationId right) => left.Value <= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static GenerationId operator ++(GenerationId value) => new(unchecked(value.Value + 1));
}

[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct RegistrationId(long Value) :
    IComparable<RegistrationId>,
    IEquatable<RegistrationId>,
    IComparisonOperators<RegistrationId, RegistrationId, bool>,
    IIncrementOperators<RegistrationId>
{
    public static RegistrationId None => new(0L);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(RegistrationId other) => Value.CompareTo(other.Value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(RegistrationId left, RegistrationId right) => left.Value > right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(RegistrationId left, RegistrationId right) => left.Value < right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(RegistrationId left, RegistrationId right) => left.Value >= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(RegistrationId left, RegistrationId right) => left.Value <= right.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RegistrationId operator ++(RegistrationId value) => new(value.Value + 1);
}

[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct SubscriptionToken(
    RegistrationId RegistrationId,
    SubscriptionSlotIndex SlotIndex,
    GenerationId Generation) : IEquatable<SubscriptionToken>;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct PublishResult(
    SequenceNumber Sequence,
    int DispatchedSubscribers,
    int SignaledWaiters);

[StructLayout(LayoutKind.Sequential, Pack = 8)]
internal readonly record struct TaggedNodePointer(long Packed)
{
    public static TaggedNodePointer Empty => new(-1, 0);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TaggedNodePointer(int index, uint version)
        : this(((long)version << 32) | (long)(uint)index) { }

    public int Index
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (int)(uint)(Packed & 0xFFFF_FFFFL);
    }

    public uint Version
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => (uint)((ulong)Packed >> 32);
    }

    public bool IsEmpty
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Index < 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TaggedNodePointer WithNextVersion(int newIndex) =>
        new(newIndex, unchecked(Version + 1));
}

public enum ReadStatus : byte
{
    Success = 0,
    TimedOut = 1,
    Cancelled = 2,
    Completed = 3,
    Faulted = 4
}

[StructLayout(LayoutKind.Auto)]
public readonly struct ReadResult<T>
{
    public readonly ReadStatus Status;
    private readonly T _value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private ReadResult(ReadStatus status, T value)
    {
        Status = status;
        _value = value;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadResult<T> Success(T value) => new(ReadStatus.Success, value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadResult<T> TimedOut() => new(ReadStatus.TimedOut, default!);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadResult<T> Cancelled() => new(ReadStatus.Cancelled, default!);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadResult<T> Completed() => new(ReadStatus.Completed, default!);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadResult<T> Faulted() => new(ReadStatus.Faulted, default!);

    public bool IsSuccess
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Status == ReadStatus.Success;
    }

    public T Value
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get
        {
            if (Status != ReadStatus.Success)
            {
                ThrowHelper.ThrowInvalidReadState(Status);
            }
            return _value;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetValue(out T value)
    {
        value = _value;
        return Status == ReadStatus.Success;
    }
}

public sealed class EventHubOptions
{
    public int WaiterPoolCapacity
    {
        get => field;
        init => field = value > 0 ? value : ThrowHelper.ThrowArgumentOutOfRange<int>(nameof(value));
    } = 1024;

    public int MaxSubscribers
    {
        get => field;
        init => field = value > 0 ? value : ThrowHelper.ThrowArgumentOutOfRange<int>(nameof(value));
    } = 128;

    public int SpinCyclesBudget
    {
        get => field;
        init => field = value >= 0 ? value : ThrowHelper.ThrowArgumentOutOfRange<int>(nameof(value));
    } = 64;
}


