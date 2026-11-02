namespace Axrone.Scene.Gltf.Tests;

using System.Collections.Immutable;
using Axrone.AssetGltf;
using Axrone.Numeric;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using Axrone.Scene.Prefab;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfExtensionTests
{
    [Fact]
    public void Convert_MapsExtensionMapsFeaturesAndParameters()
    {
        var textures = new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
        {
            [GltfTextureUsage.Clearcoat] = SceneGltfTestFactory.Binding("texture0"),
            [GltfTextureUsage.ClearcoatRoughness] = SceneGltfTestFactory.Binding("texture1"),
            [GltfTextureUsage.ClearcoatNormal] = SceneGltfTestFactory.Binding("texture2"),
            [GltfTextureUsage.SheenColor] = SceneGltfTestFactory.Binding("texture3"),
            [GltfTextureUsage.SheenRoughness] = SceneGltfTestFactory.Binding("texture4"),
            [GltfTextureUsage.Transmission] = SceneGltfTestFactory.Binding("texture5"),
            [GltfTextureUsage.Thickness] = SceneGltfTestFactory.Binding("texture6"),
            [GltfTextureUsage.Iridescence] = SceneGltfTestFactory.Binding("texture7"),
            [GltfTextureUsage.IridescenceThickness] = SceneGltfTestFactory.Binding("texture8"),
            [GltfTextureUsage.Specular] = SceneGltfTestFactory.Binding("texture9"),
            [GltfTextureUsage.SpecularColor] = SceneGltfTestFactory.Binding("texture10"),
            [GltfTextureUsage.Anisotropy] = SceneGltfTestFactory.Binding("texture11"),
            [GltfTextureUsage.Subsurface] = SceneGltfTestFactory.Binding("texture12")
        };
        var scalars = new Dictionary<string, float>
        {
            ["_ClearcoatFactor"] = 0.6f,
            ["_ClearcoatRoughnessFactor"] = 0.2f,
            ["_ClearcoatNormalTexture_Scale"] = 0.8f,
            ["_SheenRoughnessFactor"] = 0.4f,
            ["_TransmissionFactor"] = 0.7f,
            ["_IorFactor"] = 1.4f,
            ["_ThicknessFactor"] = 0.3f,
            ["_AttenuationDistance"] = 2.0f,
            ["_IridescenceFactor"] = 0.2f,
            ["_IridescenceIor"] = 1.25f,
            ["_IridescenceThicknessMinimum"] = 120.0f,
            ["_IridescenceThicknessMaximum"] = 300.0f,
            ["_SubsurfaceFactor"] = 0.5f,
            ["_SubsurfaceThickness"] = 1.5f,
            ["_SpecularFactor"] = 0.9f,
            ["_AnisotropyStrength"] = 0.3f,
            ["_AnisotropyRotation"] = 0.2f
        };
        var floats = new Dictionary<string, float[]>
        {
            ["_SheenColorFactor"] = [0.9f, 0.5f, 0.3f],
            ["_AttenuationColor"] = [0.5f, 0.6f, 0.7f],
            ["_SubsurfaceColorFactor"] = [1.0f, 0.8f, 0.6f],
            ["_SpecularColorFactor"] = [0.8f, 0.7f, 0.6f]
        };
        GltfMaterialAsset material = SceneGltfTestFactory.Material(
            scalars: scalars,
            floats: floats,
            textures: textures);

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(material);
        SceneMaterialSurface surface = conversion.Material.Surface;

        surface.ClearcoatMap.Should().NotBeNull();
        surface.ClearcoatRoughnessMap.Should().NotBeNull();
        surface.ClearcoatNormalMap.Should().NotBeNull();
        surface.SheenColorMap.Should().NotBeNull();
        surface.SheenRoughnessMap.Should().NotBeNull();
        surface.TransmissionMap.Should().NotBeNull();
        surface.ThicknessMap.Should().NotBeNull();
        surface.IridescenceMap.Should().NotBeNull();
        surface.IridescenceThicknessMap.Should().NotBeNull();
        surface.SpecularMap.Should().NotBeNull();
        surface.SpecularColorMap.Should().NotBeNull();
        surface.AnisotropyMap.Should().NotBeNull();
        surface.SubsurfaceMap.Should().NotBeNull();

        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Clearcoat);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SheenColorMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SheenRoughnessMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.TransmissionMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.ThicknessMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.IridescenceMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.IridescenceThicknessMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SpecularMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SpecularColorMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.AnisotropyMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SubsurfaceMap);

        surface.Extensions.Should().NotBeNull();
        SceneMaterialExtensions extensions = surface.Extensions!;
        extensions.Clearcoat.Should().BeApproximately(0.6f, 1e-6f);
        extensions.ClearcoatRoughness.Should().BeApproximately(0.2f, 1e-6f);
        extensions.ClearcoatNormalScale.Should().BeApproximately(0.8f, 1e-6f);
        extensions.SheenColor.Should().Be(new Vec3(0.9f, 0.5f, 0.3f));
        extensions.Transmission.Should().BeApproximately(0.7f, 1e-6f);
        extensions.Ior.Should().BeApproximately(1.4f, 1e-6f);
        extensions.AttenuationColor.Should().Be(new Vec3(0.5f, 0.6f, 0.7f));
        extensions.IridescenceThicknessMinimum.Should().BeApproximately(120.0f, 1e-6f);
        extensions.IridescenceThicknessMaximum.Should().BeApproximately(300.0f, 1e-6f);
        extensions.Subsurface.Should().BeApproximately(0.5f, 1e-6f);
        extensions.SubsurfaceColor.Should().Be(new Vec3(1.0f, 0.8f, 0.6f));
        extensions.Specular.Should().BeApproximately(0.9f, 1e-6f);
        extensions.Anisotropy.Should().BeApproximately(0.3f, 1e-6f);
    }

    [Fact]
    public void Convert_MapsAlphaAndAdditiveBlendFactors()
    {
        GltfMaterialAsset blended = SceneGltfTestFactory.Material(alphaMode: GltfAlphaMode.Blend);

        SceneMaterialPass alphaMain = SceneGltfMaterialConverter.Convert(blended).Material.Passes[0];
        alphaMain.BlendState.Should().Be(SceneBlendState.Alpha);
        alphaMain.Blend.Should().BeTrue();
        SceneBlendState alphaState = alphaMain.BlendState!.Value;
        alphaState.SourceColor.Should().Be(SceneBlendFactor.SourceAlpha);
        alphaState.DestinationColor.Should().Be(SceneBlendFactor.OneMinusSourceAlpha);
        alphaState.ColorOperation.Should().Be(SceneBlendOperation.Add);

        SceneMaterialPass addMain = SceneGltfMaterialConverter.Convert(
            blended,
            new SceneGltfImportOptions { BlendMode = SceneGltfBlendMode.Additive }).Material.Passes[0];
        addMain.BlendState.Should().Be(SceneBlendState.Additive);
        addMain.BlendState!.Value.SourceColor.Should().Be(SceneBlendFactor.One);

        SceneMaterialDefinition opaque = SceneGltfMaterialConverter.Convert(
            SceneGltfTestFactory.Material()).Material;
        opaque.Passes[0].BlendState.Should().Be(SceneBlendState.Disabled);
        opaque.Passes[1].BlendState.Should().Be(SceneBlendState.Additive);
        opaque.Passes[2].BlendState.Should().Be(SceneBlendState.Disabled);
    }

    [Fact]
    public void Convert_AppliesUnknownExtensionPolicy()
    {
        GltfImportResult result = SceneGltfTestFactory.Result(
            extensionsUsed: ["KHR_materials_clearcoat", "VENDOR_custom"]);

        SceneGltfConversion reported = SceneGltfAdapter.Convert(result);
        reported.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == SceneGltfErrorCodes.UnknownExtension &&
            diagnostic.Message.Contains("VENDOR_custom", StringComparison.Ordinal));

        SceneGltfConversion ignored = SceneGltfAdapter.Convert(
            result,
            new SceneGltfImportOptions
            {
                UnknownExtensionPolicy = SceneGltfUnknownExtensionPolicy.Ignore
            });
        ignored.Diagnostics.Should().NotContain(diagnostic =>
            diagnostic.Code == SceneGltfErrorCodes.UnknownExtension);

        Action reject = () => SceneGltfAdapter.Convert(
            result,
            new SceneGltfImportOptions
            {
                UnknownExtensionPolicy = SceneGltfUnknownExtensionPolicy.Reject
            });
        reject.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.UnknownExtension);
    }

    [Fact]
    public void Convert_ConvertsMorphsMultiSetJointsSkinsAndAnimations()
    {
        ImmutableArray<GltfVertexAttribute> attributes =
        [
            new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false),
            new GltfVertexAttribute(0, 12, 5125, GltfMeshSemantic.Joints1, 4, false, true),
            new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Weights1, 4, false, false)
        ];
        ImmutableArray<GltfMorphTargetDefinition> morphTargets =
        [
            new GltfMorphTargetDefinition(GltfMorphTargetSemantic.Position, new byte[36], 12, 3)
        ];
        GltfMeshAsset mesh = SceneGltfTestFactory.Mesh(
            attributes: attributes,
            morphTargets: morphTargets);
        GltfActorSnapshot actor = SceneGltfTestFactory.Actor(
            skinId: "skin0",
            morphWeights: [0.3f, 0.7f]);
        GltfImportResult result = SceneGltfTestFactory.Result(
            meshes: [mesh],
            prefabs: [SceneGltfTestFactory.Prefab(actors: [actor])],
            skins: [SceneGltfTestFactory.Skin(id: "skin0")],
            animations:
            [
                SceneGltfTestFactory.Animation(
                    id: "animation0",
                    path: GltfAnimationPath.Rotation,
                    interpolation: GltfInterpolation.CubicSpline)
            ]);

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(result);

        SceneMeshDefinition convertedMesh = conversion.Meshes.Should().ContainSingle().Subject;
        convertedMesh.MorphTargets.Should().ContainSingle();
        convertedMesh.Attributes.Should().Contain(attribute =>
            attribute.Semantic == SceneMeshSemantic.Joints1);
        convertedMesh.Attributes.Should().Contain(attribute =>
            attribute.Semantic == SceneMeshSemantic.Weights1);

        conversion.Skins.Should().ContainSingle();
        conversion.Skins[0].Id.Should().Be(SceneAssetId<SkinAssetTag>.FromName("gltf/skin0"));
        conversion.Skins[0].JointNodeIds.Should().ContainSingle();
        conversion.Skins[0].InverseBindMatrices.Length.Should().Be(16);

        conversion.Animations.Should().ContainSingle();
        SceneAnimationClipDefinition clip = conversion.Animations[0];
        clip.Id.Should().Be(SceneAssetId<AnimationAssetTag>.FromName("gltf/animation0"));
        SceneAnimationTrackDefinition track = clip.Tracks.Should().ContainSingle().Subject;
        track.TargetNodeId.Should().Be("node_0_Root");
        track.Path.Should().Be(SceneAnimationPath.Rotation);
        track.Interpolation.Should().Be(SceneAnimationInterpolation.CubicSpline);
        track.SampleStride.Should().Be(12);
        track.Times.Length.Should().Be(2);
        track.Values.Length.Should().Be(24);
    }

    [Fact]
    public void Import_WritesSkinAndMorphWeightsIntoTheRendererSnapshot()
    {
        GltfActorSnapshot actor = SceneGltfTestFactory.Actor(
            skinId: "skin0",
            morphWeights: [0.3f, 0.7f]);
        GltfImportResult result = SceneGltfTestFactory.Result(
            prefabs: [SceneGltfTestFactory.Prefab(actors: [actor])],
            skins: [SceneGltfTestFactory.Skin(id: "skin0")],
            animations: [SceneGltfTestFactory.Animation(id: "animation0")]);

        SceneGltfImportResult imported = SceneGltfAdapter.Import(result);
        SceneComponentSnapshot renderer = imported.Snapshot.Prefab.Actors[0].Components
            .Should().ContainSingle(component => component.Type == "MeshRenderer").Subject;

        renderer.Data.GetProperty("skin").GetString().Should().Be("gltf/skin0");
        renderer.Data.GetProperty("morphWeights").EnumerateArray()
            .Select(static value => value.GetSingle())
            .Should().Equal(0.3f, 0.7f);
        imported.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.skins");
        imported.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.animations");
    }
}
