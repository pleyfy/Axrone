namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneStructuralBufferTests
{
    [Fact]
    public void DestroyActor_DuringUpdateIsDeferred()
    {
        using SceneWorld world = CreateWorld();
        SceneActor runner = world.CreateActor("Runner");
        SceneActor target = world.CreateActor("Target");
        DeferredBehaviour behaviour = world.AddBehaviour<DeferredBehaviour>(runner);

        int countBefore = -1;
        int countAfter = -1;
        bool destroyResult = false;
        behaviour.Action = () =>
        {
            countBefore = world.ActorCount;
            destroyResult = world.DestroyActor(target);
            countAfter = world.ActorCount;
        };

        world.Start();
        world.Update(0.016f);

        countBefore.Should().Be(2);
        destroyResult.Should().BeTrue();
        countAfter.Should().Be(2);
        world.ActorCount.Should().Be(1);
        world.TryGetActor(target, out _).Should().BeFalse();
    }

    [Fact]
    public void DestroyActor_QueuedTwiceDestroysOnce()
    {
        using SceneWorld world = CreateWorld();
        SceneActor runner = world.CreateActor("Runner");
        SceneActor target = world.CreateActor("Target");
        DeferredBehaviour behaviour = world.AddBehaviour<DeferredBehaviour>(runner);

        bool first = false;
        bool second = false;
        behaviour.Action = () =>
        {
            first = world.DestroyActor(target);
            second = world.DestroyActor(target);
        };

        world.Start();
        world.Update(0.016f);

        first.Should().BeTrue();
        second.Should().BeFalse();
        world.ActorCount.Should().Be(1);
    }

    [Fact]
    public void DestroyActor_DirectOutsideIterationIsImmediate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor("Actor");

        world.DestroyActor(actor).Should().BeTrue();

        world.ActorCount.Should().Be(0);
    }

    private static SceneWorld CreateWorld()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/deferred-destroy")))
            .AddTransform3D()
            .AddBehaviour<DeferredBehaviour>("Deferred")
            .Build();

        return profile.CreateWorld();
    }

    private sealed class DeferredBehaviour : ISceneBehaviour
    {
        public Action? Action { get; set; }

        public void OnAttach(SceneBehaviourContext context) =>
            context.OnUpdate(_ => Action?.Invoke());
    }
}
