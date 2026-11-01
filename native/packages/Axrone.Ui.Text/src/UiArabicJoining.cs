namespace Axrone.Ui.Text;

internal enum UiJoiningType : byte
{
    U,
    L,
    R,
    D,
    C,
    T,
}

internal readonly record struct UiArabicForm(
    int Base,
    UiJoiningType Type,
    int Isolated,
    int Final,
    int Initial,
    int Medial);

internal static class UiArabicJoining
{
    private static readonly UiArabicForm[] Forms =
    [
        new(0x0621, UiJoiningType.U, 0xFE80, 0, 0, 0),
        new(0x0622, UiJoiningType.R, 0xFE81, 0xFE82, 0, 0),
        new(0x0623, UiJoiningType.R, 0xFE83, 0xFE84, 0, 0),
        new(0x0624, UiJoiningType.R, 0xFE85, 0xFE86, 0, 0),
        new(0x0625, UiJoiningType.R, 0xFE87, 0xFE88, 0, 0),
        new(0x0626, UiJoiningType.D, 0xFE89, 0xFE8A, 0xFE8B, 0xFE8C),
        new(0x0627, UiJoiningType.R, 0xFE8D, 0xFE8E, 0, 0),
        new(0x0628, UiJoiningType.D, 0xFE8F, 0xFE90, 0xFE91, 0xFE92),
        new(0x0629, UiJoiningType.R, 0xFE93, 0xFE94, 0, 0),
        new(0x062A, UiJoiningType.D, 0xFE95, 0xFE96, 0xFE97, 0xFE98),
        new(0x062B, UiJoiningType.D, 0xFE99, 0xFE9A, 0xFE9B, 0xFE9C),
        new(0x062C, UiJoiningType.D, 0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0),
        new(0x062D, UiJoiningType.D, 0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4),
        new(0x062E, UiJoiningType.D, 0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8),
        new(0x062F, UiJoiningType.R, 0xFEA9, 0xFEAA, 0, 0),
        new(0x0630, UiJoiningType.R, 0xFEAB, 0xFEAC, 0, 0),
        new(0x0631, UiJoiningType.R, 0xFEAD, 0xFEAE, 0, 0),
        new(0x0632, UiJoiningType.R, 0xFEAF, 0xFEB0, 0, 0),
        new(0x0633, UiJoiningType.D, 0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4),
        new(0x0634, UiJoiningType.D, 0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8),
        new(0x0635, UiJoiningType.D, 0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC),
        new(0x0636, UiJoiningType.D, 0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0),
        new(0x0637, UiJoiningType.D, 0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4),
        new(0x0638, UiJoiningType.D, 0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8),
        new(0x0639, UiJoiningType.D, 0xFEC9, 0xFECA, 0xFECB, 0xFECC),
        new(0x063A, UiJoiningType.D, 0xFECD, 0xFECE, 0xFECF, 0xFED0),
        new(0x0641, UiJoiningType.D, 0xFED1, 0xFED2, 0xFED3, 0xFED4),
        new(0x0642, UiJoiningType.D, 0xFED5, 0xFED6, 0xFED7, 0xFED8),
        new(0x0643, UiJoiningType.D, 0xFED9, 0xFEDA, 0xFEDB, 0xFEDC),
        new(0x0644, UiJoiningType.D, 0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0),
        new(0x0645, UiJoiningType.D, 0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4),
        new(0x0646, UiJoiningType.D, 0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8),
        new(0x0647, UiJoiningType.D, 0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC),
        new(0x0648, UiJoiningType.R, 0xFEED, 0xFEEE, 0, 0),
        new(0x0649, UiJoiningType.R, 0xFEEF, 0xFEF0, 0, 0),
        new(0x064A, UiJoiningType.D, 0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4),
    ];

    public static bool TryGetForm(ReadOnlySpan<int> codepoints, int index, out int form)
    {
        form = 0;
        int entry = FindEntry(codepoints[index]);
        if (entry < 0)
        {
            return false;
        }

        UiArabicForm info = Forms[entry];
        UiJoiningType previous = FindNeighbor(codepoints, index, -1);
        UiJoiningType next = FindNeighbor(codepoints, index, 1);
        bool joinsPrevious = previous is UiJoiningType.D or UiJoiningType.L or UiJoiningType.C &&
            info.Type is UiJoiningType.D or UiJoiningType.R;
        bool joinsNext = info.Type is UiJoiningType.D or UiJoiningType.L or UiJoiningType.C &&
            next is UiJoiningType.D or UiJoiningType.R;
        int candidate = joinsPrevious && joinsNext
            ? info.Medial
            : joinsPrevious
                ? info.Final
                : joinsNext
                    ? info.Initial
                    : info.Isolated;
        if (candidate == 0)
        {
            return false;
        }

        form = candidate;
        return true;
    }

    public static UiJoiningType GetType(int codePoint)
    {
        if (IsTransparent(codePoint))
        {
            return UiJoiningType.T;
        }

        if (codePoint == 0x200D)
        {
            return UiJoiningType.C;
        }

        int entry = FindEntry(codePoint);
        return entry >= 0 ? Forms[entry].Type : UiJoiningType.U;
    }

    private static UiJoiningType FindNeighbor(ReadOnlySpan<int> codepoints, int index, int step)
    {
        int current = index + step;
        while ((uint)current < (uint)codepoints.Length)
        {
            UiJoiningType type = GetType(codepoints[current]);
            if (type != UiJoiningType.T)
            {
                return type;
            }

            current += step;
        }

        return UiJoiningType.U;
    }

    private static int FindEntry(int codePoint) => codePoint switch
    {
        0x0621 => 0,
        0x0622 => 1,
        0x0623 => 2,
        0x0624 => 3,
        0x0625 => 4,
        0x0626 => 5,
        0x0627 => 6,
        0x0628 => 7,
        0x0629 => 8,
        0x062A => 9,
        0x062B => 10,
        0x062C => 11,
        0x062D => 12,
        0x062E => 13,
        0x062F => 14,
        0x0630 => 15,
        0x0631 => 16,
        0x0632 => 17,
        0x0633 => 18,
        0x0634 => 19,
        0x0635 => 20,
        0x0636 => 21,
        0x0637 => 22,
        0x0638 => 23,
        0x0639 => 24,
        0x063A => 25,
        0x0641 => 26,
        0x0642 => 27,
        0x0643 => 28,
        0x0644 => 29,
        0x0645 => 30,
        0x0646 => 31,
        0x0647 => 32,
        0x0648 => 33,
        0x0649 => 34,
        0x064A => 35,
        _ => -1,
    };

    private static bool IsTransparent(int codePoint) =>
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
