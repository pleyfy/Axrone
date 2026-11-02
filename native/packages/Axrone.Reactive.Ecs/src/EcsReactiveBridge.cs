namespace Axrone.Reactive.Ecs;

using Axrone.Ecs;

/// <summary>
/// Poll-driven bridge from ECS lifecycle, component change ticks, removals and scheduler
/// frame/system events into Reactive streams. The bridge installs a lifecycle-recording
/// diagnostics sink and never calls user code from inside the world structural gate;
/// call <see cref="Poll"/> after structural work or after a scheduler frame.
/// </summary>
/// <remarks>
/// <para><b>Allocation contract:</b> <see cref="Poll"/> is steady-state allocation-free.
/// Removal and lifecycle buffers are retained and grown only on first need; tracked
/// component polling walks dense chunks and published events are structs.</para>
/// <para><b>Ordering:</b> a poll publishes lifecycle transitions first, then component
/// added/changed/removed events in tracked-component registration order, archetype order
/// and row order. Removals follow removal-journal order.</para>
/// <para><b>Threading:</b> call <see cref="Poll"/> from one thread at a frame boundary.
/// Scheduler event callbacks may run on parallel workers; the underlying subjects are
/// thread-safe. Do not mutate world structure from a scheduler event handler.</para>
/// </remarks>
public sealed class EcsReactiveBridge : IDisposable, ISystemEventListener
{
    private readonly World _world;
    private readonly IDiagnosticsSink _innerDiagnostics;
    private readonly ReactiveDiagnosticsSink _sink;
    private readonly ObservableRegistry _registry = new(
        enableMemoryTracking: true,
        memoryManager: new ObservableMemoryManager(gcIntervalMs: 0),
        disposeMemoryManager: true);
    private readonly Subject<EntityLifecycleEvent> _lifecycle = new();
    private readonly Subject<FrameEvent> _frameStarted = new();
    private readonly Subject<FrameEvent> _frameCompleted = new();
    private readonly Subject<SystemEvent> _systemStarted = new();
    private readonly Subject<SystemEvent> _systemCompleted = new();
    private readonly Subject<SystemFaultEvent> _systemFaulted = new();
    private readonly Subject<int> _pollCompleted = new();
    private readonly Dictionary<ushort, IComponentPoller> _tracked = new();
    private readonly EcsObservables _observables;
    private Entity[] _removalEntities = [];
    private int[] _removalTicks = [];
    private LifecycleRecord[] _lifecycleBuffer = [];
    private SystemScheduler? _scheduler;
    private int _disposed;

    /// <summary>Creates a bridge and installs its lifecycle diagnostics wrapper.</summary>
    public EcsReactiveBridge(
        World world,
        Func<World, Entity, string?>? nameSelector = null,
        Func<World, Entity, string?>? tagSelector = null,
        Func<World, Entity, int>? layerSelector = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        if (world.Diagnostics is ReactiveDiagnosticsSink)
        {
            throw new InvalidOperationException("A reactive bridge is already attached to this world.");
        }

        _world = world;
        _innerDiagnostics = world.Diagnostics;
        _sink = new ReactiveDiagnosticsSink(_innerDiagnostics);
        world.SetDiagnosticsSink(_sink);
        RegisterSubjects();
        _observables = new EcsObservables(this, nameSelector, tagSelector, layerSelector);
    }

    /// <summary>Gets the entity created/destroyed stream.</summary>
    public ObservableBase<EntityLifecycleEvent> EntityLifecycle => _lifecycle;

    /// <summary>Gets the frame-started stream.</summary>
    public ObservableBase<FrameEvent> FrameStarted => _frameStarted;

    /// <summary>Gets the frame-completed stream.</summary>
    public ObservableBase<FrameEvent> FrameCompleted => _frameCompleted;

    /// <summary>Gets the system-started stream.</summary>
    public ObservableBase<SystemEvent> SystemStarted => _systemStarted;

    /// <summary>Gets the system-completed stream.</summary>
    public ObservableBase<SystemEvent> SystemCompleted => _systemCompleted;

    /// <summary>Gets the system-faulted stream.</summary>
    public ObservableBase<SystemFaultEvent> SystemFaulted => _systemFaulted;

    public ObservableBase<int> PollCompleted => _pollCompleted;

    public World World => _world;

    public ObservableRegistry Registry => _registry;

    public EcsObservables Observables => _observables;

    /// <summary>Starts tracking one component type; repeated calls return the same stream.</summary>
    public ComponentChanges<T> Track<T>() where T : unmanaged
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ComponentRegistry.Register<T>();
        ushort id = ComponentType<T>.Id.Value;
        if (_tracked.TryGetValue(id, out IComponentPoller? existing))
        {
            return (ComponentChanges<T>)existing;
        }

