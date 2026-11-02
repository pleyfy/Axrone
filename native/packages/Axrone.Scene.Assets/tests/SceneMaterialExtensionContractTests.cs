namespace Axrone.Scene.Assets.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

public sealed class SceneMaterialExtensionContractTests
{
    [Fact]
    public void Surface_AcceptsExtensionMapsAndParameters()
    {
        var registry = new SceneAssetRegistry();
        SceneAssetId<TextureAssetTag> textureId = registry.CreateId<TextureAssetTag>("tex/extension");
        SceneAssetId<SamplerAssetTag> samplerId = registry.CreateId<SamplerAssetTag>("sampler/extension");
        var binding = new SceneMaterialTextureBinding(textureId, samplerId);

        var extensions = new SceneMaterialExtensions
        {
            Clearcoat = 0.6f,
            ClearcoatRoughness = 0.2f,
            ClearcoatNormalScale = 0.8f,
            SheenColor = new Vec3(0.9f, 0.5f, 0.3f),
            SheenRoughness = 0.4f,
            Transmission = 0.7f,
            Ior = 1.4f,
            Thickness = 0.3f,
            AttenuationDistance = 2.0f,
            AttenuationColor = new Vec3(0.5f, 0.6f, 0.7f),
            Iridescence = 0.2f,
            IridescenceIor = 1.25f,
            IridescenceThicknessMinimum = 120.0f,
            IridescenceThicknessMaximum = 300.0f,
            Subsurface = 0.5f,
            SubsurfaceColor = new Vec3(1.0f, 0.8f, 0.6f),
            SubsurfaceThickness = 1.5f,
            Specular = 0.9f,
            SpecularColor = new Vec3(0.8f, 0.7f, 0.6f),
            Anisotropy = 0.3f,
            AnisotropyRotation = 0.2f
        };

        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat
                | SceneMaterialFeatures.ClearcoatMap
                | SceneMaterialFeatures.SheenColorMap
                | SceneMaterialFeatures.TransmissionMap
                | SceneMaterialFeatures.IridescenceMap
                | SceneMaterialFeatures.SubsurfaceMap,
            ClearcoatMap = binding,
            ClearcoatRoughnessMap = binding,
            ClearcoatNormalMap = binding,
            SheenColorMap = binding,
            SheenRoughnessMap = binding,
            TransmissionMap = binding,
            ThicknessMap = binding,
            IridescenceMap = binding,
            IridescenceThicknessMap = binding,
            SpecularMap = binding,
            SpecularColorMap = binding,
            AnisotropyMap = binding,
            SubsurfaceMap = binding,
            Extensions = extensions
        };

        var material = new SceneMaterialDefinition(
            registry.CreateId<MaterialAssetTag>("material/extension"),
            registry.CreateId<ShaderAssetTag>("shader/extension"),
            surface);

