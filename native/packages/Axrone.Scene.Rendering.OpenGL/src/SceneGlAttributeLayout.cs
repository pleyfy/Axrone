namespace Axrone.Scene.Rendering.OpenGL;

using System.Text;

/// <summary>
/// Binds generated vertex inputs to the attribute locations the scene mesh layout uploads.
/// </summary>
/// <remarks>
/// The scene VAO enables one location per mesh semantic, so a shader whose inputs carry no
/// explicit <c>layout(location = ...)</c> qualifier links against driver-chosen slots and reads
/// garbage attributes. This is the in-scope equivalent of the Web shader factory's
/// <c>bindAttribLocation</c> pass, which runs before linking. Sources that already declare
/// qualifiers come back untouched, so the built-in shaders stay byte-identical.
/// </remarks>
public static class SceneGlAttributeLayout
{
    /// <summary>Marker identifying a source this pass has already qualified.</summary>
    public const string Marker = "AXRON_SCENE_ATTRIBUTE_LOCATIONS";

    private const string LayoutPrefix = "layout";
    private const string InKeyword = "in";

    /// <summary>
    /// Adds missing location qualifiers to the vertex inputs named by
    /// <paramref name="bindings"/>, using the semantic value as the location.
    /// </summary>
    /// <param name="vertexSource">Vertex stage source.</param>
    /// <param name="bindings">Semantic-to-attribute-name bindings.</param>
    /// <param name="notes">Optional list receiving declarations that could not be qualified.</param>
    /// <returns>The source with explicit input locations.</returns>
    public static string EnsureLocations(
        string vertexSource,
        IReadOnlyDictionary<SceneMeshSemantic, string> bindings,
        IList<string>? notes = null)
    {
        ArgumentNullException.ThrowIfNull(vertexSource);
        ArgumentNullException.ThrowIfNull(bindings);

        Dictionary<string, int> locations = BuildLocations(bindings);
        if (locations.Count == 0)
        {
            return vertexSource;
        }

        var builder = new StringBuilder(vertexSource.Length + 128);
        int length = vertexSource.Length;
        int start = 0;
        while (start <= length)
        {
            int newline = vertexSource.IndexOf('\n', start);
            int end = newline < 0 ? length : newline;
            ReadOnlySpan<char> line = vertexSource.AsSpan(start, end - start);
            if (!TryRewriteLine(line, locations, notes, builder))
            {
                builder.Append(line);
            }

            if (newline < 0)
            {
                break;
            }

            builder.Append('\n');
            start = newline + 1;
        }

        return builder.ToString();
    }

    /// <summary>
    /// Whether the source declares <paramref name="name"/> as a vertex input without a location
    /// qualifier, i.e. exactly what <see cref="EnsureLocations"/> repairs.
    /// </summary>
    /// <param name="vertexSource">Vertex stage source.</param>
    /// <param name="name">Attribute name.</param>
    /// <returns>Whether an unqualified input declaration exists.</returns>
    public static bool HasUnqualifiedInput(string vertexSource, string name)
    {
        ArgumentNullException.ThrowIfNull(vertexSource);
        ArgumentNullException.ThrowIfNull(name);

        int length = vertexSource.Length;
        int start = 0;
        while (start <= length)
        {
            int newline = vertexSource.IndexOf('\n', start);
            int end = newline < 0 ? length : newline;
            if (MatchDeclaration(vertexSource.AsSpan(start, end - start), name.AsSpan()) ==
                SceneGlAttributeDeclaration.Unqualified)
            {
                return true;
            }

            if (newline < 0)
            {
                break;
            }

            start = newline + 1;
        }

        return false;
    }

    /// <summary>Reports how one source line declares the attribute.</summary>
    /// <param name="line">Source line, terminator excluded.</param>
    /// <param name="name">Attribute name.</param>
    /// <returns>The declaration state.</returns>
    public static SceneGlAttributeDeclaration ClassifyLine(ReadOnlySpan<char> line, string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        return MatchDeclaration(line, name.AsSpan());
    }

    private static Dictionary<string, int> BuildLocations(IReadOnlyDictionary<SceneMeshSemantic, string> bindings)
    {
        var locations = new Dictionary<string, int>(bindings.Count, StringComparer.Ordinal);
        foreach (KeyValuePair<SceneMeshSemantic, string> binding in bindings)
        {
            if (!string.IsNullOrWhiteSpace(binding.Value))
            {
                locations[binding.Value] = (int)binding.Key;
            }
        }

        return locations;
    }

