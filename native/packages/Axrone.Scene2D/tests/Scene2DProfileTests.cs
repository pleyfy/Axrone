namespace Scene2DTests;

public class Scene2DProfileTests
{
    [Fact]
    public void LeanProfileIdIsDistinctFromDefaultTwoDProfile()
    {
        Scene2DProfiles.LeanTwoD.Should().NotBeEmpty();
        Scene2DProfiles.LeanTwoD.Should().NotBe(SceneRuntimeProfileIds.TwoD);
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

    [Fact]
    public void LeanProfileDelegatesPhysicsSelectionToDefaultTwoD()
    {
        SceneRuntimeProfile profile = Scene2DProfiles.LeanTwoDProfile;

        profile.Id.Should().Be(Scene2DProfiles.LeanTwoD);
        profile.Kind.Should().Be(SceneRuntimeProfileKind.Custom);
        profile.PhysicsBridges.Bridge2D.Should().BeTrue();
        profile.PhysicsBridges.Bridge3D.Should().BeFalse();
        profile.PhysicsBridges.Should().Be(
            SceneRuntimeProfiles.ResolvePhysicsBridges(SceneRuntimeProfileIds.TwoD));
    }

    [Fact]
    public void ResolveReturnsLeanThenDelegatesBuiltInTwoD()
    {
        Scene2DProfiles.Resolve(Scene2DProfiles.LeanTwoD).Should().BeSameAs(Scene2DProfiles.LeanTwoDProfile);
        Scene2DProfiles.Resolve(SceneRuntimeProfileIds.TwoD).Should().BeSameAs(SceneRuntimeProfiles.TwoD);
        Scene2DProfiles.TryResolve("scene/unknown", out SceneRuntimeProfile? unknown).Should().BeFalse();
        unknown.Should().BeNull();

        Action resolve = () => Scene2DProfiles.Resolve("scene/unknown");
        resolve.Should().Throw<SceneConfigurationException>();
    }

    [Fact]
    public void LeanRegistryContainsManifestPayloadsAndTransform2D()
    {
        using SceneWorld world = Scene2DProfiles.LeanTwoDProfile.Profile.CreateWorld();

        world.Registry.TryGetByName(SceneBuiltInNames.Transform2D, out _).Should().BeTrue();
        for (int i = 0; i < Scene2DBuiltInManifest.Components.Length; i++)
        {
            Scene2DBuiltInManifest.IsRegistered(world, Scene2DBuiltInManifest.Components[i]).Should().BeTrue();
        }

        world.Registry.TryGetByName("MeshRenderer", out _).Should().BeFalse();
    }

    [Fact]
    public void CustomProfileComposedWithAddScene2DSupportsFacadeCreation()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/custom-2d")));
        SceneProfile profile = builder
            .AddTransform2D()
            .AddScene2D()
            .Build();
        var runtime = SceneRuntimeProfiles.CreateCustom("test/custom-2d", profile);

        using Scene2D scene = Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });
        SceneActor actor = scene.CreateSpriteActor(new SceneActorConfig("CustomSprite"), new Scene2DSpriteConfig());
        Scene2DComponentIds.GetComponentType(Scene2DBuiltInComponent.SpriteRenderer)
            .Should()
            .Be<Scene2DSpriteRenderer>();
        scene.World.TryGetData(actor, out Scene2DSpriteRenderer renderer).Should().BeTrue();
        renderer.Visible.Should().BeTrue();
    }
}
