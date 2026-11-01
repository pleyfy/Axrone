namespace Axrone.Ui.Text;

using System.Buffers;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCffGlyphBounds(int XMin, int YMin, int XMax, int YMax)
{
    public static UiCffGlyphBounds Empty => default;

    public bool IsEmpty => XMax <= XMin && YMax <= YMin;
}

internal sealed class UiCffIndex
{
    private readonly int[] _starts;

    private UiCffIndex(int[] starts) => _starts = starts;

    public static UiCffIndex Empty { get; } = new([]);

    public int Count => _starts.Length == 0 ? 0 : _starts.Length - 1;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int limit,
        out UiCffIndex? index,
        out int end,
        out UiFontError error)
    {
        index = null;
        end = offset;
        error = UiFontError.None;

        if (offset < 0 || offset + 2 > limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF INDEX header is truncated.");
        }

        int count = UiFontFace.ReadU16(data, offset);
        if (count == 0)
        {
            index = Empty;
            end = offset + 2;
            return true;
        }

        if (offset + 3 > limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF INDEX offset size is truncated.");
        }

        int offSize = data[offset + 2];
        if (offSize < 1 || offSize > 4)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset + 2, "CFF INDEX offset size is invalid.");
        }

        long offsetsStart = offset + 3L;
        long offsetsEnd = offsetsStart + ((count + 1L) * offSize);
        if (offsetsEnd > limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF INDEX offsets exceed the table.");
        }

        long dataStart = offsetsEnd - 1L;

        var starts = new int[count + 1];
        int previous = 0;
        for (int i = 0; i <= count; i++)
        {
            int value = ReadOffset(data, (int)offsetsStart + (i * offSize), offSize);
            if (value < 1 || (i > 0 && value < previous))
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, (int)offsetsStart + (i * offSize), "CFF INDEX offsets are not monotonic.");
            }

            long absolute = dataStart + value;
            if (absolute > limit)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, (int)offsetsStart + (i * offSize), "CFF INDEX object exceeds the table.");
            }

            starts[i] = (int)absolute;
            previous = value;
        }

        end = starts[count];
        index = new UiCffIndex(starts);
        return true;
    }

    public ReadOnlySpan<byte> Get(ReadOnlySpan<byte> data, int index)
    {
        int start = _starts[index];
        int end = _starts[index + 1];
        return data[start..end];
    }

    public bool TryGetRange(int index, out int start, out int end)
    {
        if ((uint)index >= (uint)Count)
        {
            start = 0;
            end = 0;
            return false;
        }

        start = _starts[index];
        end = _starts[index + 1];
        return true;
    }

    public int GetBias() => Count switch
    {
        < 1240 => 107,
        < 33900 => 1131,
        _ => 32768,
    };

    private static int ReadOffset(ReadOnlySpan<byte> data, int offset, int size)
    {
        int value = 0;
        for (int i = 0; i < size; i++)
        {
            value = (value << 8) | data[offset + i];
        }

        return value;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}

internal sealed class UiCffParsed
{
    public UiCffParsed(
        UiCffIndex charStrings,
        UiCffIndex globalSubrs,
        UiCffIndex localSubrs,
        UiCffIndex[]? fdLocalSubrs,
        byte[]? fdByGlyph,
        UiCffGlyphBounds[] bounds)
    {
        CharStrings = charStrings;
        GlobalSubrs = globalSubrs;
        LocalSubrs = localSubrs;
        FdLocalSubrs = fdLocalSubrs;
        FdByGlyph = fdByGlyph;
        Bounds = bounds;
    }

    public UiCffIndex CharStrings { get; }

    public UiCffIndex GlobalSubrs { get; }

    public UiCffIndex LocalSubrs { get; }

    public UiCffIndex[]? FdLocalSubrs { get; }

    public byte[]? FdByGlyph { get; }

    public UiCffGlyphBounds[] Bounds { get; }

    public bool IsCid => FdByGlyph is not null;

