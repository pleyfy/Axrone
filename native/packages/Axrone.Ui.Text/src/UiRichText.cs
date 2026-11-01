namespace Axrone.Ui.Text;

/// <summary>Rich-text failure classification.</summary>
public enum UiRichTextErrorCode
{
    /// <summary>No failure.</summary>
    None,

    /// <summary>The plain-text destination cannot hold the stripped markup.</summary>
    OutputTooSmall,

    /// <summary>A tag is empty or malformed.</summary>
    MalformedTag,

    /// <summary>A tag name is not recognized.</summary>
    UnknownTag,

    /// <summary>A closing tag appeared without a matching open tag.</summary>
    UnexpectedCloseTag,

    /// <summary>A closing tag does not match the innermost open tag.</summary>
    MismatchedTag,

    /// <summary>An open tag was not closed.</summary>
    UnclosedTag,

    /// <summary>A tag attribute is missing or not allowed.</summary>
    InvalidAttribute,

    /// <summary>A color value is malformed.</summary>
    InvalidColor,

    /// <summary>A size value is malformed or outside the supported range.</summary>
    InvalidSize,

    /// <summary>Nesting exceeds the depth limit.</summary>
    TooDeep,

    /// <summary>The run limit was exceeded.</summary>
    TooManyRuns,
}

/// <summary>Rich-text failure with an offset into the markup.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiRichTextError(UiRichTextErrorCode Code, int Offset, string Message)
{
    /// <summary>Gets the success sentinel.</summary>
    public static UiRichTextError None => new(UiRichTextErrorCode.None, -1, string.Empty);

    /// <summary>Gets whether this value describes a failure.</summary>
    public bool HasError => Code != UiRichTextErrorCode.None;
}

/// <summary>Style overrides carried by one rich-text run.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiRichTextStyle(
    bool Bold,
    bool Italic,
    bool HasSize,
    float Size,
    bool HasColor,
    UiColor Color,
    bool HasColorToken,
    UiThemeTokenId ColorToken)
{
    /// <summary>Gets the default inherited style.</summary>
    public static UiRichTextStyle Default => default;
}

/// <summary>One contiguous plain-text run and its style overrides.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiRichTextRun(int Start, int Length, int SpanIndex, UiRichTextStyle Style);

/// <summary>
/// Allocation-free rich-text parser. Supported tags: <c>b</c>, <c>i</c>,
/// <c>color=#rgb/#rgba/#rrggbb/#rrggbbaa|token:N</c> and <c>size=N</c>.
/// Nesting is validated; literal '&lt;' must be escaped as '\&lt;'.
/// </summary>
public static class UiRichTextParser
{
    /// <summary>Maximum nested tag depth.</summary>
    public const int MaxDepth = 16;

    /// <summary>Maximum number of emitted runs.</summary>
    public const int MaxRuns = 1024;

    /// <summary>Maximum supported explicit size.</summary>
    public const float MaxSize = 4096.0f;

    /// <summary>Parses markup into plain text and styled runs.</summary>
    public static bool TryParse(
        ReadOnlySpan<char> markup,
        Span<char> plainText,
        Span<UiRichTextRun> runs,
        out int plainLength,
        out int runCount,
        out UiRichTextError error)
    {
        plainLength = 0;
        runCount = 0;
        error = UiRichTextError.None;

        if (plainText.Length < markup.Length)
        {
            error = new UiRichTextError(UiRichTextErrorCode.OutputTooSmall, 0, "The plain-text destination is too small.");
            return false;
        }

        Span<UiRichTextStyle> frames = stackalloc UiRichTextStyle[MaxDepth];
        Span<byte> frameTags = stackalloc byte[MaxDepth];
        UiRichTextStyle current = UiRichTextStyle.Default;
        int depth = 0;
        int written = 0;
        int runStart = 0;
        int index = 0;
        int runTotal = 0;

        while (index < markup.Length)
        {
            char character = markup[index];
            if (character == '\\')
            {
                if (index + 1 < markup.Length &&
                    (markup[index + 1] == '<' || markup[index + 1] == '>' || markup[index + 1] == '\\'))
                {
                    plainText[written++] = markup[index + 1];
                    index += 2;
                    continue;
                }

                plainText[written++] = '\\';
                index++;
                continue;
            }

            if (character != '<')
            {
                plainText[written++] = character;
                index++;
                continue;
            }

            if (!TryParseTag(
                    markup,
                    index,
                    in current,
                    out int tagEnd,
                    out UiRichTagKind kind,
                    out bool closing,
                    out UiRichTextStyle applied,
                    out UiRichTextError tagError))
            {
                error = tagError;
                return false;
            }

            if (!FlushRun(written, runStart, current, runs, ref runTotal, index, out error))
            {
                return false;
            }

            if (closing)
            {
                if (depth == 0)
                {
                    error = new UiRichTextError(UiRichTextErrorCode.UnexpectedCloseTag, index, "Closing tag has no open tag.");
                    return false;
                }

                if (frameTags[depth - 1] != (byte)kind)
                {
                    error = new UiRichTextError(UiRichTextErrorCode.MismatchedTag, index, "Closing tag does not match the innermost open tag.");
                    return false;
                }

                depth--;
                current = frames[depth];
            }
            else
            {
                if (depth >= MaxDepth)
                {
                    error = new UiRichTextError(UiRichTextErrorCode.TooDeep, index, "Rich-text nesting exceeds the depth limit.");
                    return false;
                }

                frames[depth] = current;
                frameTags[depth] = (byte)kind;
                depth++;
                current = applied;
            }

            index = tagEnd + 1;
            runStart = written;
        }

        if (depth != 0)
        {
            error = new UiRichTextError(UiRichTextErrorCode.UnclosedTag, markup.Length, "An open tag was not closed.");
            return false;
        }

        if (!FlushRun(written, runStart, current, runs, ref runTotal, markup.Length, out error))
        {
            return false;
        }

        plainLength = written;
        runCount = runTotal;
        return true;
    }

