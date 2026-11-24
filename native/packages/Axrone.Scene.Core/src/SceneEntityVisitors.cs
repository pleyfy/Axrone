namespace Axrone.Scene;

/// <summary>
/// Callback invoked for every live entity. The visitor is a generic type
/// parameter, so iteration closes over the callback type rather than a
/// delegate instance.
/// </summary>
/// <typeparam name="TContext">Traversal state; may be a <see langword="ref"/> struct.</typeparam>
public interface ISceneEntityVisitor<TContext>
    where TContext : allows ref struct
{
    /// <summary>Visits one live entity.</summary>
    /// <returns><see langword="true"/> to continue; <see langword="false"/> to stop early.</returns>
    bool Visit(SceneEntity entity, scoped ref TContext context);
}

/// <summary>Allocation-free enumerable over live entities in slot order.</summary>
public readonly ref struct SceneEntityEnumerable
{
    private readonly SceneEntityTable _entities;

    internal SceneEntityEnumerable(SceneEntityTable entities)
    {
        _entities = entities;
    }

    /// <summary>Creates an entity enumerator.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneEntityEnumerator GetEnumerator() => new(_entities);
}

/// <summary>Allocation-free enumerator over live entities in slot order.</summary>
public ref struct SceneEntityEnumerator
{
    private readonly SceneEntityTable _entities;
    private int _index;
    private SceneEntity _current;

    internal SceneEntityEnumerator(SceneEntityTable entities)
    {
        _entities = entities;
        _index = -1;
        _current = SceneEntity.Null;
    }

    /// <summary>Current live entity.</summary>
    public SceneEntity Current
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _current;
    }

    /// <summary>Advances to the next live entity.</summary>
    public bool MoveNext()
    {
        while (++_index < _entities.Capacity)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(_index);
            if ((record.Meta.Flags & SceneEntityFlags.IsFree) == 0)
            {
                _current = SceneEntity.FromEntity(record.Entity);
                return true;
            }
        }

        _current = SceneEntity.Null;
        return false;
    }
}