    private static bool TryRewriteLine(
        ReadOnlySpan<char> line,
        Dictionary<string, int> locations,
        IList<string>? notes,
        StringBuilder builder)
    {
        foreach (KeyValuePair<string, int> entry in locations)
        {
            SceneGlAttributeDeclaration state = MatchDeclaration(line, entry.Key.AsSpan());
            switch (state)
            {
                case SceneGlAttributeDeclaration.Qualified:
                    return false;
                case SceneGlAttributeDeclaration.Unqualified:
                    {
                        int indent = LeadingWhitespace(line);
                        builder.Append(line[..indent]);
                        AppendLocation(builder, entry.Value);
                        builder.Append(line[indent..]);
                        return true;
                    }

                case SceneGlAttributeDeclaration.Ambiguous:
                    notes?.Add(
                        $"Attribute '{entry.Key}' is declared in a form the layout pass cannot qualify " +
                        "safely; declare each input on its own line with an explicit location.");
                    return false;
                default:
                    break;
            }
        }

        return false;
    }

    private static void AppendLocation(StringBuilder builder, int location)
    {
        builder.Append(LayoutPrefix)
            .Append("(location = ")
            .Append(location.ToString(CultureInfo.InvariantCulture))
            .Append(") ");
    }

    private static SceneGlAttributeDeclaration MatchDeclaration(ReadOnlySpan<char> line, ReadOnlySpan<char> name)
    {
        if (line.IsEmpty || name.IsEmpty)
        {
            return SceneGlAttributeDeclaration.None;
        }

        ReadOnlySpan<char> content = TrimTrailing(line);
        int comment = content.IndexOf("//", StringComparison.Ordinal);
        if (comment >= 0)
        {
            content = content[..comment];
        }

        content = content.TrimStart();
        if (content.Length == 0 || content[0] is '/' or '*')
        {
            return SceneGlAttributeDeclaration.None;
        }

        bool qualified = content.StartsWith(LayoutPrefix.AsSpan(), StringComparison.Ordinal);
        ReadOnlySpan<char> statement = qualified ? content[LayoutPrefix.Length..] : content;
        SceneGlAttributeDeclaration state = ScanDeclaration(statement, name);
        if (!qualified)
        {
            return state;
        }

        return state switch
        {
            SceneGlAttributeDeclaration.Unqualified => SceneGlAttributeDeclaration.Qualified,
            SceneGlAttributeDeclaration.Ambiguous => SceneGlAttributeDeclaration.Qualified,
            _ => SceneGlAttributeDeclaration.None
        };
    }

    private static SceneGlAttributeDeclaration ScanDeclaration(ReadOnlySpan<char> statement, ReadOnlySpan<char> name)
    {
        int phase = 0;
        int length = statement.Length;
        int index = 0;

        while (index < length)
        {
            char current = statement[index];
            if (!IsIdentifierPart(current))
            {
                index++;
                continue;
            }

            int start = index;
            while (index < length && IsIdentifierPart(statement[index]))
            {
                index++;
            }

            ReadOnlySpan<char> token = statement[start..index];
            switch (phase)
            {
                case 0:
                    phase = token.SequenceEqual(InKeyword.AsSpan()) ? 1 : 0;
                    break;
                case 1:
                    phase = 2;
                    break;
                default:
                    if (token.SequenceEqual(name))
                    {
                        // A shared declaration list cannot be qualified safely: one layout
                        // qualifier would apply to every name in the list.
                        return statement[index..].IndexOf(',') >= 0
                            ? SceneGlAttributeDeclaration.Ambiguous
                            : SceneGlAttributeDeclaration.Unqualified;
                    }

                    phase = 0;
                    break;
            }
        }

        return SceneGlAttributeDeclaration.None;
    }

    private static ReadOnlySpan<char> TrimTrailing(ReadOnlySpan<char> value)
    {
        int end = value.Length;
        while (end > 0 && (value[end - 1] == '\r' || value[end - 1] == ' ' || value[end - 1] == '\t'))
        {
            end--;
        }

        return value[..end];
    }

    private static int LeadingWhitespace(ReadOnlySpan<char> line)
    {
        int count = 0;
        while (count < line.Length && line[count] is ' ' or '\t')
        {
            count++;
        }

        return count;
    }

    private static bool IsIdentifierPart(char value) => char.IsAsciiLetterOrDigit(value) || value == '_';
}

/// <summary>How a source line declares one vertex attribute.</summary>
public enum SceneGlAttributeDeclaration
{
    /// <summary>The line does not declare the attribute.</summary>
    None = 0,

    /// <summary>The attribute is declared with an explicit location.</summary>
    Qualified,

    /// <summary>The attribute is declared without a location.</summary>
    Unqualified,

    /// <summary>The attribute shares a declaration with other names.</summary>
    Ambiguous
}
