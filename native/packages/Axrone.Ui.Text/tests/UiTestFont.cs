namespace Axrone.Ui.Text.Tests;

using System.IO;

internal static class UiTestFont
{
    public const int UnitsPerEm = 1000;
    public const int GlyphCount = 12;

    public static readonly int[] Advances = [500, 300, 600, 600, 350, 250, 250, 200, 600, 650, 600, 600];
    public static readonly int[] LeftBearings = [0, 0, 0, 0, 50, 50, 50, 50, 0, 0, 100, 0];

    public static byte[] Create(bool format12 = false, bool cff = false, int hMetrics = 0) =>
        CreateCore(format12 ? 12 : 4, cff, hMetrics);

    public static byte[] CreateFormat0() => CreateCore(0, false, 0);

    public static byte[] CreateFormat6() => CreateCore(6, false, 0);

    public static byte[] CreateFormat13() => CreateCore(13, false, 0);

    public static byte[] CreateFormat14() => CreateCore(14, false, 0);

    private static byte[] CreateCore(int cmapFormat, bool cff, int hMetrics)
    {
        List<byte[]> glyphs =
        [
            EmptyGlyph(),
            EmptyGlyph(),
            SimpleGlyph((0, 0), (300, 700), (600, 0)),
            SimpleGlyph((0, 700), (300, 0), (600, 700)),
            BoxGlyph(50, 0, 400, 700),
            BoxGlyph(50, 0, 250, 700),
            BoxGlyph(50, 0, 250, 700),
            BoxGlyph(50, 600, 250, 800),
            BoxGlyph(0, 0, 600, 700),
            BoxGlyph(0, 0, 650, 700),
            CompositeGlyph(2, 100, 0, 100, 0, 700, 700),
            BoxGlyph(0, 0, 600, 200),
        ];

        List<(int CodePoint, int GlyphId)> mappings =
        [
            (0x20, 1),
            (0x41, 2),
            (0x42, 10),
            (0x56, 3),
            (0x66, 4),
            (0x69, 5),
            (0x6C, 6),
            (0xE9, 8),
            (0x301, 7),
            (0x2026, 11),
            (0xFB01, 9),
        ];
        mappings.Sort(static (left, right) => left.CodePoint.CompareTo(right.CodePoint));

        List<(int Left, int Right, int Value)> kernPairs =
        [
            (2, 3, -80),
            (3, 2, -80),
            (4, 5, -30),
        ];

        int metrics = hMetrics <= 0 ? glyphs.Count : hMetrics;
        return Build(glyphs, Advances, LeftBearings, mappings, kernPairs, metrics, cmapFormat, cff);
    }

    public static byte[] CreateFallback()
    {
        List<byte[]> glyphs = [EmptyGlyph(), BoxGlyph(0, 0, 500, 700)];
        List<(int CodePoint, int GlyphId)> mappings = [(0x5A, 1)];
        return Build(glyphs, [500, 500], [0, 0], mappings, [], 2, 4, false);
    }