    private static bool FlushRun(
        int written,
        int runStart,
        in UiRichTextStyle style,
        Span<UiRichTextRun> runs,
        ref int runCount,
        int offset,
        out UiRichTextError error)
    {
        error = UiRichTextError.None;
        if (written <= runStart)
        {
            return true;
        }

        if (runCount >= runs.Length || runCount >= MaxRuns)
        {
            error = new UiRichTextError(UiRichTextErrorCode.TooManyRuns, offset, "The rich-text run limit was exceeded.");
            return false;
        }

        runs[runCount] = new UiRichTextRun(runStart, written - runStart, runCount, style);
        runCount++;
        return true;
    }

    private static bool TryParseTag(
        ReadOnlySpan<char> markup,
        int start,
        in UiRichTextStyle current,
        out int tagEnd,
        out UiRichTagKind kind,
        out bool closing,
        out UiRichTextStyle applied,
        out UiRichTextError error)
    {
        tagEnd = -1;
        kind = default;
        closing = false;
        applied = UiRichTextStyle.Default;
        error = UiRichTextError.None;

        int relativeEnd = markup[(start + 1)..].IndexOf('>');
        if (relativeEnd < 0)
        {
            error = new UiRichTextError(UiRichTextErrorCode.MalformedTag, start, "Tag terminator is missing.");
            return false;
        }

        tagEnd = start + 1 + relativeEnd;
        ReadOnlySpan<char> body = markup[(start + 1)..tagEnd];
        body = body.Trim();
        if (body.IsEmpty)
        {
            error = new UiRichTextError(UiRichTextErrorCode.MalformedTag, start, "Tag is empty.");
            return false;
        }

        if (body[0] == '/')
        {
            closing = true;
            body = body[1..].TrimStart();
            if (body.IsEmpty)
            {
                error = new UiRichTextError(UiRichTextErrorCode.MalformedTag, start, "Closing tag has no name.");
                return false;
            }
        }

        int equals = body.IndexOf('=');
        ReadOnlySpan<char> name = (equals >= 0 ? body[..equals] : body).Trim();
        ReadOnlySpan<char> value = equals >= 0 ? body[(equals + 1)..].Trim() : ReadOnlySpan<char>.Empty;
        if (name.IsEmpty)
        {
            error = new UiRichTextError(UiRichTextErrorCode.MalformedTag, start, "Tag name is missing.");
            return false;
        }

        if (!TryGetKind(name, out kind))
        {
            error = new UiRichTextError(UiRichTextErrorCode.UnknownTag, start, "Tag name is not supported.");
            return false;
        }

        if (closing)
        {
            if (equals >= 0)
            {
                error = new UiRichTextError(UiRichTextErrorCode.InvalidAttribute, start, "Closing tags cannot carry attributes.");
                return false;
            }

            return true;
        }

        if (kind == UiRichTagKind.Bold)
        {
            if (equals >= 0)
            {
                error = new UiRichTextError(UiRichTextErrorCode.InvalidAttribute, start, "The bold tag takes no attribute.");
                return false;
            }

            applied = current with { Bold = true };
            return true;
        }

        if (kind == UiRichTagKind.Italic)
        {
            if (equals >= 0)
            {
                error = new UiRichTextError(UiRichTextErrorCode.InvalidAttribute, start, "The italic tag takes no attribute.");
                return false;
            }

            applied = current with { Italic = true };
            return true;
        }

        if (value.IsEmpty)
        {
            error = new UiRichTextError(UiRichTextErrorCode.InvalidAttribute, start, "The tag requires an attribute value.");
            return false;
        }

        if (kind == UiRichTagKind.Color)
        {
            if (value.StartsWith("token:", StringComparison.OrdinalIgnoreCase))
            {
                if (!uint.TryParse(
                        value[6..],
                        System.Globalization.NumberStyles.None,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out uint token) ||
                    token == 0)
                {
                    error = new UiRichTextError(UiRichTextErrorCode.InvalidColor, start, "Theme token color is invalid.");
                    return false;
                }

                applied = current with
                {
                    HasColorToken = true,
                    ColorToken = new UiThemeTokenId(token),
                    HasColor = false,
                };
                return true;
            }

            if (!TryParseColor(value, out UiColor color))
            {
                error = new UiRichTextError(UiRichTextErrorCode.InvalidColor, start, "Color must be #rgb, #rgba, #rrggbb or #rrggbbaa.");
                return false;
            }

            applied = current with { HasColor = true, Color = color, HasColorToken = false };
            return true;
        }

        if (!float.TryParse(
                value,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out float size) ||
            !float.IsFinite(size) ||
            size <= 0.0f ||
            size > MaxSize)
        {
            error = new UiRichTextError(UiRichTextErrorCode.InvalidSize, start, "Size must be finite, positive and within the supported limit.");
            return false;
        }

        applied = current with { HasSize = true, Size = size };
        return true;
    }