    public UiCffIndex GetLocalSubrs(int glyphId)
    {
        if (FdByGlyph is null || FdLocalSubrs is null)
        {
            return LocalSubrs;
        }

        int fd = FdByGlyph[glyphId];
        return (uint)fd < (uint)FdLocalSubrs.Length ? FdLocalSubrs[fd] : UiCffIndex.Empty;
    }

    public UiCffGlyphBounds GetBounds(int glyphId) =>
        (uint)glyphId < (uint)Bounds.Length ? Bounds[glyphId] : UiCffGlyphBounds.Empty;
}

internal enum UiCffCommandKind : byte
{
    Move = 1,
    Line = 2,
    Cubic = 3,
    Close = 4,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCffCommand(
    UiCffCommandKind Kind,
    float X0,
    float Y0,
    float X1,
    float Y1,
    float X2,
    float Y2);

internal sealed class UiCffPath
{
    public const int MaxCommands = 8192;

    private UiCffCommand[] _commands = new UiCffCommand[256];
    private int _count;

    public int Count => _count;

    public ReadOnlySpan<UiCffCommand> Commands => _commands.AsSpan(0, _count);

    public void Clear() => _count = 0;

    public bool TryAdd(in UiCffCommand command)
    {
        if (_count >= MaxCommands)
        {
            return false;
        }

        if (_count == _commands.Length)
        {
            Array.Resize(ref _commands, _commands.Length * 2);
        }

        _commands[_count++] = command;
        return true;
    }
}

internal static class UiCffInterpreter
{
    private const int MaxStack = 48;
    private const int MaxTransient = 32;
    private const int MaxOperations = 200_000;
    private const int MaxCallDepth = 10;

