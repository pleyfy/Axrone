namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

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
    private readonly IDisposable _pollSubscription;
    private readonly Lock _gate = new();
    private bool _disposed;

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
        _pollSubscription = bridge.PollCompleted.Subscribe(new PollObserver(this));
    }

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

            var subject = new BehaviorSubject<Entity[]>(query(_bridge.World));
            var entry = new QueryEntry(query, subject);
            _queries.Add(key, entry);
            _queryOrder.Add(entry);
            return subject;
        }
    }

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

            Func<World, Entity[]> query = static world => QueryEntities<T1>(world);
            var subject = new BehaviorSubject<Entity[]>(query(_bridge.World));
            var entry = new QueryEntry(query, subject);
            _queries.Add(key, entry);
            _queryOrder.Add(entry);
            return subject;
        }
    }

    public void RefreshQueries()
    {
        QueryEntry[] entries;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_queryOrder.Count == 0)
            {
                return;
            }

            entries = [.. _queryOrder];
        }

        foreach (QueryEntry entry in entries)
        {
            entry.Subject.OnNext(entry.Query(_bridge.World));
        }
    }

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
            _byName.Clear();
            _byTag.Clear();
            _byLayer.Clear();
        }

        _pollSubscription.Dispose();
        foreach (QueryEntry entry in entries)
        {
            entry.Subject.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private static Entity[] QueryEntities<T1>(World world)
        where T1 : unmanaged
    {
        var entities = new List<Entity>();
        foreach (Chunk1<T1> chunk in world.Query<T1>())
        {
            entities.AddRange(chunk.Entities);
        }

        return [.. entities];
    }

    private sealed class QueryEntry
    {
        public QueryEntry(Func<World, Entity[]> query, BehaviorSubject<Entity[]> subject)
        {
            Query = query;
            Subject = subject;
        }

        public Func<World, Entity[]> Query { get; }

        public BehaviorSubject<Entity[]> Subject { get; }
    }

    private sealed class PollObserver : IObserver<int>
    {
        private readonly EcsObservables _owner;

        public PollObserver(EcsObservables owner) => _owner = owner;

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