    private static bool TryGetKind(ReadOnlySpan<char> name, out UiRichTagKind kind)
    {
        if (name.Equals("b", StringComparison.OrdinalIgnoreCase))
        {
            kind = UiRichTagKind.Bold;
            return true;
        }

        if (name.Equals("i", StringComparison.OrdinalIgnoreCase))
        {
            kind = UiRichTagKind.Italic;
            return true;
        }

        if (name.Equals("color", StringComparison.OrdinalIgnoreCase))
        {
            kind = UiRichTagKind.Color;
            return true;
        }

        if (name.Equals("size", StringComparison.OrdinalIgnoreCase))
        {
            kind = UiRichTagKind.Size;
            return true;
        }

        kind = default;
        return false;
    }

    private static bool TryParseColor(ReadOnlySpan<char> text, out UiColor color)
    {
        color = UiColor.Transparent;
        if (text.Length < 4 || text[0] != '#')
        {
            return false;
        }

        ReadOnlySpan<char> digits = text[1..];
        int stride = digits.Length is 3 or 4 ? 1 : 2;
        if (digits.Length != stride * 3 && digits.Length != stride * 4)
        {
            return false;
        }

        Span<float> channels = stackalloc float[4];
        int count = digits.Length / stride;
        for (int i = 0; i < count; i++)
        {
            int value = 0;
            for (int j = 0; j < stride; j++)
            {
                int nibble = HexValue(digits[(i * stride) + j]);
                if (nibble < 0)
                {
                    return false;
                }

                value = (value << 4) | nibble;
            }

            channels[i] = stride == 1 ? (value * 17) / 255.0f : value / 255.0f;
        }

        color = new UiColor(channels[0], channels[1], channels[2], count == 4 ? channels[3] : 1.0f);
        return true;
    }

    private static int HexValue(char value) => value switch
    {
        >= '0' and <= '9' => value - '0',
        >= 'a' and <= 'f' => value - 'a' + 10,
        >= 'A' and <= 'F' => value - 'A' + 10,
        _ => -1,
    };

    private enum UiRichTagKind : byte
    {
        Bold = 1,
        Italic = 2,
        Color = 3,
        Size = 4,
    }
}

/// <summary>Resolves rich-text run overrides against a base text style.</summary>
public static class UiRichTextStyleResolver
{
    /// <summary>Resolves face, size and color for one run.</summary>
    public static bool TryResolve(
        UiFontProvider provider,
        UiFontFamilyId family,
        string? locale,
        in UiTextStyle baseStyle,
        in UiRichTextStyle runStyle,
        IUiTheme? theme,
        out UiTextStyle textStyle,
        out UiColor color,
        out bool hasColor)
    {
        ArgumentNullException.ThrowIfNull(provider);
        textStyle = baseStyle;
        color = default;
        hasColor = false;

        if (!provider.TryGetFace(baseStyle.Face, out UiFontFace? baseFace))
        {
            return false;
        }

        UiFontWeight weight = runStyle.Bold ? UiFontWeight.Bold : baseFace.Weight;
        UiFontStyle fontStyle = runStyle.Italic ? UiFontStyle.Italic : baseFace.Style;
        UiFontFamilyId queryFamily = family.IsValid ? family : baseFace.Family;
        UiFontFaceId face = baseStyle.Face;
        if (provider.TryGetFace(new UiFontQuery(queryFamily, weight, fontStyle, locale ?? string.Empty), out UiFontFaceId resolved))
        {
            face = resolved;
        }

        float size = runStyle.HasSize ? runStyle.Size : baseStyle.Size;
        textStyle = baseStyle with { Face = face, Size = size };

        if (runStyle.HasColor)
        {
            color = runStyle.Color;
            hasColor = true;
        }
        else if (runStyle.HasColorToken &&
                 theme is not null &&
                 theme.TryGetColor(runStyle.ColorToken, out UiColor tokenColor))
        {
            color = tokenColor;
            hasColor = true;
        }

        return true;
    }
}
