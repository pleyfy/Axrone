namespace Axrone.AssetShader.Tests;

[Collection(ShaderLibraryRegistryGroup.Name)]
public sealed class ShaderEdgeTests
{
    private static long Eval(string expression, in EmptyMacroPolicy lookup)
    {
        var parser = new SpanExpressionParser<EmptyMacroPolicy>(expression.AsSpan(), in lookup);
        return parser.Parse();
    }

    private static long Eval(string expression, in ImmutableMacroEnvironment lookup)
    {
        var parser = new SpanExpressionParser<ImmutableMacroEnvironment>(expression.AsSpan(), in lookup);
        return parser.Parse();
    }

    [Fact]
    public void Expression_Covers_All_Operators()
    {
        EmptyMacroPolicy empty = new();
        Eval("2 + 3 * 4", in empty).Should().Be(14);
        Eval("(2 + 3) * 4", in empty).Should().Be(20);
        Eval("10 - 4", in empty).Should().Be(6);
        Eval("7 / 0", in empty).Should().Be(0);
        Eval("7 % 0", in empty).Should().Be(0);
        Eval("6 << 1", in empty).Should().Be(12);
        Eval("6 >> 1", in empty).Should().Be(3);
        Eval("6 & 3", in empty).Should().Be(2);
        Eval("6 | 1", in empty).Should().Be(7);
        Eval("6 ^ 7", in empty).Should().Be(1);
        Eval("6 == 6", in empty).Should().Be(1);
        Eval("6 != 6", in empty).Should().Be(0);
        Eval("5 > 6", in empty).Should().Be(0);
        Eval("5 <= 6", in empty).Should().Be(1);
        Eval("0x10", in empty).Should().Be(16);
        Eval("UNKNOWN + 1", in empty).Should().Be(1);
        Eval("!0", in empty).Should().Be(1);
        Eval("~0", in empty).Should().Be(-1);
        Eval("-5", in empty).Should().Be(-5);

        var macros = ImmutableDictionary.Create<ShaderSymbol, string>()
            .Add("A", "6")
            .Add("FLAG", "yes");
        var lookup = new ImmutableMacroEnvironment(macros);
        Eval("defined(A)", in lookup).Should().Be(1);
        Eval("defined(NOPE)", in lookup).Should().Be(0);
        Eval("defined ( A )", in lookup).Should().Be(1);
        Eval("A + 1", in lookup).Should().Be(7);
        Eval("FLAG", in lookup).Should().Be(0);
    }

    [Fact]
    public void Elif_Chain_And_Nested_Branches()
    {
        EmptyMacroPolicy lookup = new();
        var sink = new ShaderDiagnosticSink();
        const string source = "#if 0\nA\n#elif 2 * 3 == 6\nB\n#else\nC\n#endif\nouter\n#if 0\n#if 1\nnested\n#endif\n#endif";
        string output = GLSLPreprocessor.Preprocess(source, in lookup, sink, "t");
        sink.HasErrors.Should().BeFalse();
        output.Should().Contain("B").And.Contain("outer")
            .And.NotContain("\nA\n").And.NotContain("nested");
    }

    [Fact]
    public void Duplicate_Else_Throws()
    {
        EmptyMacroPolicy lookup = new();
        var sink = new ShaderDiagnosticSink();
        Action act = () => GLSLPreprocessor.Preprocess("#if 1\nA\n#else\nB\n#else\nC\n#endif", in lookup, sink, "t");
        act.Should().Throw<ShaderPreprocessException>();
    }

    [Fact]
    public void Include_Directive_Edge_Cases()
    {
        IncludeExpander.TryParseIncludeDirective("  #include <a>  ".AsSpan(), out ReadOnlySpan<char> angled)
            .Should().BeTrue();
        new string(angled).Should().Be("a");

        IncludeExpander.TryParseIncludeDirective("#include \"b\"".AsSpan(), out ReadOnlySpan<char> quoted)
            .Should().BeTrue();
        new string(quoted).Should().Be("b");

        IncludeExpander.TryParseIncludeDirective("#include".AsSpan(), out _).Should().BeFalse();
        IncludeExpander.TryParseIncludeDirective("#include <a".AsSpan(), out _).Should().BeFalse();
        IncludeExpander.TryParseIncludeDirective("#include a".AsSpan(), out _).Should().BeFalse();
        IncludeExpander.TryParseIncludeDirective("#pragma once".AsSpan(), out _).Should().BeFalse();
        IncludeExpander.TryParseIncludeDirective("int x;".AsSpan(), out _).Should().BeFalse();
    }

