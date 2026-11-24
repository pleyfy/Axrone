namespace Axrone.Reactive.Scene;

using Axrone.Physics3D;
using Axrone.Scene;
using Axrone.Scene.Runtime;

/// <summary>
/// Turns the scene change journal and the physics step events into typed observable streams.
/// </summary>
/// <remarks>
/// <para>The bridge is pumped by the owning loop, on the same thread that mutates the scene. No
/// background worker and no queue are created; dispatch order is journal order.</para>
/// <para>Component streams are created on first request. A stream with no subscribers is skipped
/// before the payload is read, so an unwatched change costs a dictionary probe, not a copy.</para>
/// <para>Physics events are read once per completed <see cref="ScenePhysicsBridge3D.StepCount"/>;
/// calling <see cref="Pump"/> twice without a step does not duplicate them.</para>
/// </remarks>
public sealed class SceneReactiveBridge : IDisposable
{
    private readonly SceneWorld _world;
    private readonly ScenePhysicsBridge3D? _physics;
    private readonly SceneChange[] _buffer = new SceneChange[256];
    private readonly Dictionary<Type, IComponentChangeSink> _componentsByType = new();
    private readonly Dictionary<SceneComponentTypeId, IComponentChangeSink> _componentsByTypeId = new();

    private readonly Subject<SceneActor> _actorCreated = new();
    private readonly Subject<SceneActor> _actorDestroyed = new();
    private readonly Subject<BehaviourChange> _behaviourChanges = new();
    private readonly Subject<HierarchyChange> _hierarchyChanges = new();
    private readonly Subject<SceneCollisionEvent> _collisions = new();
    private readonly Subject<SceneSensorEvent> _sensors = new();

    private long _lastPhysicsStep = -1;
    private int _disposed;
    private SceneRuntimeLoop? _loop;

    /// <summary>Creates a bridge over a scene world and, optionally, its 3D physics bridge.</summary>
    public SceneReactiveBridge(SceneWorld world, ScenePhysicsBridge3D? physics = null)
    {
        _world = world ?? throw new ArgumentNullException(nameof(world));
        _physics = physics;
    }

    /// <summary>Scene world observed by this bridge.</summary>
    public SceneWorld World => _world;

    /// <summary>Actors created since the last pump.</summary>
    public IObservable<SceneActor> ActorCreated => _actorCreated;

    /// <summary>Actors destroyed since the last pump.</summary>
    public IObservable<SceneActor> ActorDestroyed => _actorDestroyed;

    /// <summary>Behaviour add/remove/enable/disable transitions.</summary>
    public IObservable<BehaviourChange> BehaviourChanges => _behaviourChanges;

    /// <summary>Parent and effective-active transitions.</summary>
    public IObservable<HierarchyChange> HierarchyChanges => _hierarchyChanges;

    /// <summary>Collisions from the last physics step.</summary>
    public IObservable<SceneCollisionEvent> Collisions => _collisions;

    /// <summary>Sensor overlaps from the last physics step.</summary>
    public IObservable<SceneSensorEvent> Sensors => _sensors;

    /// <summary>Component-added stream for one unmanaged scene component.</summary>
    public IObservable<ComponentAdded<T>> ComponentAdded<T>()
        where T : unmanaged, ISceneDataComponent =>
        GetOrCreate<T>().Added;

    /// <summary>Component-removed stream for one unmanaged scene component.</summary>
    public IObservable<ComponentRemoved<T>> ComponentRemoved<T>()
        where T : unmanaged, ISceneDataComponent =>
        GetOrCreate<T>().Removed;

    /// <summary>Component-changed stream for one unmanaged scene component.</summary>
    public IObservable<ComponentChanged<T>> ComponentChanged<T>()
        where T : unmanaged, ISceneDataComponent =>
        GetOrCreate<T>().Changed;

    /// <summary>
    /// Pumps this bridge automatically after every <see cref="SceneRuntimeLoop.Tick"/>.
    /// Attaching another loop detaches the previous one; <see cref="Dispose"/> detaches too.
    /// </summary>
    public void AttachLoop(SceneRuntimeLoop loop)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(loop);
        if (_loop is not null)
        {
            _loop.FrameCompleted -= OnLoopFrame;
        }

