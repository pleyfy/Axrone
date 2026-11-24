namespace Axrone.AssetShader;

/// <summary>
/// Header lines a stage needs but does not carry: attribute, interface and uniform
/// declarations derived from effect metadata.
/// </summary>
/// <param name="Attributes">Vertex attribute declarations, in declaration order.</param>
/// <param name="Inputs">Stage input declarations, in declaration order.</param>
/// <param name="Outputs">Stage output declarations, in declaration order.</param>
/// <param name="Uniforms">Uniform declarations visible to the stage, in declaration order.</param>
public readonly record struct ShaderDeclarationSet(
    ImmutableArray<string> Attributes,
    ImmutableArray<string> Inputs,
    ImmutableArray<string> Outputs,
    ImmutableArray<string> Uniforms)
{
    private static readonly ImmutableArray<string> s_empty = ImmutableArray<string>.Empty;

    /// <summary>An empty set.</summary>
    public static readonly ShaderDeclarationSet Empty = new(s_empty, s_empty, s_empty, s_empty);

    /// <summary>Attribute declarations, never default.</summary>
    public ImmutableArray<string> AttributeLines => Attributes.IsDefault ? s_empty : Attributes;

    /// <summary>Input declarations, never default.</summary>
    public ImmutableArray<string> InputLines => Inputs.IsDefault ? s_empty : Inputs;

    /// <summary>Output declarations, never default.</summary>
    public ImmutableArray<string> OutputLines => Outputs.IsDefault ? s_empty : Outputs;

    /// <summary>Uniform declarations, never default.</summary>
    public ImmutableArray<string> UniformLines => Uniforms.IsDefault ? s_empty : Uniforms;

    /// <summary>Whether the set carries no lines at all.</summary>
    public bool IsEmpty =>
        AttributeLines.Length == 0 &&
        InputLines.Length == 0 &&
        OutputLines.Length == 0 &&
        UniformLines.Length == 0;

    /// <summary>Renders the set as one GLSL header block, or an empty string when empty.</summary>
    public string ToHeader()
    {
        if (IsEmpty)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        AppendBlock(builder, AttributeLines);
        AppendBlock(builder, InputLines);
        AppendBlock(builder, OutputLines);
        AppendBlock(builder, UniformLines);
        return builder.ToString();
    }

    private static void AppendBlock(StringBuilder builder, ImmutableArray<string> lines)
    {
        if (lines.Length == 0)
        {
            return;
        }

        for (int i = 0; i < lines.Length; i++)
        {
            builder.Append(lines[i]).Append('\n');
        }

        builder.Append('\n');
    }
}

/// <summary>
/// Derives GLSL declarations from effect metadata so a generated effect whose stages carry
/// only <c>main</c> bodies still compiles. Declarations already written into the stage source
/// are left alone: metadata augments authored code, it never duplicates it.
/// </summary>
/// <remarks>
/// This mirrors the Web effect compiler (<c>compileRenderShaderEffect</c>), which emits the
/// attribute, interface and uniform blocks from the same metadata. Material-graph output is
/// authored as metadata plus statement bodies, so without this pass the baked sources reference
/// symbols nothing ever declared and the GPU compile fails.
/// </remarks>
public static class ShaderEffectDeclarations
{
    /// <summary>Diagnostic code for a property redeclaring a uniform name with another type.</summary>
    public static readonly ShaderSymbol ConflictingUniformCode = new("effect.conflicting-uniform");

    /// <summary>Diagnostic code for an attribute redeclaring a name with another type or location.</summary>
    public static readonly ShaderSymbol ConflictingAttributeCode = new("effect.conflicting-attribute");

    /// <summary>Diagnostic code for an interface redeclaring a name with another type.</summary>
    public static readonly ShaderSymbol ConflictingInterfaceCode = new("effect.conflicting-interface");

    /// <summary>Diagnostic code for a type outside the declarable GLSL value vocabulary.</summary>
    public static readonly ShaderSymbol UnsupportedTypeCode = new("effect.unsupported-type");

    /// <summary>Diagnostic code for a metadata entry without a usable GLSL identifier.</summary>
    public static readonly ShaderSymbol InvalidNameCode = new("effect.invalid-declaration-name");

    /// <summary>Declaration keyword for uniforms.</summary>
    public const string UniformKeyword = "uniform";

    /// <summary>Declaration keyword for stage inputs and vertex attributes.</summary>
    public const string InputKeyword = "in";

    /// <summary>Declaration keyword for stage outputs.</summary>
    public const string OutputKeyword = "out";

    private static readonly string[] SupportedValueTypes =
    [
        "float", "vec2", "vec3", "vec4",
        "int", "ivec2", "ivec3", "ivec4",
        "uint", "uvec2", "uvec3", "uvec4",
        "bool", "bvec2", "bvec3", "bvec4",
        "mat2", "mat3", "mat4",
        "sampler2D", "sampler3D", "samplerCube",
        "isampler2D", "usampler2D",
        "sampler2DShadow", "samplerCubeShadow"
    ];

