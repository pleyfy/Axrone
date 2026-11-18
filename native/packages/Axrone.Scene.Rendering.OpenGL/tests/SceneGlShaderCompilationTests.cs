namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System;
using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Render.Core;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers the structured shader failure surface: the driver log must survive untouched and the
/// reported source line must be readable by editor tooling.
/// </summary>
public sealed class SceneGlShaderCompilationTests
{
    [Theory]
    [InlineData("ERROR: 0:12: no matching overloaded function found", 12)]
    [InlineData("Fragment shader.\nERROR: 0:7: 'u_Mask' : undeclared identifier", 7)]
    [InlineData("0(41) : error: syntax error, unexpected IDENTIFIER", 41)]
    [InlineData("ERROR: 1:2: cannot convert", 2)]
    [InlineData("No compilation errors reported.", 0)]
    [InlineData("", 0)]
    [InlineData(null, 0)]
    public void TryExtractLine_ParsesBothDriverFormats(string? infoLog, int expected)
    {
        bool found = SceneGlShaderCompilation.TryExtractLine(infoLog, out int line);

        found.Should().Be(expected > 0);
        line.Should().Be(expected);
    }

    [Theory]
    [InlineData(GLShaderErrorCode.ShaderLinkFailed, "anything", SceneGlShaderFailureStage.Link)]
    [InlineData(GLShaderErrorCode.ShaderCompileFailed, "Fragment shader.", SceneGlShaderFailureStage.Fragment)]
    [InlineData(GLShaderErrorCode.ShaderCompileFailed, "vertex shader failed", SceneGlShaderFailureStage.Vertex)]
    [InlineData(GLShaderErrorCode.ShaderCompileFailed, "generic driver message", SceneGlShaderFailureStage.Unknown)]
    [InlineData(GLShaderErrorCode.ShaderCompileFailed, "", SceneGlShaderFailureStage.Unknown)]
    public void InferStage_UsesCodeFirstThenTheLog(
        GLShaderErrorCode code,
        string infoLog,
        SceneGlShaderFailureStage expected)
    {
        var error = new GLShaderException("message", code, infoLog);

        SceneGlShaderCompilation.InferStage(error, infoLog).Should().Be(expected);
    }

    [Fact]
    public void FromException_PreservesLabelCodeLogAndLine()
    {
        const string driverLog = "Fragment shader.\nERROR: 0:9: type mismatch";
        var error = new GLShaderException(
            "SHADER_COMPILE_FAILED: " + driverLog,
            GLShaderErrorCode.ShaderCompileFailed,
            driverLog);

        SceneGlShaderCompilationFailure failure = SceneGlShaderCompilation.FromException("graph/custom", error);

        failure.Label.Should().Be("graph/custom");
        failure.Code.Should().Be(GLShaderErrorCode.ShaderCompileFailed);
        failure.Stage.Should().Be(SceneGlShaderFailureStage.Fragment);
        failure.InfoLog.Should().Be(driverLog);
        failure.ErrorLine.Should().Be(9);
        failure.HasErrorLine.Should().BeTrue();
        failure.Message.Should().StartWith("Shader 'graph/custom' failed during Fragment line 9:");
    }

    [Fact]
    public void FromException_FallsBackToTheMessageWhenTheLogIsAbsent()
    {
        var error = new GLShaderException("vertex boom", GLShaderErrorCode.ShaderCompileFailed);

        SceneGlShaderCompilationFailure failure = SceneGlShaderCompilation.FromException("graph/x", error);

        failure.InfoLog.Should().Be("vertex boom");
        failure.Stage.Should().Be(SceneGlShaderFailureStage.Vertex);
        failure.HasErrorLine.Should().BeFalse();
    }

    [Fact]
    public void FromException_RejectsNullError() =>
        Action_Throws(() => SceneGlShaderCompilation.FromException("label", null!));

    [Fact]
    public void FromBakeFailure_PrefersTheFirstErrorLineNumber()
    {
        var diagnostics = ImmutableArray.Create(
            new ShaderDiagnostic(
                new ShaderSymbol("warning"),
                ShaderDiagnosticSeverity.Warning,
                new SourceLocation(1, 1),
                default,
                "informational"),
            new ShaderDiagnostic(
                new ShaderSymbol("error"),
                ShaderDiagnosticSeverity.Error,
                new SourceLocation(23, 4),
                default,
                "library not found"));

        SceneGlShaderCompilationFailure failure = SceneGlShaderCompilation.FromBakeFailure(
            "graph/baked",
            "library not found",
            diagnostics);

        failure.Stage.Should().Be(SceneGlShaderFailureStage.Effect);
        failure.ErrorLine.Should().Be(23);
        failure.InfoLog.Should().Be("library not found");
    }

    [Fact]
    public void FromBakeFailure_WithoutDiagnosticsReportsNoLine()
    {
        SceneGlShaderCompilationFailure failure = SceneGlShaderCompilation.FromBakeFailure(
            "graph/baked",
            "bake exploded",
            ImmutableArray<ShaderDiagnostic>.Empty);

        failure.HasErrorLine.Should().BeFalse();
        failure.InfoLog.Should().Be("bake exploded");
    }

    [Fact]
    public void CompileException_CarriesTheFailureAndStaysAGlShaderException()
    {
        var failure = new SceneGlShaderCompilationFailure(
            "graph/custom",
            SceneGlShaderFailureStage.Fragment,
            GLShaderErrorCode.ShaderCompileFailed,
            "ERROR: 0:2: bad",
            2);

        var error = new SceneGlShaderCompileException(failure);

        error.Failure.Should().Be(failure);
        error.ShaderCode.Should().Be(GLShaderErrorCode.ShaderCompileFailed);
        error.InfoLog.Should().Be("ERROR: 0:2: bad");
        error.Should().BeAssignableTo<GLShaderException>();
        error.Message.Should().Contain("Fragment");
    }

    [Fact]
    public void ShaderState_DefaultsKeepDepthTestAndBackCulling()
    {
        SceneGlShaderState.Default.DepthTest.Should().BeTrue();
        SceneGlShaderState.Default.Cull.Should().Be(SceneGlCullMode.Back);
        SceneGlShaderState.Default.CullEnabled.Should().BeTrue();
        SceneGlShaderState.Default.Blend.Should().BeFalse();

        new SceneGlShaderState(true, SceneGlCullMode.None, false).CullEnabled.Should().BeFalse();
    }

    private static void Action_Throws(Action action) =>
        action.Should().Throw<ArgumentNullException>();
}
