namespace Axrone.Reactive.Ecs.Tests;

using Axrone.Ecs;
using Axrone.Reactive;
using FluentAssertions;
using Xunit;

internal struct BridgePosition
{
    public float X;
    public float Y;

    public BridgePosition(float x, float y)
    {
        X = x;
        Y = y;
    }
}

internal struct BridgeVelocity
{
    public float V;

    public BridgeVelocity(float value) => V = value;
}

internal struct BridgeTestSystem : ISystemPolicy<BridgeTestSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(1),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
    }
}

internal struct BridgeFaultSystem : ISystemPolicy<BridgeFaultSystem>
{
    public static SystemDescriptor Descriptor => new(
        new SystemId(2),
        SystemPhase.Update,
        0,
        ComponentMask.Empty,
        ComponentMask.Empty);

    public static void Execute(World world, in SystemContext context)
    {
        _ = world;
        _ = context;
        throw new InvalidOperationException("bridge system fault");
    }
}

internal sealed class RecordingObserver<T> : IObserver<T>
{
    private readonly Lock _gate = new();
    private readonly List<T> _values = new();
    private bool _completed;
    private Exception? _error;

    public IReadOnlyList<T> Values
    {
        get
        {
            lock (_gate)
            {
                return [.. _values];
            }
        }
    }

    public bool Completed
    {
        get
        {
            lock (_gate)
            {
                return _completed;
            }
        }
    }

    public Exception? Error
    {
        get
        {
            lock (_gate)
            {
                return _error;
            }
        }
    }

    public void OnNext(T value)
    {
        lock (_gate)
        {
            _values.Add(value);
        }
    }

    public void OnError(Exception error)
    {
        lock (_gate)
        {
            _error = error;
        }
    }

    public void OnCompleted()
    {
        lock (_gate)
        {
            _completed = true;
        }
    }
}

internal sealed class CountingObserver<T> : IObserver<T>
{
    public int Count;

    public void OnNext(T value)
    {
        _ = value;
        Count++;
    }

    public void OnError(Exception error) => throw error;

    public void OnCompleted()
    {
    }
}

internal sealed class RecordingSink : IDiagnosticsSink
{
    public int Archetypes;
    public int Created;
    public int Destroyed;

    public void OnArchetypeCreated(ArchetypeId id, in ComponentMask mask)
    {
        _ = id;
        _ = mask;
        Archetypes++;
    }

    public void OnEntityCreated(Entity entity)
    {
        _ = entity;
        Created++;
    }

    public void OnEntityDestroyed(Entity entity)
    {
        _ = entity;
        Destroyed++;
    }
}

public sealed class EcsReactiveBridgeTests
{
    [Fact]
    public void ComponentChangesReportAddedChangedAndRemoved()
    {
        ComponentRegistry.Register<BridgePosition>();
        ComponentRegistry.Register<BridgeVelocity>();
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        var added = new RecordingObserver<ComponentAddedEvent<BridgePosition>>();
        var changed = new RecordingObserver<ComponentChangedEvent<BridgePosition>>();
        var removed = new RecordingObserver<ComponentRemovedEvent<BridgePosition>>();
        using var addedSubscription = changes.Added.Subscribe(added);
        using var changedSubscription = changes.Changed.Subscribe(changed);
        using var removedSubscription = changes.Removed.Subscribe(removed);

        Entity entity = world.BeginEntity().With(new BridgePosition(1.0f, 2.0f)).Commit();
        bridge.Pump();

        added.Values.Should().ContainSingle();
        added.Values[0].Entity.Should().Be(entity);
        added.Values[0].Value.X.Should().BeApproximately(1.0f, 1e-4f);
        added.Values[0].Tick.Should().Be(0);
        changed.Values.Should().BeEmpty();

        bridge.Pump();
        added.Values.Should().ContainSingle();

        world.Step();
        world.SetComponent(entity, new BridgePosition(3.0f, 4.0f));
        bridge.Pump();

        changed.Values.Should().ContainSingle();
        changed.Values[0].Value.X.Should().BeApproximately(3.0f, 1e-4f);
        changed.Values[0].Tick.Should().Be(1);

        world.Step();
        world.RemoveComponent<BridgePosition>(entity);
        bridge.Pump();

        removed.Values.Should().ContainSingle();
        removed.Values[0].Entity.Should().Be(entity);
        removed.Values[0].Tick.Should().Be(2);
    }

