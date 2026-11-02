namespace Axrone.Event.Internal;

/// <summary>
/// Bounded FIFO used while a router is paused. Storage is allocated once: payload shapes without
/// references use the pinned object heap so the buffer never moves; shapes that do contain
/// references fall back to a regular array because the POH cannot hold object references.
/// </summary>
/// <remarks>
/// A single <see cref="Lock"/> guards the ring; the steady-state enqueue/dequeue/copy path takes
/// the lock and touches no heap. <see cref="Count"/> is published separately so readers can size
/// a destination span without locking.
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
internal sealed class PausedEventBuffer<TEvent>
{
    private readonly EventEnvelope<TEvent>[] _storage;
    private readonly int _capacity;
    private readonly bool _containsReferences;
    private readonly Lock _gate = new();

    private int _head;
    private int _tail;
    private int _count;

    public PausedEventBuffer(int capacity)
    {
        if (capacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(capacity), "Capacity must be positive.");
        }

        _capacity = capacity;
        _containsReferences = RuntimeHelpers.IsReferenceOrContainsReferences<EventEnvelope<TEvent>>();
        _storage = _containsReferences
            ? new EventEnvelope<TEvent>[capacity]
            : GC.AllocateArray<EventEnvelope<TEvent>>(capacity, pinned: true);
    }

    public int Capacity => _capacity;

    public int Count => Volatile.Read(ref _count);

    /// <summary>Whether the backing store lives on the pinned object heap.</summary>
    public bool IsPinned => !_containsReferences;

    public bool TryEnqueue(in EventEnvelope<TEvent> envelope)
    {
        lock (_gate)
        {
            if (_count == _capacity)
            {
                return false;
            }

            _storage[_tail] = envelope;
            _tail = _tail + 1 == _capacity ? 0 : _tail + 1;
            Volatile.Write(ref _count, _count + 1);
            return true;
        }
    }

    /// <summary>Returns the head envelope without removing it.</summary>
    public bool TryPeek(out EventEnvelope<TEvent> envelope)
    {
        lock (_gate)
        {
            if (_count == 0)
            {
                envelope = default;
                return false;
            }

            envelope = _storage[_head];
            return true;
        }
    }

    public bool TryDequeue(out EventEnvelope<TEvent> envelope)
    {
        lock (_gate)
        {
            if (_count == 0)
            {
                envelope = default;
                return false;
            }

            envelope = _storage[_head];
            _storage[_head] = default;
            _head = _head + 1 == _capacity ? 0 : _head + 1;
            Volatile.Write(ref _count, _count - 1);
            return true;
        }
    }

    /// <summary>Copies queued envelopes in FIFO order without removing them.</summary>
    /// <param name="destination">Destination view; the copy stops at the smaller length.</param>
    /// <returns>Envelopes copied.</returns>
    public int CopyTo(Span<EventEnvelope<TEvent>> destination)
    {
        lock (_gate)
        {
            int copy = Math.Min(_count, destination.Length);
            int index = _head;
            for (int i = 0; i < copy; i++)
            {
                destination[i] = _storage[index];
                index = index + 1 == _capacity ? 0 : index + 1;
            }

            return copy;
        }
    }

    public int Clear()
    {
        lock (_gate)
        {
            int cleared = _count;
            if (cleared == 0)
            {
                return 0;
            }

            if (_containsReferences)
            {
                Array.Clear(_storage);
            }

            _head = 0;
            _tail = 0;
            Volatile.Write(ref _count, 0);
            return cleared;
        }
    }
}
