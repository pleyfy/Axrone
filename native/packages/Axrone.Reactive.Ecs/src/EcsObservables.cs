namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

/// <summary>
/// Lifecycle filters and query observables built over one <see cref="EcsReactiveBridge"/>.
/// </summary>
/// <remarks>
/// Query streams publish only when their result actually changes; a static scene therefore
/// costs a walk over the query rows per pump, not a new array and a spurious notification.
/// All members are meant to be used from the pump thread.
/// </remarks>
public sealed class EcsObservables : IDisposable
{
    private readonly EcsReactiveBridge _bridge;
    private readonly Func<World, Entity, string?>? _nameSelector;
    private readonly Func<World, Entity, string?>? _tagSelector;
    private readonly Func<World, Entity, int>? _layerSelector;
    private readonly Dictionary<string, IObservable<EntityLifecycleEvent>> _byName = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IObservable<EntityLifecycleEvent>> _byTag = new(StringComparer.Ordinal);
    private readonly Dictionary<int, IObservable<EntityLifecycleEvent>> _byLayer = new();
    private readonly Dictionary<string, QueryEntry> _queries = new(StringComparer.Ordinal);
    private readonly List<QueryEntry> _queryOrder = [];
    private readonly IDisposable _pumpSubscription;
    private readonly Lock _gate = new();
    private QueryEntry[] _snapshot = [];
    private bool _disposed;

    /// <summary>Creates the filter/query facade for a bridge.</summary>
    public EcsObservables(
        EcsReactiveBridge bridge,
        Func<World, Entity, string?>? nameSelector = null,
        Func<World, Entity, string?>? tagSelector = null,
        Func<World, Entity, int>? layerSelector = null)
    {
        ArgumentNullException.ThrowIfNull(bridge);
        _bridge = bridge;
        _nameSelector = nameSelector;
        _tagSelector = tagSelector;
        _layerSelector = layerSelector;
        _pumpSubscription = bridge.PumpCompleted.Subscribe(new PumpObserver(this));
    }

    /// <summary>Lifecycle events for entities whose selected name matches.</summary>
    public IObservable<EntityLifecycleEvent> ByName(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        if (_nameSelector is null)
        {
            throw new InvalidOperationException("A name selector is required for ByName.");
        }

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_byName.TryGetValue(name, out IObservable<EntityLifecycleEvent>? stream))
            {
                stream = _bridge.EntityLifecycle.Where(
                    value => string.Equals(_nameSelector(_bridge.World, value.Entity), name, StringComparison.Ordinal));
                _byName.Add(name, stream);
            }