    public static bool TryRun(
        ReadOnlySpan<byte> data,
        int start,
        int end,
        UiCffIndex globalSubrs,
        UiCffIndex localSubrs,
        UiCffPath path,
        out UiFontError error)
    {
        error = UiFontError.None;
        Span<double> stack = stackalloc double[MaxStack];
        Span<double> transient = stackalloc double[MaxTransient];
        Span<int> savedPosition = stackalloc int[MaxCallDepth];
        Span<int> savedEnd = stackalloc int[MaxCallDepth];

        int count = 0;
        int callDepth = 0;
        int position = start;
        int codeEnd = end;
        double x = 0.0;
        double y = 0.0;
        int stemCount = 0;
        bool widthParsed = false;
        bool contourOpen = false;
        double contourStartX = 0.0;
        double contourStartY = 0.0;
        int operations = 0;

        while (position < codeEnd)
        {
            if (++operations > MaxOperations)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF charstring operation limit exceeded.");
            }

            int b0 = data[position++];
            if (b0 <= 31)
            {
                switch (b0)
                {
                    case 1:
                    case 3:
                    case 18:
                    case 23:
                        {
                            if (!TakeStemArguments(stack, ref count, ref widthParsed, ref stemCount, out error))
                            {
                                return false;
                            }

                            break;
                        }

                    case 19:
                    case 20:
                        {
                            if (count > 0)
                            {
                                if (!TakeStemArguments(stack, ref count, ref widthParsed, ref stemCount, out error))
                                {
                                    return false;
                                }
                            }

                            int maskBytes = (stemCount + 7) / 8;
                            if (position + maskBytes > codeEnd)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF hint mask is truncated.");
                            }

                            position += maskBytes;
                            break;
                        }

                    case 21:
                        {
                            if (!TakeMoveArguments(stack, ref count, 2, ref widthParsed, out error))
                            {
                                return false;
                            }

                            x += stack[count - 2];
                            y += stack[count - 1];
                            count = 0;
                            if (!AddMove(path, x, y, ref contourOpen, ref contourStartX, ref contourStartY, out error))
                            {
                                return false;
                            }

                            break;
                        }

                    case 22:
                        {
                            if (!TakeMoveArguments(stack, ref count, 1, ref widthParsed, out error))
                            {
                                return false;
                            }

                            x += stack[count - 1];
                            count = 0;
                            if (!AddMove(path, x, y, ref contourOpen, ref contourStartX, ref contourStartY, out error))
                            {
                                return false;
                            }

                            break;
                        }

                    case 4:
                        {
                            if (!TakeMoveArguments(stack, ref count, 1, ref widthParsed, out error))
                            {
                                return false;
                            }

                            y += stack[count - 1];
                            count = 0;
                            if (!AddMove(path, x, y, ref contourOpen, ref contourStartX, ref contourStartY, out error))
                            {
                                return false;
                            }

                            break;
                        }

                    case 5:
                        {
                            if ((count & 1) != 0 || count == 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF rlineto operand count is invalid.");
                            }

                            for (int i = 0; i < count; i += 2)
                            {
                                x += stack[i];
                                y += stack[i + 1];
                                if (!AddLine(path, x, y, contourOpen, out error))
                                {
                                    return false;
                                }
                            }

                            count = 0;
                            break;
                        }

                    case 6:
                    case 7:
                        {
                            if (count == 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF line operand count is invalid.");
                            }

                            bool horizontal = b0 == 6;
                            for (int i = 0; i < count; i++)
                            {
                                if (horizontal)
                                {
                                    x += stack[i];
                                }
                                else
                                {
                                    y += stack[i];
                                }

                                if (!AddLine(path, x, y, contourOpen, out error))
                                {
                                    return false;
                                }

                                horizontal = !horizontal;
                            }

                            count = 0;
                            break;
                        }

                    case 8:
                        {
                            if (count == 0 || count % 6 != 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF rrcurveto operand count is invalid.");
                            }

                            for (int i = 0; i < count; i += 6)
                            {
                                if (!AddRelativeCubic(path, stack, i, ref x, ref y, contourOpen, out error))
                                {
                                    return false;
                                }
                            }

                            count = 0;
                            break;
                        }

                    case 24:
                        {
                            if (count < 8 || (count - 2) % 6 != 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF rcurveline operand count is invalid.");
                            }

                            int curves = count - 2;
                            for (int i = 0; i < curves; i += 6)
                            {
                                if (!AddRelativeCubic(path, stack, i, ref x, ref y, contourOpen, out error))
                                {
                                    return false;
                                }
                            }

                            x += stack[curves];
                            y += stack[curves + 1];
                            if (!AddLine(path, x, y, contourOpen, out error))
                            {
                                return false;
                            }

                            count = 0;
                            break;
                        }

                    case 25:
                        {
                            if (count < 8 || (count - 6) % 2 != 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF rlinecurve operand count is invalid.");
                            }

                            int lines = count - 6;
                            for (int i = 0; i < lines; i += 2)
                            {
                                x += stack[i];
                                y += stack[i + 1];
                                if (!AddLine(path, x, y, contourOpen, out error))
                                {
                                    return false;
                                }
                            }

                            if (!AddRelativeCubic(path, stack, lines, ref x, ref y, contourOpen, out error))
                            {
                                return false;
                            }

                            count = 0;
                            break;
                        }

                    case 26:
                        {
                            if (count < 4)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF vvcurveto operand count is invalid.");
                            }

                            int index = 0;
                            double firstDx = 0.0;
                            if ((count & 3) == 1)
                            {
                                firstDx = stack[0];
                                index = 1;
                            }

                            while (index + 4 <= count)
                            {
                                double dya = stack[index];
                                double dxb = stack[index + 1];
                                double dyb = stack[index + 2];
                                double dyc = stack[index + 3];
                                double c1x = x + firstDx;
                                double c1y = y + dya;
                                double c2x = c1x + dxb;
                                double c2y = c1y + dyb;
                                double ex = c2x;
                                double ey = c2y + dyc;
                                if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
                                {
                                    return false;
                                }

                                x = ex;
                                y = ey;
                                firstDx = 0.0;
                                index += 4;
                            }

                            count = 0;
                            break;
                        }

                    case 27:
                        {
                            if (count < 4)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF hhcurveto operand count is invalid.");
                            }

                            int index = 0;
                            double firstDy = 0.0;
                            if ((count & 3) == 1)
                            {
                                firstDy = stack[0];
                                index = 1;
                            }

                            while (index + 4 <= count)
                            {
                                double dxa = stack[index];
                                double dxb = stack[index + 1];
                                double dyb = stack[index + 2];
                                double dxc = stack[index + 3];
                                double c1x = x + dxa;
                                double c1y = y + firstDy;
                                double c2x = c1x + dxb;
                                double c2y = c1y + dyb;
                                double ex = c2x + dxc;
                                double ey = c2y;
                                if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
                                {
                                    return false;
                                }

                                x = ex;
                                y = ey;
                                firstDy = 0.0;
                                index += 4;
                            }

                            count = 0;
                            break;
                        }

