namespace Scene2DTests;

public class Scene2DProfileTests
{
    [Fact]
    public void LeanProfileIdIsDistinctFromDefaultTwoDProfile()
    {
        Scene2DProfiles.LeanTwoD.Should().NotBeEmpty();
        Scene2DProfiles.LeanTwoD.Should().NotBe("scene/2d-default");
    }

    [Theory]
    [InlineData("scene/2d-lean", true)]
    [InlineData("scene/2d-LEAN", false)]
    [InlineData("scene/2d-default", false)]
    [InlineData("", false)]
    public void IsLeanTwoDMatchesExactly(string candidate, bool expected)
    {
        Scene2DProfiles.IsLeanTwoD(candidate).Should().Be(expected);
    }
}
