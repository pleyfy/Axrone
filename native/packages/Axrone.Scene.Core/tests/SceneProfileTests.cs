namespace Axrone.Scene.Core.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneProfileTests
{
    [Fact]
    public void Core3DProfile_RegistersTransform3D()
    {
        SceneProfile profile = SceneProfiles.CreateCore3D();

        profile.Id.Should().Be(SceneProfileIds.Core3D);
        profile.HasTransform3D.Should().BeTrue();
        profile.HasTransform2D.Should().BeFalse();
        profile.Registry.IsSealed.Should().BeTrue();

        using SceneWorld world = profile.CreateWorld();
        SceneEntity entity = world.CreateEntity();

        world.HasTransform3D.Should().BeTrue();
        world.HasTransform2D.Should().BeFalse();
        world.GetTransform3D(entity).Scale.Should().Be(Vec3.One);

        Action get2D = () => world.GetTransform2D(entity);
        get2D.Should().Throw<SceneCapabilityException>();
    }

    [Fact]
    public void Core2DProfile_RegistersTransform2D()
    {
        SceneProfile profile = SceneProfiles.CreateCore2D();
        using SceneWorld world = profile.CreateWorld();
        SceneEntity entity = world.CreateEntity();

        world.HasTransform2D.Should().BeTrue();
        world.HasTransform3D.Should().BeFalse();

        world.GetTransform2D(entity).SetPosition(new Vec2(1.0f, 2.0f));
        world.UpdateTransforms();

        world.GetWorldPosition2D(entity).Should().Be(new Vec2(1.0f, 2.0f));
    }

    [Fact]
    public void Builder_RegistersCustomComponentsAndFreezes()
    {
        var id = new SceneProfileId(SceneStringId.FromName("test/profile"));
        var builder = new SceneProfileBuilder(id);
        builder
            .AddTransform3D()
            .AddData<Health>("Health", SceneComponentTraits.Serializable)
            .AddBehaviour<CounterBehaviour>("Counter", priority: 5);

        SceneProfile profile = builder.Build();

        profile.Registry.IsSealed.Should().BeTrue();
        profile.Registry.DataCount.Should().Be(2);
        profile.Registry.BehaviourCount.Should().Be(1);
        SceneCapabilityGuard.RequireData<Health>(profile.Registry);
        SceneCapabilityGuard.RequireBehaviour<CounterBehaviour>(profile.Registry);

        Action addAfterBuild = () => builder.AddData<Health>("Health2");
        addAfterBuild.Should().Throw<SceneLifecycleException>();
    }

    [Fact]
    public void CapabilityGuard_RejectsMissingComponents()
    {
        SceneProfile profile = SceneProfiles.CreateCore3D();

        Action missingData = () => SceneCapabilityGuard.RequireData<Health>(profile.Registry);
        Action missingBehaviour = () => SceneCapabilityGuard.RequireBehaviour<CounterBehaviour>(profile.Registry);

        missingData.Should().Throw<SceneCapabilityException>();
        missingBehaviour.Should().Throw<SceneCapabilityException>();
    }

    [Fact]
    public void Profile_CreateWorldWithOptions_UsesOptions()
    {
        SceneProfile profile = SceneProfiles.CreateCore3D();

        using SceneWorld world = profile.CreateWorld(
            new SceneWorldOptions(8, SceneWorldErrorPolicy.FailFast));

        world.ErrorPolicy.Should().Be(SceneWorldErrorPolicy.FailFast);
        world.Capacity.Should().BeGreaterThanOrEqualTo(8);
    }

    [Fact]
    public void Profiles_CanShareNameTable()
    {
        var names = new SceneNameTable();
        SceneProfile first = SceneProfiles.CreateCore3D(names);
        SceneProfile second = SceneProfiles.CreateCore2D(names);

        first.Registry.Names.Should().BeSameAs(second.Registry.Names);
        first.Registry.TryGetDataByType(typeof(SceneTransform3D), out _).Should().BeTrue();
        second.Registry.TryGetDataByType(typeof(SceneTransform2D), out _).Should().BeTrue();
    }
}
