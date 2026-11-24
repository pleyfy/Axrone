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

        SceneActor actor = world.CreateActor();
        world.AddData(actor, new Probe { Value = 7 });
        world.SetData(actor, new Probe { Value = 8 });
        world.MarkChanged<Probe>(actor);
        world.RemoveData<Probe>(actor);

        bridge.Pump();

        added.Should().ContainSingle();
        added[0].Actor.Should().Be(actor);

        changed.Should().HaveCount(2);
        changed[0].Actor.Should().Be(actor);
        changed[1].Actor.Should().Be(actor);

        removed.Should().ContainSingle();
        removed[0].Actor.Should().Be(actor);
    }

    [Fact]
    public void ActorLifecycle_FlowsThroughBridge()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        var created = new List<SceneActor>();
        var destroyed = new List<SceneActor>();

        using IDisposable createdSub = bridge.ActorCreated.Subscribe(new Observer<SceneActor>(created.Add));
        using IDisposable destroyedSub = bridge.ActorDestroyed.Subscribe(new Observer<SceneActor>(destroyed.Add));

        SceneActor actor = world.CreateActor();
        bridge.Pump();
        world.DestroyActor(actor);
        bridge.Pump();

        created.Should().ContainSingle().Which.Should().Be(actor);
        destroyed.Should().ContainSingle().Which.Should().Be(actor);
    }

    [Fact]
    public void BehaviourSubscriptions_DisposeWithTheBehaviour()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneReactiveBridge(world);
        SceneActor actor = world.CreateActor();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(actor);

        int observed = 0;
        behaviour.Context!.ObserveComponentAdded<Probe>(bridge, _ => observed++);

        world.AddData(actor, new Probe());
        bridge.Pump();
        observed.Should().Be(1);

        world.RemoveBehaviour(behaviour);
        SceneActor other = world.CreateActor();
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

        SceneActor actor = world.CreateActor();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(actor);
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
        SceneActor actor = world.CreateActor();

        for (int i = 0; i < 1_000; i++)
        {
            world.AddData(actor, new Probe { Value = i });
            world.MarkChanged<Probe>(actor);
            bridge.Pump();
            world.RemoveData<Probe>(actor);
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

        SceneActor parent = world.CreateActor();
        SceneActor child = world.CreateActor();
        bridge.Pump();
        changes.Clear();

        world.Hierarchy.SetParent(child, parent);
        world.SetActive(parent, false);
        bridge.Pump();

        changes.Should().Contain(change => change.Actor == child && change.Kind == SceneChangeKind.ParentChanged);
        changes.Should().Contain(change => change.Actor == child && change.Kind == SceneChangeKind.ActiveInHierarchyChanged);
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
        var created = new List<SceneActor>();
        using IDisposable subscription = bridge.ActorCreated.Subscribe(new Observer<SceneActor>(created.Add));

        bridge.AttachLoop(loop);
        loop.Start();
        SceneActor actor = runtime.World.CreateActor();
        _ = loop.Tick();
        created.Should().ContainSingle().Which.Should().Be(actor);

        bridge.DetachLoop();
        _ = runtime.World.CreateActor();
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
        var created = new List<SceneActor>();
        using IDisposable subscription = bridge.ActorCreated.Subscribe(new Observer<SceneActor>(created.Add));

        bridge.AttachLoop(loop);
        bridge.AttachLoop(loop);
        bridge.DetachLoop();
        loop.Start();
        _ = runtime.World.CreateActor();
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
