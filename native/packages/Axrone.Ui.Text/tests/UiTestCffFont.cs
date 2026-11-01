namespace Axrone.Ui.Text.Tests;

using System.Text;

internal static class UiTestCffFont
{
    public static byte[] CreateTable()
    {
        byte[][] charStrings =
        [
            EndChar(),
            EndChar(),
            Box(50, 0, 500, 600),
            Triangle(),
            Curve(),
            LocalSubrCall(),
            GlobalSubrCall(),
            Box(50, 600, 200, 200),
            Box(0, 0, 600, 700),
            Box(0, 0, 650, 700),
            FlexGlyph(),
            HhCurveGlyph(),
        ];

        byte[] localSubr = LocalSubr();
        byte[] globalSubr = GlobalSubr();
        byte[] name = BuildIndex([Encoding.ASCII.GetBytes("Test")]);
        byte[] strings = BuildIndex([]);
        byte[] global = BuildIndex([globalSubr]);
        byte[] chars = BuildIndex(charStrings);

        var privateDict = new List<byte>();
        AddNumber(privateDict, 2);
        privateDict.Add(19);
        byte[] privateBytes = [.. privateDict];
        byte[] local = BuildIndex([localSubr]);

        byte[] placeholder = BuildTopDict(0, privateBytes.Length, 0);
        int topLength = BuildIndex([placeholder]).Length;
        int topStart = 4 + name.Length;
        int stringStart = topStart + topLength;
        int globalStart = stringStart + strings.Length;
        int charStart = globalStart + global.Length;
        int privateStart = charStart + chars.Length;

        byte[] top = BuildTopDict(charStart, privateBytes.Length, privateStart);
        byte[] topIndex = BuildIndex([top]);

        var cff = new List<byte>(privateStart + privateBytes.Length + local.Length);
        cff.AddRange([1, 0, 4, 4]);
        cff.AddRange(name);
        cff.AddRange(topIndex);
        cff.AddRange(strings);
        cff.AddRange(global);
        cff.AddRange(chars);
        cff.AddRange(privateBytes);
        cff.AddRange(local);
        return [.. cff];
    }

    private static byte[] EndChar() => [14];

    private static byte[] Box(int x, int y, int width, int height)
    {
        var data = new List<byte>();
        AddNumber(data, x);
        AddNumber(data, y);
        data.Add(21);
        AddNumber(data, width);
        AddNumber(data, 0);
        data.Add(5);
        AddNumber(data, 0);
        AddNumber(data, height);
        data.Add(5);
        AddNumber(data, -width);
        AddNumber(data, 0);
        data.Add(5);
        data.Add(14);
        return [.. data];
    }

    private static byte[] Triangle()
    {
        var data = new List<byte>();
        AddNumber(data, 0);
        AddNumber(data, 600);
        data.Add(21);
        AddNumber(data, 300);
        AddNumber(data, -600);
        data.Add(5);
        AddNumber(data, 300);
        AddNumber(data, 600);
        data.Add(5);
        data.Add(14);
        return [.. data];
    }

    private static byte[] FlexGlyph()
    {
        var data = new List<byte>();
        AddNumber(data, 0);
        AddNumber(data, 0);
        data.Add(21);
        AddNumber(data, 0);
        AddNumber(data, 0);
        AddNumber(data, 100);
        AddNumber(data, 200);
        AddNumber(data, 100);
        AddNumber(data, 0);
        AddNumber(data, 0);
        AddNumber(data, 0);
        AddNumber(data, 100);
        AddNumber(data, -200);
        AddNumber(data, 100);
        AddNumber(data, 0);
        AddNumber(data, 50);
        data.Add(12);
        data.Add(35);
        data.Add(14);
        return [.. data];
    }

    private static byte[] HhCurveGlyph()
    {
        var data = new List<byte>();
        AddNumber(data, 0);
        AddNumber(data, 0);
        data.Add(21);
        AddNumber(data, 300);
        AddNumber(data, 0);
        AddNumber(data, 300);
        AddNumber(data, 0);
        data.Add(27);
        data.Add(14);
        return [.. data];
    }

