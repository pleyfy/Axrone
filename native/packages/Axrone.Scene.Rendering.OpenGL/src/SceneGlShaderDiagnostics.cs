namespace Axrone.Scene.Rendering.OpenGL;

using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Render.Core;

/// <summary>Stage or phase a shader program failure belongs to.</summary>
public enum SceneGlShaderFailureStage
{
    /// <summary>Stage could not be inferred from the driver log.</summary>
    Unknown = 0,

    /// <summary>Vertex stage compilation.</summary>
    Vertex,

    /// <summary>Fragment stage compilation.</summary>
    Fragment,

    /// <summary>Program linking.</summary>
    Link,

    /// <summary>Effect baking, before any GPU work.</summary>
    Effect
}

/// <summary>
/// Structured GPU compilation failure: the driver log is preserved verbatim and the
/// reported line is parsed out, so an editor or runtime caller can point at the source
/// instead of at a thrown exception message.
/// </summary>
/// <param name="Label">Shader label the program was compiled under.</param>
/// <param name="Stage">Stage or phase that failed.</param>
/// <param name="Code">Backend error code.</param>
/// <param name="InfoLog">Driver info log, unmodified.</param>
/// <param name="ErrorLine">One-based source line reported by the driver, or zero.</param>
public readonly record struct SceneGlShaderCompilationFailure(
    string Label,
    SceneGlShaderFailureStage Stage,
    GLShaderErrorCode Code,
    string InfoLog,
    int ErrorLine)
{
    /// <summary>Whether the failure carries a usable line number.</summary>
    public bool HasErrorLine => ErrorLine > 0;

    /// <summary>Single-line summary suitable for a console or inspector message.</summary>
    public string Message
    {
        get
        {
            string location = HasErrorLine ? $" line {ErrorLine}" : string.Empty;
            return $"Shader '{Label}' failed during {Stage}{location}: {InfoLog}";
        }
    }

    /// <inheritdoc/>
    public override string ToString() => Message;
}

/// <summary>
/// Thrown when a scene shader fails to compile or link. The structured failure rides along so
/// callers that already catch <see cref="GLShaderException"/> keep working while editor tooling
/// can read the diagnostics without parsing text.
/// </summary>
public sealed class SceneGlShaderCompileException : GLShaderException
{
    /// <summary>Creates the exception from a structured failure.</summary>
    /// <param name="failure">Failure to surface.</param>
    public SceneGlShaderCompileException(SceneGlShaderCompilationFailure failure)
        : base(failure.Message, failure.Code, failure.InfoLog) =>
        Failure = failure;

    /// <summary>Structured failure details.</summary>
    public SceneGlShaderCompilationFailure Failure { get; }
}

/// <summary>
/// Turns backend shader errors into structured failures. Kept free of GL state so the mapping
/// is unit-testable with a hand-built exception instead of a driver.
/// </summary>
public static class SceneGlShaderCompilation
{
    /// <summary>Converts a backend exception into a structured failure.</summary>
    /// <param name="label">Shader label the program was compiled under.</param>
    /// <param name="error">Exception raised while compiling or linking.</param>
    /// <returns>The structured failure.</returns>
    public static SceneGlShaderCompilationFailure FromException(string label, GLShaderException error)
    {
        ArgumentNullException.ThrowIfNull(error);
        string infoLog = error.InfoLog ?? error.Message ?? string.Empty;
        return new SceneGlShaderCompilationFailure(
            label ?? string.Empty,
            InferStage(error, infoLog),
            error.ShaderCode,
            infoLog,
            TryExtractLine(infoLog, out int line) ? line : 0);
    }

    /// <summary>Builds a failure for an effect that never reached the GPU.</summary>
    /// <param name="label">Shader label the effect was registered under.</param>
    /// <param name="message">Bake failure message.</param>
    /// <param name="diagnostics">Diagnostics reported by the bake.</param>
    /// <returns>The structured failure.</returns>
    public static SceneGlShaderCompilationFailure FromBakeFailure(
        string label,
        string message,
        ImmutableArray<ShaderDiagnostic> diagnostics)
    {
        int line = 0;
        for (int i = 0; i < diagnostics.Length; i++)
        {
            ShaderDiagnostic diagnostic = diagnostics[i];
            if (diagnostic.Severity == ShaderDiagnosticSeverity.Error && diagnostic.Location.Line > 0)
            {
                line = (int)diagnostic.Location.Line;
                break;
            }
        }

        return new SceneGlShaderCompilationFailure(
            label ?? string.Empty,
            SceneGlShaderFailureStage.Effect,
            GLShaderErrorCode.ShaderCompileFailed,
            message ?? string.Empty,
            line);
    }