    public static byte[] LoadRealFont()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fonts", "kenpixel.ttf");
        File.Exists(path).ShouldBeTrue($"The real test font is missing at '{path}'.");
        return File.ReadAllBytes(path);
    }

    public static int TableOffset(byte[] font, string tag)
    {
        int record = TableRecord(font, tag);
        return record < 0 ? -1 : (int)ReadU32(font, record + 8);
    }

    public static int TableRecord(byte[] font, string tag)
    {
        int count = ReadU16(font, 4);
        for (int i = 0; i < count; i++)
        {
            int record = 12 + (i * 16);
            if (font[record] == tag[0] && font[record + 1] == tag[1] &&
                font[record + 2] == tag[2] && font[record + 3] == tag[3])
            {
                return record;
            }
        }

        return -1;
    }

    public static byte[] EmptyGlyph() => [];

    public static byte[] BoxGlyph(int xMin, int yMin, int xMax, int yMax) =>
        SimpleGlyph((xMin, yMin), (xMax, yMin), (xMax, yMax), (xMin, yMax));

    public static byte[] SimpleGlyph(params (int X, int Y)[] points)
    {
        int xMin = int.MaxValue;
        int yMin = int.MaxValue;
        int xMax = int.MinValue;
        int yMax = int.MinValue;
        foreach ((int x, int y) in points)
        {
            xMin = Math.Min(xMin, x);
            yMin = Math.Min(yMin, y);
            xMax = Math.Max(xMax, x);
            yMax = Math.Max(yMax, y);
        }

        var data = new List<byte>(32);
        WriteI16(data, 1);
        WriteI16(data, xMin);
        WriteI16(data, yMin);
        WriteI16(data, xMax);
        WriteI16(data, yMax);
        WriteU16(data, points.Length - 1);
        WriteU16(data, 0);
        for (int i = 0; i < points.Length; i++)
        {
            data.Add(0x01);
        }

        int previous = 0;
        foreach ((int x, _) in points)
        {
            WriteI16(data, x - previous);
            previous = x;
        }

        previous = 0;
        foreach ((_, int y) in points)
        {
            WriteI16(data, y - previous);
            previous = y;
        }

        return [.. data];
    }

    public static byte[] CompositeGlyph(int glyphId, int dx, int dy, int xMin, int yMin, int xMax, int yMax)
    {
        var data = new List<byte>(18);
        WriteI16(data, -1);
        WriteI16(data, xMin);
        WriteI16(data, yMin);
        WriteI16(data, xMax);
        WriteI16(data, yMax);
        WriteU16(data, 0x0003);
        WriteU16(data, glyphId);
        WriteI16(data, dx);
        WriteI16(data, dy);
        return [.. data];
    }

    private static byte[] Build(
        List<byte[]> glyphs,
        int[] advances,
        int[] bearings,
        List<(int CodePoint, int GlyphId)> mappings,
        List<(int Left, int Right, int Value)> kernPairs,
        int hMetrics,
        int cmapFormat,
        bool cff)
    {
        var tables = new List<(string Tag, byte[] Data)>
        {
            ("head", BuildHead()),
            ("hhea", BuildHhea(advances, hMetrics)),
            ("maxp", BuildMaxp(glyphs.Count)),
            ("hmtx", BuildHmtx(advances, bearings, hMetrics, glyphs.Count)),
            ("cmap", BuildCmap(mappings, cmapFormat)),
        };

        if (!cff)
        {
            tables.Add(("glyf", BuildGlyf(glyphs)));
            tables.Add(("loca", BuildLoca(glyphs)));
        }
        else
        {
            tables.Add(("CFF ", UiTestCffFont.CreateTable()));
        }

        if (kernPairs.Count > 0)
        {
            tables.Add(("kern", BuildKern(kernPairs)));
        }

        tables.Sort(static (left, right) => string.CompareOrdinal(left.Tag, right.Tag));

        int tableCount = tables.Count;
        int searchRange = 16 * (1 << FloorLog2(tableCount));
        int entrySelector = FloorLog2(tableCount);
        int rangeShift = (tableCount * 16) - searchRange;

        var file = new List<byte>(4096);
        WriteU32(file, cff ? 0x4F54544Fu : 0x00010000u);
        WriteU16(file, tableCount);
        WriteU16(file, searchRange);
        WriteU16(file, entrySelector);
        WriteU16(file, rangeShift);

        int directoryStart = file.Count;
        for (int i = 0; i < tableCount; i++)
        {
            for (int b = 0; b < 16; b++)
            {
                file.Add(0);
            }
        }

        int cursor = file.Count;
        for (int i = 0; i < tableCount; i++)
        {
            while ((cursor & 3) != 0)
            {
                file.Add(0);
                cursor++;
            }

            (string tag, byte[] data) = tables[i];
            int tableOffset = cursor;
            file.AddRange(data);
            cursor += data.Length;

            int record = directoryStart + (i * 16);
            WriteTag(file, record, tag);
            PatchU32(file, record + 4, Checksum(data));
            PatchU32(file, record + 8, (uint)tableOffset);
            PatchU32(file, record + 12, (uint)data.Length);
        }

        return [.. file];
    }

    private static byte[] BuildHead()
    {
        var data = new List<byte>(54);
        WriteU32(data, 0x00010000u);
        WriteU32(data, 0x00010000u);
        WriteU32(data, 0);
        WriteU32(data, 0x5F0F3CF5u);
        WriteU16(data, 0x0003);
        WriteU16(data, UnitsPerEm);
        for (int i = 0; i < 4; i++)
        {
            WriteU32(data, 0);
        }

        WriteI16(data, -128);
        WriteI16(data, -200);
        WriteI16(data, 800);
        WriteI16(data, 800);
        WriteU16(data, 0);
        WriteU16(data, 8);
        WriteI16(data, 2);
        WriteI16(data, 0);
        WriteI16(data, 0);
        return [.. data];
    }

    private static byte[] BuildHhea(int[] advances, int hMetrics)
    {
        int maxAdvance = 0;
        foreach (int advance in advances)
        {
            maxAdvance = Math.Max(maxAdvance, advance);
        }

        var data = new List<byte>(36);
        WriteU32(data, 0x00010000u);
        WriteI16(data, 800);
        WriteI16(data, -200);
        WriteI16(data, 100);
        WriteU16(data, maxAdvance);
        WriteI16(data, 0);
        WriteI16(data, 0);
        WriteI16(data, maxAdvance);
        WriteI16(data, 1);
        WriteI16(data, 0);
        WriteI16(data, 0);
        for (int i = 0; i < 4; i++)
        {
            WriteI16(data, 0);
        }

        WriteI16(data, 0);
        WriteU16(data, hMetrics);
        return [.. data];
    }

    private static byte[] BuildMaxp(int glyphCount)
    {
        var data = new List<byte>(32);
        WriteU32(data, 0x00010000u);
        WriteU16(data, glyphCount);
        WriteU16(data, 8);
        WriteU16(data, 2);
        WriteU16(data, 8);
        WriteU16(data, 2);
        WriteU16(data, 2);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 1);
        WriteU16(data, 1);
        return [.. data];
    }

    private static byte[] BuildHmtx(int[] advances, int[] bearings, int hMetrics, int glyphCount)
    {
        var data = new List<byte>(glyphCount * 4);
        for (int i = 0; i < hMetrics; i++)
        {
            WriteU16(data, advances[i]);
            WriteI16(data, bearings[i]);
        }

        for (int i = hMetrics; i < glyphCount; i++)
        {
            WriteI16(data, bearings[i]);
        }

        return [.. data];
    }

    private static byte[] BuildCmap(List<(int CodePoint, int GlyphId)> mappings, int format)
    {
        if (format == 14)
        {
            return BuildCmap14(mappings);
        }

        byte[] subtable = format switch
        {
            0 => BuildFormat0Subtable(mappings),
            4 => BuildFormat4Subtable(mappings),
            6 => BuildFormat6Subtable(mappings),
            12 => BuildFormat12Subtable(mappings),
            13 => BuildFormat13Subtable(mappings),
            _ => throw new ArgumentOutOfRangeException(nameof(format)),
        };

        (int platform, int encoding) = format is 12 or 13 ? (3, 10) : (3, 1);
        var table = new List<byte>(12 + subtable.Length);
        WriteU16(table, 0);
        WriteU16(table, 1);
        WriteU16(table, platform);
        WriteU16(table, encoding);
        WriteU32(table, 12);
        table.AddRange(subtable);
        return [.. table];
    }

    private static byte[] BuildFormat0Subtable(List<(int CodePoint, int GlyphId)> mappings)
    {
        var subtable = new List<byte>(262);
        WriteU16(subtable, 0);
        WriteU16(subtable, 262);
        WriteU16(subtable, 0);
        var glyphs = new byte[256];
        foreach ((int codePoint, int glyphId) in mappings)
        {
            if (codePoint < 256)
            {
                glyphs[codePoint] = (byte)glyphId;
            }
        }

        foreach (byte glyph in glyphs)
        {
            subtable.Add(glyph);
        }

        return [.. subtable];
    }

    private static byte[] BuildFormat4Subtable(List<(int CodePoint, int GlyphId)> mappings)
    {
        int segmentCount = mappings.Count + 1;
        int segmentCountX2 = segmentCount * 2;
        int length = 16 + (segmentCount * 8);
        int searchRange = 2 * (1 << FloorLog2(segmentCount));
        int entrySelector = FloorLog2(segmentCount);
        int rangeShift = segmentCountX2 - searchRange;
        var subtable = new List<byte>(length);
        WriteU16(subtable, 4);
        WriteU16(subtable, length);
        WriteU16(subtable, 0);
        WriteU16(subtable, segmentCountX2);
        WriteU16(subtable, searchRange);
        WriteU16(subtable, entrySelector);
        WriteU16(subtable, rangeShift);
        foreach ((int codePoint, _) in mappings)
        {
            WriteU16(subtable, codePoint);
        }

        WriteU16(subtable, 0xFFFF);
        WriteU16(subtable, 0);
        foreach ((int codePoint, _) in mappings)
        {
            WriteU16(subtable, codePoint);
        }

        WriteU16(subtable, 0xFFFF);
        foreach ((int codePoint, int glyphId) in mappings)
        {
            WriteI16(subtable, glyphId - codePoint);
        }

        WriteI16(subtable, 1);
        for (int i = 0; i < segmentCount; i++)
        {
            WriteU16(subtable, 0);
        }

        return [.. subtable];
    }

    private static byte[] BuildFormat6Subtable(List<(int CodePoint, int GlyphId)> mappings)
    {
        const int First = 0x20;
        const int Count = 0x50;
        var subtable = new List<byte>(10 + (Count * 2));
        WriteU16(subtable, 6);
        WriteU16(subtable, 10 + (Count * 2));
        WriteU16(subtable, 0);
        WriteU16(subtable, First);
        WriteU16(subtable, Count);
        for (int i = 0; i < Count; i++)
        {
            int codePoint = First + i;
            int glyph = 0;
            foreach ((int mappedCodePoint, int glyphId) in mappings)
            {
                if (mappedCodePoint == codePoint)
                {
                    glyph = glyphId;
                    break;
                }
            }

            WriteU16(subtable, glyph);
        }

        return [.. subtable];
    }

    private static byte[] BuildFormat12Subtable(List<(int CodePoint, int GlyphId)> mappings)
    {
        var groups = new List<(int Start, int End, int Glyph)>(mappings.Count + 1);
        foreach ((int codePoint, int glyphId) in mappings)
        {
            groups.Add((codePoint, codePoint, glyphId));
        }

        groups.Add((0x1F600, 0x1F600, 8));
        groups.Sort(static (left, right) => left.Start.CompareTo(right.Start));
        int length = 16 + (groups.Count * 12);
        var subtable = new List<byte>(length);
        WriteU16(subtable, 12);
        WriteU16(subtable, 0);
        WriteU32(subtable, (uint)length);
        WriteU32(subtable, 0);
        WriteU32(subtable, (uint)groups.Count);
        foreach ((int start, int end, int glyph) in groups)
        {
            WriteU32(subtable, (uint)start);
            WriteU32(subtable, (uint)end);
            WriteU32(subtable, (uint)glyph);
        }

        return [.. subtable];
    }

    private static byte[] BuildFormat13Subtable(List<(int CodePoint, int GlyphId)> mappings)
    {
        var groups = new List<(int Start, int End, int Glyph)>(mappings.Count + 1);
        foreach ((int codePoint, int glyphId) in mappings)
        {
            groups.Add((codePoint, codePoint, glyphId));
        }

        groups.Add((0x60, 0x61, 8));
        groups.Sort(static (left, right) => left.Start.CompareTo(right.Start));
        int length = 16 + (groups.Count * 12);
        var subtable = new List<byte>(length);
        WriteU16(subtable, 13);
        WriteU16(subtable, 0);
        WriteU32(subtable, (uint)length);
        WriteU32(subtable, 0);
        WriteU32(subtable, (uint)groups.Count);
        foreach ((int start, int end, int glyph) in groups)
        {
            WriteU32(subtable, (uint)start);
            WriteU32(subtable, (uint)end);
            WriteU32(subtable, (uint)glyph);
        }

        return [.. subtable];
    }

    private static byte[] BuildCmap14(List<(int CodePoint, int GlyphId)> mappings)
    {
        byte[] baseSubtable = BuildFormat4Subtable(mappings);
        const int HeaderSize = 20;
        const int UvsLength = 49;
        const int DefaultOffset = 32;
        const int NonDefaultOffset = 40;
        int uvsOffset = HeaderSize + baseSubtable.Length;
        var uvs = new List<byte>(UvsLength);
        WriteU16(uvs, 14);
        WriteU32(uvs, UvsLength);
        WriteU32(uvs, 2);
        WriteU24(uvs, 0xFE0F);
        WriteU32(uvs, DefaultOffset);
        WriteU32(uvs, NonDefaultOffset);
        WriteU24(uvs, 0xFE0E);
        WriteU32(uvs, DefaultOffset);
        WriteU32(uvs, 0);
        WriteU32(uvs, 1);
        WriteU24(uvs, 0x41);
        uvs.Add(0);
        WriteU32(uvs, 1);
        WriteU24(uvs, 0x41);
        WriteU16(uvs, 3);

        var table = new List<byte>(HeaderSize + baseSubtable.Length + uvs.Count);
        WriteU16(table, 0);
        WriteU16(table, 2);
        WriteU16(table, 3);
        WriteU16(table, 1);
        WriteU32(table, HeaderSize);
        WriteU16(table, 0);
        WriteU16(table, 5);
        WriteU32(table, (uint)uvsOffset);
        table.AddRange(baseSubtable);
        table.AddRange(uvs);
        return [.. table];
    }

    private static byte[] BuildGlyf(List<byte[]> glyphs)
    {
        var data = new List<byte>(4096);
        foreach (byte[] glyph in glyphs)
        {
            data.AddRange(glyph);
            if ((glyph.Length & 1) != 0)
            {
                data.Add(0);
            }
        }

        return [.. data];
    }

    private static byte[] BuildLoca(List<byte[]> glyphs)
    {
        var offsets = new List<int>(glyphs.Count + 1) { 0 };
        int total = 0;
        foreach (byte[] glyph in glyphs)
        {
            total += glyph.Length + (glyph.Length & 1);
            offsets.Add(total);
        }

        var data = new List<byte>(offsets.Count * 2);
        foreach (int offset in offsets)
        {
            WriteU16(data, offset / 2);
        }

        return [.. data];
    }

    private static byte[] BuildKern(List<(int Left, int Right, int Value)> pairs)
    {
        pairs.Sort(static (left, right) =>
        {
            int leftKey = (left.Left << 16) | left.Right;
            int rightKey = (right.Left << 16) | right.Right;
            return leftKey.CompareTo(rightKey);
        });

        int subtableLength = 14 + (pairs.Count * 6);
        int searchRange = 2 * (1 << FloorLog2(pairs.Count));
        int entrySelector = FloorLog2(pairs.Count);
        int rangeShift = (pairs.Count * 6) - (searchRange * 2);

        var subtable = new List<byte>(subtableLength);
        WriteU16(subtable, 0);
        WriteU16(subtable, subtableLength);
        WriteU16(subtable, 0x0001);
        WriteU16(subtable, pairs.Count);
        WriteU16(subtable, searchRange);
        WriteU16(subtable, entrySelector);
        WriteU16(subtable, rangeShift);
        foreach ((int left, int right, int value) in pairs)
        {
            WriteU16(subtable, left);
            WriteU16(subtable, right);
            WriteI16(subtable, value);
        }

        var table = new List<byte>(4 + subtable.Count);
        WriteU16(table, 0);
        WriteU16(table, 1);
        table.AddRange(subtable);
        return [.. table];
    }

    private static int FloorLog2(int value)
    {
        int result = 0;
        while ((1 << (result + 1)) <= value)
        {
            result++;
        }

        return result;
    }

    private static void WriteTag(List<byte> data, int offset, string tag)
    {
        for (int i = 0; i < 4; i++)
        {
            data[offset + i] = (byte)tag[i];
        }
    }

    private static void WriteU16(List<byte> data, int value)
    {
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }

    private static void WriteI16(List<byte> data, int value)
    {
        WriteU16(data, value & 0xFFFF);
    }

    private static void WriteU24(List<byte> data, int value)
    {
        data.Add((byte)(value >> 16));
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }

    private static void WriteU32(List<byte> data, uint value)
    {
        data.Add((byte)(value >> 24));
        data.Add((byte)(value >> 16));
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }

    private static void PatchU32(List<byte> data, int offset, uint value)
    {
        data[offset] = (byte)(value >> 24);
        data[offset + 1] = (byte)(value >> 16);
        data[offset + 2] = (byte)(value >> 8);
        data[offset + 3] = (byte)value;
    }

    private static ushort ReadU16(byte[] data, int offset) =>
        (ushort)((data[offset] << 8) | data[offset + 1]);

    private static uint ReadU32(byte[] data, int offset) =>
        (uint)((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);

    private static uint Checksum(byte[] data)
    {
        uint sum = 0;
        int i = 0;
        for (; i + 4 <= data.Length; i += 4)
        {
            sum += (uint)((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);
        }

        if (i < data.Length)
        {
            uint last = 0;
            int shift = 24;
            for (; i < data.Length; i++)
            {
                last |= (uint)data[i] << shift;
                shift -= 8;
            }

            sum += last;
        }

        return sum;
    }

    private static void ShouldBeTrue(this bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
