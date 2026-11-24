namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Physics2D;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class ScenePhysicsBridge2DTests
{
    [Fact]
    public void Bridge_DynamicBodyFallsUnderGravity()
    {
        using SceneWorld world = CreatePhysicsWorld();
        using var bridge = new ScenePhysicsBridge2D(world);

        SceneEntity entity = world.CreateEntity("Falling");
        world.GetTransform2D(entity).SetPosition(new Vec2(0.0f, 20.0f));
        world.AddData(entity, SceneRigidbody2D.Default);
        world.AddData(entity, SceneCollider2D.Default);
        world.UpdateTransforms();

        bridge.SyncBodies();
        bridge.BodyCount.Should().Be(1);

        Vec2 before = world.GetWorldPosition2D(entity);
        bridge.Step(0.1f);
        bridge.SyncTransformsFromPhysics();

        world.GetWorldPosition2D(entity).Y.Should().BeLessThan(before.Y);
    }

    [Fact]
    public void Bridge_StaticBodyStaysPut()
    {
        using SceneWorld world = CreatePhysicsWorld();
        using var bridge = new ScenePhysicsBridge2D(world);

        SceneEntity floor = world.CreateEntity("Floor");
        world.GetTransform2D(floor).SetPosition(Vec2.Zero);
        world.AddData(floor, SceneRigidbody2D.Static);
        world.AddData(floor, SceneCollider2D.Box(5.0f, 0.5f));

        bridge.SyncBodies();

        Vec2 before = world.GetWorldPosition2D(floor);
        bridge.Step(0.1f);
        bridge.Step(0.1f);
        bridge.SyncTransformsFromPhysics();

        world.GetWorldPosition2D(floor).Should().Be(before);
    }

    [Fact]
    public void Bridge_AppliesMassOverride()
    {
        using SceneWorld world = CreatePhysicsWorld();
        using var bridge = new ScenePhysicsBridge2D(world);

        SceneEntity entity = world.CreateEntity("Heavy");
        world.GetTransform2D(entity).SetPosition(new Vec2(0.0f, 5.0f));
        SceneRigidbody2D body = SceneRigidbody2D.Default;
        body.Mass = 7.5f;
        world.AddData(entity, body);
        world.AddData(entity, SceneCollider2D.Default);
        world.UpdateTransforms();

        bridge.SyncBodies();

        bridge.TryGetBody(entity, out BodyId bodyId).Should().BeTrue();
        bridge.PhysicsWorld.Bodies.GetMass(bodyId).Should().Be(7.5f);
    }

    [Fact]
    public void Bridge_RemovesDisabledBodies()
    {
        using SceneWorld world = CreatePhysicsWorld();
        using var bridge = new ScenePhysicsBridge2D(world);

        SceneEntity entity = world.CreateEntity("Toggle");
        world.GetTransform2D(entity).SetPosition(Vec2.Zero);
        SceneRigidbody2D body = SceneRigidbody2D.Default;
        world.AddData(entity, body);
        world.AddData(entity, SceneCollider2D.Default);
        world.UpdateTransforms();

        bridge.SyncBodies();
        bridge.BodyCount.Should().Be(1);

        body.Enabled = false;
        world.GetData<SceneRigidbody2D>(entity) = body;
        bridge.SyncBodies();

        bridge.BodyCount.Should().Be(0);
    }

    private static SceneWorld CreatePhysicsWorld()
    {
        var profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/physics-2d")))
            .AddTransform2D()
            .AddPhysics2D()
            .Build();

        return profile.CreateWorld();
    }
}