    /// <summary>Infers which stage failed from the backend code and the driver log.</summary>
    /// <param name="error">Exception raised while compiling or linking.</param>
    /// <param name="infoLog">Driver info log.</param>
    /// <returns>The inferred stage.</returns>
    public static SceneGlShaderFailureStage InferStage(GLShaderException error, string? infoLog)
    {
        ArgumentNullException.ThrowIfNull(error);
        if (error.ShaderCode == GLShaderErrorCode.ShaderLinkFailed)
        {
            return SceneGlShaderFailureStage.Link;
        }

        if (string.IsNullOrEmpty(infoLog))
        {
            return SceneGlShaderFailureStage.Unknown;
        }

        if (infoLog!.Contains("fragment", StringComparison.OrdinalIgnoreCase))
        {
            return SceneGlShaderFailureStage.Fragment;
        }

        if (infoLog.Contains("vertex", StringComparison.OrdinalIgnoreCase))
        {
            return SceneGlShaderFailureStage.Vertex;
        }

        return SceneGlShaderFailureStage.Unknown;
    }

    /// <summary>
    /// Extracts the first reported source line. Both desktop GLSL shapes are recognised:
    /// <c>ERROR: 0:12: ...</c>, where the leading number is the compilation unit, and
    /// <c>0(12) : error ...</c>.
    /// </summary>
    /// <param name="infoLog">Driver info log.</param>
    /// <param name="line">One-based line number when found.</param>
    /// <returns>Whether a line number was found.</returns>
    public static bool TryExtractLine(string? infoLog, out int line)
    {
        line = 0;
        if (string.IsNullOrEmpty(infoLog))
        {
            return false;
        }

        int length = infoLog!.Length;
        int index = 0;
        while (index < length)
        {
            if (!char.IsAsciiDigit(infoLog[index]))
            {
                index++;
                continue;
            }

            int runStart = index;
            while (index < length && char.IsAsciiDigit(infoLog[index]))
            {
                index++;
            }

            ReadOnlySpan<char> run = infoLog.AsSpan(runStart, index - runStart);
            if (index < length && infoLog[index] == '(')
            {
                // GLSL angle format: the line sits inside the parentheses.
                int close = infoLog.AsSpan(index).IndexOf(')');
                if (close > 1)
                {
                    line = ParseInt32(infoLog.AsSpan(index + 1, close - 1));
                    if (line > 0)
                    {
                        return true;
                    }
                }

                continue;
            }

            if (index >= length || infoLog[index] != ':')
            {
                line = ParseInt32(run);
                if (line > 0)
                {
                    return true;
                }

                continue;
            }

            // Colon format: skip a leading compilation-unit number and take the line after it.
            int secondStart = index + 1;
            while (secondStart < length && char.IsWhiteSpace(infoLog[secondStart]))
            {
                secondStart++;
            }

            if (secondStart < length && char.IsAsciiDigit(infoLog[secondStart]))
            {
                int secondEnd = secondStart;
                while (secondEnd < length && char.IsAsciiDigit(infoLog[secondEnd]))
                {
                    secondEnd++;
                }

                line = ParseInt32(infoLog.AsSpan(secondStart, secondEnd - secondStart));
                index = secondEnd;
                if (line > 0)
                {
                    return true;
                }

                continue;
            }

            line = ParseInt32(run);
            if (line > 0)
            {
                return true;
            }
        }

        return false;
    }

    private static int ParseInt32(ReadOnlySpan<char> digits)
    {
        int value = 0;
        for (int i = 0; i < digits.Length; i++)
        {
            value = (value * 10) + (digits[i] - '0');
        }

        return value;
    }
}

/// <summary>
/// Fixed-function state a shader program authors for itself. Material passes and render
/// passes can still override every field; this is the fallback underneath them.
/// </summary>
/// <param name="DepthTest">Whether depth testing runs.</param>
/// <param name="Cull">Face culling mode.</param>
/// <param name="Blend">Whether blending is enabled.</param>
public readonly record struct SceneGlShaderState(
    bool DepthTest = true,
    SceneGlCullMode Cull = SceneGlCullMode.Back,
    bool Blend = false)
{
    /// <summary>Opaque defaults matching the built-in scene materials.</summary>
    public static readonly SceneGlShaderState Default = new(true, SceneGlCullMode.Back, false);

    /// <summary>Whether any face is culled.</summary>
    public bool CullEnabled => Cull != SceneGlCullMode.None;
}

/// <summary>Face culling mode authored by a shader.</summary>
public enum SceneGlCullMode
{
    /// <summary>No faces are culled.</summary>
    None = 0,

    /// <summary>Back faces are culled.</summary>
    Back = 1,

    /// <summary>Front faces are culled.</summary>
    Front = 2
}
