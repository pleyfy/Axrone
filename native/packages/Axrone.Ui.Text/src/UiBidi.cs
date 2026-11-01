namespace Axrone.Ui.Text;

internal enum UiBidiClass : byte
{
    L,
    R,
    AL,
    EN,
    AN,
    ES,
    ET,
    CS,
    NSM,
    BN,
    B,
    S,
    WS,
    ON,
    LRE,
    RLE,
    LRO,
    RLO,
    PDF,
    LRI,
    RLI,
    FSI,
    PDI,
}

internal static class UiBidi
{
    private const int MaxDepth = 128;
    private const int MaxBracketDepth = 64;

    private static readonly int[] BracketOpen =
    [
        0x0028, 0x005B, 0x007B, 0x00AB, 0x2039, 0x2045, 0x207D, 0x208D,
        0x2329, 0x3008, 0x300A, 0x300C, 0x300E, 0x3010, 0x3014, 0x3016,
        0x3018, 0x301A, 0xFE59, 0xFE5B, 0xFE5D, 0xFF08, 0xFF3B, 0xFF5B,
        0xFF62,
    ];

    private static readonly int[] BracketClose =
    [
        0x0029, 0x005D, 0x007D, 0x00BB, 0x203A, 0x2046, 0x207E, 0x208E,
        0x232A, 0x3009, 0x300B, 0x300D, 0x300F, 0x3011, 0x3015, 0x3017,
        0x3019, 0x301B, 0xFE5A, 0xFE5C, 0xFE5E, 0xFF09, 0xFF3D, 0xFF5D,
        0xFF63,
    ];

    public static byte ResolveBaseLevel(UiTextDirection direction, ReadOnlySpan<int> codepoints)
    {
        if (direction == UiTextDirection.Ltr)
        {
            return 0;
        }

        if (direction == UiTextDirection.Rtl)
        {
            return 1;
        }

        int isolateDepth = 0;
        for (int i = 0; i < codepoints.Length; i++)
        {
            UiBidiClass type = Classify(codepoints[i]);
            if (type is UiBidiClass.LRI or UiBidiClass.RLI or UiBidiClass.FSI)
            {
                isolateDepth++;
                continue;
            }

            if (type == UiBidiClass.PDI)
            {
                if (isolateDepth > 0)
                {
                    isolateDepth--;
                }

                continue;
            }

            if (isolateDepth > 0)
            {
                continue;
            }

            if (type is UiBidiClass.R or UiBidiClass.AL)
            {
                return 1;
            }

            if (type == UiBidiClass.L)
            {
                return 0;
            }
        }

        return 0;
    }