    [Fact]
    public void UntrackedComponentChangesAreNotReported()
    {
        ComponentRegistry.Register<BridgePosition>();
        ComponentRegistry.Register<BridgeVelocity>();
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        var added = new RecordingObserver<ComponentAddedEvent<BridgePosition>>();
        using var subscription = changes.Added.Subscribe(added);

        _ = world.BeginEntity().With(new BridgeVelocity(1.0f)).Commit();
        bridge.Pump();

        added.Values.Should().BeEmpty();
    }

    [Fact]
    public void LifecycleStreamForwardsAndLeavesTheInnerSinkIntact()
    {
        var inner = new RecordingSink();
        using var world = new World(diagnostics: inner, workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        var lifecycle = new RecordingObserver<EntityLifecycleEvent>();
        using var subscription = bridge.EntityLifecycle.Subscribe(lifecycle);

        Entity entity = world.BeginEntity().Commit();
        world.DestroyEntity(entity);
        bridge.Pump();

        lifecycle.Values.Should().HaveCount(2);
        lifecycle.Values[0].Entity.Should().Be(entity);
        lifecycle.Values[0].Kind.Should().Be(EntityLifecycleKind.Created);
        lifecycle.Values[1].Kind.Should().Be(EntityLifecycleKind.Destroyed);
        inner.Created.Should().Be(1);
        inner.Destroyed.Should().Be(1);
    }

    [Fact]
    public void LifecycleStreamDoesNotReplayEntitiesCreatedBeforeAttachment()
    {
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().Commit();
        using var bridge = new EcsReactiveBridge(world);
        var lifecycle = new RecordingObserver<EntityLifecycleEvent>();
        using var subscription = bridge.EntityLifecycle.Subscribe(lifecycle);

        bridge.Pump();

        lifecycle.Values.Should().BeEmpty();
    }

    [Fact]
    public void SchedulerEmitsFrameAndSystemEventsInSerialOrder()
    {
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        using var bridge = new EcsReactiveBridge(world);
        bridge.AttachScheduler(scheduler);
        scheduler.Add<BridgeTestSystem>();

        var order = new List<string>();
        var framesStarted = new List<FrameEvent>();
        var framesCompleted = new List<FrameEvent>();
        var systemsStarted = new List<SystemEvent>();
        var systemsCompleted = new List<SystemEvent>();
        using var a = bridge.FrameStarted.Subscribe(new DelegateObserver<FrameEvent>(frame =>
        {
            order.Add("frame-start");
            framesStarted.Add(frame);
        }));
        using var b = bridge.FrameCompleted.Subscribe(new DelegateObserver<FrameEvent>(frame =>
        {
            order.Add("frame-end");
            framesCompleted.Add(frame);
        }));
        using var c = bridge.SystemStarted.Subscribe(new DelegateObserver<SystemEvent>(system =>
        {
            order.Add("system-start");
            systemsStarted.Add(system);
        }));
        using var d = bridge.SystemCompleted.Subscribe(new DelegateObserver<SystemEvent>(system =>
        {
            order.Add("system-end");
            systemsCompleted.Add(system);
        }));

        scheduler.Run(0.016f);

        order.Should().Equal("frame-start", "system-start", "system-end", "frame-end");
        framesStarted.Should().ContainSingle();
        framesStarted[0].Tick.Should().Be(1);
        framesCompleted.Should().ContainSingle();
        systemsStarted.Should().ContainSingle();
        systemsStarted[0].Id.Should().Be(new SystemId(1));
        systemsCompleted.Should().ContainSingle();
    }

    [Fact]
    public void SchedulerFaultIsPublishedAndRethrown()
    {
        using var world = new World(workerCount: 1);
        using var scheduler = new SystemScheduler(world);
        using var bridge = new EcsReactiveBridge(world);
        bridge.AttachScheduler(scheduler);
        scheduler.Add<BridgeFaultSystem>();
        var faults = new RecordingObserver<SystemFaultEvent>();
        using var subscription = bridge.SystemFaulted.Subscribe(faults);

        Action run = () => scheduler.Run();
        run.Should().Throw<InvalidOperationException>().WithMessage("bridge system fault");
        faults.Values.Should().ContainSingle();
        faults.Values[0].Event.Id.Should().Be(new SystemId(2));
        faults.Values[0].Error.Should().BeOfType<InvalidOperationException>();
    }

    [Fact]
    public void PumpIsDeterministicAcrossRows()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        for (int index = 0; index < 3; index++)
        {
            _ = world.BeginEntity().With(new BridgePosition(index, 0.0f)).Commit();
        }

        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        var added = new RecordingObserver<ComponentAddedEvent<BridgePosition>>();
        using var subscription = changes.Added.Subscribe(added);

        bridge.Pump();

        added.Values.Should().HaveCount(3);
        added.Values.Select(value => value.Value.X).Should().Equal(0.0f, 1.0f, 2.0f);
    }

