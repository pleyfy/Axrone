namespace Axrone.Scene.Gltf.Tests;

using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfShadersV2Tests
{
    [Theory]
    [InlineData("gltf/toon-outline")]
    [InlineData("gltf/hair")]
    [InlineData("gltf/cloth")]
    [InlineData("gltf/water")]
    [InlineData("gltf/foliage")]
    [InlineData("gltf/particle")]
    [InlineData("gltf/decal")]
    [InlineData("post-process/contract")]
    [InlineData("gltf/volume")]
    public void TryCreate_ResolvesAllBuiltInV2ShadersAndVariants(string shaderId)
    {
        SceneGltfShaders.TryCreate(shaderId, names: null, out SceneShaderDefinition? shader).Should().BeTrue();
        shader!.VertexSource.Should().Contain("#version 330 core");
        shader.FragmentSource.Should().Contain("#version 330 core");
        shader.VertexSource.Should().Contain("_VertexOffset");
        shader.Uniforms.Should().Contain("_BaseColorFactor");

        string blendVariant = SceneGltfShaders.ResolveVariantId(shaderId, blend: true, doubleSided: true);
        SceneGltfShaders.TryCreate(blendVariant, names: null, out SceneShaderDefinition? variant).Should().BeTrue();
        variant!.Blend.Should().BeTrue();
        variant.Cull.Should().BeFalse();
    }

    [Fact]
    public void VolumeShader_DeclaresRaymarchUniforms()
    {
        SceneGltfShadersV2.TryClassify("gltf/volume", out string? baseName).Should().BeTrue();
        baseName.Should().Be("gltf/volume");
        SceneGltfShadersV2.TryClassify("gltf/volume/blend", out baseName).Should().BeTrue();
        baseName.Should().Be("gltf/volume");

        ReadOnlySpan<SceneGltfShaderProperty> properties = SceneGltfShadersV2.GetProperties("gltf/volume");
        properties.ToArray().Select(property => property.Name).Should().Contain(
            ["_VolumeDensity", "_VolumeAbsorption", "_VolumeScatterColor", "_VolumeAnisotropy"]);
        properties.ToArray().Single(property => property.Name == "_VolumeScatterColor").Type
            .Should().Be(SceneGltfShaderPropertyType.Vec3);
        properties.ToArray().Single(property => property.Name == "_VolumeDensity").Type
            .Should().Be(SceneGltfShaderPropertyType.Float);
    }

    [Fact]
    public void VolumeShader_EmitsBeerLambertAndHenyeyGreensteinRaymarch()
    {
        SceneGltfShadersV2.TryCreate(
            SceneGltfShadersV2.VolumeShaderName,
            names: null,
            out SceneShaderDefinition? shader).Should().BeTrue();

        string fragment = shader!.FragmentSource;
        fragment.Should().Contain("for (int stepIdx = 0; stepIdx < 16; stepIdx += 1)");
        fragment.Should().Contain("clamp(marchLength / 16.0, 0.02, 0.35)");
        fragment.Should().Contain("exp(-sigmaT * stepSize)");
        fragment.Should().Contain("max(_VolumeAbsorption, 0.01) * density");
        fragment.Should().Contain("(1.0 - g * g) / (4.0 * 3.14159265");
        fragment.Should().Contain("clamp(_VolumeAnisotropy, -0.85, 0.85)");
        fragment.Should().Contain("_BaseColorFactor.rgb * _VolumeScatterColor");
        fragment.Should().Contain("inScatter += transmittance * scatterSample * (1.0 - stepExtinction)");
        fragment.Should().Contain("o_FragColor = vec4(finalColor, clamp(1.0 - transmittance, 0.0, 1.0));");

        fragment.Should().NotContain("_PostTintColor");
        fragment.Should().NotContain("_PostBlendFactor");
    }

    [Fact]
    public void VolumeShader_AuthorsDepthTestFrontCullAndBlendDefaults()
    {
        SceneGltfShadersV2.TryCreate(
            SceneGltfShadersV2.VolumeShaderName,
            names: null,
            out SceneShaderDefinition? shader).Should().BeTrue();

        shader!.DepthTest.Should().BeTrue();
        shader.Cull.Should().BeTrue();
        shader.Blend.Should().BeTrue();

        SceneGltfShadersV2.TryCreate(
            SceneGltfShaders.ResolveVariantId(SceneGltfShadersV2.VolumeShaderName, blend: false, doubleSided: true),
            names: null,
            out SceneShaderDefinition? doubleSided).Should().BeTrue();
        doubleSided!.Cull.Should().BeFalse();
        doubleSided.DepthTest.Should().BeTrue();
    }

    [Fact]
    public void Properties_V2UniformsAreKnownToImporter()
    {
        SceneGltfShaderProperties.IsKnownMaterialProperty("_HairSpecularShift").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_ClothFuzzColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_WaterDeepColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_WindStrength").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_ParticleSoftness").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_DecalBlend").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_PostTintColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_VolumeDensity").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_VolumeAbsorption").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_VolumeScatterColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_VolumeAnisotropy").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_OpacityTexture").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_EmissiveIntensity").Should().BeTrue();
    }
}