                    case 30:
                    case 31:
                        {
                            if (count < 4)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF alternating curve operand count is invalid.");
                            }

                            int index = 0;
                            bool horizontal = b0 == 31;
                            while (index + 4 <= count)
                            {
                                double first = stack[index];
                                double second = stack[index + 1];
                                double third = stack[index + 2];
                                double fourth = stack[index + 3];
                                double c1x;
                                double c1y;
                                double c2x;
                                double c2y;
                                double ex;
                                double ey;
                                if (horizontal)
                                {
                                    c1x = x + first;
                                    c1y = y;
                                    c2x = c1x + second;
                                    c2y = c1y + third;
                                    ex = c2x;
                                    ey = c2y + fourth;
                                    if (index + 4 == count - 1)
                                    {
                                        ex += stack[count - 1];
                                    }
                                }
                                else
                                {
                                    c1x = x;
                                    c1y = y + first;
                                    c2x = c1x + second;
                                    c2y = c1y + third;
                                    ex = c2x + fourth;
                                    ey = c2y;
                                    if (index + 4 == count - 1)
                                    {
                                        ey += stack[count - 1];
                                    }
                                }

                                if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
                                {
                                    return false;
                                }

                                x = ex;
                                y = ey;
                                horizontal = !horizontal;
                                index += 4;
                            }

                            count = 0;
                            break;
                        }

                    case 10:
                    case 29:
                        {
                            if (count == 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF subroutine call has no operand.");
                            }

                            if (callDepth >= MaxCallDepth)
                            {
                                return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF subroutine depth exceeded.");
                            }

                            UiCffIndex subrs = b0 == 29 ? globalSubrs : localSubrs;
                            int subrIndex = (int)Math.Truncate(stack[--count]) + subrs.GetBias();
                            if (!subrs.TryGetRange(subrIndex, out int subrStart, out int subrEnd))
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF subroutine index is out of range.");
                            }

