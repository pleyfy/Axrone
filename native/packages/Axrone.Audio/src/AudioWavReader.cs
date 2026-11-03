namespace Axrone.Audio;

/// <summary>
/// RIFF/WAVE linear-PCM ingest. Converts 8/16/24/32-bit integer and
/// 32/64-bit float samples into the engine's interleaved normalized float
/// layout, preserving the source channel count up to eight channels.
/// Compressed payloads are reported as unsupported here and routed to an
/// <see cref="IAudioSampleDecoder"/> by <see cref="AudioClipIngest"/>.
/// </summary>
public static class AudioWavReader
{
    private const int MaxNativeChannels = 8;

    /// <summary>
    /// Decodes a WAV payload into a native buffer. A false return carries the
    /// typed reason and never produces a partially filled buffer.
    /// </summary>
    public static bool TryDecode(
        ReadOnlySpan<byte> payload,
        out NativeAudioMemory? samples,
        out AudioContainerInfo info,
        out AudioContainerFailure failure)
    {
        samples = null;
        if (!AudioContainerInspector.TryInspectWav(payload, out info, out failure))
        {
            return false;
        }

        if (info.Encoding == AudioSampleEncoding.Compressed)
        {
            failure = AudioContainerFailure.UnsupportedFormatTag;
            return false;
        }

        if (info.ChannelCount is < 1 or > MaxNativeChannels)
        {
            failure = AudioContainerFailure.UnsupportedChannelCount;
            return false;
        }

        if (!AudioContainerInspector.TryLocateData(payload, out long dataStart, out long dataLength))
        {
            failure = AudioContainerFailure.TruncatedChunk;
            return false;
        }

        if (dataLength % info.BlockAlign != 0)
        {
            failure = AudioContainerFailure.TruncatedFrame;
            return false;
        }

        int frames = (int)(dataLength / info.BlockAlign);
        long totalSamples = (long)frames * info.ChannelCount;
        if (totalSamples > int.MaxValue)
        {
            failure = AudioContainerFailure.SizeOverflow;
            return false;
        }

        NativeAudioMemory buffer = new(info.SampleRate, info.ChannelCount, (int)totalSamples);
        if (!TryConvert(payload.Slice((int)dataStart, (int)dataLength), buffer.AsSpan(), in info, out failure))
        {
            buffer.Dispose();
            samples = null;
            return false;
        }

        samples = buffer;
        info = info with { FrameCount = frames };
        failure = AudioContainerFailure.None;
        return true;
    }

    /// <summary>
    /// Decodes a WAV payload or throws the typed <see cref="AudioContainerException"/>.
    /// </summary>
    public static NativeAudioMemory Decode(ReadOnlySpan<byte> payload, out AudioContainerInfo info)
    {
        if (!TryDecode(payload, out NativeAudioMemory? samples, out info, out AudioContainerFailure failure))
        {
            throw new AudioContainerException(info.Kind, failure);
        }

        return samples!;
    }

    private static bool TryConvert(ReadOnlySpan<byte> source, Span<float> destination, in AudioContainerInfo info, out AudioContainerFailure failure)
    {
        failure = AudioContainerFailure.None;

        switch (info.Encoding)
        {
            case AudioSampleEncoding.PcmInt8:
                ConvertInt8(source, destination);
                return true;
            case AudioSampleEncoding.PcmInt16:
                ConvertInt16(source, destination);
                return true;
            case AudioSampleEncoding.PcmInt24:
                ConvertInt24(source, destination);
                return true;
            case AudioSampleEncoding.PcmInt32:
                ConvertInt32(source, destination);
                return true;
            case AudioSampleEncoding.PcmFloat32:
                return ConvertFloat32(source, destination, out failure);
            case AudioSampleEncoding.PcmFloat64:
                return ConvertFloat64(source, destination, out failure);
            default:
                failure = AudioContainerFailure.UnsupportedBitDepth;
                return false;
        }
    }

    private static void ConvertInt8(ReadOnlySpan<byte> source, Span<float> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = (source[i] - 128) * (1.0f / 128.0f);
        }
    }

    private static void ConvertInt16(ReadOnlySpan<byte> source, Span<float> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            int low = source[i << 1];
            int high = source[(i << 1) + 1];
            short value = (short)((high << 8) | low);
            destination[i] = value * (1.0f / 32768.0f);
        }
    }

    private static void ConvertInt24(ReadOnlySpan<byte> source, Span<float> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            int baseIndex = i * 3;
            int value = source[baseIndex] | (source[baseIndex + 1] << 8) | (source[baseIndex + 2] << 16);
            value = (value << 8) >> 8;
            destination[i] = value * (1.0f / 8388608.0f);
        }
    }

    private static void ConvertInt32(ReadOnlySpan<byte> source, Span<float> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            int baseIndex = i << 2;
            int value = source[baseIndex] | (source[baseIndex + 1] << 8) | (source[baseIndex + 2] << 16) | (source[baseIndex + 3] << 24);
            destination[i] = value * (1.0f / 2147483648.0f);
        }
    }

    private static bool ConvertFloat32(ReadOnlySpan<byte> source, Span<float> destination, out AudioContainerFailure failure)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            int baseIndex = i << 2;
            int bits = source[baseIndex] | (source[baseIndex + 1] << 8) | (source[baseIndex + 2] << 16) | (source[baseIndex + 3] << 24);
            float value = BitConverter.Int32BitsToSingle(bits);
            if (!float.IsFinite(value))
            {
                failure = AudioContainerFailure.NonFiniteSample;
                return false;
            }

            destination[i] = value;
        }

        failure = AudioContainerFailure.None;
        return true;
    }

    private static bool ConvertFloat64(ReadOnlySpan<byte> source, Span<float> destination, out AudioContainerFailure failure)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            int baseIndex = i * 8;
            long bits = (long)source[baseIndex]
                | ((long)source[baseIndex + 1] << 8)
                | ((long)source[baseIndex + 2] << 16)
                | ((long)source[baseIndex + 3] << 24)
                | ((long)source[baseIndex + 4] << 32)
                | ((long)source[baseIndex + 5] << 40)
                | ((long)source[baseIndex + 6] << 48)
                | ((long)source[baseIndex + 7] << 56);
            double value = BitConverter.Int64BitsToDouble(bits);
            if (!double.IsFinite(value))
            {
                failure = AudioContainerFailure.NonFiniteSample;
                return false;
            }

            float narrowed = (float)value;
            if (!float.IsFinite(narrowed))
            {
                failure = AudioContainerFailure.NonFiniteSample;
                return false;
            }

            destination[i] = narrowed;
        }

        failure = AudioContainerFailure.None;
        return true;
    }
}
