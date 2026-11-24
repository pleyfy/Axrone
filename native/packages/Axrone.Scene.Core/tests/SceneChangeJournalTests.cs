namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneChangeJournalTests
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

    private sealed class Tracker : IDisposable
    {
        public int Disposed;

        public void Dispose() => Disposed++;
    }

    [Fact]
    public void EntityAndComponentMutations_AreJournaledInOrder()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = world.CreateEntity("Player");

        world.AddData(entity, new Probe { Value = 1 });
        world.SetData(entity, new Probe { Value = 2 });
        world.MarkChanged<Probe>(entity);
        world.RemoveData<Probe>(entity);
        world.DestroyEntity(entity);

        var buffer = new SceneChange[16];
        int count = world.Changes.Drain(buffer);
        buffer.AsSpan(0, count).ToArray()
            .Select(change => change.Kind)
            .Should().ContainInOrder(
                SceneChangeKind.EntityCreated,
                SceneChangeKind.ComponentAdded,
                SceneChangeKind.ComponentChanged,
                SceneChangeKind.ComponentChanged,
                SceneChangeKind.ComponentRemoved,
                SceneChangeKind.EntityDestroyed);
    }

    [Fact]
    public void BehaviourMutations_AreJournaledAndSubscriptionsAreDisposed()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = world.CreateEntity();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(entity);
        var tracker = new Tracker();
        behaviour.Context!.Track(tracker);

        world.RemoveBehaviour(behaviour);

        tracker.Disposed.Should().Be(1);
        world.BehaviourCount.Should().Be(0);

        var buffer = new SceneChange[8];
        int count = world.Changes.Drain(buffer);
        buffer.AsSpan(0, count).ToArray()
            .Select(change => change.Kind)
            .Should().ContainInOrder(
                SceneChangeKind.EntityCreated,
                SceneChangeKind.BehaviourAdded,
                SceneChangeKind.BehaviourRemoved);
    }

    [Fact]
    public void HierarchyMutations_AreJournaled()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity parent = world.CreateEntity();
        SceneEntity child = world.CreateEntity();
        world.Changes.Clear();

        world.Hierarchy.SetParent(child, parent);
        world.SetActive(parent, false);

        var buffer = new SceneChange[16];
        int count = world.Changes.Drain(buffer);
        buffer.AsSpan(0, count).ToArray()
            .Select(change => change.Kind)
            .Should().ContainInOrder(
                SceneChangeKind.ParentChanged,
                SceneChangeKind.ActiveInHierarchyChanged);
    }

    [Fact]
    public void BehaviourEnableAndDisable_AreJournaled()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = world.CreateEntity();
        TrackingBehaviour behaviour = world.AddBehaviour<TrackingBehaviour>(entity);
        world.Start();

        world.SetBehaviourEnabled<TrackingBehaviour>(entity, false);
        world.SetBehaviourEnabled<TrackingBehaviour>(entity, true);

        var buffer = new SceneChange[16];
        int count = world.Changes.Drain(buffer);
        buffer.AsSpan(0, count).ToArray()
            .Select(change => change.Kind)
            .Should().ContainInOrder(
                SceneChangeKind.EntityCreated,
                SceneChangeKind.BehaviourAdded,
                SceneChangeKind.BehaviourEnabled,
                SceneChangeKind.BehaviourDisabled,
                SceneChangeKind.BehaviourEnabled);
    }

    [Fact]
    public void Journal_DropsOldestWhenFull()
    {
        var journal = new SceneChangeJournal(capacity: 2);
        SceneEntity entity = SceneEntity.Null;

        journal.Write(SceneChange.EntityCreated(entity));
        journal.Write(SceneChange.EntityDestroyed(entity));
        journal.Write(SceneChange.EntityCreated(entity));

        journal.DroppedCount.Should().Be(1);
        journal.Count.Should().Be(2);

        var buffer = new SceneChange[2];
        journal.Drain(buffer).Should().Be(2);
        buffer[0].Kind.Should().Be(SceneChangeKind.EntityDestroyed);
        buffer[1].Kind.Should().Be(SceneChangeKind.EntityCreated);
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
}
