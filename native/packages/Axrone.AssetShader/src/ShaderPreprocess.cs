namespace Axrone.AssetShader;

/// <summary>Macro lookup contract for the preprocessor.</summary>
public interface IMacroLookupPolicy
{
    /// <summary>Tries to resolve a numeric macro value.</summary>
    bool TryLookup(ShaderSymbol symbol, out long value);

    /// <summary>Whether the macro is defined.</summary>
    bool IsDefined(ShaderSymbol symbol);

    /// <summary>Tries to resolve macro replacement text.</summary>
    bool TryGetText(ShaderSymbol symbol, [NotNullWhen(true)] out string? text);

    /// <summary>Predefined object-like macros seeding #define state.</summary>
    ImmutableDictionary<ShaderSymbol, string> GetDefines() => ImmutableDictionary<ShaderSymbol, string>.Empty;
}

/// <summary>Empty macro environment: nothing defined.</summary>
public readonly struct EmptyMacroPolicy : IMacroLookupPolicy
{
    /// <inheritdoc/>
    public bool TryLookup(ShaderSymbol symbol, out long value)
    {
        value = 0;
        return false;
    }

    /// <inheritdoc/>
    public bool IsDefined(ShaderSymbol symbol) => false;

    /// <inheritdoc/>
    public bool TryGetText(ShaderSymbol symbol, [NotNullWhen(true)] out string? text)
    {
        text = null;
        return false;
    }
}

