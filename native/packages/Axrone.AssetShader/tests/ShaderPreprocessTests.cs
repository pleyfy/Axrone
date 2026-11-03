namespace Axrone.AssetShader.Tests;

public sealed class ShaderPreprocessTests
{
    private sealed class DictResolver : IIncludeResolver
    {
        private readonly Dictionary<string, string> _map;
        public DictResolver(Dictionary<string, string> map) => _map = map;
        public bool TryResolve(ShaderSymbol symbol, [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out string? code) =>
            _map.TryGetValue(symbol.Name, out code);
    }

    [Fact]
    public void Include_Expands_Nested_And_Detects_Cycles()
    {
        var resolver = new DictResolver(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["common"] = "float helper() { return 1.0; }\n#include <more>",
            ["more"] = "float extra() { return 2.0; }",
        });
        var sink = new ShaderDiagnosticSink();

        string expanded = IncludeExpander.ExpandIncludes(
            "void main() {}\n#include <common>\n", resolver, sink, "main");
        sink.HasErrors.Should().BeFalse();
        expanded.Should().Contain("helper").And.Contain("extra").And.Contain("void main()");
    }

    [Fact]
    public void Include_Missing_And_Circular_Report_Errors()
    {
        var sink = new ShaderDiagnosticSink();
        IncludeExpander.ExpandIncludes(
            "#include <ghost>\n", new DictResolver(new Dictionary<string, string>()), sink, "main");
        sink.HasErrors.Should().BeTrue();

        var cyclic = new DictResolver(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["a"] = "#include <b>",
            ["b"] = "#include <a>",
        });
        var sink2 = new ShaderDiagnosticSink();
        IncludeExpander.ExpandIncludes("#include <a>\n", cyclic, sink2, "main");
        sink2.HasErrors.Should().BeTrue();
        sink2.Diagnostics.Should().Contain(d => d.Code.Name == "ERR_CIRCULAR_INCLUDE");
    }

    [Fact]
    public void Include_Preserves_Line_Markers()
    {
        var resolver = new DictResolver(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["lib"] = "float x;",
        });
        var sink = new ShaderDiagnosticSink();
        string expanded = IncludeExpander.ExpandIncludes(
            "a\n#include <lib>\nb\n", resolver, sink, "main", preserveLineMarkers: true);
        expanded.Should().Contain("#line 1 \"lib\"").And.Contain("#line 3 \"main\"");
    }

    [Fact]
    public void Preprocessor_Handles_Conditionals_And_Macros()
    {
        var macros = ImmutableDictionary.Create<ShaderSymbol, string>()
            .Add("USE_FOG", "1")
            .Add("QUALITY", "2");
        var lookup = new ImmutableMacroEnvironment(macros);
        var sink = new ShaderDiagnosticSink();

        const string source = """
            base
            #if USE_FOG && QUALITY >= 2
            fog
            #else
            nofog
            #endif
            #ifdef MISSING
            hidden
            #endif
            #ifndef MISSING
            shown
            #endif
            """;
        string output = GLSLPreprocessor.Preprocess(source, in lookup, sink, "test");
        sink.HasErrors.Should().BeFalse();
        output.Should().Contain("fog").And.Contain("shown")
            .And.NotContain("nofog").And.NotContain("hidden");
    }

    [Fact]
    public void Preprocessor_Elif_Errors_And_Unterminated_Throw()
    {
        var lookup = new EmptyMacroPolicy();
        var sink = new ShaderDiagnosticSink();
        Action stray = () => GLSLPreprocessor.Preprocess("#elif 1\n", in lookup, sink, "t");
        stray.Should().Throw<ShaderPreprocessException>();
        sink.HasErrors.Should().BeTrue();

        var sink2 = new ShaderDiagnosticSink();
        Action unterminated = () => GLSLPreprocessor.Preprocess("#if 1\ncode\n", in lookup, sink2, "t");
        unterminated.Should().Throw<ShaderPreprocessException>();
    }

    [Fact]
    public void Preprocessor_Expands_Identifiers_And_Handles_Errors()
    {
        var macros = ImmutableDictionary.Create<ShaderSymbol, string>()
            .Add("MAX_LIGHTS", "4");
        var lookup = new ImmutableMacroEnvironment(macros);
        var sink = new ShaderDiagnosticSink();

        string output = GLSLPreprocessor.Preprocess("int n = MAX_LIGHTS;\n", in lookup, sink, "t");
        output.Should().Contain("int n = 4;");

        var sink2 = new ShaderDiagnosticSink();
        Action userError = () => GLSLPreprocessor.Preprocess("#error stop here\n", in lookup, sink2, "t");
        userError.Should().Throw<ShaderPreprocessException>();
    }

    [Fact]
    public void Uniform_Scanner_Dedupes_And_Parses_Arrays()
    {
        const string vtx = "uniform mat4 uModel;\nuniform vec3 uLights[4];\nvoid main() {}\n";
        const string frag = "uniform mat4 uModel;\nuniform sampler2D uAlbedo;\n";
        ImmutableArray<ShaderUniformScanResult> uniforms = UniformExtractor.ScanUniforms(vtx.AsSpan(), frag.AsSpan());
        uniforms.Should().HaveCount(3);
        uniforms.Should().Contain(u => u.Name.Name == "uLights" && u.ArrayLength == 4);
        uniforms.Should().Contain(u => u.Name.Name == "uAlbedo" && u.Type.Name == "sampler2D");
    }

    [Fact]
    public void Registry_Registers_Resolves_And_Clears()
    {
        // A private instance keeps registry semantics independent from the process-wide
        // ShaderLibraryRegistry.Instance shared by concurrent bake tests.
        var registry = new ShaderLibraryRegistry();

        registry.Has("chunk").Should().BeFalse();
        registry.TryResolve("chunk", out string? missing).Should().BeFalse();
        missing.Should().BeNull();
        registry.Remove("chunk").Should().BeFalse();

        ShaderLibraryDefinition definition = registry.Register("chunk", "  float c() { return 0.0; }\n");
        definition.Id.Should().Be(new ShaderSymbol("chunk"));
        definition.Code.TrimEnd().Should().Be("float c() { return 0.0; }");
        registry.Has("chunk").Should().BeTrue();
        registry.TryResolve("chunk", out string? code).Should().BeTrue();
        code.Should().Contain("float c()");
        registry.ToArray().Should().ContainSingle();

        registry.Register("chunk", "float replacement() { return 1.0; }");
        registry.TryResolve("chunk", out string? replaced).Should().BeTrue();
        replaced.Should().Contain("replacement");
        registry.ToArray().Should().ContainSingle();

        registry.Register("other", "float o();");
        registry.ToArray().Should().HaveCount(2);

        registry.Remove("chunk").Should().BeTrue();
        registry.Has("chunk").Should().BeFalse();
        registry.Has("other").Should().BeTrue();

        registry.Clear();
        registry.ToArray().Should().BeEmpty();
        registry.Has("other").Should().BeFalse();

        ShaderLibraryRegistry.Instance.Should().BeSameAs(ShaderLibraryRegistry.Instance);
    }
}
