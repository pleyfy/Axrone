namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;

public sealed class SceneGlEffectProgramsTests
{
    private static ShaderEffect Effect() =>
        new(new ShaderEffectDefinition(
            new ShaderSymbol("test/effect"),
            new ShaderStageDefinition("void main(){}"),
            new ShaderStageDefinition("void main(){}"),
            Techniques:
            [
                new ShaderTechniqueDefinition(
                    new ShaderSymbol("opaque"),
                    [
                        new ShaderPassDefinition(new ShaderSymbol("base")),
                        new ShaderPassDefinition(
                            new ShaderSymbol("outline"),
                            FragmentOverride: new ShaderStageDefinition("void main(){ /* outline */ }"),
                            RenderState: new ShaderRenderState(CullMode: "front")),
                    ]),
            ]));

    private static (GLContext Context, SceneGlEffectPrograms Programs) Create()
    {
        var context = new GLContext(new MockGLApi());
        return (context, new SceneGlEffectPrograms(context));
    }

    [Fact]
    public void ResolveTechnique_ReturnsPassesInDeclarationOrderWithTheirState()
    {
        var (context, programs) = Create();
        using (context)
        using (programs)
        {
            ImmutableArray<SceneGlEffectPass> passes =
                programs.ResolveTechnique(Effect(), new ShaderSymbol("opaque"), null);

            passes.Length.Should().Be(2);
            passes[0].Id.Name.Should().Be("base");
            passes[0].State.Should().BeNull();
            passes[1].Id.Name.Should().Be("outline");
            passes[1].State!.Value.CullMode.Should().Be("front");
            passes[1].Shader.Program.Should().NotBe(passes[0].Shader.Program);
        }
    }

    [Fact]
    public void ResolvePass_IsCachedPerEffectTechniquePassAndKeywords()
    {
        var (context, programs) = Create();
        using (context)
        using (programs)
        {
            ShaderEffect effect = Effect();

            SceneGlEffectPass first = programs.ResolvePass(effect, new ShaderSymbol("opaque"), new ShaderSymbol("base"), null);
            SceneGlEffectPass second = programs.ResolvePass(effect, new ShaderSymbol("opaque"), new ShaderSymbol("base"), null);

            second.Shader.Should().BeSameAs(first.Shader);
        }
    }

    [Fact]
    public void ResolvePass_UnknownTechniqueOrPass_Throws()
    {
        var (context, programs) = Create();
        using (context)
        using (programs)
        {
            ShaderEffect effect = Effect();

            Action badTechnique = () => programs.ResolvePass(effect, new ShaderSymbol("nope"), new ShaderSymbol("base"), null);
            badTechnique.Should().Throw<ArgumentException>();

            Action badPass = () => programs.ResolvePass(effect, new ShaderSymbol("opaque"), new ShaderSymbol("nope"), null);
            badPass.Should().Throw<ArgumentException>();
        }
    }

    [Fact]
    public void ResolveTechnique_NoTechniques_SynthesizesOneBasePass()
    {
        var (context, programs) = Create();
        using (context)
        using (programs)
        {
            var bare = new ShaderEffect(new ShaderEffectDefinition(
                new ShaderSymbol("test/bare"),
                new ShaderStageDefinition("void main(){}"),
                new ShaderStageDefinition("void main(){}")));

            ImmutableArray<SceneGlEffectPass> passes = programs.ResolveTechnique(bare, null, null);

            passes.Length.Should().Be(1);
            passes[0].Id.Name.Should().Be("base");
        }
    }

    [Fact]
    public void ResolveTechnique_DefaultTechniqueIsHonouredWhenNoIdIsGiven()
    {
        var (context, programs) = Create();
        using (context)
        using (programs)
        {
            var effect = new ShaderEffect(Effect().Definition with
            {
                DefaultTechnique = new ShaderSymbol("opaque"),
            });

            ImmutableArray<SceneGlEffectPass> passes = programs.ResolveTechnique(effect, null, null);

            passes.Length.Should().Be(2);
            passes[1].Id.Name.Should().Be("outline");
        }
    }

    [Fact]
    public void Dispose_ReleasesProgramsAndRejectsFurtherResolution()
    {
        var (context, programs) = Create();
        using (context)
        {
            programs.ResolvePass(Effect(), new ShaderSymbol("opaque"), new ShaderSymbol("base"), null);
            programs.Dispose();
            programs.Dispose();

            Action afterDispose = () => programs.ResolvePass(Effect(), null, new ShaderSymbol("base"), null);
            afterDispose.Should().Throw<ObjectDisposedException>();
        }
    }
}