            return stream;
        }
    }

    /// <summary>Lifecycle events for entities whose selected tag matches.</summary>
    public IObservable<EntityLifecycleEvent> ByTag(string tag)
    {
        ArgumentException.ThrowIfNullOrEmpty(tag);
        if (_tagSelector is null)
        {
            throw new InvalidOperationException("A tag selector is required for ByTag.");
        }

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_byTag.TryGetValue(tag, out IObservable<EntityLifecycleEvent>? stream))
            {
                stream = _bridge.EntityLifecycle.Where(
                    value => string.Equals(_tagSelector(_bridge.World, value.Entity), tag, StringComparison.Ordinal));
                _byTag.Add(tag, stream);
            }

            return stream;
        }
    }

    /// <summary>Lifecycle events for entities whose selected layer matches.</summary>
    public IObservable<EntityLifecycleEvent> ByLayer(int layer)
    {
        if (_layerSelector is null)
        {
            throw new InvalidOperationException("A layer selector is required for ByLayer.");
        }

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_byLayer.TryGetValue(layer, out IObservable<EntityLifecycleEvent>? stream))
            {
                stream = _bridge.EntityLifecycle.Where(value => _layerSelector(_bridge.World, value.Entity) == layer);
                _byLayer.Add(layer, stream);
            }

            return stream;
        }
    }

    /// <summary>
    /// Gets or creates a shared query stream. The query runs once for the initial value and
    /// again after every pump; a result identical to the previous one is not republished.
    /// </summary>
    public BehaviorSubject<Entity[]> GetQueryObservable(string key, Func<World, Entity[]> query)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(query);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_queries.TryGetValue(key, out QueryEntry? existing))
            {
                return existing.Subject;
            }

            QueryEntry entry = QueryEntry.ForArray(query, query(_bridge.World));
            AddEntry(key, entry);
            return entry.Subject;
        }
    }

    /// <summary>
    /// Gets or creates a shared query stream for all entities carrying <typeparamref name="T1"/>.
    /// The row buffer is reused between pumps, so an unchanged result allocates nothing.
    /// </summary>
    public BehaviorSubject<Entity[]> GetQueryObservable<T1>(string key)
        where T1 : unmanaged
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_queries.TryGetValue(key, out QueryEntry? existing))
            {
                return existing.Subject;
            }

            var initial = new List<Entity>();
            FillQuery<T1>(_bridge.World, initial);
            QueryEntry entry = QueryEntry.ForFill(FillQuery<T1>, [.. initial]);
            AddEntry(key, entry);
            return entry.Subject;
        }
    }

    /// <summary>
    /// Re-evaluates every registered query and publishes only the results that changed.
    /// Called automatically after each <see cref="EcsReactiveBridge.Pump"/>.
    /// </summary>
    public void RefreshQueries()
    {
        QueryEntry[] entries;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_snapshot.Length == 0)
            {
                return;
            }

            entries = _snapshot;
        }

        foreach (QueryEntry entry in entries)
        {
            entry.Refresh(_bridge.World);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        QueryEntry[] entries;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            entries = [.. _queryOrder];
            _queries.Clear();
            _queryOrder.Clear();
            _snapshot = [];
            _byName.Clear();
            _byTag.Clear();
            _byLayer.Clear();
        }

        _pumpSubscription.Dispose();
        foreach (QueryEntry entry in entries)
        {
            entry.Subject.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private static void FillQuery<T1>(World world, List<Entity> destination)
        where T1 : unmanaged
    {
        destination.Clear();
        foreach (Chunk1<T1> chunk in world.Query<T1>())
        {
            destination.AddRange(chunk.Entities);
        }
    }

    private void AddEntry(string key, QueryEntry entry)
    {
        _queries.Add(key, entry);
        _queryOrder.Add(entry);
        _snapshot = [.. _queryOrder];
    }

    private sealed class QueryEntry
    {
        private readonly Func<World, Entity[]>? _arrayQuery;
        private readonly Action<World, List<Entity>>? _fillQuery;
        private readonly List<Entity> _scratch = [];
        private Entity[] _current;

        private QueryEntry(
            Func<World, Entity[]>? arrayQuery,
            Action<World, List<Entity>>? fillQuery,
            Entity[] initial)
        {
            _arrayQuery = arrayQuery;
            _fillQuery = fillQuery;
            _current = initial;
            Subject = new BehaviorSubject<Entity[]>(initial);
        }

        public BehaviorSubject<Entity[]> Subject { get; }

        public static QueryEntry ForArray(Func<World, Entity[]> query, Entity[] initial) =>
            new(query, null, initial);

        public static QueryEntry ForFill(Action<World, List<Entity>> query, Entity[] initial) =>
            new(null, query, initial);

        public void Refresh(World world)
        {
            if (_arrayQuery is not null)
            {
                Entity[] next = _arrayQuery(world);
                if (!next.AsSpan().SequenceEqual(_current))
                {
                    Publish(next);
                }

                return;
            }

            _fillQuery!(world, _scratch);
            if (!SameAsCurrent())
            {
                Publish([.. _scratch]);
            }
        }

        private bool SameAsCurrent()
        {
            if (_scratch.Count != _current.Length)
            {
                return false;
            }

            for (int index = 0; index < _current.Length; index++)
            {
                if (!_scratch[index].Equals(_current[index]))
                {
                    return false;
                }
            }

            return true;
        }

        private void Publish(Entity[] next)
        {
            _current = next;
            Subject.OnNext(next);
        }
    }

    private sealed class PumpObserver : IObserver<int>
    {
        private readonly EcsObservables _owner;

        public PumpObserver(EcsObservables owner) => _owner = owner;

        public void OnNext(int value)
        {
            _ = value;
            _owner.RefreshQueries();
        }

        public void OnError(Exception error) => _ = error;

        public void OnCompleted()
        {
        }
    }
}
