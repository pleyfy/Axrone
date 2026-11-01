namespace Axrone.Event.Internal;

/// <summary>Immutable subscription slot ordered by priority then registration sequence.</summary>
internal readonly struct EventSubscriptionEntry<TEvent>
{
    public EventSubscriptionEntry(
        EventSubscription<TEvent> subscription,
        EventPriority priority,
        long sequence)
    {
        Subscription = subscription;
        Priority = priority;
        Sequence = sequence;
    }

    public EventSubscription<TEvent> Subscription { get; }

    public EventPriority Priority { get; }

    public long Sequence { get; }
}

/// <summary>
/// Copy-on-write subscription registry. Registration and removal pay one array copy; dispatch
/// reads the published array reference without locking or allocating. Ordering is priority
/// ascending, then registration sequence, so dispatch is deterministic.
/// </summary>
internal sealed class EventSubscriptionTable<TEvent>
{
    private static readonly EventSubscriptionEntry<TEvent>[] Empty = [];

    private readonly Lock _gate = new();
    private EventSubscriptionEntry<TEvent>[] _entries = Empty;
    private long _sequence;

    /// <summary>Registered subscriptions.</summary>
    public int Count => Volatile.Read(ref _entries).Length;

    /// <summary>Current ordered snapshot; the returned array is never mutated.</summary>
    public EventSubscriptionEntry<TEvent>[] Entries
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Volatile.Read(ref _entries);
    }

    /// <summary>Adds a subscription in priority/registration order.</summary>
    public void Add(EventSubscription<TEvent> subscription)
    {
        lock (_gate)
        {
            EventSubscriptionEntry<TEvent>[] current = _entries;
            var entry = new EventSubscriptionEntry<TEvent>(
                subscription,
                subscription.Priority,
                ++_sequence);

            var next = new EventSubscriptionEntry<TEvent>[current.Length + 1];
            int index = 0;
            while (index < current.Length && Compare(in current[index], in entry) <= 0)
            {
                next[index] = current[index];
                index++;
            }

            next[index] = entry;
            for (int i = index; i < current.Length; i++)
            {
                next[i + 1] = current[i];
            }

            Volatile.Write(ref _entries, next);
        }
    }

    /// <summary>Removes a subscription by id; false when it was already gone.</summary>
    public bool Remove(Guid subscriptionId)
    {
        lock (_gate)
        {
            EventSubscriptionEntry<TEvent>[] current = _entries;
            int index = -1;
            for (int i = 0; i < current.Length; i++)
            {
                if (current[i].Subscription.SubscriptionId == subscriptionId)
                {
                    index = i;
                    break;
                }
            }

            if (index < 0)
            {
                return false;
            }

            if (current.Length == 1)
            {
                Volatile.Write(ref _entries, Empty);
                return true;
            }

            var next = new EventSubscriptionEntry<TEvent>[current.Length - 1];
            for (int i = 0; i < index; i++)
            {
                next[i] = current[i];
            }

            for (int i = index + 1; i < current.Length; i++)
            {
                next[i - 1] = current[i];
            }

            Volatile.Write(ref _entries, next);
            return true;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static int Compare(
        in EventSubscriptionEntry<TEvent> left,
        in EventSubscriptionEntry<TEvent> right)
    {
        int priority = ((int)left.Priority).CompareTo((int)right.Priority);
        return priority != 0 ? priority : left.Sequence.CompareTo(right.Sequence);
    }
}
