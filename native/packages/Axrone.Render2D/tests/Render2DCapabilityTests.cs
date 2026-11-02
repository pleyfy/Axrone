namespace Render2DTests;

public class Render2DCapabilityTests
{
    [Fact]
    public void CapabilityTokensAreStable()
    {
        Render2DCapabilities.CapabilityId.Should().Be("render/2d");
        Render2DCapabilities.PackageName.Should().Be("@axrone/render-2d");
        Render2DCapabilities.OwnerPackage.Should().Be("@axrone/render-core");
        Render2DCapabilities.DefaultSpriteShaderId.Should().Be("render/2d/sprite-default");
    }

    [Theory]
    [InlineData("render/2d", true)]
    [InlineData("RENDER/2D", false)]
    [InlineData("render/2d/", false)]
    [InlineData("render/3d", false)]
    [InlineData("", false)]
    public void OwnsCapabilityMatchesExactly(string candidate, bool expected)
    {
        Render2DCapabilities.OwnsCapability(candidate).Should().Be(expected);
    }
}
