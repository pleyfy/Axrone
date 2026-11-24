namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Scene.Assets;

public sealed class SceneGlEffectShaderTests
{
    private static ShaderEffect Effect(string id) =>
        new(new ShaderEffectDefinition(
            new ShaderSymbol(id),
            new ShaderStageDefinition("void main(){}"),
            new ShaderStageDefinition("void main(){}")));

    [Fact]
    public void RegisterShader_WithEffect_CompilesTheEffectVariant()
    {
        using var fixture = new SceneGlFixture();
        var id = fixture.Assets.CreateId<ShaderAssetTag>("test/effect-shader");
        var definition = new SceneShaderDefinition(id, "void main(){}", "void main(){}", effect: Effect("test/effect-backed"));
        fixture.Assets.Shaders.Register(definition);

        fixture.Cache.RegisterShader(definition);

        fixture.Cache.TryGetShader(id, out SceneGlShader? shader).Should().BeTrue();
        shader!.Label.Should().Contain("test/effect-backed");
        fixture.Cache.TryGetEffectPasses(id, out ImmutableArray<SceneGlEffectPass> passes).Should().BeTrue();
        passes.Length.Should().Be(1);
        passes[0].Shader.Should().BeSameAs(shader);
    }

    [Fact]
    public void RegisterShader_WithoutEffect_KeepsTheRawStringPath()
    {
        using var fixture = new SceneGlFixture();
        fixture.Cache.RegisterShader(fixture.Shader);

        fixture.Cache.TryGetEffectPasses(fixture.Shader.Id, out _).Should().BeFalse();
        fixture.Cache.TryGetShader(fixture.Shader.Id, out SceneGlShader? shader).Should().BeTrue();
        shader!.Label.Should().Be(fixture.Shader.Id.ToString());
    }

    [Fact]
    public void RegisterShader_EffectTechniquePassesAreAllResolved()
    {
        using var fixture = new SceneGlFixture();
        var effect = new ShaderEffect(Effect("test/multi").Definition with
        {
            Techniques =
            [
                new ShaderTechniqueDefinition(
                    new ShaderSymbol("opaque"),
                    [
                        new ShaderPassDefinition(new ShaderSymbol("base")),
                        new ShaderPassDefinition(new ShaderSymbol("decal")),
                    ]),
            ],
        });

        var id = fixture.Assets.CreateId<ShaderAssetTag>("test/multi-shader");
        var definition = new SceneShaderDefinition(id, "void main(){}", "void main(){}", effect: effect);
        fixture.Assets.Shaders.Register(definition);
        fixture.Cache.RegisterShader(definition);

        fixture.Cache.TryGetEffectPasses(id, out ImmutableArray<SceneGlEffectPass> passes).Should().BeTrue();
        passes.Length.Should().Be(2);
        passes[0].Id.Name.Should().Be("base");
        passes[1].Id.Name.Should().Be("decal");
        passes[1].Shader.Should().NotBeSameAs(passes[0].Shader);
    }

    [Fact]
    public void Dispose_ReleasesEffectProgramsExactlyOnce()
    {
        var fixture = new SceneGlFixture();
        var id = fixture.Assets.CreateId<ShaderAssetTag>("test/dispose-shader");
        var definition = new SceneShaderDefinition(id, "void main(){}", "void main(){}", effect: Effect("test/dispose"));
        fixture.Assets.Shaders.Register(definition);
        fixture.Cache.RegisterShader(definition);
        fixture.Cache.TryGetShader(id, out SceneGlShader? shader).Should().BeTrue();

        fixture.Cache.Dispose();
        fixture.Cache.Dispose();

        shader!.IsDisposed.Should().BeTrue("the resolver released the program exactly once");
        fixture.Dispose();
    }
}
