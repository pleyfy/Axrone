namespace Axrone.Audio.Tests;

using System.Buffers.Binary;
using System.IO;

internal static class WavFactory
{
    internal const int DefaultRate = 48000;

    internal static byte[] Header(int channels, int sampleRate, int bitsPerSample, ushort formatTag, uint chunkSize, int blockAlign = 0)
    {
        using MemoryStream stream = new();
        using BinaryWriter writer = new(stream);
        writer.Write("RIFF"u8);
        writer.Write(chunkSize);
        writer.Write("WAVE"u8);
        writer.Write("fmt "u8);
        writer.Write(16);
        writer.Write(formatTag);
        writer.Write((ushort)channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * (blockAlign == 0 ? channels * (bitsPerSample / 8) : blockAlign));
        writer.Write((ushort)(blockAlign == 0 ? channels * (bitsPerSample / 8) : blockAlign));
        writer.Write((ushort)bitsPerSample);
        writer.Flush();
        return stream.ToArray();
    }

    internal static byte[] Data(ReadOnlySpan<byte> samples, bool truncateSize = false)
    {
        using MemoryStream stream = new();
        using BinaryWriter writer = new(stream);
        writer.Write("data"u8);
        writer.Write(truncateSize ? samples.Length + 4096 : samples.Length);
        writer.Write(samples);
        writer.Flush();
        return stream.ToArray();
    }

    internal static byte[] Pcm(int[] codes, int channels, int bitsPerSample, int sampleRate = DefaultRate, ushort formatTag = 1)
    {
        int bytesPerSample = bitsPerSample / 8;
        byte[] payload = new byte[codes.Length * bytesPerSample];
        for (int i = 0; i < codes.Length; i++)
        {
            WriteCode(payload.AsSpan(i * bytesPerSample, bytesPerSample), codes[i], bitsPerSample);
        }

        return Concat(Header(channels, sampleRate, bitsPerSample, formatTag, (uint)(payload.Length + 36)), Data(payload));
    }

    internal static byte[] FloatPcm(float[] values, int channels, int bitsPerSample, int sampleRate = DefaultRate)
    {
        byte[] payload = new byte[values.Length * (bitsPerSample / 8)];
        for (int i = 0; i < values.Length; i++)
        {
            if (bitsPerSample == 32)
            {
                BinaryPrimitives.WriteInt32LittleEndian(payload.AsSpan(i * 4, 4), BitConverter.SingleToInt32Bits(values[i]));
            }
            else
            {
                BinaryPrimitives.WriteInt64LittleEndian(payload.AsSpan(i * 8, 8), BitConverter.DoubleToInt64Bits(values[i]));
            }
        }

        return Concat(Header(channels, sampleRate, bitsPerSample, 3, (uint)(payload.Length + 36)), Data(payload));
    }

    internal static byte[] Extensible(int[] codes, int channels, int bitsPerSample, uint channelMask, bool pcmSubFormat, int sampleRate = DefaultRate)
    {
        using MemoryStream stream = new();
        using BinaryWriter writer = new(stream);
        writer.Write("RIFF"u8);
        writer.Write(0);
        writer.Write("WAVE"u8);
        writer.Write("fmt "u8);
        writer.Write(40);
        writer.Write((ushort)0xFFFE);
        writer.Write((ushort)channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * channels * (bitsPerSample / 8));
        writer.Write((ushort)(channels * (bitsPerSample / 8)));
        writer.Write((ushort)bitsPerSample);
        writer.Write((ushort)22);
        writer.Write((ushort)bitsPerSample);
        writer.Write(channelMask);
        byte[] subFormat = pcmSubFormat
            ? [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71]
            : [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];
        writer.Write(subFormat);

        int bytesPerSample = bitsPerSample / 8;
        byte[] payload = new byte[codes.Length * bytesPerSample];
        for (int i = 0; i < codes.Length; i++)
        {
            WriteCode(payload.AsSpan(i * bytesPerSample, bytesPerSample), codes[i], bitsPerSample);
        }

        writer.Write("data"u8);
        writer.Write(payload.Length);
        writer.Write(payload);
        writer.Flush();

        byte[] all = stream.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(all.AsSpan(4, 4), all.Length - 8);
        return all;
    }

    internal static byte[] WithFormatTag(byte[] wav, ushort formatTag)
    {
        byte[] copy = (byte[])wav.Clone();
        BinaryPrimitives.WriteUInt16LittleEndian(copy.AsSpan(20, 2), formatTag);
        return copy;
    }

    internal static byte[] WithChunkSize(byte[] wav, int dataChunkSizeAt, int newSize)
    {
        byte[] copy = (byte[])wav.Clone();
        BinaryPrimitives.WriteInt32LittleEndian(copy.AsSpan(dataChunkSizeAt, 4), newSize);
        return copy;
    }

    internal static byte[] Concat(params byte[][] parts)
    {
        using MemoryStream stream = new();
        foreach (byte[] part in parts)
        {
            stream.Write(part, 0, part.Length);
        }

        return stream.ToArray();
    }

    internal static int DataOffset(byte[] wav) => 12 + 8 + 16;

    internal static float Expected(int code, int bitsPerSample) => bitsPerSample switch
    {
        8 => (code - 128) * (1.0f / 128.0f),
        16 => code * (1.0f / 32768.0f),
        24 => code * (1.0f / 8388608.0f),
        _ => code * (1.0f / 2147483648.0f),
    };

    private static void WriteCode(Span<byte> target, int code, int bitsPerSample)
    {
        switch (bitsPerSample)
        {
            case 8:
                target[0] = (byte)(code & 0xFF);
                break;
            case 16:
                BinaryPrimitives.WriteInt16LittleEndian(target, (short)code);
                break;
            case 24:
                target[0] = (byte)(code & 0xFF);
                target[1] = (byte)((code >> 8) & 0xFF);
                target[2] = (byte)((code >> 16) & 0xFF);
                break;
            case 32:
                BinaryPrimitives.WriteInt32LittleEndian(target, code);
                break;
            case 64:
                BinaryPrimitives.WriteInt64LittleEndian(target, code);
                break;
            default:
                throw new NotSupportedException($"Unsupported sample width {bitsPerSample}.");
        }
    }
}
