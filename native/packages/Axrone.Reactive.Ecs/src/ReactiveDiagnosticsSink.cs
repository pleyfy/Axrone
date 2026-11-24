namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

/// <summary>One recorded lifecycle transition.</summary>
internal readonly record struct LifecycleRecord(Entity Entity, EntityLifecycleKind Kind);

/// <summary>
/// Bounded lifecycle ring written from world diagnostics and drained by the bridge pump.
/// Diagnostics callbacks run under the world structural gate, so the ring never calls user
/// code there; the bridge publishes after the structural operation completes.
/// </summary>
internal sealed class ReactiveDiagnosticsSink : IDiagnosticsSink
{
    private readonly IDiagnosticsSink _inner;
    private readonly LifecycleRecord[] _records;
    private readonly Lock _gate = new();
    private int _start;
    private int _count;
    private long _dropped;

    public ReactiveDiagnosticsSink(IDiagnosticsSink inner, int capacity = 1024)
    {
        ArgumentNullException.ThrowIfNull(inner);
        ArgumentOutOfRangeException.ThrowIfLessThan(capacity, 1, nameof(capacity));
        _inner = inner;
        _records = GC.AllocateArray<LifecycleRecord>(capacity, pinned: true);
    }

    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _count;
            }
        }
    }

    /// <summary>Number of records discarded because the ring was full.</summary>
    public long Dropped
    {
        get
        {
            lock (_gate)
            {
                return _dropped;
            }
        }
    }

    public void OnArchetypeCreated(ArchetypeId id, in ComponentMask mask) =>
        _inner.OnArchetypeCreated(id, in mask);

    public void OnEntityCreated(Entity entity)
    {
        Record(entity, EntityLifecycleKind.Created);
        _inner.OnEntityCreated(entity);
    }

    public void OnEntityDestroyed(Entity entity)
    {
        Record(entity, EntityLifecycleKind.Destroyed);
        _inner.OnEntityDestroyed(entity);
    }

    public int Drain(Span<LifecycleRecord> destination)
    {
        lock (_gate)
        {
            int count = Math.Min(_count, destination.Length);
            for (int index = 0; index < count; index++)
            {
                destination[index] = _records[(_start + index) % _records.Length];
            }

            _start = (_start + count) % _records.Length;
            _count -= count;
            return count;
        }
    }

    private void Record(Entity entity, EntityLifecycleKind kind)
    {
        lock (_gate)
        {
            if (_count == _records.Length)
            {
                _start = (_start + 1) % _records.Length;
                _count--;
                _dropped++;
            }

            _records[(_start + _count) % _records.Length] = new LifecycleRecord(entity, kind);
            _count++;
        }
    }
}
