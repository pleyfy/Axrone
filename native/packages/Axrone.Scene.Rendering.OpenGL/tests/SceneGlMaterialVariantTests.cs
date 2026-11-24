namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.AssetShader;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene.Assets;

public sealed class SceneGlMaterialVariantTests
{
    private static int ProgramCompilations(MockGLApi api) =>
        api.CallLog.Count(entry => entry.StartsWith("CreateProgram(", StringComparison.Ordinal));

    private static ShaderEffect TwoVariantEffect() =>
        new(new ShaderEffectDefinition(
            new ShaderSymbol("test/variants"),
            new ShaderStageDefinition("void main(){}"),
            new ShaderStageDefinition("void main(){}"),
            Keywords: [new ShaderKeywordDefinition(new ShaderSymbol("MODE"), Options: ["a", "b"])]));

    private static SceneShaderDefinition RegisterEffectShader(SceneGlFixture fixture, string name)
    {
        var id = fixture.Assets.CreateId<ShaderAssetTag>(name);
        var definition = new SceneShaderDefinition(id, "void main(){}", "void main(){}", effect: TwoVariantEffect());
        fixture.Assets.Shaders.Register(definition);
        fixture.Cache.RegisterShader(definition);
        return definition;
    }

    [Fact]
    public void Materials_WithDifferentKeywords_GetDifferentPrograms()
    {
        using var fixture = new SceneGlFixture();
        SceneShaderDefinition shader = RegisterEffectShader(fixture, "test/variant-shader");

        var firstId = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-a");
        var secondId = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-b");
        var first = new SceneMaterialDefinition(firstId, shader.Id, new SceneMaterialSurface(),
            keywords: new Dictionary<string, string> { ["MODE"] = "a" });
        var second = new SceneMaterialDefinition(secondId, shader.Id, new SceneMaterialSurface(),
            keywords: new Dictionary<string, string> { ["MODE"] = "b" });

        SceneGlShader programA = fixture.Cache.ResolveMaterialProgram(first);
        SceneGlShader programB = fixture.Cache.ResolveMaterialProgram(second);

        programA.Should().NotBeSameAs(programB);
        fixture.Cache.ResolveMaterialProgram(first).Should().BeSameAs(programA);
    }

    [Fact]
    public void Material_WithoutSelection_UsesTheEffectDefaultVariant()
    {
        using var fixture = new SceneGlFixture();
        SceneShaderDefinition shader = RegisterEffectShader(fixture, "test/default-shader");
        var id = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-default");
        var material = new SceneMaterialDefinition(id, shader.Id, new SceneMaterialSurface());

        fixture.Cache.ResolveMaterialProgram(material).Should().NotBeNull();
        material.TechniqueId.Should().BeNull();
        material.Keywords.Should().BeEmpty();
    }

    [Fact]
    public void Material_WithoutEffect_UsesTheRawShaderProgram()
    {
        using var fixture = new SceneGlFixture();
        fixture.Cache.RegisterShader(fixture.Shader);

        SceneGlShader program = fixture.Cache.ResolveMaterialProgram(fixture.Material);

        fixture.Cache.TryGetShader(fixture.Shader.Id, out SceneGlShader? raw).Should().BeTrue();
        program.Should().BeSameAs(raw);
    }

    [Fact]
    public void Material_TechniqueSelection_PicksThatTechniquesPasses()
    {
        using var fixture = new SceneGlFixture();
        var effect = new ShaderEffect(TwoVariantEffect().Definition with
        {
            Techniques =
            [
                new ShaderTechniqueDefinition(new ShaderSymbol("opaque"), [new ShaderPassDefinition(new ShaderSymbol("base"))]),
                new ShaderTechniqueDefinition(new ShaderSymbol("wire"), [new ShaderPassDefinition(new ShaderSymbol("lines"))]),
            ],
        });
        var shaderId = fixture.Assets.CreateId<ShaderAssetTag>("test/technique-shader");
        var shader = new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}", effect: effect);
        fixture.Assets.Shaders.Register(shader);
        fixture.Cache.RegisterShader(shader);

        var id = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-wire");
        var material = new SceneMaterialDefinition(id, shaderId, new SceneMaterialSurface(), techniqueId: "wire");

        SceneGlShader program = fixture.Cache.ResolveMaterialProgram(material);

        program.Label.Should().Contain("/wire/lines");
    }

    [Fact]
    public void Material_TechniqueSelection_CompilesOnlyThePassItDrawsWith()
    {
        using var fixture = new SceneGlFixture();
        var effect = new ShaderEffect(TwoVariantEffect().Definition with
        {
            Techniques =
            [
                new ShaderTechniqueDefinition(new ShaderSymbol("opaque"), [new ShaderPassDefinition(new ShaderSymbol("base"))]),
                new ShaderTechniqueDefinition(
                    new ShaderSymbol("dense"),
                    [
                        new ShaderPassDefinition(new ShaderSymbol("base")),
                        new ShaderPassDefinition(new ShaderSymbol("shadow")),
                        new ShaderPassDefinition(new ShaderSymbol("depth")),
                    ]),
            ],
        });
        var shaderId = fixture.Assets.CreateId<ShaderAssetTag>("test/dense-shader");
        var shader = new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}", effect: effect);
        fixture.Assets.Shaders.Register(shader);
        fixture.Cache.RegisterShader(shader);
        fixture.Api.ClearCallLog();

        var id = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-dense");
        var material = new SceneMaterialDefinition(id, shaderId, new SceneMaterialSurface(), techniqueId: "dense");

        SceneGlShader program = fixture.Cache.ResolveMaterialProgram(material);

        program.Label.Should().Contain("/dense/base");
        ProgramCompilations(fixture.Api).Should().Be(1, "the technique's other passes draw elsewhere, not here");

        fixture.Cache.ResolveMaterialProgram(material).Should().BeSameAs(program);
        ProgramCompilations(fixture.Api).Should().Be(1, "the same effect, technique, pass and keyword set is cached");
    }

    [Fact]
    public void Material_KeywordsAreCopiedSoLaterCallerMutationCannotChangeIt()
    {
        using var fixture = new SceneGlFixture();
        SceneShaderDefinition shader = RegisterEffectShader(fixture, "test/copy-shader");
        var keywords = new Dictionary<string, string> { ["MODE"] = "a" };
        var id = fixture.Assets.CreateId<MaterialAssetTag>("test/mat-copy");
        var material = new SceneMaterialDefinition(id, shader.Id, new SceneMaterialSurface(), keywords: keywords);

        keywords["MODE"] = "b";

        material.Keywords["MODE"].Should().Be("a");
    }
}