        material.Surface.ClearcoatMap.Should().NotBeNull();
        material.Surface.SubsurfaceMap.Should().NotBeNull();
        material.Surface.Extensions.Should().NotBeNull();
        material.Surface.Extensions!.Transmission.Should().BeApproximately(0.7f, 1e-6f);
        material.Surface.Extensions.SubsurfaceColor.Should().Be(new Vec3(1.0f, 0.8f, 0.6f));
        material.Surface.Features.Should().HaveFlag(SceneMaterialFeatures.SubsurfaceMap);
    }

    [Fact]
    public void Surface_RejectsInvalidExtensionValues()
    {
        var registry = new SceneAssetRegistry();

        Action tooHigh = () => CreateMaterial(
            registry,
            new SceneMaterialExtensions { Clearcoat = 2.0f });
        tooHigh.Should().Throw<SceneAssetException>();

        Action lowIor = () => CreateMaterial(
            registry,
            new SceneMaterialExtensions { Ior = 0.5f });
        lowIor.Should().Throw<SceneAssetException>();

        Action invertedThickness = () => CreateMaterial(
            registry,
            new SceneMaterialExtensions
            {
                IridescenceThicknessMinimum = 500.0f,
                IridescenceThicknessMaximum = 100.0f
            });
        invertedThickness.Should().Throw<SceneAssetException>();

        Action invalidBinding = () =>
        {
            var surface = new SceneMaterialSurface
            {
                ClearcoatMap = new SceneMaterialTextureBinding(default)
            };
            _ = new SceneMaterialDefinition(
                registry.CreateId<MaterialAssetTag>("material/invalid-binding"),
                registry.CreateId<ShaderAssetTag>("shader/invalid-binding"),
                surface);
        };
        invalidBinding.Should().Throw<SceneAssetException>();
    }

    [Fact]
    public void Pass_CarriesExplicitBlendState()
    {
        var pass = new SceneMaterialPass(
            "main",
            blend: true,
            blendState: SceneBlendState.Additive);

        pass.Blend.Should().BeTrue();
        pass.BlendState.Should().NotBeNull();
        pass.BlendState!.Value.Enabled.Should().BeTrue();
        pass.BlendState.Value.SourceColor.Should().Be(SceneBlendFactor.One);
        pass.BlendState.Value.DestinationColor.Should().Be(SceneBlendFactor.One);
        pass.BlendState.Value.ColorOperation.Should().Be(SceneBlendOperation.Add);

        SceneBlendState alpha = SceneBlendState.Alpha;
        alpha.SourceColor.Should().Be(SceneBlendFactor.SourceAlpha);
        alpha.DestinationColor.Should().Be(SceneBlendFactor.OneMinusSourceAlpha);
        alpha.SourceAlpha.Should().Be(SceneBlendFactor.One);
        alpha.DestinationAlpha.Should().Be(SceneBlendFactor.OneMinusSourceAlpha);

        var invalid = new SceneBlendState(
            true,
            (SceneBlendFactor)99,
            SceneBlendFactor.Zero,
            SceneBlendOperation.Add,
            SceneBlendFactor.One,
            SceneBlendFactor.Zero,
            SceneBlendOperation.Add);
        Action create = () =>
        {
            _ = new SceneMaterialPass("main", blendState: invalid);
        };
        create.Should().Throw<SceneAssetException>();
    }

    [Fact]
    public void Mesh_AcceptsAndValidatesMorphTargets()
    {
        var registry = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = registry.CreateId<MeshAssetTag>("mesh/morph");
        var attributes = new List<SceneVertexAttribute>
        {
            new(SceneMeshSemantic.Position, 3, 0, 12, false, false)
        };
        var target = new SceneMorphTargetDefinition(
            SceneMorphTargetSemantic.Position,
            new byte[36],
            Stride: 12,
            ComponentCount: 3);

        var mesh = new SceneMeshDefinition(
            meshId,
            new byte[36],
            attributes,
            vertexCount: 3,
            morphTargets: [target]);

        mesh.MorphTargets.Should().ContainSingle();
        mesh.MorphTargets[0].Semantic.Should().Be(SceneMorphTargetSemantic.Position);

        var shortTarget = new SceneMorphTargetDefinition(
            SceneMorphTargetSemantic.Position,
            new byte[12],
            Stride: 12,
            ComponentCount: 3);
        Action create = () =>
        {
            _ = new SceneMeshDefinition(
                registry.CreateId<MeshAssetTag>("mesh/morph-short"),
                new byte[36],
                attributes,
                vertexCount: 3,
                morphTargets: [shortTarget]);
        };
        create.Should().Throw<SceneAssetException>();
    }

    [Fact]
    public void SkinAndAnimation_ValidateTheirLayouts()
    {
        var registry = new SceneAssetRegistry();

        var skin = new SceneSkinDefinition(
            registry.CreateId<SkinAssetTag>("skin/valid"),
            ["node/0", "node/1"],
            [0, 1],
            "node/0",
            new float[32]);
        skin.JointNodeIds.Should().HaveCount(2);

        Action badInverseBind = () =>
        {
            _ = new SceneSkinDefinition(
                registry.CreateId<SkinAssetTag>("skin/invalid"),
                ["node/0", "node/1"],
                [0, 1],
                null,
                new float[16]);
        };
        badInverseBind.Should().Throw<SceneAssetException>();

        var track = new SceneAnimationTrackDefinition(
            "node/0",
            SceneAnimationPath.Translation,
            SceneAnimationInterpolation.Linear,
            keyframeCount: 2,
            valueComponentCount: 3,
            sampleStride: 3,
            times: new float[2],
            values: new float[6]);
        var clip = new SceneAnimationClipDefinition(
            registry.CreateId<AnimationAssetTag>("animation/valid"),
            1.0f,
            [track]);
        clip.Tracks.Should().ContainSingle();

        Action badCubicStride = () =>
        {
            _ = new SceneAnimationTrackDefinition(
                "node/0",
                SceneAnimationPath.Translation,
                SceneAnimationInterpolation.CubicSpline,
                keyframeCount: 2,
                valueComponentCount: 3,
                sampleStride: 3,
                times: new float[2],
                values: new float[6]);
        };
        badCubicStride.Should().Throw<SceneAssetException>();

        Action negativeDuration = () =>
        {
            _ = new SceneAnimationClipDefinition(
                registry.CreateId<AnimationAssetTag>("animation/invalid"),
                -1.0f,
                [track]);
        };
        negativeDuration.Should().Throw<SceneAssetException>();
    }

    private static SceneMaterialDefinition CreateMaterial(
        SceneAssetRegistry registry,
        SceneMaterialExtensions extensions) =>
        new(
            registry.CreateId<MaterialAssetTag>($"material/{Guid.NewGuid():N}"),
            registry.CreateId<ShaderAssetTag>($"shader/{Guid.NewGuid():N}"),
            new SceneMaterialSurface { Extensions = extensions });
}
