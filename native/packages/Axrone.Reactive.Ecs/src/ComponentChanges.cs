namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

/// <summary>
/// Change streams for one component type. Polling walks the world's dense chunks and the
/// removal journal; it never allocates and publishes only rows whose ticks are newer than
/// the previous pump.
/// </summary>
/// <typeparam name="T">Unmanaged component type.</typeparam>
public sealed class ComponentChanges<T> : IComponentPoller, IDisposable
    where T : unmanaged
{
    private readonly World _world;
    private readonly Subject<ComponentAddedEvent<T>> _added = new();
    private readonly Subject<ComponentChangedEvent<T>> _changed = new();
    private readonly Subject<ComponentRemovedEvent<T>> _removed = new();
    private int _lastTick;
    private int _disposed;

    internal ComponentChanges(World world)
    {
        _world = world;
        _lastTick = unchecked(world.Tick - 1);
    }

    /// <summary>Gets the added-component stream.</summary>
    public IPriorityObservable<ComponentAddedEvent<T>> Added => _added;

    /// <summary>Gets the changed-component stream; newly added rows are reported once on Added.</summary>
    public IPriorityObservable<ComponentChangedEvent<T>> Changed => _changed;

    /// <summary>Gets the removed-component stream.</summary>
    public IPriorityObservable<ComponentRemovedEvent<T>> Removed => _removed;

    /// <summary>True once the stream has been disposed and can no longer be tracked.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    int IComponentPoller.Poll(int tick, Span<Entity> removalEntities, Span<int> removalTicks)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            return 0;
        }

        var published = 0;
        foreach (Chunk1<T> chunk in _world.Query<T>())
        {
            ReadOnlySpan<Entity> entities = chunk.Entities;
            Span<T> values = chunk.Column1;
            ReadOnlySpan<int> addedTicks = chunk.Added1;
            ReadOnlySpan<int> changedTicks = chunk.Changed1;
            for (int row = 0; row < chunk.Length; row++)
            {
                int changedTick = changedTicks[row];
                if (!EcsTick.IsNewer(changedTick, _lastTick))
                {
                    continue;
                }

                int addedTick = addedTicks[row];
                if (EcsTick.IsNewer(addedTick, _lastTick))
                {
                    _added.OnNext(new ComponentAddedEvent<T>(entities[row], values[row], addedTick));
                }
                else
                {
                    _changed.OnNext(new ComponentChangedEvent<T>(entities[row], values[row], changedTick));
                }

                published++;
            }
        }

        int removedCount = _world.GetRemoved<T>(_lastTick, removalEntities, removalTicks);
        for (int index = 0; index < removedCount; index++)
        {
            _removed.OnNext(new ComponentRemovedEvent<T>(removalEntities[index], removalTicks[index]));
            published++;
        }

        _lastTick = tick;
        return published;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _added.Dispose();
        _changed.Dispose();
        _removed.Dispose();
        GC.SuppressFinalize(this);
    }
}

/// <summary>Type-erased pump hook so the bridge can iterate tracked components without reflection.</summary>
internal interface IComponentPoller
{
    bool IsDisposed { get; }

    int Poll(int tick, Span<Entity> removalEntities, Span<int> removalTicks);
}
