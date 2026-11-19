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
    public void Properties_V2UniformsAreKnownToImporter()
    {
        SceneGltfShaderProperties.IsKnownMaterialProperty("_HairSpecularShift").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_ClothFuzzColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_WaterDeepColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_WindStrength").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_ParticleSoftness").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_DecalBlend").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_PostTintColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_OpacityTexture").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_EmissiveIntensity").Should().BeTrue();
    }
}
