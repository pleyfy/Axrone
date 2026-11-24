namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneBehaviourActiveTests
{
    [Fact]
    public void InactiveActor_StopsUpdatesAndFiresCallbacks()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor("Actor");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(actor);
        world.Start();

        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);

        world.SetActive(actor, false);
        behaviour.DisableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);

        world.SetActive(actor, true);
        behaviour.EnableCount.Should().Be(2);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(2);
    }

    [Fact]
    public void InactiveActor_BehaviourAddedAfterStartStartsDisabled()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor("Actor");
        world.Start();
        world.SetActive(actor, false);

        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(actor);

        behaviour.EnableCount.Should().Be(0);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(0);

        world.SetActive(actor, true);
        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);
    }

    [Fact]
    public void ParentDeactivation_DisablesChildBehaviours()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor parent = world.CreateActor("Parent");
        SceneActor child = world.CreateActor("Child");
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
        SceneActor actor = world.CreateActor("Actor");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(actor);
        world.Start();

        world.SetBehaviourEnabled<CounterBehaviour>(actor, false);
        behaviour.DisableCount.Should().Be(1);

        world.SetActive(actor, false);
        world.SetActive(actor, true);

        behaviour.EnableCount.Should().Be(1);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(0);

        world.SetBehaviourEnabled<CounterBehaviour>(actor, true);
        behaviour.EnableCount.Should().Be(2);
        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);
    }

    [Fact]
    public void Behaviour_ExposesContextUntilDetached()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor("Actor");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(actor);

        behaviour.Context!.World.Should().BeSameAs(world);
        behaviour.Context.IsAttached.Should().BeTrue();

        world.DestroyActor(actor);

        behaviour.Context.IsAttached.Should().BeFalse();
    }
}