        _loop = loop;
        loop.FrameCompleted += OnLoopFrame;
    }

    /// <summary>Detaches the loop attached with <see cref="AttachLoop"/>, if any.</summary>
    public void DetachLoop()
    {
        SceneRuntimeLoop? loop = _loop;
        _loop = null;
        if (loop is not null)
        {
            loop.FrameCompleted -= OnLoopFrame;
        }
    }

    /// <summary>
    /// Drains up to <paramref name="maxChanges"/> journal entries and dispatches them, then reads
    /// one frame of physics events.
    /// </summary>
    /// <returns>Journal entries dispatched.</returns>
    public int Pump(int maxChanges = 1024)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (maxChanges < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxChanges), maxChanges, "Max changes must not be negative.");
        }

        int total = 0;
        while (total < maxChanges)
        {
            int want = Math.Min(_buffer.Length, maxChanges - total);
            int drained = _world.Changes.Drain(_buffer.AsSpan(0, want));
            if (drained == 0)
            {
                break;
            }

            for (int i = 0; i < drained; i++)
            {
                Dispatch(in _buffer[i]);
            }

            total += drained;
        }

        PumpPhysics();
        return total;
    }

    private void Dispatch(in SceneChange change)
    {
        switch (change.Kind)
        {
            case SceneChangeKind.ActorCreated:
                if (_actorCreated.SubscriberCount > 0)
                {
                    _actorCreated.OnNext(change.Actor);
                }

                break;

            case SceneChangeKind.ActorDestroyed:
                if (_actorDestroyed.SubscriberCount > 0)
                {
                    _actorDestroyed.OnNext(change.Actor);
                }

                break;

            case SceneChangeKind.ComponentAdded:
                if (_componentsByTypeId.TryGetValue(change.ComponentType, out IComponentChangeSink? added))
                {
                    added.OnAdded(change.Actor);
                }

                break;

            case SceneChangeKind.ComponentRemoved:
                if (_componentsByTypeId.TryGetValue(change.ComponentType, out IComponentChangeSink? removed))
                {
                    removed.OnRemoved(change.Actor);
                }

                break;

            case SceneChangeKind.ComponentChanged:
                if (_componentsByTypeId.TryGetValue(change.ComponentType, out IComponentChangeSink? changed))
                {
                    changed.OnChanged(change.Actor);
                }

                break;

            case SceneChangeKind.BehaviourAdded:
            case SceneChangeKind.BehaviourRemoved:
            case SceneChangeKind.BehaviourEnabled:
            case SceneChangeKind.BehaviourDisabled:
                if (_behaviourChanges.SubscriberCount > 0)
                {
                    _behaviourChanges.OnNext(new BehaviourChange(change.Actor, change.BehaviourType, change.Kind));
                }

                break;

            case SceneChangeKind.ParentChanged:
            case SceneChangeKind.ActiveInHierarchyChanged:
                if (_hierarchyChanges.SubscriberCount > 0)
                {
                    _hierarchyChanges.OnNext(new HierarchyChange(change.Actor, change.Kind));
                }

                break;
        }
    }

    private void OnLoopFrame(object? sender, EventArgs arguments)
    {
        _ = sender;
        _ = arguments;
        if (Volatile.Read(ref _disposed) == 0)
        {
            _ = Pump();
        }
    }

    private void PumpPhysics()
    {
        if (_physics is null)
        {
            return;
        }

        long step = _physics.StepCount;
        if (step == _lastPhysicsStep)
        {
            return;
        }

        _lastPhysicsStep = step;

        if (_collisions.SubscriberCount > 0)
        {
            int count = _physics.ContactEventCount;
            for (int i = 0; i < count; i++)
            {
                ContactEvent contact = _physics.GetContactEvent(i);
                _collisions.OnNext(new SceneCollisionEvent(
                    _physics.GetActor(contact.BodyA),
                    contact.BodyA,
                    _physics.GetActor(contact.BodyB),
                    contact.BodyB,
                    contact.Type));
            }
        }

        if (_sensors.SubscriberCount > 0)
        {
            int count = _physics.SensorEventCount;
            for (int i = 0; i < count; i++)
            {
                SensorEvent sensor = _physics.GetSensorEvent(i);
                _sensors.OnNext(new SceneSensorEvent(
                    _physics.GetActor(sensor.BodyA),
                    sensor.BodyA,
                    _physics.GetActor(sensor.BodyB),
                    sensor.BodyB,
                    sensor.Type));
            }
        }
    }

    private ComponentStream<T> GetOrCreate<T>()
        where T : unmanaged, ISceneDataComponent
    {
        if (_componentsByType.TryGetValue(typeof(T), out IComponentChangeSink? existing))
        {
            return (ComponentStream<T>)existing;
        }

        SceneDataComponentDescriptor descriptor = _world.Registry.GetDataByType(typeof(T));
        var stream = new ComponentStream<T>();
        _componentsByType[typeof(T)] = stream;
        _componentsByTypeId[descriptor.TypeId] = stream;
        return stream;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        DetachLoop();
        _actorCreated.Dispose();
        _actorDestroyed.Dispose();
        _behaviourChanges.Dispose();
        _hierarchyChanges.Dispose();
        _collisions.Dispose();
        _sensors.Dispose();

        foreach (IComponentChangeSink stream in _componentsByType.Values)
        {
            stream.Dispose();
        }

        _componentsByType.Clear();
        _componentsByTypeId.Clear();
    }

    private interface IComponentChangeSink : IDisposable
    {
        void OnAdded(SceneActor actor);

        void OnRemoved(SceneActor actor);

        void OnChanged(SceneActor actor);
    }

    private sealed class ComponentStream<T> : IComponentChangeSink
        where T : unmanaged, ISceneDataComponent
    {
        private readonly Subject<ComponentAdded<T>> _added = new();
        private readonly Subject<ComponentRemoved<T>> _removed = new();
        private readonly Subject<ComponentChanged<T>> _changed = new();

        public IObservable<ComponentAdded<T>> Added => _added;

        public IObservable<ComponentRemoved<T>> Removed => _removed;

        public IObservable<ComponentChanged<T>> Changed => _changed;

        public void OnAdded(SceneActor actor)
        {
            if (_added.SubscriberCount > 0)
            {
                _added.OnNext(new ComponentAdded<T>(actor));
            }
        }

        public void OnRemoved(SceneActor actor)
        {
            if (_removed.SubscriberCount > 0)
            {
                _removed.OnNext(new ComponentRemoved<T>(actor));
            }
        }

        public void OnChanged(SceneActor actor)
        {
            if (_changed.SubscriberCount > 0)
            {
                _changed.OnNext(new ComponentChanged<T>(actor));
            }
        }

        public void Dispose()
        {
            _added.Dispose();
            _removed.Dispose();
            _changed.Dispose();
        }
    }
}
