namespace Render2DTests;

using Axrone.Render2D;
using FluentAssertions;
using Xunit;

public sealed class Render2DSpriteShaderTests
{
    [Fact]
    public void ShaderContractMatchesTsIdentityAndUniforms()
    {
        Render2DSpriteShaderContract.DefaultShaderId.Should().Be("Render2D/Sprite");
        Render2DCapabilities.SpriteShaderId.Should().Be(Render2DSpriteShaderContract.DefaultShaderId);
        Render2DSpriteShaderContract.RequiredUniformNames.ToArray().Should().Contain("u_ViewProjection");
        Render2DSpriteShaderContract.RequiredUniformNames.ToArray().Should().Contain("u_MainTex");
        Render2DSpriteShaderContract.RequiredUniformNames.ToArray().Should().Contain("u_MaskShape");
        Render2DSpriteShaderContract.MainTextureUniform.Should().Be("u_MainTex");
        Render2DSpriteShaderContract.PositionAttribute.Should().Be("a_Position");
        Render2DSpriteShaderContract.UvAttribute.Should().Be("a_UV0");
        Render2DSpriteShaderContract.ColorAttribute.Should().Be("a_Color0");
    }

    [Fact]
    public void UniformNamesAcceptRequiredSetWithExtras()
    {
        string[] names =
        [
            "u_MainTex",
            "extra",
            "u_MaskCornerRadius",
            "u_ViewProjection",
            "u_MaskSize",
            "u_MaskAnchor",
            "u_MaskWorldToLocal",
            "u_MaskShape",
        ];

        Render2DSpriteShaderContract.IsSpriteUniformNames(names).Should().BeTrue();
    }

    [Fact]
    public void UniformNamesRejectMissingRequiredName()
    {
        string[] names =
        [
            "u_ViewProjection",
            "u_MainTex",
            "u_MaskShape",
            "u_MaskWorldToLocal",
            "u_MaskSize",
            "u_MaskAnchor",
        ];

        Render2DSpriteShaderContract.IsSpriteUniformNames(names).Should().BeFalse();
    }

    [Fact]
    public void SourceKeyOrdersByKindThenId()
    {
        Render2DSpriteSourceKey textureLow = Render2DSpriteSource.Texture(1).Key;
        Render2DSpriteSourceKey textureHigh = Render2DSpriteSource.Texture(2).Key;
        Render2DSpriteSourceKey material = Render2DSpriteSource.Material(1).Key;

        textureLow.CompareTo(textureHigh).Should().BeLessThan(0);
        material.CompareTo(textureHigh).Should().BeGreaterThan(0);
        (textureLow < textureHigh).Should().BeTrue();
        (material >= textureHigh).Should().BeTrue();
        textureLow.Should().Be(Render2DSpriteSource.Texture(1).Key);
    }
}