    [Fact]
    public void BridgeStreamsHonorSubscriberPriority()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        var order = new List<string>();
        using var high = changes.Added.Subscribe(
            new DelegateObserver<ComponentAddedEvent<BridgePosition>>(_ => order.Add("high")),
            ObservationPriority.High);
        using var low = changes.Added.Subscribe(
            new DelegateObserver<ComponentAddedEvent<BridgePosition>>(_ => order.Add("low")),
            ObservationPriority.Low);

        _ = world.BeginEntity().With(new BridgePosition(1.0f, 0.0f)).Commit();
        bridge.Pump();

        order.Should().Equal("high", "low");
    }

    [Fact]
    public void PumpDoesNotAllocateInSteadyState()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        for (int index = 0; index < 32; index++)
        {
            _ = world.BeginEntity().With(new BridgePosition(index, 0.0f)).Commit();
        }

        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        var added = new CountingObserver<ComponentAddedEvent<BridgePosition>>();
        var changed = new CountingObserver<ComponentChangedEvent<BridgePosition>>();
        var removed = new CountingObserver<ComponentRemovedEvent<BridgePosition>>();
        using var a = changes.Added.Subscribe(added);
        using var b = changes.Changed.Subscribe(changed);
        using var c = changes.Removed.Subscribe(removed);

        for (int iteration = 0; iteration < 200; iteration++)
        {
            bridge.Pump();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int iteration = 0; iteration < 1000; iteration++)
        {
            bridge.Pump();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        added.Count.Should().Be(32);
    }

    [Fact]
    public void PumpWithUnchangedQueryDoesNotAllocate()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        _ = world.BeginEntity().With(new BridgePosition(1, 0)).Commit();
        _ = world.BeginEntity().With(new BridgePosition(2, 0)).Commit();
        using var bridge = new EcsReactiveBridge(world);
        BehaviorSubject<Entity[]> query = bridge.Observables.GetQueryObservable<BridgePosition>("positions");
        using var subscription = query.Subscribe(new CountingObserver<Entity[]>());

        for (int iteration = 0; iteration < 200; iteration++)
        {
            bridge.Pump();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int iteration = 0; iteration < 1000; iteration++)
        {
            bridge.Pump();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void DisposeCompletesStreamsAndRestoresDiagnostics()
    {
        var inner = new RecordingSink();
        var world = new World(diagnostics: inner, workerCount: 1);
        var bridge = new EcsReactiveBridge(world);
        var lifecycle = new RecordingObserver<EntityLifecycleEvent>();
        using var subscription = bridge.EntityLifecycle.Subscribe(lifecycle);

        bridge.Dispose();

        lifecycle.Completed.Should().BeTrue();
        world.Diagnostics.Should().BeSameAs(inner);
        Action pump = () => bridge.Pump();
        pump.Should().Throw<ObjectDisposedException>();
        world.Dispose();
    }

    [Fact]
    public void TrackReturnsTheSameStreamAndRecreatesAfterDispose()
    {
        ComponentRegistry.Register<BridgePosition>();
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        ComponentChanges<BridgePosition> changes = bridge.Track<BridgePosition>();
        bridge.Track<BridgePosition>().Should().BeSameAs(changes);

        changes.Dispose();
        ComponentChanges<BridgePosition> replacement = bridge.Track<BridgePosition>();
        replacement.Should().NotBeSameAs(changes);
        replacement.IsDisposed.Should().BeFalse();

        FluentActions.Invoking(bridge.Dispose).Should().NotThrow();
        FluentActions.Invoking(bridge.Dispose).Should().NotThrow();
    }

    [Fact]
    public void DroppedLifecycleEventsReportsRingOverflow()
    {
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        for (int index = 0; index < 1100; index++)
        {
            _ = world.BeginEntity().Commit();
        }

        bridge.DroppedLifecycleEvents.Should().BeGreaterThan(0);
        bridge.Pump();
        bridge.DroppedLifecycleEvents.Should().BeGreaterThan(0);
    }

    [Fact]
    public void SecondBridgeOnTheSameWorldIsRejected()
    {
        using var world = new World(workerCount: 1);
        using var bridge = new EcsReactiveBridge(world);
        Action create = () => _ = new EcsReactiveBridge(world);
        create.Should().Throw<InvalidOperationException>();
    }

    private sealed class DelegateObserver<T> : IObserver<T>
    {
        private readonly Action<T> _onNext;

        public DelegateObserver(Action<T> onNext) => _onNext = onNext;

        public void OnNext(T value) => _onNext(value);

        public void OnError(Exception error) => throw error;

        public void OnCompleted()
        {
        }
    }
}
