namespace Axrone.Reactive.Scene.Tests;

using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneReactiveBridgeTests
{
    private struct Probe : ISceneDataComponent
    {
        public int Value;
    }

    private sealed class TrackingBehaviour : ISceneBehaviour
    {
        public SceneBehaviourContext? Context { get; private set; }

        public void OnAttach(SceneBehaviourContext context) => Context = context;
    }

    [Fact]
    public void ComponentAddRemoveAndChange_FlowThroughTypedStreams()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        var added = new List<ComponentAdded<Probe>>();
        var removed = new List<ComponentRemoved<Probe>>();
        var changed = new List<ComponentChanged<Probe>>();

        using IDisposable addedSub = bridge.ComponentAdded<Probe>().Subscribe(new Observer<ComponentAdded<Probe>>(added.Add));
        using IDisposable removedSub = bridge.ComponentRemoved<Probe>().Subscribe(new Observer<ComponentRemoved<Probe>>(removed.Add));
        using IDisposable changedSub = bridge.ComponentChanged<Probe>().Subscribe(new Observer<ComponentChanged<Probe>>(changed.Add));

        SceneEntity entity = world.CreateEntity();
        world.AddData(entity, new Probe { Value = 7 });
        world.SetData(entity, new Probe { Value = 8 });
        world.MarkChanged<Probe>(entity);
        world.RemoveData<Probe>(entity);

        bridge.Pump();

        added.Should().ContainSingle();
        added[0].Entity.Should().Be(entity);

        changed.Should().HaveCount(2);
        changed[0].Entity.Should().Be(entity);
        changed[1].Entity.Should().Be(entity);

        removed.Should().ContainSingle();
        removed[0].Entity.Should().Be(entity);
    }

    [Fact]
    public void EntityLifecycle_FlowsThroughBridge()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        var created = new List<SceneEntity>();
        var destroyed = new List<SceneEntity>();

        using IDisposable createdSub = bridge.EntityCreated.Subscribe(new Observer<SceneEntity>(created.Add));
        using IDisposable destroyedSub = bridge.EntityDestroyed.Subscribe(new Observer<SceneEntity>(destroyed.Add));

        SceneEntity entity = world.CreateEntity();
        bridge.Pump();
        world.DestroyEntity(entity);
        bridge.Pump();

        created.Should().ContainSingle().Which.Should().Be(entity);
        destroyed.Should().ContainSingle().Which.Should().Be(entity);
    }

    [Fact]
    public void BehaviourSubscriptions_DisposeWithTheBehaviour()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        SceneEntity entity = world.CreateEntity();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(entity);

        int observed = 0;
        behaviour.Context!.ObserveComponentAdded<Probe>(bridge, _ => observed++);

        world.AddData(entity, new Probe());
        bridge.Pump();
        observed.Should().Be(1);

        world.RemoveBehaviour(behaviour);
        SceneEntity other = world.CreateEntity();
        world.AddData(other, new Probe());
        bridge.Pump();

        observed.Should().Be(1, "the behaviour subscription was disposed with its owner");
    }

    [Fact]
    public void BehaviourLifecycle_FlowsThroughBridge()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        var changes = new List<BehaviourChange>();
        using IDisposable subscription = bridge.BehaviourChanges.Subscribe(new Observer<BehaviourChange>(changes.Add));

        SceneEntity entity = world.CreateEntity();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(entity);
        world.RemoveBehaviour(behaviour);
        bridge.Pump();

        changes.Select(change => change.Kind).Should().ContainInOrder(
            SceneChangeKind.BehaviourAdded,
            SceneChangeKind.BehaviourRemoved);
    }

    [Fact]
    public void Pump_WithoutSubscribers_DoesNotAllocatePayloadCopies()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        SceneEntity entity = world.CreateEntity();

        for (int i = 0; i < 1_000; i++)
        {
            world.AddData(entity, new Probe { Value = i });
            world.MarkChanged<Probe>(entity);
            bridge.Pump();
            world.RemoveData<Probe>(entity);
            bridge.Pump();
        }

        world.Changes.Count.Should().Be(0);
    }

    [Fact]
    public void HierarchyChanges_FlowThroughBridge()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        var changes = new List<HierarchyChange>();
        using IDisposable subscription = bridge.HierarchyChanges.Subscribe(new Observer<HierarchyChange>(changes.Add));

        SceneEntity parent = world.CreateEntity();
        SceneEntity child = world.CreateEntity();
        bridge.Pump();
        changes.Clear();

        world.Hierarchy.SetParent(child, parent);
        world.SetActive(parent, false);
        bridge.Pump();

        changes.Should().Contain(change => change.Entity == child && change.Kind == SceneChangeKind.ParentChanged);
        changes.Should().Contain(change => change.Entity == child && change.Kind == SceneChangeKind.ActiveInHierarchyChanged);
    }

    [Fact]
    public void AttachedLoopPumpsAutomaticallyAndDetachesOnBridgeDispose()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/reactive-loop")))
            .AddTransform3D()
            .Build();
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = profile });
        var bridge = new SceneReactiveBridge(runtime.World);
        using var loop = new SceneRuntimeLoop(runtime);
        var created = new List<SceneEntity>();
        using IDisposable subscription = bridge.EntityCreated.Subscribe(new Observer<SceneEntity>(created.Add));

        bridge.AttachLoop(loop);
        loop.Start();
        SceneEntity entity = runtime.World.CreateEntity();
        _ = loop.Tick();
        created.Should().ContainSingle().Which.Should().Be(entity);

        bridge.DetachLoop();
        _ = runtime.World.CreateEntity();
        _ = loop.Tick();
        created.Should().ContainSingle();

        bridge.Dispose();
    }

    [Fact]
    public void ReattachingTheSameLoopKeepsASingleRegistration()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/reactive-loop-reattach")))
            .AddTransform3D()
            .Build();
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = profile });
        var bridge = new SceneReactiveBridge(runtime.World);
        using var loop = new SceneRuntimeLoop(runtime);
        var created = new List<SceneEntity>();
        using IDisposable subscription = bridge.EntityCreated.Subscribe(new Observer<SceneEntity>(created.Add));

        bridge.AttachLoop(loop);
        bridge.AttachLoop(loop);
        bridge.DetachLoop();
        loop.Start();
        _ = runtime.World.CreateEntity();
        _ = loop.Tick();

        created.Should().BeEmpty("detach must remove the single loop registration");

        bridge.Dispose();
    }

    private static SceneWorld CreateWorld()
    {
        var registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>(
            "Transform3D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);
        registry.RegisterData<Probe>("Probe");
        registry.RegisterBehaviour<TrackingBehaviour>("Tracking");

        return new SceneWorld(
            registry,
            diagnostics: null,
            new SceneWorldOptions(initialCapacity: 4));
    }

    private sealed class Observer<T>(Action<T> onNext) : IObserver<T>
    {
        public void OnNext(T value) => onNext(value);

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }
}
