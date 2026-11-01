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
}

internal static class UiBidi
{
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

        for (int i = 0; i < codepoints.Length; i++)
        {
            UiBidiClass type = Classify(codepoints[i]);
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

        if ((codePoint >= 0x202A && codePoint <= 0x202E) ||
            (codePoint >= 0x2066 && codePoint <= 0x2069) ||
            (codePoint >= 0x200B && codePoint <= 0x200F) ||
            codePoint == 0xFEFF)
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

    public static void ResolveLevels(
        ReadOnlySpan<int> codepoints,
        Span<UiBidiClass> types,
        Span<byte> levels,
        byte baseLevel)
    {
        int count = codepoints.Length;
        for (int i = 0; i < count; i++)
        {
            types[i] = Classify(codepoints[i]);
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.NSM)
            {
                types[i] = i > 0 ? types[i - 1] : UiBidiClass.ON;
            }
        }

        UiBidiClass lastStrong = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.EN && lastStrong == UiBidiClass.AL)
            {
                types[i] = UiBidiClass.AN;
            }

            if (types[i] is UiBidiClass.L or UiBidiClass.R or UiBidiClass.AL)
            {
                lastStrong = types[i];
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.AL)
            {
                types[i] = UiBidiClass.R;
            }
        }

        for (int i = 1; i < count - 1; i++)
        {
            if (types[i] == UiBidiClass.ES && types[i - 1] == UiBidiClass.EN && types[i + 1] == UiBidiClass.EN)
            {
                types[i] = UiBidiClass.EN;
            }
            else if (types[i] == UiBidiClass.CS)
            {
                if (types[i - 1] == UiBidiClass.EN && types[i + 1] == UiBidiClass.EN)
                {
                    types[i] = UiBidiClass.EN;
                }
                else if (types[i - 1] == UiBidiClass.AN && types[i + 1] == UiBidiClass.AN)
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
            while (i < count && types[i] == UiBidiClass.ET)
            {
                i++;
            }

            bool adjacent = (start > 0 && types[start - 1] == UiBidiClass.EN) ||
                (i < count && types[i] == UiBidiClass.EN);
            if (adjacent)
            {
                for (int e = start; e < i; e++)
                {
                    types[e] = UiBidiClass.EN;
                }
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] is UiBidiClass.ES or UiBidiClass.ET or UiBidiClass.CS)
            {
                types[i] = UiBidiClass.ON;
            }
        }

        lastStrong = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.EN && lastStrong == UiBidiClass.L)
            {
                types[i] = UiBidiClass.L;
            }

            if (types[i] is UiBidiClass.L or UiBidiClass.R)
            {
                lastStrong = types[i];
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (types[i] == UiBidiClass.BN)
            {
                types[i] = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (!IsNeutral(types[i]))
            {
                continue;
            }

            int start = i;
            while (i < count && IsNeutral(types[i]))
            {
                i++;
            }

            UiBidiClass before = start > 0
                ? NeutralStrong(types[start - 1], baseLevel)
                : (baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L);
            UiBidiClass after = i < count
                ? NeutralStrong(types[i], baseLevel)
                : before;
            if (before == after)
            {
                for (int n = start; n < i; n++)
                {
                    types[n] = before;
                }
            }
        }

        for (int i = 0; i < count; i++)
        {
            if (IsNeutral(types[i]))
            {
                types[i] = baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L;
            }
        }

        for (int i = 0; i < count; i++)
        {
            UiBidiClass type = types[i];
            byte level = baseLevel;
            if (baseLevel == 0)
            {
                if (type == UiBidiClass.R)
                {
                    level = 1;
                }
                else if (type is UiBidiClass.EN or UiBidiClass.AN)
                {
                    level = 2;
                }
            }
            else
            {
                if (type is UiBidiClass.L or UiBidiClass.EN or UiBidiClass.AN)
                {
                    level = 2;
                }
            }

            levels[i] = level;
        }
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

    private static bool IsNeutral(UiBidiClass type) =>
        type is UiBidiClass.B or UiBidiClass.S or UiBidiClass.WS or UiBidiClass.ON;

    private static UiBidiClass NeutralStrong(UiBidiClass type, byte baseLevel) => type switch
    {
        UiBidiClass.L => UiBidiClass.L,
        UiBidiClass.R => UiBidiClass.R,
        UiBidiClass.EN => UiBidiClass.R,
        UiBidiClass.AN => UiBidiClass.R,
        _ => baseLevel == 1 ? UiBidiClass.R : UiBidiClass.L,
    };
}
