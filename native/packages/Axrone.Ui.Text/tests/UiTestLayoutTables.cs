namespace Axrone.Ui.Text.Tests;

internal static class UiTestLayoutTables
{
    public static byte[] CreateGsub()
    {
        var data = new List<byte>(60);
        WriteU16(data, 1);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 10);
        WriteU16(data, 1);
        WriteU16(data, 4);
        WriteU16(data, 4);
        WriteU16(data, 0);
        WriteU16(data, 1);
        WriteU16(data, 8);
        WriteU16(data, 1);
        WriteU16(data, 10);
        WriteU16(data, 2);
        WriteU16(data, 18);
        WriteU16(data, 28);
        WriteU16(data, 1);
        WriteU16(data, 2);
        WriteU16(data, 2);
        WriteU16(data, 4);
        WriteU16(data, 1);
        WriteU16(data, 4);
        WriteU16(data, 9);
        WriteU16(data, 2);
        WriteU16(data, 10);
        WriteU16(data, 1);
        WriteU16(data, 4);
        WriteU16(data, 9);
        WriteU16(data, 2);
        WriteU16(data, 5);
        return [.. data];
    }

    public static byte[] CreateGpos()
    {
        var data = new List<byte>(106);
        WriteU16(data, 1);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 0);
        WriteU16(data, 10);
        WriteU16(data, 2);
        WriteU16(data, 6);
        WriteU16(data, 38);
        WriteU16(data, 2);
        WriteU16(data, 0);
        WriteU16(data, 1);
        WriteU16(data, 8);
        WriteU16(data, 1);
        WriteU16(data, 12);
        WriteU16(data, 0x0004);
        WriteU16(data, 0);
        WriteU16(data, 1);
        WriteU16(data, 18);
        WriteU16(data, 1);
        WriteU16(data, 1);
        WriteU16(data, 2);
        WriteU16(data, 1);
        WriteU16(data, 3);
        WriteI16(data, -50);
        WriteU16(data, 2);
        WriteU16(data, 0);
        WriteU16(data, 1);
        WriteU16(data, 8);
        WriteU16(data, 2);
        WriteU16(data, 24);
        WriteU16(data, 0x0004);
        WriteU16(data, 0);
        WriteU16(data, 30);
        WriteU16(data, 40);
        WriteU16(data, 2);
        WriteU16(data, 2);
        WriteI16(data, 0);
        WriteI16(data, 0);
        WriteI16(data, 0);
        WriteI16(data, -30);
        WriteU16(data, 1);
        WriteU16(data, 1);
        WriteU16(data, 10);
        WriteU16(data, 2);
        WriteU16(data, 1);
        WriteU16(data, 10);
        WriteU16(data, 10);
        WriteU16(data, 1);
        WriteU16(data, 2);
        WriteU16(data, 1);
        WriteU16(data, 3);
        WriteU16(data, 3);
        WriteU16(data, 1);
        return [.. data];
    }

    private static void WriteU16(List<byte> data, int value)
    {
        data.Add((byte)(value >> 8));
        data.Add((byte)value);
    }

    private static void WriteI16(List<byte> data, int value) => WriteU16(data, value & 0xFFFF);
}
