namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneStructuralBufferTests
{
    [Fact]
    public void DestroyEntity_DuringUpdateIsDeferred()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity runner = world.CreateEntity("Runner");
        SceneEntity target = world.CreateEntity("Target");
        DeferredBehaviour behaviour = world.AddBehaviour<DeferredBehaviour>(runner);

        int countBefore = -1;
        int countAfter = -1;
        bool destroyResult = false;
        behaviour.Action = () =>
        {
            countBefore = world.EntityCount;
            destroyResult = world.DestroyEntity(target);
            countAfter = world.EntityCount;
        };

        world.Start();
        world.Update(0.016f);

        countBefore.Should().Be(2);
        destroyResult.Should().BeTrue();
        countAfter.Should().Be(2);
        world.EntityCount.Should().Be(1);
        world.TryGetEntity(target, out _).Should().BeFalse();
    }

    [Fact]
    public void DestroyEntity_QueuedTwiceDestroysOnce()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity runner = world.CreateEntity("Runner");
        SceneEntity target = world.CreateEntity("Target");
        DeferredBehaviour behaviour = world.AddBehaviour<DeferredBehaviour>(runner);

        bool first = false;
        bool second = false;
        behaviour.Action = () =>
        {
            first = world.DestroyEntity(target);
            second = world.DestroyEntity(target);
        };

        world.Start();
        world.Update(0.016f);

        first.Should().BeTrue();
        second.Should().BeFalse();
        world.EntityCount.Should().Be(1);
    }

    [Fact]
    public void DestroyEntity_DirectOutsideIterationIsImmediate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity("Entity");

        world.DestroyEntity(entity).Should().BeTrue();

        world.EntityCount.Should().Be(0);
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
