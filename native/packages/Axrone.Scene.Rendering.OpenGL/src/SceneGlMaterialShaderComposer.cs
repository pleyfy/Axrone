namespace Axrone.Scene.Rendering.OpenGL;

using System.Text;

/// <summary>
/// Composes fragment shaders for scene materials by embedding the GLSL
/// material-extension contract from <see cref="SceneGlShaderSnippets.MaterialExtensions"/>.
/// Composition is applied at upload time so compiled programs expose the
/// extension samplers, feature gates and sampling helpers even though the
/// shader definitions themselves are authored outside this assembly.
/// </summary>
public static class SceneGlMaterialShaderComposer
{
    /// <summary>Marker comment identifying an already composed shader.</summary>
    public const string Marker = "AXRON_SCENE_MATERIAL_EXTENSIONS";

    private const string VersionDirective = "#version";
    private const string SceneMaterialUniform = "u_Albedo;";
    private const string ExtensionProbeUniform = "u_ClearcoatEnabled";
    private const int MinimumVersion = 330;

    private static readonly string[] ExtensionSymbols =
    [
        "u_ClearcoatMap",
        "u_HasClearcoatMap",
        "ClearcoatWeight(",
        "SheenColorValue(",
        "TransmissionWeight(",
        "IridescenceWeight(",
        "SubsurfaceWeight("
    ];

    /// <summary>Whether a fragment source already carries the extension contract.</summary>
    public static bool IsComposed(string fragmentSource)
    {
        ArgumentNullException.ThrowIfNull(fragmentSource);
        return fragmentSource.Contains(Marker, StringComparison.Ordinal) ||
            fragmentSource.Contains(ExtensionProbeUniform, StringComparison.Ordinal);
    }

    /// <summary>
    /// Returns a fragment source with the material-extension contract inserted
    /// immediately after its <c>#version</c> directive. Sources that are not
    /// desktop GLSL 330-or-later scene-material shaders, that already contain
    /// the contract, or that declare their own extension symbols are returned
    /// unchanged.
    /// </summary>
    public static string ComposeFragmentSource(string fragmentSource)
    {
        ArgumentNullException.ThrowIfNull(fragmentSource);

        if (!fragmentSource.Contains(SceneMaterialUniform, StringComparison.Ordinal) ||
            ContainsExtensionSymbols(fragmentSource))
        {
            return fragmentSource;
        }

        int versionIndex = fragmentSource.IndexOf(VersionDirective, StringComparison.Ordinal);
        if (versionIndex < 0 || !IsSupportedDesktopVersion(fragmentSource, versionIndex))
        {
            return fragmentSource;
        }

        ReadOnlySpan<char> snippet = SceneGlShaderSnippets.MaterialExtensions;
        int lineEnd = fragmentSource.IndexOf('\n', versionIndex);
        int insertionIndex = lineEnd >= 0 ? lineEnd + 1 : fragmentSource.Length;

        var builder = new StringBuilder(fragmentSource.Length + snippet.Length + 96);
        builder.Append(fragmentSource, 0, insertionIndex);
        if (lineEnd < 0)
        {
            builder.Append('\n');
        }

        builder.Append("// ").Append(Marker).Append('\n');
        builder.Append(snippet);
        if (snippet.Length == 0 || snippet[^1] != '\n')
        {
            builder.Append('\n');
        }

        builder.Append('\n');
        builder.Append(fragmentSource, insertionIndex, fragmentSource.Length - insertionIndex);
        return builder.ToString();
    }

    private static bool ContainsExtensionSymbols(string fragmentSource)
    {
        if (IsComposed(fragmentSource))
        {
            return true;
        }

        for (int i = 0; i < ExtensionSymbols.Length; i++)
        {
            if (fragmentSource.Contains(ExtensionSymbols[i], StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsSupportedDesktopVersion(string fragmentSource, int versionIndex)
    {
        int cursor = versionIndex + VersionDirective.Length;
        while (cursor < fragmentSource.Length && char.IsWhiteSpace(fragmentSource[cursor]))
        {
            cursor++;
        }

        int versionStart = cursor;
        int version = 0;
        while (cursor < fragmentSource.Length && char.IsAsciiDigit(fragmentSource[cursor]))
        {
            version = (version * 10) + (fragmentSource[cursor] - '0');
            cursor++;
        }

        if (cursor == versionStart || version < MinimumVersion)
        {
            return false;
        }

        while (cursor < fragmentSource.Length && char.IsWhiteSpace(fragmentSource[cursor]))
        {
            cursor++;
        }

        return cursor + 1 >= fragmentSource.Length ||
            (fragmentSource[cursor] is not 'e' and not 'E') ||
            (fragmentSource[cursor + 1] is not 's' and not 'S');
    }
}