    /// <summary>Whether a metadata type string names a declarable GLSL value type.</summary>
    public static bool IsSupportedValueType(string? type)
    {
        if (string.IsNullOrEmpty(type))
        {
            return false;
        }

        for (int i = 0; i < SupportedValueTypes.Length; i++)
        {
            if (string.Equals(SupportedValueTypes[i], type, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Whether the source opens with a <c>#version</c> directive.</summary>
    public static bool HasVersionDirective(ReadOnlySpan<char> source)
    {
        int index = SkipToStatement(source, 0);
        return index < source.Length &&
            source[index..].StartsWith("#version".AsSpan(), StringComparison.Ordinal);
    }

    /// <summary>
    /// Whether <paramref name="source"/> declares <paramref name="name"/> with the given
    /// declaration keyword (<c>uniform</c>, <c>in</c> or <c>out</c>). Mere use of a symbol is
    /// not a declaration, so reading a uniform never suppresses emitting it.
    /// </summary>
    public static bool Declares(ReadOnlySpan<char> source, string keyword, ReadOnlySpan<char> name)
    {
        ArgumentNullException.ThrowIfNull(keyword);
        int length = source.Length;
        for (int start = 0; start < length;)
        {
            int newline = source[start..].IndexOf('\n');
            int end = newline < 0 ? length : start + newline;
            if (StatementDeclares(source[start..end], keyword.AsSpan(), name))
            {
                return true;
            }

            start = end + 1;
        }

        return false;
    }

    /// <summary>Formats one attribute declaration, keeping an explicit location when present.</summary>
    public static string FormatAttribute(in ShaderAttributeDefinition attribute)
    {
        StringBuilder builder = new(64);
        if (attribute.Location is { } location)
        {
            builder
                .Append("layout(location = ")
                .Append(location.ToString(CultureInfo.InvariantCulture))
                .Append(") ");
        }

        builder.Append(InputKeyword).Append(' ').Append(attribute.Type).Append(' ').Append(attribute.Name.Name).Append(';');
        return builder.ToString();
    }

    /// <summary>Formats one interface declaration for the requested direction.</summary>
    public static string FormatInterface(ShaderStageTag stage, in ShaderInterfaceDefinition value, bool output)
    {
        StringBuilder builder = new(48);
        bool interpolationApplies = output
            ? stage == ShaderStageTag.Vertex
            : stage == ShaderStageTag.Fragment;

        if (interpolationApplies)
        {
            switch (value.Interpolation)
            {
                case ShaderInterpolation.Flat:
                    builder.Append("flat ");
                    break;
                case ShaderInterpolation.NoPerspective:
                    builder.Append("noperspective ");
                    break;
                default:
                    break;
            }
        }

        builder
            .Append(output ? OutputKeyword : InputKeyword)
            .Append(' ')
            .Append(value.Type)
            .Append(' ')
            .Append(value.Name.Name)
            .Append(';');
        return builder.ToString();
    }

    /// <summary>Formats one uniform declaration, including the array suffix when sized.</summary>
    public static string FormatUniform(in ShaderPropertyDefinition property)
    {
        StringBuilder builder = new(48);
        builder
            .Append(UniformKeyword)
            .Append(' ')
            .Append(property.Type)
            .Append(' ')
            .Append(property.Name.Name);
        if (property.ArrayLength > 0)
        {
            builder.Append('[').Append(property.ArrayLength.ToString(CultureInfo.InvariantCulture)).Append(']');
        }

        builder.Append(';');
        return builder.ToString();
    }

    /// <summary>
    /// Collects the declarations the metadata requires and the stage source does not already
    /// carry. Entries that contradict each other are reported once and the first wins.
    /// </summary>
    /// <param name="effect">Effect definition providing the metadata.</param>
    /// <param name="stage">Stage the collected lines belong to.</param>
    /// <param name="stageSource">Raw stage source scanned for existing declarations.</param>
    /// <param name="sink">Optional sink receiving conflict and type diagnostics.</param>
    /// <returns>The declaration lines still missing from the stage.</returns>
    public static ShaderDeclarationSet Collect(
        in ShaderEffectDefinition effect,
        ShaderStageTag stage,
        ReadOnlySpan<char> stageSource,
        ShaderDiagnosticSink? sink = null)
    {
        ImmutableArray<string>.Builder attributes = ImmutableArray.CreateBuilder<string>();
        ImmutableArray<string>.Builder inputs = ImmutableArray.CreateBuilder<string>();
        ImmutableArray<string>.Builder outputs = ImmutableArray.CreateBuilder<string>();
        ImmutableArray<string>.Builder uniforms = ImmutableArray.CreateBuilder<string>();

        if (stage == ShaderStageTag.Vertex)
        {
            CollectAttributes(effect, stageSource, attributes, sink);
        }

        if (stage is ShaderStageTag.Vertex or ShaderStageTag.Fragment)
        {
            CollectInterfaces(effect, stage, stageSource, inputs, outputs, sink);
        }

        CollectUniforms(effect, stage, stageSource, uniforms, sink);

        return new ShaderDeclarationSet(
            attributes.ToImmutable(),
            inputs.ToImmutable(),
            outputs.ToImmutable(),
            uniforms.ToImmutable());
    }

    private static void CollectAttributes(
        in ShaderEffectDefinition effect,
        ReadOnlySpan<char> stageSource,
        ImmutableArray<string>.Builder lines,
        ShaderDiagnosticSink? sink)
    {
        ImmutableArray<ShaderAttributeDefinition> attributes = effect.Attributes;
        if (attributes.IsDefaultOrEmpty)
        {
            return;
        }

        Dictionary<string, string> seen = new(StringComparer.Ordinal);
        for (int i = 0; i < attributes.Length; i++)
        {
            ShaderAttributeDefinition attribute = attributes[i];
            string name = attribute.Name.Name;
            if (!IsValidIdentifier(name))
            {
                Report(sink, InvalidNameCode, effect.Id, $"Attribute '{name}' is not a GLSL identifier.");
                continue;
            }

            if (!IsSupportedValueType(attribute.Type))
            {
                Report(sink, UnsupportedTypeCode, effect.Id,
                    $"Attribute '{name}' declares unsupported type '{attribute.Type}'.");
                continue;
            }

            string line = FormatAttribute(attribute);
            if (seen.TryGetValue(name, out string? previous))
            {
                if (!string.Equals(previous, line, StringComparison.Ordinal))
                {
                    Report(sink, ConflictingAttributeCode, effect.Id,
                        $"Attribute '{name}' is declared twice with different types or locations.");
                }

                continue;
            }

            seen[name] = line;
            if (!Declares(stageSource, InputKeyword, name.AsSpan()))
            {
                lines.Add(line);
            }
        }
    }

    private static void CollectInterfaces(
        in ShaderEffectDefinition effect,
        ShaderStageTag stage,
        ReadOnlySpan<char> stageSource,
        ImmutableArray<string>.Builder inputs,
        ImmutableArray<string>.Builder outputs,
        ShaderDiagnosticSink? sink)
    {
        ShaderStageDefinition stageDefinition = StageOf(effect, stage);
        Dictionary<string, string> seenInputs = new(StringComparer.Ordinal);
        Dictionary<string, string> seenOutputs = new(StringComparer.Ordinal);

        if (stage == ShaderStageTag.Vertex)
        {
            AppendInterfaces(stageDefinition.Inputs, stage, output: false, stageSource, inputs, seenInputs, effect, sink);
            AppendInterfaces(effect.Varyings, stage, output: true, stageSource, outputs, seenOutputs, effect, sink);
            AppendInterfaces(stageDefinition.Outputs, stage, output: true, stageSource, outputs, seenOutputs, effect, sink);
            return;
        }

        AppendInterfaces(effect.Varyings, stage, output: false, stageSource, inputs, seenInputs, effect, sink);
        AppendInterfaces(stageDefinition.Inputs, stage, output: false, stageSource, inputs, seenInputs, effect, sink);
        AppendInterfaces(stageDefinition.Outputs, stage, output: true, stageSource, outputs, seenOutputs, effect, sink);
    }

    private static void AppendInterfaces(
        ImmutableArray<ShaderInterfaceDefinition> values,
        ShaderStageTag stage,
        bool output,
        ReadOnlySpan<char> stageSource,
        ImmutableArray<string>.Builder lines,
        Dictionary<string, string> seen,
        in ShaderEffectDefinition effect,
        ShaderDiagnosticSink? sink)
    {
        if (values.IsDefaultOrEmpty)
        {
            return;
        }

        string keyword = output ? OutputKeyword : InputKeyword;
        for (int i = 0; i < values.Length; i++)
        {
            ShaderInterfaceDefinition value = values[i];
            string name = value.Name.Name;
            if (!IsValidIdentifier(name))
            {
                Report(sink, InvalidNameCode, effect.Id, $"Interface '{name}' is not a GLSL identifier.");
                continue;
            }

            if (!IsSupportedValueType(value.Type))
            {
                Report(sink, UnsupportedTypeCode, effect.Id,
                    $"Interface '{name}' declares unsupported type '{value.Type}'.");
                continue;
            }

            string line = FormatInterface(stage, in value, output);
            if (seen.TryGetValue(name, out string? previous))
            {
                if (!string.Equals(previous, line, StringComparison.Ordinal))
                {
                    Report(sink, ConflictingInterfaceCode, effect.Id,
                        $"Interface '{name}' is declared twice with different types.");
                }

                continue;
            }

            seen[name] = line;
            if (!Declares(stageSource, keyword, name.AsSpan()))
            {
                lines.Add(line);
            }
        }
    }

    private static void CollectUniforms(
        in ShaderEffectDefinition effect,
        ShaderStageTag stage,
        ReadOnlySpan<char> stageSource,
        ImmutableArray<string>.Builder lines,
        ShaderDiagnosticSink? sink)
    {
        ImmutableArray<ShaderPropertyDefinition> properties = effect.Properties;
        if (properties.IsDefaultOrEmpty)
        {
            return;
        }

        Dictionary<string, string> seen = new(StringComparer.Ordinal);
        for (int i = 0; i < properties.Length; i++)
        {
            ShaderPropertyDefinition property = properties[i];
            if (!DeclaresInStage(property, stage))
            {
                continue;
            }

            string name = property.Name.Name;
            if (!IsValidIdentifier(name))
            {
                Report(sink, InvalidNameCode, effect.Id, $"Property '{name}' is not a GLSL identifier.");
                continue;
            }

            if (!IsSupportedValueType(property.Type))
            {
                Report(sink, UnsupportedTypeCode, effect.Id,
                    $"Property '{name}' declares unsupported type '{property.Type}'.");
                continue;
            }

            if (property.ArrayLength < 0)
            {
                Report(sink, UnsupportedTypeCode, effect.Id,
                    $"Property '{name}' declares negative array length {property.ArrayLength}.");
                continue;
            }

            string line = FormatUniform(property);
            if (seen.TryGetValue(name, out string? previous))
            {
                if (!string.Equals(previous, line, StringComparison.Ordinal))
                {
                    Report(sink, ConflictingUniformCode, effect.Id,
                        $"Uniform '{name}' is declared twice with different types.");
                }

                continue;
            }

            seen[name] = line;
            if (!Declares(stageSource, UniformKeyword, name.AsSpan()))
            {
                lines.Add(line);
            }
        }
    }

    private static bool DeclaresInStage(in ShaderPropertyDefinition property, ShaderStageTag stage)
    {
        ImmutableArray<ShaderStageTag> stages = property.Stages;
        if (stages.IsDefaultOrEmpty)
        {
            return true;
        }

        for (int i = 0; i < stages.Length; i++)
        {
            if (stages[i] == stage)
            {
                return true;
            }
        }

        return false;
    }

    private static bool StatementDeclares(ReadOnlySpan<char> statement, ReadOnlySpan<char> keyword, ReadOnlySpan<char> name)
    {
        int comment = statement.IndexOf("//", StringComparison.Ordinal);
        if (comment >= 0)
        {
            statement = statement[..comment];
        }

        int length = statement.Length;
        int phase = 0;
        int index = 0;

        while (index < length)
        {
            if (!IsIdentifierStart(statement[index]))
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
                    phase = token.SequenceEqual(keyword) ? 1 : 0;
                    break;
                case 1:
                    phase = 2;
                    break;
                default:
                    if (token.SequenceEqual(name))
                    {
                        return true;
                    }

                    phase = 0;
                    break;
            }
        }

        return false;
    }

    private static ShaderStageDefinition StageOf(in ShaderEffectDefinition effect, ShaderStageTag stage) =>
        stage == ShaderStageTag.Fragment ? effect.Fragment : effect.Vertex;

    private static int SkipToStatement(ReadOnlySpan<char> source, int index)
    {
        int length = source.Length;
        while (index < length)
        {
            ReadOnlySpan<char> rest = source[index..];
            if (rest.StartsWith("//".AsSpan(), StringComparison.Ordinal))
            {
                int newline = rest.IndexOf('\n');
                if (newline < 0)
                {
                    return length;
                }

                index += newline + 1;
                continue;
            }

            if (char.IsWhiteSpace(source[index]))
            {
                index++;
                continue;
            }

            return index;
        }

        return length;
    }

    private static bool IsValidIdentifier(string name)
    {
        if (name.Length == 0 || !IsIdentifierStart(name[0]))
        {
            return false;
        }

        for (int i = 1; i < name.Length; i++)
        {
            if (!IsIdentifierPart(name[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsIdentifierStart(char value) => char.IsAsciiLetter(value) || value == '_';

    private static bool IsIdentifierPart(char value) => char.IsAsciiLetterOrDigit(value) || value == '_';

    private static void Report(
        ShaderDiagnosticSink? sink,
        ShaderSymbol code,
        ShaderSymbol effectId,
        string message) =>
        sink?.ReportError(code, message, sourceId: effectId);
}
