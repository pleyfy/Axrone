namespace Axrone.Scene.Runtime.Tests;

using Axrone.Animation;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneAnimationImporterTests
{
    private static readonly string[] s_jointIds = ["node/root", "node/child"];
    private static readonly int[] s_jointIndices = [0, 1];
    private static readonly float[] s_times = [0.0f, 1.0f];
    private static readonly float[] s_translationValues = [0, 0, 0, 1, 0, 0];
    private static readonly float[] s_morphValues = [0.0f, 0.5f, 1.0f, 1.0f];
    [Fact]
    public void ImportsSkinAndClipIntoRuntimeObjects()
    {
        using SceneWorld world = CreateWorld();
        SceneActor root = world.CreateActor("Root");
        SceneActor child = world.CreateActor("Child");
        world.Hierarchy.SetParent(child, root);
        world.UpdateTransforms();

        var nodeMap = new Dictionary<string, SceneActor>(StringComparer.Ordinal)
        {
            ["node/root"] = root,
            ["node/child"] = child,
        };
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["node/root"] = null,
            ["node/child"] = "node/root",
        };

        var skin = new SceneSkinDefinition(
            SceneAssetId<SkinAssetTag>.FromName("skin/test"),
            s_jointIds,
            s_jointIndices,
            "node/root",
            IdentityBindMatrices(2));

        var track = new SceneAnimationTrackDefinition(
            "node/child",
            SceneAnimationPath.Translation,
            SceneAnimationInterpolation.Linear,
            keyframeCount: 2,
            valueComponentCount: 3,
            sampleStride: 3,
            times: s_times,
            values: s_translationValues);
        var clip = new SceneAnimationClipDefinition(
            SceneAssetId<AnimationAssetTag>.FromName("clip/walk"),
            1.0f,
            [track]);

        bool imported = Axrone.Scene.Runtime.SceneAnimationImporter.TryImport(
            world,
            skin,
            [clip],
            nodeMap,
            parents,
            out Axrone.Scene.Runtime.SceneAnimationImportResult? result,
            out string reason);

        imported.Should().BeTrue(reason);
        result.Should().NotBeNull();
        result!.MeshActor.Should().Be(root);
        result.Rig.BoneCount.Should().Be(2);
        result.Clips.Should().ContainSingle();
        result.Clips[0].Channels.Length.Should().Be(1);
        result.Controller.LayerCount.Should().Be(1);
        result.InverseBind.Should().HaveCount(2);
        result.JointActors.Should().Equal(root, child);
        world.TryGetData(root, out SceneAnimationBinding binding).Should().BeTrue();
        binding.Skin.Should().Be(skin.Id);
        binding.DefaultClip.Should().Be(clip.Id);
        result.Dispose();
    }

    [Fact]
    public void MissingJointFailsWithReason()
    {
        using SceneWorld world = CreateWorld();
        SceneActor root = world.CreateActor("Root");
        var nodeMap = new Dictionary<string, SceneActor>(StringComparer.Ordinal)
        {
            ["node/root"] = root,
        };
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["node/root"] = null,
        };
        var skin = new SceneSkinDefinition(
            SceneAssetId<SkinAssetTag>.FromName("skin/missing"),
            ["node/root", "node/missing"],
            [0, 1],
            null,
            IdentityBindMatrices(2));

        bool imported = Axrone.Scene.Runtime.SceneAnimationImporter.TryImport(
            world,
            skin,
            [CreateClip()],
            nodeMap,
            parents,
            out Axrone.Scene.Runtime.SceneAnimationImportResult? result,
            out string reason);

        imported.Should().BeFalse();
        result.Should().BeNull();
        reason.Should().Contain("missing");
    }

    [Fact]
    public void ImportedClipsBecomeAddressableStates()
    {
        using SceneWorld world = CreateWorld();
        SceneActor root = world.CreateActor("Root");
        SceneActor child = world.CreateActor("Child");
        world.Hierarchy.SetParent(child, root);
        world.UpdateTransforms();

        var nodeMap = new Dictionary<string, SceneActor>(StringComparer.Ordinal)
        {
            ["node/root"] = root,
            ["node/child"] = child,
        };
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["node/root"] = null,
            ["node/child"] = "node/root",
        };
        var skin = new SceneSkinDefinition(
            SceneAssetId<SkinAssetTag>.FromName("skin/states"),
            s_jointIds,
            s_jointIndices,
            "node/root",
            IdentityBindMatrices(2));
        var clipA = new SceneAnimationClipDefinition(
            SceneAssetId<AnimationAssetTag>.FromName("clip/a"),
            1.0f,
            [CreateTrack(1.0f)]);
        var clipB = new SceneAnimationClipDefinition(
            SceneAssetId<AnimationAssetTag>.FromName("clip/b"),
            1.0f,
            [CreateTrack(4.0f)]);

        bool imported = SceneAnimationImporter.TryImport(
            world,
            skin,
            [clipA, clipB],
            nodeMap,
            parents,
            out SceneAnimationImportResult? result,
            out string reason);

        imported.Should().BeTrue(reason);
        result.Should().NotBeNull();
        result!.BaseLayer.Machine.ForceState(1);
        result.Controller.Update(0.5f, new List<ClipEvent>(), out _, out _);
        result.Controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(2.0f, 1e-4f);
        result.Dispose();
    }

    [Fact]
    public void ImportsMorphWeightsAsCurveChannels()
    {
        using SceneWorld world = CreateWorld();
        SceneActor root = world.CreateActor("Root");
        SceneActor child = world.CreateActor("Child");
        world.Hierarchy.SetParent(child, root);
        world.UpdateTransforms();

        var nodeMap = new Dictionary<string, SceneActor>(StringComparer.Ordinal)
        {
            ["node/root"] = root,
            ["node/child"] = child,
        };
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["node/root"] = null,
            ["node/child"] = "node/root",
        };
        var skin = new SceneSkinDefinition(
            SceneAssetId<SkinAssetTag>.FromName("skin/morph"),
            s_jointIds,
            s_jointIndices,
            "node/root",
            IdentityBindMatrices(2));
        var weights = new SceneAnimationTrackDefinition(
            "node/child",
            SceneAnimationPath.Weights,
            SceneAnimationInterpolation.Linear,
            keyframeCount: 2,
            valueComponentCount: 2,
            sampleStride: 2,
            times: s_times,
            values: s_morphValues);
        var clip = new SceneAnimationClipDefinition(
            SceneAssetId<AnimationAssetTag>.FromName("clip/morph"),
            1.0f,
            [weights]);

        bool imported = SceneAnimationImporter.TryImport(
            world,
            skin,
            [clip],
            nodeMap,
            parents,
            out SceneAnimationImportResult? result,
            out string reason);

        imported.Should().BeTrue(reason);
        result.Should().NotBeNull();
        result!.CurveLayout.Count.Should().Be(2);
        world.TryGetData(root, out SceneAnimator animator).Should().BeTrue();
        animator.MorphCurveOffset.Should().Be(0);
        animator.MorphCurveCount.Should().Be(2);
        result.Controller.Update(0.5f, new List<ClipEvent>(), out _, out _);
        Span<float> curves = result.Controller.CurrentFrame.Curves.AsSpan();
        curves[0].Should().BeApproximately(0.5f, 1e-4f);
        curves[1].Should().BeApproximately(0.75f, 1e-4f);
        result.Dispose();
    }

    private static SceneAnimationTrackDefinition CreateTrack(float toX)
    {
        float[] values = [0.0f, 0.0f, 0.0f, toX, 0.0f, 0.0f];
        return new SceneAnimationTrackDefinition(
            "node/child",
            SceneAnimationPath.Translation,
            SceneAnimationInterpolation.Linear,
            keyframeCount: 2,
            valueComponentCount: 3,
            sampleStride: 3,
            times: s_times,
            values: values);
    }

    private static SceneAnimationClipDefinition CreateClip()
    {
        var track = new SceneAnimationTrackDefinition(
            "node/root",
            SceneAnimationPath.Translation,
            SceneAnimationInterpolation.Linear,
            2,
            3,
            3,
            s_times,
            s_translationValues);
        return new SceneAnimationClipDefinition(
            SceneAssetId<AnimationAssetTag>.FromName("clip/test"),
            1.0f,
            [track]);
    }

    private static float[] IdentityBindMatrices(int count)
    {
        var matrices = new float[count * 16];
        for (int i = 0; i < count; i++)
        {
            int offset = i * 16;
            matrices[offset] = 1.0f;
            matrices[offset + 5] = 1.0f;
            matrices[offset + 10] = 1.0f;
            matrices[offset + 15] = 1.0f;
        }

        return matrices;
    }

    private static SceneWorld CreateWorld()
    {
        var registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>(
            "Transform3D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);
        registry.RegisterData<SceneAnimationBinding>("AnimationBinding");
        registry.RegisterData<SceneAnimator>("SceneAnimator");
        return new SceneWorld(registry, diagnostics: null, new SceneWorldOptions(initialCapacity: 4));
    }
}
