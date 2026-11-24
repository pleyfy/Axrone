namespace Axrone.AssetShader.Tests;

using System.Collections.Generic;
using Axrone.AssetShader;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers the metadata-to-GLSL declaration pass: a generated effect that authors only property
/// tables and stage bodies must still bake into sources that declare every symbol they use.
/// </summary>
public sealed class ShaderEffectDeclarationTests
{
    [Fact]
    public void Collect_EmitsUniformDeclarationsForMetadataProperties()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/emissive"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Tint, 1.0);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Strength"), "float")));

        ShaderDeclarationSet set = ShaderEffectDeclarations.Collect(
            definition,
            ShaderStageTag.Fragment,
            "void main() {\n}\n");

        set.UniformLines.Should().ContainInOrder("uniform vec3 u_Tint;", "uniform float u_Strength;");
        set.IsEmpty.Should().BeFalse();
    }

    [Fact]
    public void Collect_FiltersPropertiesByTheirDeclaredStage()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/stages"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = u_Offset * vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Gain);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(
                    new ShaderSymbol("u_Offset"),
                    "vec2",
                    Stages: ImmutableArray.Create(ShaderStageTag.Vertex)),
                new ShaderPropertyDefinition(
                    new ShaderSymbol("u_Gain"),
                    "float",
                    Stages: ImmutableArray.Create(ShaderStageTag.Fragment))));

        ShaderDeclarationSet vertexSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Vertex, "void main() {\n}\n");
        ShaderDeclarationSet fragmentSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Fragment, "void main() {\n}\n");

        vertexSet.UniformLines.Should().ContainSingle().Which.Should().Be("uniform vec2 u_Offset;");
        fragmentSet.UniformLines.Should().ContainSingle().Which.Should().Be("uniform float u_Gain;");
    }

    [Fact]
    public void Collect_EmitsAttributesWithLocationsForTheVertexOnly()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/attributes"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(a_Position, 1.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(1.0);"),
            Attributes: ImmutableArray.Create(
                new ShaderAttributeDefinition("a_Position", "vec3", 0),
                new ShaderAttributeDefinition("a_Tangent", "vec4", 4),
                new ShaderAttributeDefinition("a_Unlocated", "vec2")));

        ShaderDeclarationSet vertexSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Vertex, "void main() {\n}\n");
        ShaderDeclarationSet fragmentSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Fragment, "void main() {\n}\n");

        vertexSet.AttributeLines.Should().ContainInOrder(
            "layout(location = 0) in vec3 a_Position;",
            "layout(location = 4) in vec4 a_Tangent;",
            "in vec2 a_Unlocated;");
        fragmentSet.AttributeLines.Should().BeEmpty();
    }

    [Fact]
    public void Collect_EmitsVaryingsAsVertexOutputsAndFragmentInputs()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/varyings"),
            Vertex: new ShaderStageDefinition(Main: "v_Uv = vec2(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(texture(u_Mask, v_Uv).rgb, 1.0);"),
            Varyings: ImmutableArray.Create(
                new ShaderInterfaceDefinition("v_Uv", "vec2"),
                new ShaderInterfaceDefinition("v_Face", "int", ShaderInterpolation.Flat)),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Mask"), "sampler2D")));

        ShaderDeclarationSet vertexSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Vertex, "void main() {\n}\n");
        ShaderDeclarationSet fragmentSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Fragment, "void main() {\n}\n");

        vertexSet.OutputLines.Should().ContainInOrder("out vec2 v_Uv;", "flat out int v_Face;");
        fragmentSet.InputLines.Should().ContainInOrder("in vec2 v_Uv;", "flat in int v_Face;");
        fragmentSet.OutputLines.Should().BeEmpty();
    }

    [Fact]
    public void Collect_SkipsSymbolsTheAuthoredStageAlreadyDeclares()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/authored"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Tint, 1.0);"),
            Attributes: ImmutableArray.Create(new ShaderAttributeDefinition("a_Position", "vec3", 0)),
            Varyings: ImmutableArray.Create(new ShaderInterfaceDefinition("v_Uv", "vec2")),
            Properties: ImmutableArray.Create(new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3")));

        ShaderDeclarationSet set = ShaderEffectDeclarations.Collect(
            definition,
            ShaderStageTag.Fragment,
            "uniform vec3 u_Tint;\nin vec2 v_Uv;\nvoid main() {\n}\n");

        set.UniformLines.Should().BeEmpty();
        set.InputLines.Should().BeEmpty();
        set.IsEmpty.Should().BeTrue();
    }

    [Fact]
    public void Collect_DeclaresMetadataUniformsEvenWhenTheSourceShadowsOneLocally()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/usage"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Tint * u_Strength, 1.0);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Strength"), "float")));

        ShaderDeclarationSet set = ShaderEffectDeclarations.Collect(
            definition,
            ShaderStageTag.Fragment,
            "void main() {\n    float u_Strength = 1.0;\n    o_FragColor = vec4(u_Tint * u_Strength, 1.0);\n}\n");

        set.UniformLines.Should().Equal("uniform vec3 u_Tint;", "uniform float u_Strength;");

        ShaderDeclarationSet authored = ShaderEffectDeclarations.Collect(
            definition,
            ShaderStageTag.Fragment,
            "uniform vec3 u_Tint;\nvoid main() {\n}\n");
        authored.UniformLines.Should().ContainSingle().Which.Should().Be("uniform float u_Strength;");
    }

    [Fact]
    public void Collect_AppendsArraySuffixAndRejectsNegativeLengths()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/arrays"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Lights[0].rgb, 1.0);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Lights"), "vec4") with { ArrayLength = 8 },
                new ShaderPropertyDefinition(new ShaderSymbol("u_Broken"), "vec2") with { ArrayLength = -1 }));

        var sink = new ShaderDiagnosticSink();
        ShaderDeclarationSet set = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Fragment, "void main() {\n}\n", sink);

        set.UniformLines.Should().ContainSingle().Which.Should().Be("uniform vec4 u_Lights[8];");
        sink.Diagnostics.Should().ContainSingle(diagnostic =>
            diagnostic.Message.Contains("u_Broken", StringComparison.Ordinal));
    }

    [Fact]
    public void Collect_ReportsConflictingAndUnsupportedMetadata()
    {
        ShaderEffectDefinition definition = new(
            Id: new ShaderSymbol("graph/conflicts"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(1.0);"),
            Attributes: ImmutableArray.Create(
                new ShaderAttributeDefinition("a_Position", "vec3", 0),
                new ShaderAttributeDefinition("a_Position", "vec4", 0)),
            Varyings: ImmutableArray.Create(
                new ShaderInterfaceDefinition("v_Uv", "vec2"),
                new ShaderInterfaceDefinition("v_Uv", "vec4")),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec4"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Weird"), "texture2D")));

        var sink = new ShaderDiagnosticSink();
        ShaderDeclarationSet set = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Fragment, "void main() {\n}\n", sink);
        ShaderDeclarationSet vertexSet = ShaderEffectDeclarations.Collect(
            definition, ShaderStageTag.Vertex, "void main() {\n}\n", sink);

        sink.HasErrors.Should().BeTrue();
        sink.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code.Equals(ShaderEffectDeclarations.ConflictingUniformCode));
        sink.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code.Equals(ShaderEffectDeclarations.ConflictingAttributeCode));
        sink.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code.Equals(ShaderEffectDeclarations.ConflictingInterfaceCode));
        sink.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code.Equals(ShaderEffectDeclarations.UnsupportedTypeCode));
        set.UniformLines.Should().ContainSingle().Which.Should().Be("uniform vec3 u_Tint;");
        vertexSet.AttributeLines.Should().ContainSingle()
            .Which.Should().Be("layout(location = 0) in vec3 a_Position;");
    }

    [Fact]
    public void Bake_DeclaresEveryMetadataSymbolInTheBakedSources()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/baked"),
            Vertex: new ShaderStageDefinition(
                Main: "v_Uv = a_UV0; gl_Position = u_Model * vec4(a_Position, 1.0);",
                Directives: ImmutableArray.Create("#version 330 core"),
                Precision: ShaderPrecision.Highp),
            Fragment: new ShaderStageDefinition(
                Main: "o_FragColor = vec4(texture(u_Albedo, v_Uv).rgb * u_Tint, 1.0);",
                Directives: ImmutableArray.Create("#version 330 core")),
            Attributes: ImmutableArray.Create(
                new ShaderAttributeDefinition("a_Position", "vec3", 0),
                new ShaderAttributeDefinition("a_UV0", "vec2", 2)),
            Varyings: ImmutableArray.Create(new ShaderInterfaceDefinition("v_Uv", "vec2")),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Model"), "mat4", Stages: ImmutableArray.Create(ShaderStageTag.Vertex)),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Albedo"), "sampler2D"))));

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect);

        variant.VertexSource.Should().StartWith("#version 330 core")
            .And.Contain("precision highp float;")
            .And.Contain("layout(location = 0) in vec3 a_Position;")
            .And.Contain("uniform mat4 u_Model;")
            .And.Contain("out vec2 v_Uv;");
        variant.FragmentSource.Should().Contain("in vec2 v_Uv;")
            .And.Contain("uniform vec3 u_Tint;")
            .And.Contain("uniform sampler2D u_Albedo;");
        variant.VertexSource.IndexOf("void main()", StringComparison.Ordinal)
            .Should().BeGreaterThan(variant.VertexSource.IndexOf("in vec3 a_Position;", StringComparison.Ordinal));
        variant.Uniforms.Should().Contain(uniform => uniform.Type.Name == "sampler2D");
        variant.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public void Bake_KeepsVersionDirectiveAsTheFirstStatementWhenDeclarationsAreEmitted()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/version-first"),
            Vertex: new ShaderStageDefinition(
                Main: "gl_Position = u_Model * vec4(a_Position, 1.0);",
                Directives: ImmutableArray.Create("#version 300 es"),
                Precision: ShaderPrecision.Highp),
            Fragment: new ShaderStageDefinition(
                Main: "o_FragColor = vec4(1.0);",
                Directives: ImmutableArray.Create("#version 300 es")),
            Attributes: ImmutableArray.Create(new ShaderAttributeDefinition("a_Position", "vec3", 0)),
            Properties: ImmutableArray.Create(new ShaderPropertyDefinition(new ShaderSymbol("u_Model"), "mat4"))));

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect);

        variant.VertexSource.Should().StartWith("#version 300 es\n");
        variant.VertexSource.IndexOf("precision highp float;", StringComparison.Ordinal)
            .Should().BeGreaterThan(variant.VertexSource.IndexOf("#version", StringComparison.Ordinal));
    }

    [Fact]
    public void Bake_EmitsNothingExtraWhenMetadataIsAbsent()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/plain"),
            Vertex: new ShaderStageDefinition(
                Main: "gl_Position = vec4(0.0);",
                Declarations: ImmutableArray.Create(new ShaderGlslBlock("uniform vec3 u_Authored;"))),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Authored, 1.0);")));

        ShaderVariant variant = ShaderVariantSystem.BakeVariant(effect);

        variant.VertexSource.Should().Contain("uniform vec3 u_Authored;");
        CountOccurrences(variant.VertexSource, "uniform ").Should().Be(1);
        variant.VertexSource.Should().NotContain("layout(location");
    }

    [Fact]
    public void Bake_KeepsKeywordDefinesWorkingWithTheEmittedHeader()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/keywords"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(
                Main: "#ifdef USE_MASK\no_FragColor = texture(u_Mask, vec2(0.0));\n#else\no_FragColor = vec4(1.0);\n#endif"),
            Keywords: ImmutableArray.Create(new ShaderKeywordDefinition("USE_MASK")),
            Properties: ImmutableArray.Create(new ShaderPropertyDefinition(new ShaderSymbol("u_Mask"), "sampler2D"))));

        var enabled = new ShaderKeywordSelection(
            ImmutableDictionary.Create<ShaderSymbol, string>().Add(new ShaderSymbol("USE_MASK"), "1"));

        ShaderVariant on = ShaderVariantSystem.BakeVariant(effect, enabled);
        ShaderVariant off = ShaderVariantSystem.BakeVariant(effect, ShaderKeywordSelection.Empty);

        on.FragmentSource.Should().Contain("uniform sampler2D u_Mask;")
            .And.Contain("texture(u_Mask, vec2(0.0))")
            .And.NotContain("#else");
        off.FragmentSource.Should().NotContain("texture(u_Mask");
    }

    [Fact]
    public void ToHeader_RendersAttributesThenInputsThenOutputsThenUniforms()
    {
        var set = new ShaderDeclarationSet(
            ImmutableArray.Create("layout(location = 0) in vec3 a_Position;"),
            ImmutableArray.Create("in vec2 v_Uv;"),
            ImmutableArray.Create("out vec4 fragColor;"),
            ImmutableArray.Create("uniform sampler2D u_Albedo;"));

        string header = set.ToHeader();

        int attribute = header.IndexOf("a_Position", StringComparison.Ordinal);
        int input = header.IndexOf("v_Uv", StringComparison.Ordinal);
        int output = header.IndexOf("fragColor", StringComparison.Ordinal);
        int uniform = header.IndexOf("u_Albedo", StringComparison.Ordinal);
        attribute.Should().BeGreaterThanOrEqualTo(0);
        input.Should().BeGreaterThan(attribute);
        output.Should().BeGreaterThan(input);
        uniform.Should().BeGreaterThan(output);
    }

    [Fact]
    public void EmptySet_HasNoHeader()
    {
        ShaderDeclarationSet.Empty.IsEmpty.Should().BeTrue();
        ShaderDeclarationSet.Empty.ToHeader().Should().BeEmpty();
        ShaderDeclarationSet.Empty.AttributeLines.Should().BeEmpty();
        ShaderDeclarationSet.Empty.UniformLines.Should().BeEmpty();
    }

    [Theory]
    [InlineData("uniform vec3 u_Tint;\n", "uniform", "u_Tint", true)]
    [InlineData("  uniform   vec3\tu_Tint[2];\n", "uniform", "u_Tint", true)]
    [InlineData("void main() { vec3 u_Tint = vec3(0.0); }\n", "uniform", "u_Tint", false)]
    [InlineData("// uniform vec3 u_Tint;\n", "uniform", "u_Tint", false)]
    [InlineData("in vec3 a_Position;\n", "in", "a_Position", true)]
    [InlineData("layout(location = 0) in vec3 a_Position;\n", "in", "a_Position", true)]
    [InlineData("out vec4 fragColor;\n", "out", "fragColor", true)]
    [InlineData("out vec4 fragColor;\n", "out", "u_Tint", false)]
    [InlineData("vec4 value = fragColor;\n", "out", "fragColor", false)]
    public void Declares_RecognisesDeclarationsOnly(
        string source,
        string keyword,
        string name,
        bool expected) =>
        ShaderEffectDeclarations.Declares(source.AsSpan(), keyword, name).Should().Be(expected);

    [Theory]
    [InlineData("#version 330 core\nvoid main() {}\n", true)]
    [InlineData("\n  #version 300 es\n", true)]
    [InlineData("// #version 330\nvoid main() {}\n", false)]
    [InlineData("precision mediump float;\n", false)]
    [InlineData("", false)]
    public void HasVersionDirective_SkipsLeadingBlankSpaceAndComments(string source, bool expected) =>
        ShaderEffectDeclarations.HasVersionDirective(source.AsSpan()).Should().Be(expected);

    [Theory]
    [InlineData("float", true)]
    [InlineData("vec3", true)]
    [InlineData("sampler2D", true)]
    [InlineData("samplerCube", true)]
    [InlineData("mat4", true)]
    [InlineData("ivec2", true)]
    [InlineData("texture2D", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsSupportedValueType_MatchesTheGlslVocabulary(string? type, bool expected) =>
        ShaderEffectDeclarations.IsSupportedValueType(type).Should().Be(expected);

    [Fact]
    public void Formatters_WriteOneDeclarationEach()
    {
        var located = new ShaderAttributeDefinition("a_Position", "vec3", 0);
        var unlocated = new ShaderAttributeDefinition("a_Position", "vec3");
        var array = new ShaderPropertyDefinition(new ShaderSymbol("u_Lights"), "vec4") with { ArrayLength = 3 };
        var scalar = new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3");
        var flat = new ShaderInterfaceDefinition("v_Face", "int", ShaderInterpolation.Flat);
        var smooth = new ShaderInterfaceDefinition("v_Uv", "vec2");

        ShaderEffectDeclarations.FormatAttribute(in located).Should().Be("layout(location = 0) in vec3 a_Position;");
        ShaderEffectDeclarations.FormatAttribute(in unlocated).Should().Be("in vec3 a_Position;");
        ShaderEffectDeclarations.FormatUniform(in array).Should().Be("uniform vec4 u_Lights[3];");
        ShaderEffectDeclarations.FormatUniform(in scalar).Should().Be("uniform vec3 u_Tint;");
        ShaderEffectDeclarations.FormatInterface(ShaderStageTag.Fragment, in flat, output: false)
            .Should().Be("flat in int v_Face;");
        ShaderEffectDeclarations.FormatInterface(ShaderStageTag.Vertex, in flat, output: true)
            .Should().Be("flat out int v_Face;");
        ShaderEffectDeclarations.FormatInterface(ShaderStageTag.Fragment, in smooth, output: false)
            .Should().Be("in vec2 v_Uv;");
    }

    [Fact]
    public void Variants_CacheBakesPerEffectInstanceAndSelection()
    {
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/cached"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(u_Tint, 1.0);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"))));

        ShaderVariant first = ShaderVariantSystem.BakeVariant(effect);
        ShaderVariant again = ShaderVariantSystem.BakeVariant(effect);

        again.Should().BeSameAs(first);
        first.FragmentSource.Should().Contain("uniform vec3 u_Tint;");
    }

    private static int CountOccurrences(string source, string needle)
    {
        int count = 0;
        int index = 0;
        while ((index = source.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }

        return count;
    }
}