    public static UiBidiClass Classify(int codePoint)
    {
        if (codePoint < 0x20)
        {
            if (codePoint == 0x09)
            {
                return UiBidiClass.S;
            }

            if (codePoint is 0x0A or 0x0D)
            {
                return UiBidiClass.B;
            }

            if (codePoint is 0x0B or 0x0C)
            {
                return UiBidiClass.S;
            }

            return UiBidiClass.BN;
        }

        if (codePoint is >= 0x202A and <= 0x202E)
        {
            return codePoint switch
            {
                0x202A => UiBidiClass.LRE,
                0x202B => UiBidiClass.RLE,
                0x202C => UiBidiClass.PDF,
                0x202D => UiBidiClass.LRO,
                _ => UiBidiClass.RLO,
            };
        }

        if (codePoint is >= 0x2066 and <= 0x2069)
        {
            return codePoint switch
            {
                0x2066 => UiBidiClass.LRI,
                0x2067 => UiBidiClass.RLI,
                0x2068 => UiBidiClass.FSI,
                _ => UiBidiClass.PDI,
            };
        }

        if (IsTransparentMark(codePoint))
        {
            return UiBidiClass.NSM;
        }

        if ((codePoint >= 0x0660 && codePoint <= 0x0669) ||
            (codePoint >= 0x06F0 && codePoint <= 0x06F9))
        {
            return UiBidiClass.AN;
        }

        if ((codePoint >= 0x0600 && codePoint <= 0x06FF) ||
            (codePoint >= 0x0750 && codePoint <= 0x077F) ||
            (codePoint >= 0x08A0 && codePoint <= 0x08FF) ||
            (codePoint >= 0xFB50 && codePoint <= 0xFDFF) ||
            (codePoint >= 0xFE70 && codePoint <= 0xFEFF))
        {
            return UiBidiClass.AL;
        }

        if ((codePoint >= 0x0590 && codePoint <= 0x05FF) ||
            (codePoint >= 0x0700 && codePoint <= 0x074F) ||
            (codePoint >= 0x0780 && codePoint <= 0x07BF) ||
            (codePoint >= 0x0800 && codePoint <= 0x085F) ||
            (codePoint >= 0x10800 && codePoint <= 0x10FFF) ||
            (codePoint >= 0x1E800 && codePoint <= 0x1EFFF))
        {
            return UiBidiClass.R;
        }

        if (codePoint >= 0x30 && codePoint <= 0x39)
        {
            return UiBidiClass.EN;
        }

        if (codePoint is 0x2B or 0x2D)
        {
            return UiBidiClass.ES;
        }

        if (codePoint is 0x23 or 0x24 or 0x25 ||
            (codePoint >= 0x00A2 && codePoint <= 0x00A5) ||
            (codePoint >= 0x20A0 && codePoint <= 0x20CF))
        {
            return UiBidiClass.ET;
        }

        if (codePoint is 0x2C or 0x2E or 0x3A or 0x3B)
        {
            return UiBidiClass.CS;
        }

        if (codePoint == 0x20 || codePoint == 0x00A0 || codePoint == 0x1680 ||
            (codePoint >= 0x2000 && codePoint <= 0x200A) ||
            codePoint == 0x202F || codePoint == 0x205F || codePoint == 0x3000)
        {
            return UiBidiClass.WS;
        }

        if (codePoint is 0x2028 or 0x2029)
        {
            return UiBidiClass.B;
        }

        if (codePoint == 0x061C || codePoint == 0xFEFF ||
            (codePoint >= 0x200B && codePoint <= 0x200F))
        {
            return UiBidiClass.BN;
        }

        if ((codePoint >= 0x0041 && codePoint <= 0x005A) ||
            (codePoint >= 0x0061 && codePoint <= 0x007A) ||
            (codePoint >= 0x00C0 && codePoint <= 0x02AF) ||
            (codePoint >= 0x0370 && codePoint <= 0x052F) ||
            (codePoint >= 0x0531 && codePoint <= 0x058F) ||
            (codePoint >= 0x10A0 && codePoint <= 0x10FF) ||
            (codePoint >= 0x1E00 && codePoint <= 0x1FFF) ||
            (codePoint >= 0x2C60 && codePoint <= 0x2C7F) ||
            (codePoint >= 0x3040 && codePoint <= 0x30FF) ||
            (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
            (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
            (codePoint >= 0xA000 && codePoint <= 0xA4CF) ||
            (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||
            (codePoint >= 0xF900 && codePoint <= 0xFAFF))
        {
            return UiBidiClass.L;
        }

        return UiBidiClass.ON;
    }

    public static bool IsBidiControl(int codePoint) =>
        codePoint is 0x061C or 0x200B or 0x200E or 0x200F or 0xFEFF ||
        codePoint is >= 0x202A and <= 0x202E ||
        codePoint is >= 0x2066 and <= 0x2069;

    public static void ResolveLevels(
        ReadOnlySpan<int> codepoints,
        Span<UiBidiClass> types,
        Span<byte> levels,
        byte baseLevel) => Resolve(codepoints, types, levels, baseLevel);

    public static void Resolve(
        ReadOnlySpan<int> codepoints,
        Span<UiBidiClass> types,
        Span<byte> levels,
        byte baseLevel)
    {
        int count = codepoints.Length;
        Span<byte> levelStack = stackalloc byte[MaxDepth];
        Span<bool> overrideActive = stackalloc bool[MaxDepth];
        Span<bool> overrideLeft = stackalloc bool[MaxDepth];
        Span<bool> isolateStack = stackalloc bool[MaxDepth];
        int depth = 0;
        levelStack[0] = baseLevel;

        for (int i = 0; i < count; i++)
        {
            UiBidiClass type = Classify(codepoints[i]);
            types[i] = type;
            byte currentLevel = levelStack[depth];
            levels[i] = currentLevel;
            switch (type)
            {
                case UiBidiClass.LRE:
                case UiBidiClass.RLE:
                case UiBidiClass.LRO:
                case UiBidiClass.RLO:
                    {
                        byte embedded = EmbeddingLevel(currentLevel, type is UiBidiClass.RLE or UiBidiClass.RLO);
                        if (embedded <= 125 && depth < MaxDepth - 1)
                        {
                            depth++;
                            levelStack[depth] = embedded;
                            overrideActive[depth] = type is UiBidiClass.LRO or UiBidiClass.RLO;
                            overrideLeft[depth] = type == UiBidiClass.LRO;
                            isolateStack[depth] = false;
                        }

                        break;
                    }
                case UiBidiClass.LRI:
                case UiBidiClass.RLI:
                case UiBidiClass.FSI:
                    {
                        bool rtl = type == UiBidiClass.RLI || (type == UiBidiClass.FSI && IsFirstStrongRtl(codepoints, i));
                        byte isolateLevel = EmbeddingLevel(currentLevel, rtl);
                        if (isolateLevel <= 125 && depth < MaxDepth - 1)
                        {
                            depth++;
                            levelStack[depth] = isolateLevel;
                            overrideActive[depth] = false;
                            overrideLeft[depth] = false;
                            isolateStack[depth] = true;
                        }

                        break;
                    }
                case UiBidiClass.PDI:
                    {
                        int target = depth;
                        while (target > 0 && !isolateStack[target])
                        {
                            target--;
                        }

                        depth = target > 0 ? target - 1 : 0;
                        levels[i] = levelStack[depth];
                        break;
                    }
                case UiBidiClass.PDF:
                    {
                        while (depth > 0 && !isolateStack[depth])
                        {
                            depth--;
                        }

                        levels[i] = levelStack[depth];
                        break;
                    }
                case UiBidiClass.B:
                case UiBidiClass.S:
                case UiBidiClass.BN:
                    break;
                default:
                    if (overrideActive[depth])
                    {
                        types[i] = overrideLeft[depth] ? UiBidiClass.L : UiBidiClass.R;
                    }

                    break;
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] is UiBidiClass.LRE or UiBidiClass.RLE or UiBidiClass.LRO or UiBidiClass.RLO or
                UiBidiClass.PDF or UiBidiClass.LRI or UiBidiClass.RLI or UiBidiClass.FSI or UiBidiClass.PDI)
            {
                types[i] = UiBidiClass.BN;
            }
        }

        ApplyWeakRules(types, baseLevel);
        ResolveBrackets(codepoints, types, levels, baseLevel);
        ApplyNeutralRules(types, levels, baseLevel);
        ApplyImplicitLevels(codepoints, types, levels);
    }

    public static void Reorder(Span<int> codepoints, Span<int> clusters, Span<byte> levels)
    {
        int count = codepoints.Length;
        int maxLevel = 0;
        int minOdd = int.MaxValue;
        for (int i = 0; i < count; i++)
        {
            int level = levels[i];
            maxLevel = Math.Max(maxLevel, level);
            if ((level & 1) != 0)
            {
                minOdd = Math.Min(minOdd, level);
            }
        }

        if (minOdd == int.MaxValue)
        {
            return;
        }

        for (int level = maxLevel; level >= minOdd; level--)
        {
            int i = 0;
            while (i < count)
            {
                while (i < count && levels[i] < level)
                {
                    i++;
                }

                int start = i;
                while (i < count && levels[i] >= level)
                {
                    i++;
                }

                for (int left = start, right = i - 1; left < right; left++, right--)
                {
                    (codepoints[left], codepoints[right]) = (codepoints[right], codepoints[left]);
                    (clusters[left], clusters[right]) = (clusters[right], clusters[left]);
                    (levels[left], levels[right]) = (levels[right], levels[left]);
                }
            }
        }
    }

    public static int Mirror(int codePoint) => codePoint switch
    {
        0x0028 => 0x0029,
        0x0029 => 0x0028,
        0x005B => 0x005D,
        0x005D => 0x005B,
        0x007B => 0x007D,
        0x007D => 0x007B,
        0x003C => 0x003E,
        0x003E => 0x003C,
        0x00AB => 0x00BB,
        0x00BB => 0x00AB,
        0x2039 => 0x203A,
        0x203A => 0x2039,
        0x2045 => 0x2046,
        0x2046 => 0x2045,
        0x207D => 0x207E,
        0x207E => 0x207D,
        0x208D => 0x208E,
        0x208E => 0x208D,
        0x2264 => 0x2265,
        0x2265 => 0x2264,
        0x2266 => 0x2267,
        0x2267 => 0x2266,
        0x22DA => 0x22DB,
        0x22DB => 0x22DA,
        0x2329 => 0x232A,
        0x232A => 0x2329,
        0x3008 => 0x3009,
        0x3009 => 0x3008,
        0x300A => 0x300B,
        0x300B => 0x300A,
        0x300C => 0x300D,
        0x300D => 0x300C,
        0x300E => 0x300F,
        0x300F => 0x300E,
        0x3010 => 0x3011,
        0x3011 => 0x3010,
        0x3014 => 0x3015,
        0x3015 => 0x3014,
        0x3016 => 0x3017,
        0x3017 => 0x3016,
        0x3018 => 0x3019,
        0x3019 => 0x3018,
        0x301A => 0x301B,
        0x301B => 0x301A,
        0xFE59 => 0xFE5A,
        0xFE5A => 0xFE59,
        0xFE5B => 0xFE5C,
        0xFE5C => 0xFE5B,
        0xFE5D => 0xFE5E,
        0xFE5E => 0xFE5D,
        0xFF08 => 0xFF09,
        0xFF09 => 0xFF08,
        0xFF3B => 0xFF3D,
        0xFF3D => 0xFF3B,
        0xFF5B => 0xFF5D,
        0xFF5D => 0xFF5B,
        0xFF62 => 0xFF63,
        0xFF63 => 0xFF62,
        _ => codePoint,
    };

    private static void ApplyWeakRules(Span<UiBidiClass> types, byte baseLevel)
    {
        int count = types.Length;
        UiBidiClass sos = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
        UiBidiClass previous = sos;
        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.BN)
            {
                continue;
            }

            if (types[i] == UiBidiClass.NSM)
            {
                types[i] = previous;
            }

            previous = types[i];
        }

        UiBidiClass lastStrong = sos;
        for (int i = 0; i < count; i++)
        {
            UiBidiClass type = types[i];
            if (type == UiBidiClass.BN)
            {
                continue;
            }

            if (type == UiBidiClass.EN && lastStrong == UiBidiClass.AL)
            {
                types[i] = UiBidiClass.AN;
            }

            if (type is UiBidiClass.L or UiBidiClass.R or UiBidiClass.AL)
            {
                lastStrong = type;
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.AL)
            {
                types[i] = UiBidiClass.R;
            }
        }

        for (int i = 0; i < count; i++)
        {
            UiBidiClass type = types[i];
            if (type is not (UiBidiClass.ES or UiBidiClass.CS))
            {
                continue;
            }

            UiBidiClass before = PreviousVisible(types, i - 1, sos);
            UiBidiClass after = NextVisible(types, i, sos);
            if (type == UiBidiClass.ES && before == UiBidiClass.EN && after == UiBidiClass.EN)
            {
                types[i] = UiBidiClass.EN;
            }
            else if (type == UiBidiClass.CS)
            {
                if (before == UiBidiClass.EN && after == UiBidiClass.EN)
                {
                    types[i] = UiBidiClass.EN;
                }
                else if (before == UiBidiClass.AN && after == UiBidiClass.AN)
                {
                    types[i] = UiBidiClass.AN;
                }
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] != UiBidiClass.ET)
            {
                continue;
            }

            int start = i;
            int end = i;
            while (end < count && types[end] == UiBidiClass.ET)
            {
                end++;
            }

            bool adjacent = (start > 0 && PreviousVisible(types, start - 1, sos) == UiBidiClass.EN) ||
                (end < count && NextVisible(types, end - 1, sos) == UiBidiClass.EN);
            if (adjacent)
            {
                for (int e = start; e < end; e++)
                {
                    types[e] = UiBidiClass.EN;
                }
            }

            i = end - 1;
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] is UiBidiClass.ES or UiBidiClass.ET or UiBidiClass.CS)
            {
                types[i] = UiBidiClass.ON;
            }
        }

        lastStrong = sos;
        for (int i = 0; i < count; i++)
        {
            UiBidiClass type = types[i];
            if (type == UiBidiClass.BN)
            {
                continue;
            }

            if (type == UiBidiClass.EN && lastStrong == UiBidiClass.L)
            {
                types[i] = UiBidiClass.L;
            }

            if (types[i] is UiBidiClass.L or UiBidiClass.R)
            {
                lastStrong = types[i];
            }
        }
    }

    private static void ResolveBrackets(
        ReadOnlySpan<int> codepoints,
        Span<UiBidiClass> types,
        ReadOnlySpan<byte> levels,
        byte baseLevel)
    {
        Span<int> opens = stackalloc int[MaxBracketDepth];
        Span<int> closes = stackalloc int[MaxBracketDepth];
        int depth = 0;
        for (int i = 0; i < codepoints.Length; i++)
        {
            if (types[i] == UiBidiClass.BN)
            {
                continue;
            }

            if (TryGetOpenClose(codepoints[i], out int closeCodePoint))
            {
                if (depth < MaxBracketDepth)
                {
                    opens[depth] = i;
                    closes[depth] = closeCodePoint;
                    depth++;
                }

                continue;
            }

            if (!TryGetClose(codepoints[i]))
            {
                continue;
            }

            int match = -1;
            for (int d = depth - 1; d >= 0; d--)
            {
                if (closes[d] == codepoints[i])
                {
                    match = d;
                    break;
                }
            }

            if (match < 0)
            {
                continue;
            }

            ResolveBracketPair(codepoints, types, levels, baseLevel, opens[match], i);
            depth = match;
        }
    }

    private static void ResolveBracketPair(
        ReadOnlySpan<int> codepoints,
        Span<UiBidiClass> types,
        ReadOnlySpan<byte> levels,
        byte baseLevel,
        int open,
        int close)
    {
        UiBidiClass embedding = (levels[open] & 1) == 0 ? UiBidiClass.L : UiBidiClass.R;
        UiBidiClass opposite = embedding == UiBidiClass.L ? UiBidiClass.R : UiBidiClass.L;
        bool foundSame = false;
        bool foundOpposite = false;
        for (int i = open + 1; i < close; i++)
        {
            UiBidiClass type = types[i];
            if (type is UiBidiClass.L or UiBidiClass.R or UiBidiClass.EN or UiBidiClass.AN)
            {
                UiBidiClass direction = type == UiBidiClass.L ? UiBidiClass.L : UiBidiClass.R;
                if (direction == embedding)
                {
                    foundSame = true;
                }
                else
                {
                    foundOpposite = true;
                }
            }
        }

        UiBidiClass resolved;
        if (foundOpposite && !foundSame)
        {
            resolved = opposite;
        }
        else if (foundSame)
        {
            resolved = embedding;
        }
        else
        {
            UiBidiClass before = PreviousStrong(types, open - 1, baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L);
            resolved = before == opposite ? opposite : embedding;
        }

        types[open] = resolved;
        types[close] = resolved;
    }

    private static void ApplyNeutralRules(Span<UiBidiClass> types, ReadOnlySpan<byte> levels, byte baseLevel)
    {
        int count = types.Length;
        UiBidiClass sos = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
        for (int i = 0; i < count; i++)
        {
            if (!IsNeutral(types[i]))
            {
                continue;
            }

            int start = i;
            while (i < count && (IsNeutral(types[i]) || types[i] == UiBidiClass.BN))
            {
                i++;
            }

            UiBidiClass before = PreviousStrong(types, start - 1, sos);
            UiBidiClass after = NextStrong(types, i, sos);
            bool uniform = before == after;
            for (int n = start; n < i; n++)
            {
                if (!IsNeutral(types[n]))
                {
                    continue;
                }

                types[n] = uniform
                    ? before
                    : (levels[n] & 1) == 0
                        ? UiBidiClass.L
                        : UiBidiClass.R;
            }
        }
    }

    private static void ApplyImplicitLevels(
        ReadOnlySpan<int> codepoints,
        ReadOnlySpan<UiBidiClass> types,
        Span<byte> levels)
    {
        for (int i = 0; i < codepoints.Length; i++)
        {
            if (IsBidiControl(codepoints[i]))
            {
                continue;
            }

            int level = levels[i];
            UiBidiClass type = types[i];
            if ((level & 1) == 0)
            {
                if (type == UiBidiClass.R)
                {
                    level++;
                }
                else if (type is UiBidiClass.EN or UiBidiClass.AN)
                {
                    level += 2;
                }
            }
            else if (type is UiBidiClass.L or UiBidiClass.EN or UiBidiClass.AN)
            {
                level++;
            }

            levels[i] = (byte)Math.Min(level, 255);
        }
    }

    private static bool IsFirstStrongRtl(ReadOnlySpan<int> codepoints, int index)
    {
        int isolateDepth = 1;
        for (int i = index + 1; i < codepoints.Length; i++)
        {
            UiBidiClass type = Classify(codepoints[i]);
            if (type is UiBidiClass.LRI or UiBidiClass.RLI or UiBidiClass.FSI)
            {
                isolateDepth++;
                continue;
            }

            if (type == UiBidiClass.PDI)
            {
                isolateDepth--;
                if (isolateDepth == 0)
                {
                    return false;
                }

                continue;
            }

            if (isolateDepth > 1)
            {
                continue;
            }

            if (type is UiBidiClass.R or UiBidiClass.AL)
            {
                return true;
            }

            if (type == UiBidiClass.L)
            {
                return false;
            }
        }

        return false;
    }

    private static byte EmbeddingLevel(byte level, bool rtl) =>
        rtl ? (byte)((level + 1) | 1) : (byte)((level + 2) & ~1);

    private static bool IsNeutral(UiBidiClass type) =>
        type is UiBidiClass.B or UiBidiClass.S or UiBidiClass.WS or UiBidiClass.ON;

    private static UiBidiClass PreviousVisible(ReadOnlySpan<UiBidiClass> types, int index, UiBidiClass fallback)
    {
        for (int i = index; i >= 0; i--)
        {
            if (types[i] != UiBidiClass.BN)
            {
                return types[i];
            }
        }

        return fallback;
    }

    private static UiBidiClass NextVisible(ReadOnlySpan<UiBidiClass> types, int index, UiBidiClass fallback)
    {
        for (int i = index + 1; i < types.Length; i++)
        {
            if (types[i] != UiBidiClass.BN)
            {
                return types[i];
            }
        }

        return fallback;
    }

    private static UiBidiClass PreviousStrong(ReadOnlySpan<UiBidiClass> types, int index, UiBidiClass fallback)
    {
        for (int i = index; i >= 0; i--)
        {
            UiBidiClass type = types[i];
            if (type == UiBidiClass.BN || IsNeutral(type))
            {
                continue;
            }

            return type switch
            {
                UiBidiClass.L => UiBidiClass.L,
                UiBidiClass.R or UiBidiClass.EN or UiBidiClass.AN => UiBidiClass.R,
                _ => fallback,
            };
        }

        return fallback;
    }

    private static UiBidiClass NextStrong(ReadOnlySpan<UiBidiClass> types, int index, UiBidiClass fallback)
    {
        for (int i = index; i < types.Length; i++)
        {
            UiBidiClass type = types[i];
            if (type == UiBidiClass.BN || IsNeutral(type))
            {
                continue;
            }

            return type switch
            {
                UiBidiClass.L => UiBidiClass.L,
                UiBidiClass.R or UiBidiClass.EN or UiBidiClass.AN => UiBidiClass.R,
                _ => fallback,
            };
        }

        return fallback;
    }

    private static bool TryGetOpenClose(int codePoint, out int close)
    {
        for (int i = 0; i < BracketOpen.Length; i++)
        {
            if (BracketOpen[i] == codePoint)
            {
                close = BracketClose[i];
                return true;
            }
        }

        close = 0;
        return false;
    }

    private static bool TryGetClose(int codePoint)
    {
        for (int i = 0; i < BracketClose.Length; i++)
        {
            if (BracketClose[i] == codePoint)
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsTransparentMark(int codePoint) =>
        (codePoint >= 0x0300 && codePoint <= 0x036F) ||
        (codePoint >= 0x0483 && codePoint <= 0x0489) ||
        (codePoint >= 0x0591 && codePoint <= 0x05BD) ||
        codePoint == 0x05BF ||
        (codePoint >= 0x05C1 && codePoint <= 0x05C2) ||
        (codePoint >= 0x05C4 && codePoint <= 0x05C5) ||
        codePoint == 0x05C7 ||
        (codePoint >= 0x0610 && codePoint <= 0x061A) ||
        (codePoint >= 0x064B && codePoint <= 0x065F) ||
        codePoint == 0x0670 ||
        (codePoint >= 0x06D6 && codePoint <= 0x06DC) ||
        (codePoint >= 0x06DF && codePoint <= 0x06E4) ||
        (codePoint >= 0x06E7 && codePoint <= 0x06E8) ||
        (codePoint >= 0x06EA && codePoint <= 0x06ED) ||
        (codePoint >= 0x1AB0 && codePoint <= 0x1AFF) ||
        (codePoint >= 0x1DC0 && codePoint <= 0x1DFF) ||
        (codePoint >= 0x20D0 && codePoint <= 0x20FF) ||
        (codePoint >= 0xFE20 && codePoint <= 0xFE2F);
}
