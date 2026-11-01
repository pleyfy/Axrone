namespace Axrone.Scene.Gltf.Tests;

using System.Collections.Immutable;
using Axrone.AssetGltf;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfMaterialTests
{
    [Fact]
    public void Convert_PbrMaterialMapsSurfacePropertiesAndRenderState()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            alphaMode: GltfAlphaMode.Mask,
            alphaCutoff: 0.33f,
            doubleSided: true,
            floats: new Dictionary<string, float[]>
            {
                ["_BaseColorFactor"] = [0.8f, 0.7f, 0.6f, 1.0f],
                ["_EmissiveFactor"] = [0.1f, 0.2f, 0.3f]
            },
            scalars: new Dictionary<string, float>
            {
                ["_MetallicFactor"] = 0.4f,
                ["_RoughnessFactor"] = 0.2f,
                ["_ClearcoatFactor"] = 0.65f,
                ["_ClearcoatRoughnessFactor"] = 0.15f,
                ["_NormalTexture_Scale"] = 1.5f,
                ["_OcclusionTexture_Strength"] = 0.75f,
                ["_AnisotropyStrength"] = 0.5f,
                ["_TransmissionFactor"] = 0.25f,
                ["_SubsurfaceFactor"] = 0.1f,
                ["_IridescenceFactor"] = 0.2f
            },
            textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
            {
                [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding(
                    "texture0",
                    texCoord: 1,
                    transformScale: new Vec2(2.0f, 3.0f),
                    transformOffset: new Vec2(0.1f, 0.2f),
                    rotation: 0.5f,
                    transformTexCoord: 1),
                [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1", scale: 1.5f),
                [GltfTextureUsage.MetallicRoughness] = SceneGltfTestFactory.Binding("texture2"),
                [GltfTextureUsage.Occlusion] = SceneGltfTestFactory.Binding("texture3", strength: 0.75f),
                [GltfTextureUsage.Emissive] = SceneGltfTestFactory.Binding("texture4"),
                [GltfTextureUsage.Clearcoat] = SceneGltfTestFactory.Binding("texture5")
            });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);
        SceneMaterialDefinition material = conversion.Material;

        conversion.BuiltInShaderId.Should().Be("gltf/pbr/double-sided");
        material.Id.Should().Be(SceneAssetId<MaterialAssetTag>.FromName("gltf/material0"));
        material.ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr/double-sided"));
        conversion.Diagnostics.Should().BeEmpty();

        SceneMaterialSurface surface = material.Surface;
        surface.ShadingModel.Should().Be(SceneMaterialShadingModel.Pbr);
        surface.AlphaMode.Should().Be(SceneMaterialAlphaMode.Mask);
        surface.AlphaCutoff.Should().BeApproximately(0.33f, 1e-6f);
        surface.Albedo.Should().Be(new Vec4(0.8f, 0.7f, 0.6f, 1.0f));
        surface.Emissive.Should().Be(new Vec3(0.1f, 0.2f, 0.3f));
        surface.Metallic.Should().BeApproximately(0.4f, 1e-6f);
        surface.Roughness.Should().BeApproximately(0.2f, 1e-6f);
        surface.NormalScale.Should().BeApproximately(1.5f, 1e-6f);
        surface.Occlusion.Should().BeApproximately(0.75f, 1e-6f);
        surface.Tiling.Should().Be(new Vec2(2.0f, 3.0f));
        surface.Offset.Should().Be(new Vec2(0.1f, 0.2f));
        surface.AlbedoMap!.Value.TextureId.Should().Be(SceneAssetId<TextureAssetTag>.FromName("gltf/texture0"));
        surface.AlbedoMap!.Value.UvSet.Should().Be(SceneUvSet.Uv1);
        surface.AlbedoMap!.Value.SamplerId.Should().Be(SceneAssetId<SamplerAssetTag>.FromName("gltf/texture0/sampler"));
        surface.PbrMap!.Value.TextureId.Should().Be(SceneAssetId<TextureAssetTag>.FromName("gltf/texture2"));

        surface.Features.Should().HaveFlag(SceneMaterialFeatures.TwoSided);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.AlphaTest);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.AlbedoMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.SecondUv);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.NormalMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.PbrMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.MetallicRoughnessMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.OcclusionMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.EmissiveMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Clearcoat);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.ClearcoatMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Anisotropy);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Transmission);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Subsurface);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.Iridescence);

        Uniform(material, "_BaseColorTexture_ST").Should().Be(SceneUniformValue.FromVec4(new Vec4(2.0f, 3.0f, 0.1f, 0.2f)));
        Uniform(material, "_BaseColorTexture_Rotation").Should().Be(SceneUniformValue.FromFloat(0.5f));
        Uniform(material, "_BaseColorTexture_TexCoord").Should().Be(SceneUniformValue.FromInt(1));
        Uniform(material, "_AlphaMode").Should().Be(SceneUniformValue.FromInt((int)SceneMaterialAlphaMode.Mask));
        Uniform(material, "_DoubleSided").Should().Be(SceneUniformValue.FromInt(1));
        Uniform(material, "_AlphaCutoff").Should().Be(SceneUniformValue.FromFloat(0.33f));
        Uniform(material, "_NormalTexture_Scale").Should().Be(SceneUniformValue.FromFloat(1.5f));
        Uniform(material, "_OcclusionTexture_Strength").Should().Be(SceneUniformValue.FromFloat(0.75f));

        material.Passes.Should().HaveCount(3);
        material.Passes[0].Id.Should().Be("main");
        material.Passes[0].DepthTest.Should().BeTrue();
        material.Passes[0].DepthWrite.Should().BeTrue();
        material.Passes[0].Cull.Should().BeFalse();
        material.Passes[0].Blend.Should().BeFalse();
        material.Passes[1].Id.Should().Be("forward-add");
        material.Passes[1].DepthWrite.Should().BeFalse();
        material.Passes[1].Blend.Should().BeTrue();
        material.Passes[2].Id.Should().Be("shadow-caster");
        material.Passes[2].Priority.Should().Be(1);
        material.Passes[2].DepthWrite.Should().BeTrue();
        material.Passes[2].Blend.Should().BeFalse();
    }

    [Fact]
    public void Convert_BlendModeProducesBlendVariantAndDepthState()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(alphaMode: GltfAlphaMode.Blend);
        source = WithAlphaCutoff(source, 0.4f);

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);
        SceneMaterialDefinition material = conversion.Material;

        conversion.BuiltInShaderId.Should().Be("gltf/pbr/blend");
        material.Surface.AlphaMode.Should().Be(SceneMaterialAlphaMode.Blend);
        material.Surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.AlphaTest);
        material.Passes[0].DepthWrite.Should().BeFalse();
        material.Passes[0].Blend.Should().BeTrue();
        material.Passes[2].Priority.Should().Be(0);
        Uniform(material, "_AlphaMode").Should().Be(SceneUniformValue.FromInt(2));
    }

    [Fact]
    public void Convert_UnlitSuppressesPbrOnlyFeatures()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            unlit: true,
            doubleSided: true,
            scalars: new Dictionary<string, float>
            {
                ["_ClearcoatFactor"] = 1.0f,
                ["_TransmissionFactor"] = 1.0f
            },
            textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
            {
                [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0"),
                [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1"),
                [GltfTextureUsage.MetallicRoughness] = SceneGltfTestFactory.Binding("texture2"),
                [GltfTextureUsage.Occlusion] = SceneGltfTestFactory.Binding("texture3"),
                [GltfTextureUsage.Emissive] = SceneGltfTestFactory.Binding("texture4"),
                [GltfTextureUsage.Clearcoat] = SceneGltfTestFactory.Binding("texture5")
            });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);
        SceneMaterialSurface surface = conversion.Material.Surface;

        conversion.BuiltInShaderId.Should().Be("gltf/unlit/double-sided");
        surface.ShadingModel.Should().Be(SceneMaterialShadingModel.Unlit);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.TwoSided);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.AlbedoMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.NormalMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.PbrMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.OcclusionMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.EmissiveMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.Clearcoat);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.Transmission);
    }

    [Fact]
    public void Convert_ToonOptionSelectsToonShaderAndModel()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
            {
                [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0"),
                [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1"),
                [GltfTextureUsage.MetallicRoughness] = SceneGltfTestFactory.Binding("texture2"),
                [GltfTextureUsage.Emissive] = SceneGltfTestFactory.Binding("texture3")
            });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(
            source,
            new SceneGltfImportOptions { ShadingModel = SceneGltfShadingModel.Toon });
        SceneMaterialSurface surface = conversion.Material.Surface;

        conversion.BuiltInShaderId.Should().Be("gltf/toon");
        surface.ShadingModel.Should().Be(SceneMaterialShadingModel.Toon);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.AlbedoMap);
        surface.Features.Should().HaveFlag(SceneMaterialFeatures.EmissiveMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.NormalMap);
        surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.PbrMap);

        SceneShaderDefinition? shader = conversion.CreateShaderDefinition();
        shader.Should().NotBeNull();
        shader!.Uniforms.Should().Contain("_ShadowColor");
    }

    [Theory]
    [InlineData(SceneGltfUnknownPropertyPolicy.Preserve, true)]
    [InlineData(SceneGltfUnknownPropertyPolicy.Ignore, false)]
    public void Convert_AppliesUnknownPropertyPolicy(
        SceneGltfUnknownPropertyPolicy policy,
        bool preserved)
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            scalars: new Dictionary<string, float> { ["custom/roughnessBoost"] = 0.5f });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(
            source,
            new SceneGltfImportOptions { UnknownPropertyPolicy = policy });

        conversion.Material.Uniforms.ContainsKey("custom/roughnessBoost").Should().Be(preserved);
        conversion.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == SceneGltfErrorCodes.UnknownProperty &&
            diagnostic.Message.Contains("custom/roughnessBoost", StringComparison.Ordinal));
    }

    [Fact]
    public void Convert_RejectsUnknownPropertiesWhenConfigured()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            scalars: new Dictionary<string, float> { ["custom/roughnessBoost"] = 0.5f });

        Action convert = () => SceneGltfMaterialConverter.Convert(
            source,
            new SceneGltfImportOptions { UnknownPropertyPolicy = SceneGltfUnknownPropertyPolicy.Reject });

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.UnknownProperty);
    }

    [Fact]
    public void Convert_PreservesDeclaredIntUniformsAndSkipsMalformedValues()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            floats: new Dictionary<string, float[]>
            {
                ["_BadWidth"] = [1.0f, 2.0f, 3.0f, 4.0f, 5.0f],
                ["_NonFinite"] = [float.NaN, 0.0f, 0.0f]
            },
            scalars: new Dictionary<string, float> { ["_NonFiniteScalar"] = float.PositiveInfinity });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);

        conversion.Material.Uniforms.ContainsKey("_BadWidth").Should().BeFalse();
        conversion.Material.Uniforms.ContainsKey("_NonFinite").Should().BeFalse();
        conversion.Material.Uniforms.ContainsKey("_NonFiniteScalar").Should().BeFalse();
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.unsupported-uniform");
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.non-finite-uniform");
    }

    [Fact]
    public void Convert_ClampsInvalidAlphaCutoff()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(alphaMode: GltfAlphaMode.Mask);
        source = WithAlphaCutoff(source, 2.0f);

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);

        conversion.Material.Surface.AlphaCutoff.Should().Be(1.0f);
        Uniform(conversion.Material, "_AlphaCutoff").Should().Be(SceneUniformValue.FromFloat(1.0f));
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.invalid-alpha-cutoff");
    }

    [Fact]
    public void Convert_InjectsTexturePropertyDefaults()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material();

        SceneMaterialDefinition material = SceneGltfMaterialConverter.Convert(source).Material;

        material.Surface.Features.Should().Be(SceneMaterialFeatures.None);
        material.Surface.AlphaMode.Should().Be(SceneMaterialAlphaMode.Opaque);
        material.Surface.Albedo.Should().Be(Vec4.One);
        material.Surface.Metallic.Should().Be(1.0f);
        material.Surface.Roughness.Should().Be(1.0f);
        material.Surface.NormalScale.Should().Be(1.0f);
        material.Surface.Occlusion.Should().Be(1.0f);

        Uniform(material, "_BaseColorTexture_TexCoord").Should().Be(SceneUniformValue.FromInt(-1));
        Uniform(material, "_BaseColorTexture_ST").Should().Be(SceneUniformValue.FromVec4(new Vec4(1.0f, 1.0f, 0.0f, 0.0f)));
        Uniform(material, "_BaseColorTexture_Rotation").Should().Be(SceneUniformValue.FromFloat(0.0f));
        Uniform(material, "_NormalTexture_Scale").Should().Be(SceneUniformValue.FromFloat(1.0f));
        Uniform(material, "_OcclusionTexture_Strength").Should().Be(SceneUniformValue.FromFloat(1.0f));
        Uniform(material, "_ClearcoatNormalTexture_Scale").Should().Be(SceneUniformValue.FromFloat(1.0f));
        Uniform(material, "_AlphaMode").Should().Be(SceneUniformValue.FromInt(0));
        Uniform(material, "_DoubleSided").Should().Be(SceneUniformValue.FromInt(0));
    }

    [Fact]
    public void Convert_DoesNotOverrideSuppliedTexturePropertyDefaults()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            floats: new Dictionary<string, float[]> { ["_BaseColorTexture_ST"] = [4.0f, 5.0f, 0.5f, 0.25f] });

        SceneMaterialDefinition material = SceneGltfMaterialConverter.Convert(source).Material;

        Uniform(material, "_BaseColorTexture_ST")
            .Should().Be(SceneUniformValue.FromVec4(new Vec4(4.0f, 5.0f, 0.5f, 0.25f)));
    }

    [Fact]
    public void Convert_NonFiniteTextureTransformFallsBackToIdentity()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
            {
                [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding(
                    "texture0",
                    transformScale: new Vec2(float.NaN, 1.0f))
            });

        SceneGltfMaterialConversion conversion = SceneGltfMaterialConverter.Convert(source);

        conversion.Material.Surface.Tiling.Should().Be(Vec2.One);
        conversion.Material.Surface.AlbedoMap!.Value.Scale.Should().Be(Vec2.One);
        Uniform(conversion.Material, "_BaseColorTexture_ST")
            .Should().Be(SceneUniformValue.FromVec4(new Vec4(1.0f, 1.0f, 0.0f, 0.0f)));
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.non-finite-uniform");
    }

    [Fact]
    public void Convert_UsesAnisotropyAliasForFeatureDetection()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            scalars: new Dictionary<string, float> { ["_AnisotropyFactor"] = 0.75f });

        SceneMaterialDefinition material = SceneGltfMaterialConverter.Convert(source).Material;

        material.Surface.Features.Should().HaveFlag(SceneMaterialFeatures.Anisotropy);
    }

    [Fact]
    public void Convert_EmptyMaterialIdThrows()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(id: " ");

        Action convert = () => SceneGltfMaterialConverter.Convert(source);

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Convert_MissingDefinitionThrows()
    {
        var source = new GltfMaterialAsset
        {
            Id = "material0",
            MaterialIndex = 0,
            Definition = null!,
            AlphaMode = GltfAlphaMode.Opaque,
            AlphaCutoff = 0.5f,
            DoubleSided = false,
            Unlit = false,
            Textures = ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding>.Empty
        };

        Action convert = () => SceneGltfMaterialConverter.Convert(source);

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Convert_ProducesDeterministicUniformSet()
    {
        GltfMaterialAsset source = SceneGltfTestFactory.Material(
            scalars: new Dictionary<string, float>
            {
                ["_Zeta"] = 1.0f,
                ["_Alpha"] = 2.0f
            },
            ints: new Dictionary<string, int> { ["_Custom"] = 3 });

        string[] first = Keys(SceneGltfMaterialConverter.Convert(
            source,
            new SceneGltfImportOptions { UnknownPropertyPolicy = SceneGltfUnknownPropertyPolicy.Preserve }).Material);
        string[] second = Keys(SceneGltfMaterialConverter.Convert(
            source,
            new SceneGltfImportOptions { UnknownPropertyPolicy = SceneGltfUnknownPropertyPolicy.Preserve }).Material);

        first.Should().Equal(second);
        first.Should().OnlyHaveUniqueItems();
        first.Should().Contain("_Alpha").And.Contain("_Zeta").And.Contain("_Custom");
    }

    private static GltfMaterialAsset WithAlphaCutoff(GltfMaterialAsset material, float cutoff) =>
        new()
        {
            Id = material.Id,
            MaterialIndex = material.MaterialIndex,
            Definition = material.Definition,
            AlphaMode = material.AlphaMode,
            AlphaCutoff = cutoff,
            DoubleSided = material.DoubleSided,
            Unlit = material.Unlit,
            Textures = material.Textures
        };

    private static SceneUniformValue Uniform(SceneMaterialDefinition material, string name) =>
        material.Uniforms[name];

    private static string[] Keys(SceneMaterialDefinition material)
    {
        var keys = new string[material.Uniforms.Count];
        int index = 0;
        foreach (string key in material.Uniforms.Keys)
        {
            keys[index++] = key;
        }

        return keys;
    }
}