/// <summary>Immutable dictionary-backed macro environment.</summary>
public readonly struct ImmutableMacroEnvironment : IMacroLookupPolicy
{
    private readonly ImmutableDictionary<ShaderSymbol, string> _macros;

    /// <summary>Creates an environment.</summary>
    public ImmutableMacroEnvironment(ImmutableDictionary<ShaderSymbol, string> macros)
    {
        _macros = macros;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryLookup(ShaderSymbol symbol, out long value)
    {
        if (_macros.TryGetValue(symbol, out string? text))
        {
            if (long.TryParse(text.AsSpan(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                return true;
            }

            value = 1;
            return true;
        }

        value = 0;
        return false;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsDefined(ShaderSymbol symbol) => _macros.ContainsKey(symbol);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetText(ShaderSymbol symbol, [NotNullWhen(true)] out string? text) =>
        _macros.TryGetValue(symbol, out text);

    /// <inheritdoc/>
    public ImmutableDictionary<ShaderSymbol, string> GetDefines() => _macros;
}

/// <summary>Constant expression parser: expands macros, then evaluates.</summary>
/// <typeparam name="TLookup">Macro lookup type.</typeparam>
public ref struct SpanExpressionParser<TLookup>
    where TLookup : struct, IMacroLookupPolicy
{
    private readonly ReadOnlySpan<char> _span;
    private readonly TLookup _lookup;

    /// <summary>Creates a parser.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SpanExpressionParser(ReadOnlySpan<char> span, in TLookup lookup)
    {
        _span = span;
        _lookup = lookup;
    }

    /// <summary>Parses the expression.</summary>
    public long Parse()
    {
        var table = new ShaderMacroTable();
        table.Seed(_lookup.GetDefines());
        string expanded = table.Expand(table.ResolveDefined(_span.ToString(), in _lookup));
        return ConstantExpression.Evaluate(expanded);
    }
}

/// <summary>Lexical GLSL preprocessor: macros, conditionals and line markers.</summary>
public static class GLSLPreprocessor
{
    private struct BranchContext
    {
        public bool ConditionMet;
        public bool Active;
        public bool HadElse;
    }

    /// <summary>Preprocesses a source string.</summary>
    public static string Preprocess<TLookup>(
        string source,
        in TLookup lookup,
        ShaderDiagnosticSink sink,
        ShaderSymbol sourceId,
        bool preserveLineMarkers = false)
        where TLookup : struct, IMacroLookupPolicy
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(sink);

        var table = new ShaderMacroTable();
        table.Seed(lookup.GetDefines());

        List<(string Text, uint Line)> logical = BuildLogicalLines(StripComments(source));
        Span<BranchContext> branchStack = stackalloc BranchContext[32];
        int stackDepth = 0;

        var output = new List<(string Text, uint Line, bool Directive)>();

        foreach ((string text, uint line) in logical)
        {
            if (!TryParseDirectiveLine(text, out string name, out string rest))
            {
                if (IsEmitting(branchStack, stackDepth))
                {
                    output.Add((text, line, false));
                }

                continue;
            }

            switch (name)
            {
                case "if":
                    {
                        bool parentActive = IsEmitting(branchStack, stackDepth);
                        bool cond = parentActive && EvaluateCondition(rest, table, lookup) != 0;
                        if (stackDepth >= branchStack.Length)
                        {
                            ThrowHelper.ThrowPreprocessorStackOverflow();
                        }

                        branchStack[stackDepth++] = new BranchContext
                        {
                            ConditionMet = cond,
                            Active = parentActive && cond,
                            HadElse = false,
                        };

                        break;
                    }

                case "ifdef":
                    {
                        bool parentActive = IsEmitting(branchStack, stackDepth);
                        bool exists = parentActive && (table.IsDefined(rest.Trim()) || lookup.IsDefined(new ShaderSymbol(rest.Trim())));
                        if (stackDepth >= branchStack.Length)
                        {
                            ThrowHelper.ThrowPreprocessorStackOverflow();
                        }

                        branchStack[stackDepth++] = new BranchContext
                        {
                            ConditionMet = exists,
                            Active = parentActive && exists,
                            HadElse = false,
                        };

                        break;
                    }

                case "ifndef":
                    {
                        bool parentActive = IsEmitting(branchStack, stackDepth);
                        string target = rest.Trim();
                        bool missing = parentActive && !table.IsDefined(target) && !lookup.IsDefined(new ShaderSymbol(target));
                        if (stackDepth >= branchStack.Length)
                        {
                            ThrowHelper.ThrowPreprocessorStackOverflow();
                        }

                        branchStack[stackDepth++] = new BranchContext
                        {
                            ConditionMet = missing,
                            Active = parentActive && missing,
                            HadElse = false,
                        };

                        break;
                    }

                case "elif":
                    {
                        if (stackDepth == 0)
                        {
                            sink.ReportError("ERR_UNEXPECTED_ELIF", "#elif without matching #if",
                                new SourceLocation(line, 1), sourceId);
                            break;
                        }

                        ref BranchContext current = ref branchStack[stackDepth - 1];
                        if (current.HadElse)
                        {
                            sink.ReportError("ERR_ELIF_AFTER_ELSE", "#elif after #else is forbidden",
                                new SourceLocation(line, 1), sourceId);
                            break;
                        }

                        bool parentActive = stackDepth <= 1 || branchStack[stackDepth - 2].Active;
                        bool cond = parentActive && !current.ConditionMet && EvaluateCondition(rest, table, lookup) != 0;
                        current.Active = cond;
                        if (cond)
                        {
                            current.ConditionMet = true;
                        }

                        break;
                    }

                case "else":
                    {
                        if (stackDepth == 0)
                        {
                            sink.ReportError("ERR_UNEXPECTED_ELSE", "#else without matching #if",
                                new SourceLocation(line, 1), sourceId);
                            break;
                        }

                        ref BranchContext current = ref branchStack[stackDepth - 1];
                        if (current.HadElse)
                        {
                            sink.ReportError("ERR_DUPLICATE_ELSE", "Duplicate #else block encountered",
                                new SourceLocation(line, 1), sourceId);
                            break;
                        }

                        bool parentActive = stackDepth <= 1 || branchStack[stackDepth - 2].Active;
                        current.Active = parentActive && !current.ConditionMet;
                        current.ConditionMet = true;
                        current.HadElse = true;
                        break;
                    }

                case "endif":
                    {
                        if (stackDepth == 0)
                        {
                            sink.ReportError("ERR_UNEXPECTED_ENDIF", "#endif without matching #if",
                                new SourceLocation(line, 1), sourceId);
                            break;
                        }

                        stackDepth--;
                        break;
                    }

                case "define":
                    {
                        if (IsEmitting(branchStack, stackDepth))
                        {
                            var (macroName, macroRest) = SplitDefineName(rest);
                            if (macroName.Length != 0)
                            {
                                table.Define(macroName, ShaderMacroTable.ParseDefine(macroRest, macroName));
                            }
                        }

                        break;
                    }

                case "undef":
                    {
                        if (IsEmitting(branchStack, stackDepth))
                        {
                            table.Undefine(rest.Trim());
                        }

                        break;
                    }

                case "error":
                    {
                        if (IsEmitting(branchStack, stackDepth))
                        {
                            sink.ReportError("ERR_USER_DIRECTIVE", rest.Trim().Length != 0 ? rest.Trim() : "#error",
                                new SourceLocation(line, 1), sourceId);
                        }

                        break;
                    }

                case "version":
                case "extension":
                case "pragma":
                case "line":
                default:
                    {
                        if (IsEmitting(branchStack, stackDepth))
                        {
                            output.Add((text.TrimStart(), line, true));
                        }

                        break;
                    }
            }
        }

        if (stackDepth > 0)
        {
            sink.ReportError("ERR_UNTERMINATED_CONDITIONAL", "Unterminated #if directive block",
                new SourceLocation(logical.Count > 0 ? logical[^1].Line : 1, 1), sourceId);
        }

        var assembled = new StringBuilder(source.Length);
        uint lastEmittedLine = 0;
        bool first = true;
        foreach ((string text, uint line, bool directive) in output)
        {
            string expanded = directive ? text : table.Expand(text);
            if (preserveLineMarkers && (lastEmittedLine == 0 || line != lastEmittedLine + 1))
            {
                if (!first)
                {
                    assembled.Append('\n');
                }

                first = false;
                assembled.Append("#line ").Append(line).Append(" \"").Append(sourceId.Name).Append('\"');
            }

            if (!first)
            {
                assembled.Append('\n');
            }

            first = false;
            assembled.Append(expanded);
            lastEmittedLine = line;
        }

        if (sink.HasErrors)
        {
            throw new ShaderPreprocessException(sink.Diagnostics);
        }

        return assembled.ToString();
    }

    private static bool IsEmitting(Span<BranchContext> branchStack, int stackDepth) =>
        stackDepth == 0 || branchStack[stackDepth - 1].Active;

    private static long EvaluateCondition<TLookup>(string expression, ShaderMacroTable table, in TLookup lookup)
        where TLookup : struct, IMacroLookupPolicy =>
        ConstantExpression.Evaluate(table.Expand(table.ResolveDefined(expression, in lookup)));

    private static (string Name, string Remainder) SplitDefineName(string rest)
    {
        int index = 0;
        while (index < rest.Length && ShaderMacroTable.IsIdentStart(rest[index]))
        {
            index++;
        }

        while (index < rest.Length && ShaderMacroTable.IsIdentPart(rest[index]))
        {
            index++;
        }

        return index == 0 ? (string.Empty, rest) : (rest[..index], rest[index..]);
    }

    private static bool TryParseDirectiveLine(string line, out string name, out string rest)
    {
        name = string.Empty;
        rest = string.Empty;

        int index = 0;
        while (index < line.Length && char.IsWhiteSpace(line[index]))
        {
            index++;
        }

        if (index >= line.Length || line[index] != '#')
        {
            return false;
        }

        index++;
        while (index < line.Length && char.IsWhiteSpace(line[index]))
        {
            index++;
        }

        int start = index;
        if (index < line.Length && (char.IsLetter(line[index]) || line[index] == '_'))
        {
            index++;
            while (index < line.Length && (char.IsLetterOrDigit(line[index]) || line[index] == '_'))
            {
                index++;
            }

            name = line[start..index];
            rest = line[index..].Trim();
            return true;
        }

        rest = line[start..].Trim();
        return true;
    }

    internal static string StripComments(string source)
    {
        var output = new StringBuilder(source.Length);
        int index = 0;
        CommentState state = CommentState.Code;

        while (index < source.Length)
        {
            char c = source[index];
            char next = index + 1 < source.Length ? source[index + 1] : '\0';

            switch (state)
            {
                case CommentState.Code:
                    if (c == '/' && next == '/')
                    {
                        state = CommentState.Line;
                        output.Append("  ");
                        index += 2;
                    }
                    else if (c == '/' && next == '*')
                    {
                        state = CommentState.Block;
                        output.Append("  ");
                        index += 2;
                    }
                    else
                    {
                        output.Append(c);
                        index++;
                    }

                    break;

                case CommentState.Line:
                    if (c == '\n')
                    {
                        state = CommentState.Code;
                        output.Append(c);
                    }
                    else
                    {
                        output.Append(' ');
                    }

                    index++;
                    break;

                default:
                    if (c == '*' && next == '/')
                    {
                        state = CommentState.Code;
                        output.Append("  ");
                        index += 2;
                    }
                    else
                    {
                        output.Append(c == '\n' ? c : ' ');
                        index++;
                    }

                    break;
            }
        }

        return output.ToString();
    }

    private enum CommentState : byte
    {
        Code = 0,
        Line = 1,
        Block = 2,
    }

    internal static List<(string Text, uint Line)> BuildLogicalLines(string source)
    {
        string[] physical = source.Split('\n');
        var logical = new List<(string Text, uint Line)>(physical.Length);

        int index = 0;
        while (index < physical.Length)
        {
            string text = physical[index];
            uint startLine = (uint)index + 1;
            while (text.EndsWith('\\') && index + 1 < physical.Length)
            {
                text = text[..^1] + physical[index + 1];
                index++;
            }

            logical.Add((text, startLine));
            index++;
        }

        return logical;
    }
}

/// <summary>One scanned uniform declaration.</summary>
public readonly record struct ShaderUniformScanResult(
    ShaderSymbol Name,
    ShaderSymbol Type,
    int ArrayLength);

/// <summary>Allocation-free uniform declaration scanner.</summary>
public static class UniformExtractor
{
    /// <summary>Scans both stages without duplicates.</summary>
    public static ImmutableArray<ShaderUniformScanResult> ScanUniforms(ReadOnlySpan<char> vtx, ReadOnlySpan<char> frag)
    {
        ImmutableArray<ShaderUniformScanResult>.Builder builder = ImmutableArray.CreateBuilder<ShaderUniformScanResult>();
        ScanStage(vtx, builder);
        ScanStage(frag, builder);
        return builder.ToImmutable();
    }

    private static void ScanStage(ReadOnlySpan<char> code, ImmutableArray<ShaderUniformScanResult>.Builder builder)
    {
        var enumerator = new SpanLineEnumerator(code);
        while (enumerator.MoveNext())
        {
            ReadOnlySpan<char> line = enumerator.Current;
            if (TryParseUniformDeclaration(line, out ReadOnlySpan<char> type, out ReadOnlySpan<char> name, out int arrLen))
            {
                var uniformName = new ShaderSymbol(name);
                bool exists = false;
                for (int i = 0; i < builder.Count; i++)
                {
                    if (builder[i].Name == uniformName)
                    {
                        exists = true;
                        break;
                    }
                }

                if (!exists)
                {
                    builder.Add(new ShaderUniformScanResult(uniformName, new ShaderSymbol(type), arrLen));
                }
            }
        }
    }

    /// <summary>Parses a uniform declaration line.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool TryParseUniformDeclaration(
        ReadOnlySpan<char> line,
        out ReadOnlySpan<char> type,
        out ReadOnlySpan<char> name,
        out int arrayLength)
    {
        type = default;
        name = default;
        arrayLength = 0;

        ReadOnlySpan<char> trimmed = line.Trim();
        if (!trimmed.StartsWith("uniform", StringComparison.Ordinal))
        {
            return false;
        }

        if (trimmed.Length <= 7 || !char.IsWhiteSpace(trimmed[7]))
        {
            return false;
        }

        ReadOnlySpan<char> rest = trimmed[7..].TrimStart();
        int spaceIdx = rest.IndexOfAny(' ', '\t');
        if (spaceIdx <= 0)
        {
            return false;
        }

        type = rest[..spaceIdx];
        rest = rest[spaceIdx..].TrimStart();

        int semiIdx = rest.IndexOf(';');
        if (semiIdx < 0)
        {
            return false;
        }

        ReadOnlySpan<char> namePart = rest[..semiIdx].TrimEnd();
        int bracketOpen = namePart.IndexOf('[');
        if (bracketOpen >= 0)
        {
            int bracketClose = namePart.IndexOf(']');
            if (bracketClose > bracketOpen)
            {
                ReadOnlySpan<char> lenSpan = namePart.Slice(bracketOpen + 1, bracketClose - bracketOpen - 1).Trim();
                int.TryParse(lenSpan, NumberStyles.Integer, CultureInfo.InvariantCulture, out arrayLength);
                name = namePart[..bracketOpen].TrimEnd();
                return true;
            }
        }

        name = namePart;
        return true;
    }
}

