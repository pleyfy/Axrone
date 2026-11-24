namespace Axrone.Scene;

/// <summary>Kind of structural mutation recorded by <see cref="SceneChangeJournal"/>.</summary>
public enum SceneChangeKind : byte
{
    ActorCreated = 0,
    ActorDestroyed = 1,
    ComponentAdded = 2,
    ComponentRemoved = 3,
    ComponentChanged = 4,
    BehaviourAdded = 5,
    BehaviourRemoved = 6,
    BehaviourEnabled = 7,
    BehaviourDisabled = 8,
    ParentChanged = 9,
    ActiveInHierarchyChanged = 10,
}

/// <summary>
/// One structural scene mutation. Payload-free by design: consumers query the world with
/// <see cref="SceneActor"/> plus the component/behaviour type when they need the value.
/// </summary>
public readonly record struct SceneChange(
    SceneChangeKind Kind,
    SceneActor Actor,
    SceneComponentTypeId ComponentType,
    SceneBehaviourTypeId BehaviourType)
{
    public static SceneChange ActorCreated(SceneActor actor) =>
        new(SceneChangeKind.ActorCreated, actor, default, default);

    public static SceneChange ActorDestroyed(SceneActor actor) =>
        new(SceneChangeKind.ActorDestroyed, actor, default, default);

    public static SceneChange ComponentAdded(SceneActor actor, SceneComponentTypeId type) =>
        new(SceneChangeKind.ComponentAdded, actor, type, default);

    public static SceneChange ComponentRemoved(SceneActor actor, SceneComponentTypeId type) =>
        new(SceneChangeKind.ComponentRemoved, actor, type, default);

    public static SceneChange ComponentChanged(SceneActor actor, SceneComponentTypeId type) =>
        new(SceneChangeKind.ComponentChanged, actor, type, default);

    public static SceneChange BehaviourAdded(SceneActor actor, SceneBehaviourTypeId type) =>
        new(SceneChangeKind.BehaviourAdded, actor, default, type);

    public static SceneChange BehaviourRemoved(SceneActor actor, SceneBehaviourTypeId type) =>
        new(SceneChangeKind.BehaviourRemoved, actor, default, type);

    public static SceneChange BehaviourEnabled(SceneActor actor, SceneBehaviourTypeId type) =>
        new(SceneChangeKind.BehaviourEnabled, actor, default, type);

    public static SceneChange BehaviourDisabled(SceneActor actor, SceneBehaviourTypeId type) =>
        new(SceneChangeKind.BehaviourDisabled, actor, default, type);

    public static SceneChange ParentChanged(SceneActor actor) =>
        new(SceneChangeKind.ParentChanged, actor, default, default);

    public static SceneChange ActiveInHierarchyChanged(SceneActor actor) =>
        new(SceneChangeKind.ActiveInHierarchyChanged, actor, default, default);
}

/// <summary>
/// Bounded, allocation-free journal of scene mutations. The loop thread drains it once per frame
/// and hands the batch to a consumer (a reactive bridge, diagnostics, editor).
/// </summary>
/// <remarks>
/// When the ring is full the oldest entry is dropped and counted, so a stalled consumer degrades
/// to "recent changes only" instead of growing without bound. Writers and the drain may run on
/// different threads; the journal is internally synchronized.
/// </remarks>
public sealed class SceneChangeJournal
{
    private readonly SceneChange[] _buffer;
    private readonly Lock _gate = new();
    private int _head;
    private int _count;
    private long _dropped;

    /// <summary>Creates a journal with a fixed ring capacity.</summary>
    public SceneChangeJournal(int capacity = 4096)
    {
        if (capacity < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity), capacity, "Capacity must be positive.");
        }

        _buffer = new SceneChange[capacity];
    }

    /// <summary>Ring capacity.</summary>
    public int Capacity => _buffer.Length;

    /// <summary>Entries waiting to be drained.</summary>
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

    /// <summary>Entries dropped because the ring was full.</summary>
    public long DroppedCount => Interlocked.Read(ref _dropped);

    /// <summary>Records one mutation.</summary>
    public void Write(in SceneChange change)
    {
        lock (_gate)
        {
            if (_count == _buffer.Length)
            {
                _head = Next(_head);
                _count--;
                Interlocked.Increment(ref _dropped);
            }

            _buffer[(_head + _count) % _buffer.Length] = change;
            _count++;
        }
    }

    /// <summary>Copies pending changes into <paramref name="destination"/> in write order.</summary>
    /// <returns>Number of entries copied.</returns>
    public int Drain(Span<SceneChange> destination)
    {
        if (destination.IsEmpty)
        {
            return 0;
        }

        lock (_gate)
        {
            int copied = Math.Min(_count, destination.Length);
            for (int i = 0; i < copied; i++)
            {
                destination[i] = _buffer[(_head + i) % _buffer.Length];
            }

            _head = (_head + copied) % _buffer.Length;
            _count -= copied;
            return copied;
        }
    }

    /// <summary>Discards every pending entry.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            Array.Clear(_buffer);
            _head = 0;
            _count = 0;
        }
    }

    private int Next(int index) => index + 1 == _buffer.Length ? 0 : index + 1;
}