    private static byte[] Curve()
    {
        var data = new List<byte>();
        AddNumber(data, 0);
        AddNumber(data, 0);
        data.Add(21);
        AddNumber(data, 0);
        AddNumber(data, 500);
        AddNumber(data, 300);
        AddNumber(data, 0);
        AddNumber(data, 0);
        AddNumber(data, -500);
        data.Add(8);
        data.Add(14);
        return [.. data];
    }

    private static byte[] LocalSubrCall()
    {
        var data = new List<byte>();
        AddNumber(data, 50);
        AddNumber(data, 0);
        data.Add(21);
        AddNumber(data, -107);
        data.Add(10);
        data.Add(14);
        return [.. data];
    }

    private static byte[] GlobalSubrCall()
    {
        var data = new List<byte>();
        AddNumber(data, 50);
        AddNumber(data, 0);
        data.Add(21);
        AddNumber(data, -107);
        data.Add(29);
        data.Add(14);
        return [.. data];
    }

    private static byte[] LocalSubr()
    {
        var data = new List<byte>();
        AddNumber(data, 500);
        AddNumber(data, 0);
        data.Add(5);
        AddNumber(data, 0);
        AddNumber(data, 400);
        data.Add(5);
        AddNumber(data, -500);
        AddNumber(data, 0);
        data.Add(5);
        data.Add(11);
        return [.. data];
    }

    private static byte[] GlobalSubr()
    {
        var data = new List<byte>();
        AddNumber(data, 300);
        AddNumber(data, 400);
        data.Add(5);
        AddNumber(data, -300);
        AddNumber(data, 0);
        data.Add(5);
        data.Add(11);
        return [.. data];
    }

    private static byte[] BuildTopDict(int charStringsOffset, int privateSize, int privateOffset)
    {
        var data = new List<byte>();
        data.Add(29);
        WriteI32(data, charStringsOffset);
        data.Add(17);
        data.Add(29);
        WriteI32(data, privateSize);
        data.Add(29);
        WriteI32(data, privateOffset);
        data.Add(18);
        return [.. data];
    }

    private static byte[] BuildIndex(byte[][] objects)
    {
        if (objects.Length == 0)
        {
            return [0, 0];
        }

        int dataLength = 0;
        foreach (byte[] item in objects)
        {
            dataLength += item.Length;
        }

        int offsetSize = dataLength < 256 ? 1 : dataLength < 65536 ? 2 : 3;
        var data = new List<byte>(dataLength + 3 + ((objects.Length + 1) * offsetSize));
        data.Add((byte)(objects.Length >> 8));
        data.Add((byte)objects.Length);
        data.Add((byte)offsetSize);
        int offset = 1;
        WriteOffset(data, offset, offsetSize);
        foreach (byte[] item in objects)
        {
            offset += item.Length;
            WriteOffset(data, offset, offsetSize);
        }

        foreach (byte[] item in objects)
        {
            data.AddRange(item);
        }

        return [.. data];
    }

    private static void AddNumber(List<byte> data, int value)
    {
        if (value >= -107 && value <= 107)
        {
            data.Add((byte)(value + 139));
            return;
        }

        if (value >= 108 && value <= 1131)
        {
            int adjusted = value - 108;
            data.Add((byte)(247 + (adjusted / 256)));
            data.Add((byte)(adjusted % 256));
            return;
        }

        if (value <= -108 && value >= -1131)
        {
            int adjusted = -value - 108;
            data.Add((byte)(251 + (adjusted / 256)));
            data.Add((byte)(adjusted % 256));
            return;
        }

        data.Add(28);
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }

    private static void WriteOffset(List<byte> data, int value, int size)
    {
        for (int shift = (size - 1) * 8; shift >= 0; shift -= 8)
        {
            data.Add((byte)(value >> shift));
        }
    }

    private static void WriteI32(List<byte> data, int value)
    {
        data.Add((byte)(value >> 24));
        data.Add((byte)(value >> 16));
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }
}