                            savedPosition[callDepth] = position;
                            savedEnd[callDepth] = codeEnd;
                            callDepth++;
                            position = subrStart;
                            codeEnd = subrEnd;
                            break;
                        }

                    case 11:
                        {
                            if (callDepth == 0)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF return without a subroutine call.");
                            }

                            callDepth--;
                            position = savedPosition[callDepth];
                            codeEnd = savedEnd[callDepth];
                            break;
                        }

                    case 14:
                        {
                            if (count == 4)
                            {
                                return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF seac endchar is not supported.");
                            }

                            CloseContour(path, ref contourOpen, out error);
                            return !error.HasError;
                        }

                    case 12:
                        {
                            if (position >= codeEnd)
                            {
                                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF escaped operator is truncated.");
                            }

                            int b1 = data[position++];
                            if (!ExecuteEscape(
                                    b1,
                                    stack,
                                    transient,
                                    ref count,
                                    ref x,
                                    ref y,
                                    ref contourOpen,
                                    ref stemCount,
                                    ref widthParsed,
                                    path,
                                    position,
                                    out error))
                            {
                                return false;
                            }

                            break;
                        }

                    default:
                        return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF operator is not supported.");
                }

                continue;
            }

            if (!TryReadNumber(data, ref position, codeEnd, b0, out double number, out error))
            {
                return false;
            }

            if (count >= MaxStack)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF operand stack overflow.");
            }

            stack[count++] = number;
        }

        CloseContour(path, ref contourOpen, out error);
        return !error.HasError;
    }

    public static UiCffGlyphBounds Measure(UiCffPath path)
    {
        float minX = float.PositiveInfinity;
        float minY = float.PositiveInfinity;
        float maxX = float.NegativeInfinity;
        float maxY = float.NegativeInfinity;
        bool any = false;
        ReadOnlySpan<UiCffCommand> commands = path.Commands;
        for (int i = 0; i < commands.Length; i++)
        {
            UiCffCommand command = commands[i];
            if (command.Kind == UiCffCommandKind.Close)
            {
                continue;
            }

            Include(command.X0, command.Y0);
            if (command.Kind == UiCffCommandKind.Cubic)
            {
                Include(command.X1, command.Y1);
                Include(command.X2, command.Y2);
            }
        }

        if (!any)
        {
            return UiCffGlyphBounds.Empty;
        }

        return new UiCffGlyphBounds(
            (int)MathF.Floor(minX),
            (int)MathF.Floor(minY),
            (int)MathF.Ceiling(maxX),
            (int)MathF.Ceiling(maxY));

        void Include(float px, float py)
        {
            any = true;
            minX = MathF.Min(minX, px);
            minY = MathF.Min(minY, py);
            maxX = MathF.Max(maxX, px);
            maxY = MathF.Max(maxY, py);
        }
    }

    private static bool ExecuteEscape(
        int b1,
        Span<double> stack,
        Span<double> transient,
        ref int count,
        ref double x,
        ref double y,
        ref bool contourOpen,
        ref int stemCount,
        ref bool widthParsed,
        UiCffPath path,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        switch (b1)
        {
            case 0:
                return true;
            case 1:
            case 2:
                return TakeStemArguments(stack, ref count, ref widthParsed, ref stemCount, out error);
            case 3:
                return Binary(stack, ref count, static (a, b) => (a != 0.0 && b != 0.0) ? 1.0 : 0.0, position, out error);
            case 4:
                return Binary(stack, ref count, static (a, b) => (a != 0.0 || b != 0.0) ? 1.0 : 0.0, position, out error);
            case 5:
                return Unary(stack, ref count, static a => a == 0.0 ? 1.0 : 0.0, position, out error);
            case 6:
                return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF seac is not supported.");
            case 9:
                return Unary(stack, ref count, static a => Math.Abs(a), position, out error);
            case 10:
                return Binary(stack, ref count, static (a, b) => a + b, position, out error);
            case 11:
                return Binary(stack, ref count, static (a, b) => a - b, position, out error);
            case 12:
                return Binary(stack, ref count, static (a, b) => b == 0.0 ? 0.0 : a / b, position, out error);
            case 14:
                return Unary(stack, ref count, static a => -a, position, out error);
            case 15:
                return Binary(stack, ref count, static (a, b) => a == b ? 1.0 : 0.0, position, out error);
            case 16:
            case 17:
                return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF Type 1 subroutine operators are not supported.");
            case 18:
                if (count < 1)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF drop operand is missing.");
                }

                count--;
                return true;
            case 20:
                {
                    if (count < 2)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF put operands are missing.");
                    }

                    int index = (int)Math.Truncate(stack[count - 1]);
                    double value = stack[count - 2];
                    count -= 2;
                    if ((uint)index < (uint)MaxTransient)
                    {
                        transient[index] = value;
                    }

                    return true;
                }
            case 21:
                {
                    if (count < 1)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF get operand is missing.");
                    }

                    int index = (int)Math.Truncate(stack[--count]);
                    double value = (uint)index < (uint)MaxTransient ? transient[index] : 0.0;
                    if (count >= MaxStack)
                    {
                        return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF operand stack overflow.");
                    }

                    stack[count++] = value;
                    return true;
                }
            case 22:
                {
                    if (count < 4)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF ifelse operands are missing.");
                    }

                    double v2 = stack[--count];
                    double v1 = stack[--count];
                    double s2 = stack[--count];
                    double s1 = stack[--count];
                    stack[count++] = s1 <= s2 ? v1 : v2;
                    return true;
                }
            case 23:
                if (count >= MaxStack)
                {
                    return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF operand stack overflow.");
                }

                stack[count++] = 0.5;
                return true;
            case 24:
                return Binary(stack, ref count, static (a, b) => a * b, position, out error);
            case 26:
                return Unary(stack, ref count, static a => Math.Sqrt(Math.Abs(a)), position, out error);
            case 27:
                if (count < 1 || count >= MaxStack)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF dup operand is invalid.");
                }

                stack[count] = stack[count - 1];
                count++;
                return true;
            case 28:
                if (count < 2)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF exch operands are missing.");
                }

                (stack[count - 2], stack[count - 1]) = (stack[count - 1], stack[count - 2]);
                return true;
            case 29:
                {
                    if (count < 1)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF index operand is missing.");
                    }

                    int index = (int)Math.Truncate(stack[--count]);
                    int source = count - 1 - index;
                    double value = source >= 0 ? stack[source] : 0.0;
                    if (count >= MaxStack)
                    {
                        return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF operand stack overflow.");
                    }

                    stack[count++] = value;
                    return true;
                }
            case 30:
                {
                    if (count < 2)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF roll operands are missing.");
                    }

                    int n = (int)Math.Truncate(stack[--count]);
                    int j = (int)Math.Truncate(stack[--count]);
                    if (n <= 0 || n > count)
                    {
                        return true;
                    }

                    int shift = ((j % n) + n) % n;
                    for (int s = 0; s < shift; s++)
                    {
                        double temp = stack[count - 1];
                        for (int i = count - 1; i > count - n; i--)
                        {
                            stack[i] = stack[i - 1];
                        }

                        stack[count - n] = temp;
                    }

                    return true;
                }
            case 34:
                return FlexH(stack, ref count, ref x, ref y, ref contourOpen, path, position, out error);
            case 35:
                return Flex(stack, ref count, ref x, ref y, ref contourOpen, path, position, out error);
            case 36:
                return FlexH1(stack, ref count, ref x, ref y, ref contourOpen, path, position, out error);
            case 37:
                return Flex1(stack, ref count, ref x, ref y, ref contourOpen, path, position, out error);
            default:
                return Fail(out error, UiFontErrorCode.UnsupportedGlyph, position, "CFF escaped operator is not supported.");
        }
    }

    private static bool Flex(
        Span<double> stack,
        ref int count,
        ref double x,
        ref double y,
        ref bool contourOpen,
        UiCffPath path,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 13)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF flex operands are missing.");
        }

        double startX = x;
        double startY = y;
        double c1x = startX + stack[0];
        double c1y = startY + stack[1];
        double c2x = c1x + stack[2];
        double c2y = c1y + stack[3];
        double ex = c2x + stack[4];
        double ey = c2y + stack[5];
        if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
        {
            return false;
        }

        double start2X = ex;
        double start2Y = ey;
        double d1x = start2X + stack[6];
        double d1y = start2Y + stack[7];
        double d2x = d1x + stack[8];
        double d2y = d1y + stack[9];
        double ex2 = d2x + stack[10];
        double ey2 = d2y + stack[11];
        if (!AddCubic(path, d1x, d1y, d2x, d2y, ex2, ey2, contourOpen, out error))
        {
            return false;
        }

        x = ex2;
        y = ey2;
        count = 0;
        return true;
    }

    private static bool FlexH(
        Span<double> stack,
        ref int count,
        ref double x,
        ref double y,
        ref bool contourOpen,
        UiCffPath path,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 7)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF hflex operands are missing.");
        }

        double startX = x;
        double startY = y;
        double c1x = startX + stack[0];
        double c2x = c1x + stack[1];
        double c2y = startY + stack[2];
        double ex = c2x + stack[3];
        if (!AddCubic(path, c1x, startY, c2x, c2y, ex, c2y, contourOpen, out error))
        {
            return false;
        }

        double d1x = ex + stack[4];
        double d2x = d1x + stack[5];
        double ex2 = d2x + stack[6];
        if (!AddCubic(path, d1x, c2y, d2x, startY, ex2, startY, contourOpen, out error))
        {
            return false;
        }

        x = ex2;
        y = startY;
        count = 0;
        return true;
    }

    private static bool FlexH1(
        Span<double> stack,
        ref int count,
        ref double x,
        ref double y,
        ref bool contourOpen,
        UiCffPath path,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 9)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF hflex1 operands are missing.");
        }

        double startX = x;
        double startY = y;
        double c1x = startX + stack[0];
        double c1y = startY + stack[1];
        double c2x = c1x + stack[2];
        double c2y = c1y + stack[3];
        double ex = c2x + stack[4];
        if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, c2y, contourOpen, out error))
        {
            return false;
        }

        double d1x = ex + stack[5];
        double d2x = d1x + stack[6];
        double d2y = c2y + stack[7];
        double ex2 = d2x + stack[8];
        double ey2 = startY - (stack[1] + stack[3] + stack[7]);
        if (!AddCubic(path, d1x, c2y, d2x, d2y, ex2, ey2, contourOpen, out error))
        {
            return false;
        }

        x = ex2;
        y = ey2;
        count = 0;
        return true;
    }

    private static bool Flex1(
        Span<double> stack,
        ref int count,
        ref double x,
        ref double y,
        ref bool contourOpen,
        UiCffPath path,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 11)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF flex1 operands are missing.");
        }

        double startX = x;
        double startY = y;
        double dx = stack[0] + stack[2] + stack[4] + stack[6] + stack[8];
        double dy = stack[1] + stack[3] + stack[5] + stack[7] + stack[9];
        double dx6 = Math.Abs(dx) > Math.Abs(dy) ? stack[10] : -dx;
        double dy6 = Math.Abs(dx) > Math.Abs(dy) ? -dy : stack[10];

        double c1x = startX + stack[0];
        double c1y = startY + stack[1];
        double c2x = c1x + stack[2];
        double c2y = c1y + stack[3];
        double ex = c2x + stack[4];
        double ey = c2y + stack[5];
        if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
        {
            return false;
        }

        double d1x = ex + stack[6];
        double d1y = ey + stack[7];
        double d2x = d1x + stack[8];
        double d2y = d1y + stack[9];
        double ex2 = d2x + dx6;
        double ey2 = d2y + dy6;
        if (!AddCubic(path, d1x, d1y, d2x, d2y, ex2, ey2, contourOpen, out error))
        {
            return false;
        }

        x = ex2;
        y = ey2;
        count = 0;
        return true;
    }

    private static bool TryReadNumber(
        ReadOnlySpan<byte> data,
        ref int position,
        int end,
        int b0,
        out double value,
        out UiFontError error)
    {
        value = 0.0;
        error = UiFontError.None;
        if (b0 == 28)
        {
            if (position + 2 > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF number is truncated.");
            }

            value = UiFontFace.ReadI16(data, position);
            position += 2;
            return true;
        }

        if (b0 == 255)
        {
            if (position + 4 > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF fixed number is truncated.");
            }

            value = UiFontFace.ReadI32(data, position) / 65536.0;
            position += 4;
            return true;
        }

        if (b0 >= 32 && b0 <= 246)
        {
            value = b0 - 139;
            return true;
        }

        if (b0 >= 247 && b0 <= 250)
        {
            if (position >= end)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF number is truncated.");
            }

            value = ((b0 - 247) * 256) + data[position++] + 108;
            return true;
        }

        if (b0 >= 251 && b0 <= 254)
        {
            if (position >= end)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF number is truncated.");
            }

            value = -((b0 - 251) * 256) - data[position++] - 108;
            return true;
        }

        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF number encoding is invalid.");
    }

    private static bool TakeStemArguments(
        Span<double> stack,
        ref int count,
        ref bool widthParsed,
        ref int stemCount,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (!widthParsed && (count & 1) != 0)
        {
            for (int i = 0; i < count - 1; i++)
            {
                stack[i] = stack[i + 1];
            }

            count--;
            widthParsed = true;
        }

        stemCount += count / 2;
        count = 0;
        return true;
    }

    private static bool TakeMoveArguments(
        Span<double> stack,
        ref int count,
        int required,
        ref bool widthParsed,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (!widthParsed && count == required + 1)
        {
            for (int i = 0; i < count - 1; i++)
            {
                stack[i] = stack[i + 1];
            }

            count--;
            widthParsed = true;
        }

        if (count != required)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, 0, "CFF moveto operand count is invalid.");
        }

        widthParsed = true;
        return true;
    }

    private static bool AddMove(
        UiCffPath path,
        double x,
        double y,
        ref bool contourOpen,
        ref double contourStartX,
        ref double contourStartY,
        out UiFontError error)
    {
        error = UiFontError.None;
        CloseContour(path, ref contourOpen, out error);
        if (error.HasError)
        {
            return false;
        }

        if (!path.TryAdd(new UiCffCommand(UiCffCommandKind.Move, (float)x, (float)y, 0.0f, 0.0f, 0.0f, 0.0f)))
        {
            return Fail(out error, UiFontErrorCode.OutlineTooComplex, 0, "CFF path command limit exceeded.");
        }

        contourOpen = true;
        contourStartX = x;
        contourStartY = y;
        return true;
    }

    private static bool AddLine(UiCffPath path, double x, double y, bool contourOpen, out UiFontError error)
    {
        error = UiFontError.None;
        if (!contourOpen)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, 0, "CFF line appears before a moveto.");
        }

        if (!path.TryAdd(new UiCffCommand(UiCffCommandKind.Line, (float)x, (float)y, 0.0f, 0.0f, 0.0f, 0.0f)))
        {
            return Fail(out error, UiFontErrorCode.OutlineTooComplex, 0, "CFF path command limit exceeded.");
        }

        return true;
    }

    private static bool AddCubic(
        UiCffPath path,
        double c1x,
        double c1y,
        double c2x,
        double c2y,
        double x,
        double y,
        bool contourOpen,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (!contourOpen)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, 0, "CFF curve appears before a moveto.");
        }

        if (!path.TryAdd(new UiCffCommand(
                UiCffCommandKind.Cubic,
                (float)x,
                (float)y,
                (float)c1x,
                (float)c1y,
                (float)c2x,
                (float)c2y)))
        {
            return Fail(out error, UiFontErrorCode.OutlineTooComplex, 0, "CFF path command limit exceeded.");
        }

        return true;
    }

    private static bool AddRelativeCubic(
        UiCffPath path,
        Span<double> stack,
        int index,
        ref double x,
        ref double y,
        bool contourOpen,
        out UiFontError error)
    {
        double c1x = x + stack[index];
        double c1y = y + stack[index + 1];
        double c2x = c1x + stack[index + 2];
        double c2y = c1y + stack[index + 3];
        double ex = c2x + stack[index + 4];
        double ey = c2y + stack[index + 5];
        if (!AddCubic(path, c1x, c1y, c2x, c2y, ex, ey, contourOpen, out error))
        {
            return false;
        }

        x = ex;
        y = ey;
        return true;
    }

    private static void CloseContour(UiCffPath path, ref bool contourOpen, out UiFontError error)
    {
        error = UiFontError.None;
        if (!contourOpen)
        {
            return;
        }

        contourOpen = false;
        if (!path.TryAdd(new UiCffCommand(UiCffCommandKind.Close, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f)))
        {
            error = UiFontError.At(UiFontErrorCode.OutlineTooComplex, 0, "CFF path command limit exceeded.");
        }
    }

    private static bool Unary(
        Span<double> stack,
        ref int count,
        Func<double, double> operation,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF unary operand is missing.");
        }

        stack[count - 1] = operation(stack[count - 1]);
        return true;
    }

    private static bool Binary(
        Span<double> stack,
        ref int count,
        Func<double, double, double> operation,
        int position,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (count < 2)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF binary operands are missing.");
        }

        double right = stack[count - 1];
        double left = stack[count - 2];
        count--;
        stack[count - 1] = operation(left, right);
        return true;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
