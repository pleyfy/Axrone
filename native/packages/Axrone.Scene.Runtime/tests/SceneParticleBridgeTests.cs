namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneParticleBridgeTests
{
    [Fact]
    public void Bridge_EmitsAndStepsParticles()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneParticleBridge3D(world);

        SceneEntity entity = world.CreateEntity("Emitter");
        world.GetTransform3D(entity).SetPosition(new Vec3(0.0f, 1.0f, 0.0f));
        SceneParticleSystem system = SceneParticleSystem.Default;
        world.AddData(entity, system);
        world.UpdateTransforms();

        bridge.SyncSystems();
        bridge.SystemCount.Should().Be(1);

        bridge.Step(0.1f);

        SceneParticleSnapshot snapshot = bridge.GetSnapshot(0);
        snapshot.Count.Should().BeGreaterThan(0);
        snapshot.Count.Should().BeLessThanOrEqualTo(system.MaxParticles);
        snapshot.PosX.Length.Should().Be(snapshot.Count);
    }

    [Fact]
    public void Bridge_RemovesDisabledAndDeletedSystems()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneParticleBridge3D(world);

        SceneEntity entity = world.CreateEntity("Emitter");
        world.GetTransform3D(entity).SetPosition(Vec3.Zero);
        SceneParticleSystem system = SceneParticleSystem.Default;
        world.AddData(entity, system);
        world.UpdateTransforms();

        bridge.SyncSystems();
        bridge.SystemCount.Should().Be(1);

        world.RemoveData<SceneParticleSystem>(entity);
        bridge.SyncSystems();
        bridge.SystemCount.Should().Be(0);
    }

    [Fact]
    public void Bridge_RecreatesEngineWhenCapacityGrows()
    {
        using SceneWorld world = CreateWorld();
        using var bridge = new SceneParticleBridge3D(world);

        SceneEntity entity = world.CreateEntity("Emitter");
        world.GetTransform3D(entity).SetPosition(Vec3.Zero);
        SceneParticleSystem system = SceneParticleSystem.Default;
        world.AddData(entity, system);
        world.UpdateTransforms();

        bridge.SyncSystems();
        bridge.Step(0.1f);
        int initialCount = bridge.GetSnapshot(0).Count;

        SceneParticleSystem bigger = system;
        bigger.MaxParticles = system.MaxParticles * 2;
        world.GetData<SceneParticleSystem>(entity) = bigger;
        bridge.SyncSystems();

        bridge.SystemCount.Should().Be(1);
        bridge.GetSnapshot(0).Count.Should().Be(0);
        initialCount.Should().BeGreaterThan(0);
    }

    private static SceneWorld CreateWorld()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/particles")))
            .AddTransform3D()
            .AddParticles3D()
            .Build();

        return profile.CreateWorld();
    }
}
