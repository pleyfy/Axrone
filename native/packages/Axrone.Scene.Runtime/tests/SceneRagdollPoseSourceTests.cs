namespace Axrone.Scene.Runtime.Tests;

using Axrone.Animation;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneRagdollPoseSourceTests
{
    [Fact]
    public void ApplyBlendsBoneActorWorldTransforms()
    {
        using SceneWorld world = CreateWorld();
        SceneActor animated = world.CreateActor("Character");
        SceneActor rootBone = world.CreateActor("Hips");
        SceneActor childBone = world.CreateActor("Spine");
        world.GetTransform3D(rootBone).SetPosition(new Vec3(1.0f, 0.0f, 0.0f));
        world.GetTransform3D(childBone).SetPosition(new Vec3(1.0f, 2.0f, 0.0f));
        world.UpdateTransforms();

        Rig rig = CreateRig();
        var frame = new AnimationFrame(2, new CurveLayout(new Dictionary<CurveId, int>()));
        frame.ResetToRest(rig);
        var source = new SceneRagdollPoseSource(world);
        source.Bind(animated, [rootBone, childBone]);

        source.TryApply(animated, rig, frame).Should().BeTrue();

        frame.ReadTranslations()[0].Should().Be(new Vec3(1.0f, 0.0f, 0.0f));
        frame.ReadTranslations()[1].X.Should().BeApproximately(0.0f, 1e-4f);
        frame.ReadTranslations()[1].Y.Should().BeApproximately(2.0f, 1e-4f);
        source.Count.Should().Be(1);
    }

    [Fact]
    public void ApplyRejectsMismatchedBindings()
    {
        using SceneWorld world = CreateWorld();
        SceneActor animated = world.CreateActor("Character");
        SceneActor only = world.CreateActor("Hips");
        world.UpdateTransforms();

        var source = new SceneRagdollPoseSource(world);
        source.Bind(animated, [only]);

        Rig rig = CreateRig();
        var frame = new AnimationFrame(2, new CurveLayout(new Dictionary<CurveId, int>()));
        frame.ResetToRest(rig);

        source.TryApply(animated, rig, frame).Should().BeFalse();
    }

    private static Rig CreateRig() => new(new RigId("ragdoll"), [
        new BoneInfo { Name = "hips", ParentIndex = -1 },
        new BoneInfo { Name = "spine", ParentIndex = 0, RestTranslation = new Vec3(0.0f, 1.0f, 0.0f) },
    ]);

    private static SceneWorld CreateWorld()
    {
        var registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>("Transform3D", SceneComponentTraits.Required | SceneComponentTraits.Singleton);
        return new SceneWorld(registry, diagnostics: null, new SceneWorldOptions(initialCapacity: 4));
    }
}
