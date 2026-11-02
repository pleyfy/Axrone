namespace Axrone.Event;

/// <summary>Immutable copy of one subscription slot.</summary>
/// <param name="SubscriptionId">Stable identity.</param>
/// <param name="Priority">Dispatch priority.</param>
/// <param name="IsOnce">Whether the subscription self-releases after one delivery.</param>
/// <param name="IsActive">Whether dispatch currently delivers to the slot.</param>
/// <param name="RegistrationSequence">Monotonic registration order; deterministic tie-breaker.</param>
public readonly record struct EventSubscriptionInfo(
    Guid SubscriptionId,
    EventPriority Priority,
    bool IsOnce,
    bool IsActive,
    long RegistrationSequence);

/// <summary>
/// Copied subscription snapshot with a value-type enumerator; enumeration never allocates and
/// never observes later registrations.
/// </summary>
public readonly struct SubscriptionSnapshot
{
    private readonly EventSubscriptionInfo[]? _items;

    internal SubscriptionSnapshot(EventSubscriptionInfo[] items) => _items = items;

    /// <summary>Snapshotted subscriptions.</summary>
    public int Count => _items?.Length ?? 0;

    /// <summary>Returns a value-type enumerator over the snapshot.</summary>
    public Enumerator GetEnumerator() => new(_items);

    /// <summary>Allocation-free enumerator over a copied snapshot.</summary>
    public ref struct Enumerator
    {
        private readonly EventSubscriptionInfo[]? _items;
        private int _index;

        internal Enumerator(EventSubscriptionInfo[]? items)
        {
            _items = items;
            _index = -1;
        }

        /// <summary>Current subscription.</summary>
        public EventSubscriptionInfo Current => _items![_index];

        /// <summary>Advances to the next snapshot entry.</summary>
        public bool MoveNext()
        {
            int next = _index + 1;
            if (_items is null || (uint)next >= (uint)_items.Length)
            {
                return false;
            }

            _index = next;
            return true;
        }
    }
}