    [Fact]
    public void Bake_Resolves_Registered_Library()
    {
        const string libraryKey = "p7_lighting";
        string? previous = ShaderLibraryRegistry.Instance.TryResolve(libraryKey, out string? existing)
            ? existing
            : null;

        try
        {
            ShaderEffect missing = BuildEffectWithInclude("lit_before", libraryKey, "gl_FragColor = vec4(lit());");
            ShaderPreprocessException missingError = Assert.Throws<ShaderPreprocessException>(
                () => ShaderVariantSystem.BakeVariant(missing));
            missingError.Diagnostics.Should().Contain(diagnostic => diagnostic.Code.Name == "ERR_INCLUDE_NOT_FOUND");

            ShaderLibraryRegistry.Instance.Register(libraryKey, "float lit() { return 1.0; }");

            ShaderEffect registered = BuildEffectWithInclude("lit_registered", libraryKey, "gl_FragColor = vec4(lit());");
            ShaderVariant resolved = ShaderVariantSystem.BakeVariant(registered);
            resolved.FragmentSource.Should().Contain("float lit()");
            resolved.Diagnostics.Should().BeEmpty();

            ShaderLibraryRegistry.Instance.Remove(libraryKey).Should().BeTrue();

            ShaderEffect removed = BuildEffectWithInclude("lit_removed", libraryKey, "gl_FragColor = vec4(lit());");
            ShaderPreprocessException removedError = Assert.Throws<ShaderPreprocessException>(
                () => ShaderVariantSystem.BakeVariant(removed));
            removedError.Diagnostics.Should().Contain(diagnostic => diagnostic.Code.Name == "ERR_INCLUDE_NOT_FOUND");
        }
        finally
        {
            if (previous is null)
            {
                ShaderLibraryRegistry.Instance.Remove(libraryKey);
            }
            else
            {
                ShaderLibraryRegistry.Instance.Register(libraryKey, previous);
            }
        }
    }

    private static ShaderEffect BuildEffectWithInclude(string id, string includeKey, string fragmentMain) =>
        ShaderPipelineBuilder<StageUninitialized>.Begin(id)
            .WithVertex(new ShaderStageDefinition("gl_Position = vec4(0.0);"))
            .WithFragment(new ShaderStageDefinition(
                fragmentMain,
                Includes: ImmutableArray.Create(new ShaderSymbol(includeKey))))
            .Seal()
            .BuildEffect();

    [Fact]
    public void Bake_User_Error_Throws()
    {
        ShaderEffect effect = ShaderPipelineBuilder<StageUninitialized>.Begin("bad")
            .WithVertex(new ShaderStageDefinition("gl_Position = vec4(0.0);"))
            .WithFragment(new ShaderStageDefinition("#error broken\n"))
            .Seal()
            .BuildEffect();

        Action act = () => ShaderVariantSystem.BakeVariant(effect);
        act.Should().Throw<ShaderPreprocessException>();
    }

    [Fact]
    public void Defines_Lower_Selection()
    {
        var keywords = ImmutableArray.Create(
            new ShaderKeywordDefinition("FOG"),
            new ShaderKeywordDefinition("MODE", Options: ImmutableArray.Create("LIT", "UNLIT")));
        var selection = new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>()
                .Add("FOG", "false")
                .Add("MODE", "LIT")
                .Add("GHOST", "x"));