        var stream = new ComponentChanges<T>(_world, _registry);
        _tracked.Add(id, stream);
        return stream;
    }

    /// <summary>Installs the bridge as the scheduler's frame/system observer.</summary>
    public void AttachScheduler(SystemScheduler scheduler)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(scheduler);
        if (_scheduler is not null && !ReferenceEquals(_scheduler, scheduler))
        {
            _scheduler.SetListener(null);
        }

        _scheduler = scheduler;
        scheduler.SetListener(this);
    }

    /// <summary>Detaches the current scheduler observer, if any.</summary>
    public void DetachScheduler()
    {
        SystemScheduler? scheduler = _scheduler;
        _scheduler = null;
        if (scheduler is not null)
        {
            scheduler.SetListener(null);
        }
    }

    /// <summary>
    /// Drains lifecycle records and polls every tracked component. Returns the number of
    /// events published.
    /// </summary>
    public int Poll()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        int tick = _world.Tick;
        var published = 0;

        int lifecycleCount = _sink.Count;
        if (_lifecycleBuffer.Length < lifecycleCount)
        {
            _lifecycleBuffer = GC.AllocateArray<LifecycleRecord>(lifecycleCount, pinned: true);
        }

        int drained = _sink.Drain(_lifecycleBuffer);
        for (int index = 0; index < drained; index++)
        {
            LifecycleRecord record = _lifecycleBuffer[index];
            _lifecycle.OnNext(new EntityLifecycleEvent(record.Entity, record.Kind));
            published++;
        }

        int removalCapacity = _world.RemovalCount;
        if (_removalEntities.Length < removalCapacity)
        {
            _removalEntities = GC.AllocateArray<Entity>(removalCapacity, pinned: true);
            _removalTicks = GC.AllocateArray<int>(removalCapacity, pinned: true);
        }

        foreach (IComponentPoller poller in _tracked.Values)
        {
            published += poller.Poll(tick, _removalEntities, _removalTicks);
        }

        _pollCompleted.OnNext(published);
        return published;
    }

    /// <inheritdoc/>
    public void OnFrameStarting(int tick, long frame, float deltaTime) =>
        _frameStarted.OnNext(new FrameEvent(tick, frame, deltaTime));

    /// <inheritdoc/>
    public void OnFrameCompleted(int tick, long frame, float deltaTime) =>
        _frameCompleted.OnNext(new FrameEvent(tick, frame, deltaTime));

    /// <inheritdoc/>
    public void OnSystemStarting(in SystemEventContext context) =>
        _systemStarted.OnNext(new SystemEvent(
            context.Id,
            context.Phase,
            context.Priority,
            context.Tick,
            context.Frame,
            context.DeltaTime));

    /// <inheritdoc/>
    public void OnSystemCompleted(in SystemEventContext context) =>
        _systemCompleted.OnNext(new SystemEvent(
            context.Id,
            context.Phase,
            context.Priority,
            context.Tick,
            context.Frame,
            context.DeltaTime));

    /// <inheritdoc/>
    public void OnSystemFaulted(in SystemEventContext context, Exception exception) =>
        _systemFaulted.OnNext(new SystemFaultEvent(
            new SystemEvent(
                context.Id,
                context.Phase,
                context.Priority,
                context.Tick,
                context.Frame,
                context.DeltaTime),
            exception));

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        DetachScheduler();
        if (ReferenceEquals(_world.Diagnostics, _sink))
        {
            _world.SetDiagnosticsSink(_innerDiagnostics);
        }

        _observables.Dispose();
        foreach (IComponentPoller poller in _tracked.Values)
        {
            if (poller is IDisposable disposable)
            {
                disposable.Dispose();
            }
        }

        _tracked.Clear();
        _lifecycle.Dispose();
        _frameStarted.Dispose();
        _frameCompleted.Dispose();
        _systemStarted.Dispose();
        _systemCompleted.Dispose();
        _systemFaulted.Dispose();
        _pollCompleted.Dispose();
        _registry.Dispose();
        GC.SuppressFinalize(this);
    }

    private void RegisterSubjects()
    {
        _ = _registry.RegisterSubject(_lifecycle);
        _ = _registry.RegisterSubject(_frameStarted);
        _ = _registry.RegisterSubject(_frameCompleted);
        _ = _registry.RegisterSubject(_systemStarted);
        _ = _registry.RegisterSubject(_systemCompleted);
        _ = _registry.RegisterSubject(_systemFaulted);
        _ = _registry.RegisterSubject(_pollCompleted);
    }
}
