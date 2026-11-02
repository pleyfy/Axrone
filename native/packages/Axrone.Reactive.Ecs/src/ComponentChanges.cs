namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

/// <summary>
/// Change streams for one component type. Polling walks the world's dense chunks and the
/// removal journal; it never allocates and publishes only rows whose ticks are newer than
/// the previous poll.
/// </summary>
/// <typeparam name="T">Unmanaged component type.</typeparam>
public sealed class ComponentChanges<T> : IComponentPoller, IDisposable
    where T : unmanaged
{
    private readonly World _world;
    private readonly ObservableRegistry _registry;
    private readonly Subject<ComponentAddedEvent<T>> _added = new();
    private readonly Subject<ComponentChangedEvent<T>> _changed = new();
    private readonly Subject<ComponentRemovedEvent<T>> _removed = new();
    private readonly int _addedRegistryId;
    private readonly int _changedRegistryId;
    private readonly int _removedRegistryId;
    private int _lastTick;
    private int _disposed;

    internal ComponentChanges(World world, ObservableRegistry registry)
    {
        _world = world;
        _registry = registry;
        _lastTick = unchecked(world.Tick - 1);
        _addedRegistryId = registry.RegisterSubject(_added);
        _changedRegistryId = registry.RegisterSubject(_changed);
        _removedRegistryId = registry.RegisterSubject(_removed);
    }

    /// <summary>Gets the added-component stream.</summary>
    public ObservableBase<ComponentAddedEvent<T>> Added => _added;

    /// <summary>Gets the changed-component stream; newly added rows are reported once on Added.</summary>
    public ObservableBase<ComponentChangedEvent<T>> Changed => _changed;

    /// <summary>Gets the removed-component stream.</summary>
    public ObservableBase<ComponentRemovedEvent<T>> Removed => _removed;

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

        _ = _registry.UnregisterSubject(_addedRegistryId);
        _ = _registry.UnregisterSubject(_changedRegistryId);
        _ = _registry.UnregisterSubject(_removedRegistryId);
        _added.Dispose();
        _changed.Dispose();
        _removed.Dispose();
        GC.SuppressFinalize(this);
    }
}

/// <summary>Type-erased poll hook so the bridge can iterate tracked components without reflection.</summary>
internal interface IComponentPoller
{
    int Poll(int tick, Span<Entity> removalEntities, Span<int> removalTicks);
}
