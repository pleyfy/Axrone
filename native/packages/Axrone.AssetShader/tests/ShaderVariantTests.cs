namespace Axrone.AssetShader.Tests;

public sealed class ShaderVariantTests
{
    private static ShaderEffect TestEffect() =>
        ShaderPipelineBuilder<StageUninitialized>.Begin("phong")
            .WithVertex(new ShaderStageDefinition(
                "gl_Position = vec4(0.0);",
                Precision: ShaderPrecision.Highp,
                Inputs: ImmutableArray.Create(new ShaderInterfaceDefinition("position", "vec3"))))
            .WithFragment(new ShaderStageDefinition(
                "#ifdef USE_FOG\nfog\n#endif\ngl_FragColor = ALBEDO;",
                Directives: ImmutableArray.Create("#version 300 es")))
            .WithKeywords(ImmutableArray.Create(
                new ShaderKeywordDefinition("USE_FOG"),
                new ShaderKeywordDefinition("MODE", Options: ImmutableArray.Create("LIT", "UNLIT"))))
            .Seal()
            .BuildEffect();

    [Fact]
    public void Variant_Count_And_Combinations()
    {
        ShaderEffect effect = TestEffect();
        ShaderVariantSystem.ComputeVariantCount(effect.Definition.Keywords).Should().Be(4);

        ShaderKeywordSelection[] combos = ShaderVariantSystem.EnumerateCombinations(effect.Definition.Keywords);
        combos.Should().HaveCount(4);
        combos.Select(c => c.Selections[new ShaderSymbol("USE_FOG")]).Should().Contain("true").And.Contain("false");
    }

    [Fact]
    public void Variant_Keys_Are_Stable_And_Distinct()
    {
        ShaderEffect effect = TestEffect();
        ShaderKeywordSelection[] combos = ShaderVariantSystem.EnumerateCombinations(effect.Definition.Keywords);

        VariantKey first = ShaderVariantSystem.ComputeVariantKey(combos[0]);
        VariantKey repeat = ShaderVariantSystem.ComputeVariantKey(combos[0]);
        first.Should().Be(repeat);

        combos.Select(c => ShaderVariantSystem.ComputeVariantKey(c)).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Bake_Produces_Sources_Uniforms_And_Caches()
    {
        ShaderEffect effect = TestEffect();
        var selection = new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add("USE_FOG", "1"));
        var sink = new ShaderDiagnosticSink();

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect, selection, sink);
        variant.VertexSource.Should().Contain("precision highp float;");
        variant.FragmentSource.Should().Contain("fog").And.Contain("gl_FragColor");
        variant.Defines.Should().ContainKey(new ShaderSymbol("USE_FOG"));

        ShaderVariant again = ShaderVariantSystem.BakeVariant(effect, selection);
        again.Should().BeSameAs(variant);
    }

    [Fact]
    public void Defaults_Select_First_Options_And_Build_All_Variants()
    {
        ShaderEffect effect = TestEffect();
        ShaderKeywordSelection defaults = ShaderVariantSystem.DefaultShaderKeywordSelection(effect.Definition.Keywords);
        defaults.Selections[new ShaderSymbol("USE_FOG")].Should().Be("false");
        defaults.Selections[new ShaderSymbol("MODE")].Should().Be("LIT");

        ShaderVariant[] variants = ShaderVariantSystem.BuildShaderVariants(effect);
        variants.Should().HaveCount(4);

        string key = ShaderVariantSystem.ComputeVariantKeyString(defaults);
        key.Should().Be("MODE=LIT|USE_FOG=false");
    }

    [Fact]
    public void Bake_Preserves_Line_Markers_On_Request()
    {
        ShaderEffect effect = TestEffect();
        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect, preserveLineMarkers: true);
        variant.FragmentSource.Should().Contain("#line");
    }

    [Fact]
    public void Bake_Without_Keywords_Emits_Empty_Variant()
    {
        ShaderEffect effect = ShaderPipelineBuilder<StageUninitialized>.Begin("flat")
            .WithVertex(new ShaderStageDefinition("gl_Position = vec4(0.0);"))
            .WithFragment(new ShaderStageDefinition("gl_FragColor = vec4(1.0);"))
            .Seal()
            .BuildEffect();

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect);
        variant.Key.Should().Be(VariantKey.Default);
        variant.Defines.Should().BeEmpty();
    }

    [Fact]
    public void Reflector_Summarizes_Effect()
    {
        ShaderEffect effect = TestEffect();
        ShaderEffectDefinition definition = effect.Definition;
        ShaderEffectReflection reflection = ShaderReflector.Reflect(in definition);
        reflection.Id.Name.Should().Be("phong");
        reflection.VariantCount.Should().Be(4);
        reflection.Vertex.Precision.Should().Be("highp");
        reflection.Vertex.InputCount.Should().Be(1);
        reflection.Vertex.MainLineCount.Should().Be(1);
        reflection.Keywords.Should().HaveCount(2);
    }

    [Fact]
    public void BakeVariant_EffectWithoutKeywords_BakesInsteadOfThrowing()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            new ShaderSymbol("no-keywords"),
            new ShaderStageDefinition("gl_Position = vec4(0.0);"),
            new ShaderStageDefinition("gl_FragColor = vec4(1.0);")));

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect);

        variant.Defines.Should().BeEmpty();
        variant.VertexSource.Should().NotBeNullOrWhiteSpace();
        variant.FragmentSource.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void SelectionToDefines_DefaultKeywordArray_YieldsNoDefines()
    {
        ImmutableDictionary<ShaderSymbol, string> defines =
            ShaderVariantSystem.SelectionToDefines(default, ShaderKeywordSelection.Empty);

        defines.Should().BeEmpty();
    }
}
