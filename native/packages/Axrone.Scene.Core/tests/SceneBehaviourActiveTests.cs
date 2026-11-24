namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneBehaviourActiveTests
{
    [Fact]
    public void InactiveEntity_StopsUpdatesAndFiresCallbacks()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);
        world.Start();

        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);

        world.SetActive(entity, false);
        behaviour.DisableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);

        world.SetActive(entity, true);
        behaviour.EnableCount.Should().Be(2);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(2);
    }

    [Fact]
    public void InactiveEntity_BehaviourAddedAfterStartStartsDisabled()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        world.Start();
        world.SetActive(entity, false);

        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);

        behaviour.EnableCount.Should().Be(0);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(0);

        world.SetActive(entity, true);
        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);
    }

    [Fact]
    public void ParentDeactivation_DisablesChildBehaviours()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity("Parent");
        SceneEntity child = world.CreateEntity("Child");
        world.Hierarchy.SetParent(child, parent);
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(child);
        world.Start();

        behaviour.EnableCount.Should().Be(1);

        world.SetActive(parent, false);
        behaviour.DisableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(0);

        world.SetActive(parent, true);
        behaviour.EnableCount.Should().Be(2);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);
    }

    [Fact]
    public void DisabledBehaviour_StaysDisabledAcrossHierarchyReactivation()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);
        world.Start();

        world.SetBehaviourEnabled<CounterBehaviour>(entity, false);
        behaviour.DisableCount.Should().Be(1);

        world.SetActive(entity, false);
        world.SetActive(entity, true);

        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(0);

        world.SetBehaviourEnabled<CounterBehaviour>(entity, true);
        behaviour.EnableCount.Should().Be(2);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);
    }

    [Fact]
    public void Behaviour_ExposesContextUntilDetached()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);

        behaviour.Context!.World.Should().BeSameAs(world);
        behaviour.Context.IsAttached.Should().BeTrue();

        world.DestroyEntity(entity);

        behaviour.Context.IsAttached.Should().BeFalse();
    }
}
