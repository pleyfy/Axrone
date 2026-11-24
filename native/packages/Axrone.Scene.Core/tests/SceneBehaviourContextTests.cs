namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneBehaviourContextTests
{
    [Fact]
    public void ContextReportsAttachmentAndLifecycleTransitions()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);
        SceneBehaviourContext context = behaviour.Context!;

        context.Entity.Should().Be(entity);
        context.World.Should().BeSameAs(world);
        context.IsAttached.Should().BeTrue();
        context.State.Should().Be(SceneBehaviourState.Loaded);
        context.Enabled.Should().BeTrue();

        world.Start();
        context.State.Should().Be(SceneBehaviourState.Enabled);

        world.SetBehaviourEnabled<CounterBehaviour>(entity, false);
        context.State.Should().Be(SceneBehaviourState.Disabled);
        context.Enabled.Should().BeFalse();

        world.SetBehaviourEnabled<CounterBehaviour>(entity, true);
        context.State.Should().Be(SceneBehaviourState.Enabled);

        world.RemoveBehaviour(behaviour);
        context.IsAttached.Should().BeFalse();
        context.State.Should().Be(SceneBehaviourState.Destroyed);
        context.Enabled.Should().BeFalse();
    }

    [Fact]
    public void DuplicatePhaseRegistrationIsRejected()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);
        SceneBehaviourContext context = behaviour.Context!;

        FluentActions.Invoking(() => context.OnUpdate(_ => { }))
            .Should().Throw<SceneValidationException>();
        FluentActions.Invoking(() => context.OnDetach(() => { }))
            .Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void TrackedSubscriptionsDisposeOnDetachAndRejectLateRegistrations()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);
        SceneBehaviourContext context = behaviour.Context!;
        var probe = new DisposableProbe();

        context.Track(probe);

        world.DestroyEntity(entity);
        probe.Disposed.Should().Be(1);
        FluentActions.Invoking(() => context.Track(new DisposableProbe()))
            .Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void TwoInstancesOfTheSameTypeAttachIndependently()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");
        CounterBehaviour first = world.AddBehaviour<CounterBehaviour>(entity);
        CounterBehaviour second = world.AddBehaviour<CounterBehaviour>(entity);

        first.Context.Should().NotBeSameAs(second.Context);
        world.BehaviourCount.Should().Be(2);

        world.RemoveBehaviour(first);
        second.Context!.IsAttached.Should().BeTrue();
        world.BehaviourCount.Should().Be(1);
    }

    private sealed class DisposableProbe : IDisposable
    {
        public int Disposed { get; private set; }

        public void Dispose() => Disposed++;
    }
}