        ImmutableDictionary<ShaderSymbol, string> defines = ShaderVariantSystem.SelectionToDefines(keywords, selection);
        defines[new ShaderSymbol("FOG")].Should().Be("0");
        defines[new ShaderSymbol("MODE")].Should().Be("0");
        defines[new ShaderSymbol("LIT")].Should().Be("1");
        defines.Should().NotContainKey(new ShaderSymbol("GHOST"));
    }

    [Fact]
    public void Empty_Keyword_Space_Yields_Single_Combination()
    {
        ShaderVariantSystem.ComputeVariantCount(default).Should().Be(1);
        ShaderKeywordSelection[] combos = ShaderVariantSystem.EnumerateCombinations(default);
        combos.Should().ContainSingle().Which.Should().BeSameAs(ShaderKeywordSelection.Empty);
    }

    [Fact]
    public void Selection_Equality_Rules()
    {
        var selection = new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add("A", "1"));
        selection.Equals(selection).Should().BeTrue();
        selection.Equals((object)new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add("A", "1"))).Should().BeTrue();
        selection.Equals(new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add("A", "2"))).Should().BeFalse();
        selection.Equals(new ShaderKeywordSelection(ImmutableDictionary.Create<ShaderSymbol, string>())).Should().BeFalse();
        selection.GetHashCode().Should().Be(new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add("A", "1")).GetHashCode());
    }

    [Fact]
    public void Composer_Merges_Collections()
    {
        ShaderEffectDefinition effect = ShaderPipelineBuilder<StageUninitialized>.Begin("a")
            .WithVertex(new ShaderStageDefinition("v", Directives: ImmutableArray.Create("#x")))
            .WithFragment(new ShaderStageDefinition("f"))
            .WithTechniques(ImmutableArray.Create(new ShaderTechniqueDefinition(
                new ShaderSymbol("t"),
                ImmutableArray.Create(new ShaderPassDefinition(new ShaderSymbol("p"))),
                Label: "Old")))
            .Seal()
            .BuildEffect()
            .Definition;

        ShaderEffectDefinition extended = ShaderComposer.ExtendShaderEffect(
            in effect,
            new PartialShaderEffectOverride(
                Vertex: new PartialShaderStageOverride(
                    Directives: ImmutableArray.Create("#y"),
                    Includes: ImmutableArray.Create(new ShaderSymbol("lib"), new ShaderSymbol("lib"))),
                Techniques: ImmutableArray.Create(new ShaderTechniqueDefinition(
                    new ShaderSymbol("t"),
                    ImmutableArray.Create(new ShaderPassDefinition(new ShaderSymbol("p"))),
                    Label: "New"))));

        extended.Vertex.Directives.Should().HaveCount(2);
        extended.Vertex.Includes.Should().ContainSingle();
        extended.Techniques.Should().ContainSingle(t => t.Label == "New");
    }

    [Fact]
    public void Libraries_RoundTrip()
    {
        ShaderEffectDefinition effect = ShaderPipelineBuilder<StageUninitialized>.Begin("a")
            .WithVertex(new ShaderStageDefinition("v"))
            .WithFragment(new ShaderStageDefinition("f"))
            .Seal()
            .BuildEffect()
            .Definition with
        {
            Libraries = ImmutableArray.Create(new ShaderLibraryDefinition("chunk", "float c();")),
        };

        ShaderEffectDefinition restored = ShaderSerialization.DeserializeFromJson(ShaderSerialization.SerializeToJson(effect));
        restored.Libraries.Should().ContainSingle(l => l.Id.Name == "chunk" && l.Code == "float c();");
    }

    [Fact]
    public void Pipeline_Matches_Shader_Extensions()
    {
        var pipeline = new AssetImportPipeline(new ShaderEffectModuleImporter(), new ShaderEffectJsonImporter());
        pipeline.Import("void main() {}", "basic.shader").Id.Name.Should().Be("basic");
        pipeline.Import("{\"id\":\"j\",\"vertex\":{\"main\":\"v\"},\"fragment\":{\"main\":\"f\"}}", "j.shader.json").Id.Name.Should().Be("j");
    }

    [Fact]
    public void Quirks_Compute_Is_Fragment_Noperspective_Is_Smooth()
    {
        const string json = """
            {
              "id": "q",
              "vertex": { "main": "v" },
              "fragment": { "main": "f", "inputs": [{ "name": "uv", "type": "vec2", "interpolation": "noperspective" }] },
              "properties": [{ "name": "p", "type": "float", "stages": ["compute"] }]
            }
            """;
        ShaderEffectDefinition effect = ShaderSerialization.DeserializeFromJson(json);
        effect.Fragment.Inputs[0].Interpolation.Should().Be(ShaderInterpolation.Smooth);
        effect.Properties[0].Stages.Should().ContainSingle().Which.Should().Be(ShaderStageTag.Fragment);
    }

    [Fact]
    public void Symbol_Format_Uses_Debug_Name()
    {
        ShaderSymbol named = new ShaderSymbol("hero".AsSpan());
        named.ToString(null, null).Should().Be("hero");
        named.ToString("X8", null).Should().Be("hero");

        var anonymous = new ShaderSymbol(0x1234UL);
        anonymous.ToString("X8", null).Should().Be("00001234");
    }
}
