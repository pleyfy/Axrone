namespace Axrone.Audio;

/// <summary>
/// Container families recognised by clip ingest. Compressed families are
/// sniffed only: sample extraction is delegated to a registered
/// <see cref="IAudioSampleDecoder"/>.
/// </summary>
public enum AudioContainerKind : byte
{
    /// <summary>Not a supported container.</summary>
    Unknown = 0,

    /// <summary>RIFF/WAVE container.</summary>
    Wav = 1,

    /// <summary>Ogg bitstream (Vorbis, Opus or another codec inside).</summary>
    Ogg = 2,

    /// <summary>MPEG audio (frame sync or ID3-prefixed).</summary>
    Mp3 = 3,

    /// <summary>FLAC bitstream.</summary>
    Flac = 4,
}

/// <summary>
/// Sample encoding carried by a container.
/// </summary>
public enum AudioSampleEncoding : byte
{
    /// <summary>Encoding is unknown or held by a compressed stream.</summary>
    Unknown = 0,

    /// <summary>8-bit unsigned PCM.</summary>
    PcmInt8 = 1,

    /// <summary>16-bit signed little-endian PCM.</summary>
    PcmInt16 = 2,

    /// <summary>24-bit signed little-endian PCM.</summary>
    PcmInt24 = 3,

    /// <summary>32-bit signed little-endian PCM.</summary>
    PcmInt32 = 4,

    /// <summary>32-bit little-endian IEEE float.</summary>
    PcmFloat32 = 5,

    /// <summary>64-bit little-endian IEEE float.</summary>
    PcmFloat64 = 6,

    /// <summary>Compressed or ADPCM payload; needs a decoder.</summary>
    Compressed = 7,
}

/// <summary>
/// Speaker layout resolved from a channel count and a channel mask.
/// </summary>
public enum AudioChannelLayout : byte
{
    /// <summary>Layout cannot be resolved.</summary>
    Unknown = 0,

    /// <summary>One channel.</summary>
    Mono = 1,

    /// <summary>Left and right.</summary>
    Stereo = 2,

    /// <summary>Four discrete channels.</summary>
    Quad = 3,

    /// <summary>Five channels plus LFE.</summary>
    Surround5Point1 = 4,

    /// <summary>Seven channels plus LFE.</summary>
    Surround7Point1 = 5,

    /// <summary>Discrete channels without a standard speaker mapping.</summary>
    Discrete = 6,
}

/// <summary>
/// Container header summary. For sniffed compressed containers only
/// <see cref="Kind"/> and <see cref="Encoding"/> are meaningful; the
/// registered decoder reports the real stream geometry.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioContainerInfo(
    AudioContainerKind Kind,
    AudioSampleEncoding Encoding,
    AudioChannelLayout Layout,
    int ChannelCount,
    int SampleRate,
    int BitDepth,
    int FrameCount,
    int BlockAlign,
    uint ChannelMask,
    ushort FormatTag);

/// <summary>
/// Typed ingest failure. Structural defects and unsupported encodings are
/// separated so callers can distinguish a broken file from a missing decoder.
/// </summary>
public enum AudioContainerFailure : byte
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>Payload is shorter than the mandatory header.</summary>
    TooSmall = 1,

    /// <summary>Missing RIFF magic.</summary>
    NotRiff = 2,

    /// <summary>RIFF form type is not WAVE.</summary>
    NotWave = 3,

    /// <summary>RIFF size exceeds the payload.</summary>
    TruncatedChunk = 4,

    /// <summary>No fmt chunk is present.</summary>
    MissingFormatChunk = 5,

    /// <summary>fmt chunk is present but not large enough.</summary>
    MalformedFormatChunk = 6,

    /// <summary>No data chunk is present.</summary>
    MissingDataChunk = 7,

    /// <summary>Sample block is not a whole number of frames.</summary>
    TruncatedFrame = 8,

    /// <summary>Block align disagrees with channel count and bit depth.</summary>
    ConflictingBlockAlign = 9,

    /// <summary>Channel mask population disagrees with channel count.</summary>
    ChannelMaskMismatch = 10,

    /// <summary>Format tag is neither linear PCM nor a known float tag.</summary>
    UnsupportedFormatTag = 11,

    /// <summary>Bit depth is not supported for the format tag.</summary>
    UnsupportedBitDepth = 12,

    /// <summary>Channel count is outside the supported range.</summary>
    UnsupportedChannelCount = 13,

    /// <summary>Extensible sub-format GUID is neither PCM nor IEEE float.</summary>
    UnknownSubFormat = 14,

    /// <summary>Sample rate is outside the supported range.</summary>
    UnsupportedSampleRate = 15,

    /// <summary>Data chunk holds no frames.</summary>
    EmptySampleData = 16,

    /// <summary>A size field overflows the addressable range.</summary>
    SizeOverflow = 17,

    /// <summary>Decoded float samples contain a non-finite value.</summary>
    NonFiniteSample = 18,

    /// <summary>Payload does not match any supported container magic.</summary>
    UnrecognizedContainer = 19,
}

/// <summary>
/// Container ingest failure: malformed payload or unsupported encoding.
/// Codes separate structural damage from unsupported format so a caller can
/// never mistake a corrupt file for a missing decoder.
/// </summary>
public sealed class AudioContainerException : AudioException
{
    /// <summary>Offending container.</summary>
    public AudioContainerKind Kind { get; }

    /// <summary>Failure discriminant.</summary>
    public AudioContainerFailure Failure { get; }

    /// <summary>Creates a container failure.</summary>
    public AudioContainerException(AudioContainerKind kind, AudioContainerFailure failure, string? detail = null)
        : base(CodeFor(failure), MessageFor(kind, failure, detail))
    {
        Kind = kind;
        Failure = failure;
    }

    /// <summary>Whether the payload is structurally damaged.</summary>
    public bool IsStructural => Failure is not (
        AudioContainerFailure.UnsupportedFormatTag or
        AudioContainerFailure.UnsupportedBitDepth or
        AudioContainerFailure.UnsupportedChannelCount or
        AudioContainerFailure.UnsupportedSampleRate or
        AudioContainerFailure.UnknownSubFormat or
        AudioContainerFailure.UnrecognizedContainer);

    internal static string CodeFor(AudioContainerFailure failure) => failure switch
    {
        AudioContainerFailure.UnsupportedFormatTag or
        AudioContainerFailure.UnsupportedBitDepth or
        AudioContainerFailure.UnsupportedChannelCount or
        AudioContainerFailure.UnsupportedSampleRate or
        AudioContainerFailure.UnknownSubFormat or
        AudioContainerFailure.UnrecognizedContainer => "audio.container.unsupported",
        _ => "audio.container.malformed",
    };

    private static string MessageFor(AudioContainerKind kind, AudioContainerFailure failure, string? detail)
    {
        string baseMessage = $"Audio container '{kind}' failed: {failure}.";
        return string.IsNullOrEmpty(detail) ? baseMessage : baseMessage + " " + detail;
    }
}

/// <summary>
/// Identifies a container from its magic and, for RIFF/WAVE, resolves the
/// linear-PCM header. Sniffing allocates nothing.
/// </summary>
public static class AudioContainerInspector
{
    private const int MinWaveHeader = 12;
    private const int MaxNativeChannels = 8;

    private static ReadOnlySpan<byte> RiffMagic => "RIFF"u8;
    private static ReadOnlySpan<byte> WaveMagic => "WAVE"u8;
    private static ReadOnlySpan<byte> FmtMagic => "fmt "u8;
    private static ReadOnlySpan<byte> DataMagic => "data"u8;
    private static ReadOnlySpan<byte> OggMagic => "OggS"u8;
    private static ReadOnlySpan<byte> FlacMagic => "fLaC"u8;
    private static ReadOnlySpan<byte> Id3Magic => "ID3"u8;

    private static ReadOnlySpan<byte> SubFormatPcm =>
        [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];

    private static ReadOnlySpan<byte> SubFormatFloat =>
        [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];

    /// <summary>
    /// Resolves a container and, when it is uncompressed WAV, its PCM header.
    /// A false return always carries the typed reason.
    /// </summary>
    public static bool TryInspect(ReadOnlySpan<byte> payload, out AudioContainerInfo info, out AudioContainerFailure failure)
    {
        if (TryInspectWav(payload, out info, out failure))
        {
            return true;
        }

        AudioContainerFailure waveFailure = failure;

        // A RIFF file whose form type is not WAVE is a container we do not
        // support; it cannot be an Ogg or MPEG stream, so report it directly.
        if (waveFailure == AudioContainerFailure.NotWave)
        {
            return false;
        }

        if (TryInspectCompressed(payload, out info, out AudioContainerFailure compressedFailure))
        {
            failure = AudioContainerFailure.None;
            return true;
        }

        failure = waveFailure is AudioContainerFailure.NotRiff or AudioContainerFailure.TooSmall
            ? compressedFailure
            : waveFailure;
        return false;
    }

    /// <summary>Resolves only the container family from magic bytes.</summary>
    public static AudioContainerKind SniffKind(ReadOnlySpan<byte> payload)
    {
        if (payload.Length >= MinWaveHeader && payload[..4].SequenceEqual(RiffMagic) && payload.Slice(8, 4).SequenceEqual(WaveMagic))
        {
            return AudioContainerKind.Wav;
        }

        if (payload.Length >= 4 && payload[..4].SequenceEqual(OggMagic))
        {
            return AudioContainerKind.Ogg;
        }

        if (payload.Length >= 4 && payload[..4].SequenceEqual(FlacMagic))
        {
            return AudioContainerKind.Flac;
        }

        if (LooksLikeMp3(payload))
        {
            return AudioContainerKind.Mp3;
        }

        return AudioContainerKind.Unknown;
    }

    internal static bool TryInspectWav(ReadOnlySpan<byte> payload, out AudioContainerInfo info, out AudioContainerFailure failure)
    {
        info = default;
        failure = AudioContainerFailure.None;

        if (payload.Length < MinWaveHeader)
        {
            failure = payload.Length < RiffMagic.Length ? AudioContainerFailure.TooSmall : AudioContainerFailure.NotRiff;
            return false;
        }

        if (!payload[..4].SequenceEqual(RiffMagic))
        {
            failure = AudioContainerFailure.NotRiff;
            return false;
        }

        if (!payload[8..12].SequenceEqual(WaveMagic))
        {
            info = new AudioContainerInfo(AudioContainerKind.Wav, AudioSampleEncoding.Unknown, AudioChannelLayout.Unknown, 0, 0, 0, 0, 0, 0U, 0);
            failure = AudioContainerFailure.NotWave;
            return false;
        }

        long riffBytes = (long)ReadUInt32(payload[4..8]) + 8L;
        if (riffBytes > payload.Length)
        {
            failure = AudioContainerFailure.TruncatedChunk;
            return false;
        }

        bool haveFormat = false;
        AudioContainerInfo format = default;
        long dataStart = -1;
        long dataLength = -1;

        int offset = MinWaveHeader;
        while (offset + 8 <= payload.Length)
        {
            ReadOnlySpan<byte> id = payload.Slice(offset, 4);
            uint chunkSize = ReadUInt32(payload.Slice(offset + 4, 4));
            long payloadStart = offset + 8L;
            long payloadEnd = payloadStart + chunkSize;

            if (payloadEnd > payload.Length)
            {
                failure = AudioContainerFailure.TruncatedChunk;
                return false;
            }

            if (id.SequenceEqual(FmtMagic))
            {
                if (!TryReadFormat(payload, payloadStart, chunkSize, out format, out failure))
                {
                    return false;
                }

                haveFormat = true;
            }
            else if (id.SequenceEqual(DataMagic))
            {
                dataStart = payloadStart;
                dataLength = chunkSize;
            }

            offset = (int)(payloadStart + chunkSize + (chunkSize & 1U));
        }

        if (!haveFormat)
        {
            failure = AudioContainerFailure.MissingFormatChunk;
            return false;
        }

        if (dataStart < 0)
        {
            failure = AudioContainerFailure.MissingDataChunk;
            return false;
        }

        if (dataLength == 0)
        {
            failure = AudioContainerFailure.EmptySampleData;
            return false;
        }

        if (format.Encoding != AudioSampleEncoding.Compressed)
        {
            int blockAlign = format.BlockAlign;
            if (blockAlign <= 0)
            {
                failure = AudioContainerFailure.ConflictingBlockAlign;
                return false;
            }

            if (dataLength % blockAlign != 0)
            {
                failure = AudioContainerFailure.TruncatedFrame;
                return false;
            }

            long frames = dataLength / blockAlign;
            long totalSamples = frames * format.ChannelCount;
            if (frames == 0 || totalSamples > int.MaxValue)
            {
                failure = frames == 0 ? AudioContainerFailure.EmptySampleData : AudioContainerFailure.SizeOverflow;
                return false;
            }

            format = format with { FrameCount = (int)frames };
        }

        info = format;
        return true;
    }

    internal static bool TryLocateData(ReadOnlySpan<byte> payload, out long dataStart, out long dataLength)
    {
        dataStart = -1;
        dataLength = -1;

        int offset = MinWaveHeader;
        while (offset + 8 <= payload.Length)
        {
            ReadOnlySpan<byte> id = payload.Slice(offset, 4);
            uint chunkSize = ReadUInt32(payload.Slice(offset + 4, 4));
            long payloadStart = offset + 8L;

            if (id.SequenceEqual(DataMagic))
            {
                if (payloadStart + chunkSize > payload.Length)
                {
                    return false;
                }

                dataStart = payloadStart;
                dataLength = chunkSize;
                return true;
            }

            offset = (int)(payloadStart + chunkSize + (chunkSize & 1U));
        }

        return false;
    }

    private static bool TryReadFormat(ReadOnlySpan<byte> payload, long start, uint size, out AudioContainerInfo info, out AudioContainerFailure failure)
    {
        info = default;
        failure = AudioContainerFailure.None;

        if (size < 16 || start + 16 > payload.Length)
        {
            failure = AudioContainerFailure.MalformedFormatChunk;
            return false;
        }

        ReadOnlySpan<byte> fmt = payload.Slice((int)start, 16);
        ushort formatTag = (ushort)ReadUInt16(fmt[0..2]);
        int channels = ReadUInt16(fmt[2..4]);
        int sampleRate = (int)ReadUInt32(fmt[4..8]);
        int blockAlign = ReadUInt16(fmt[12..14]);
        int bitDepth = ReadUInt16(fmt[14..16]);

        if (channels is < 1 or > MaxNativeChannels)
        {
            failure = AudioContainerFailure.UnsupportedChannelCount;
            return false;
        }

        if (sampleRate < 8000 || sampleRate > 192000)
        {
            failure = AudioContainerFailure.UnsupportedSampleRate;
            return false;
        }

        uint channelMask = 0U;
        bool extensible = formatTag == 0xFFFE;
        if (extensible)
        {
            if (size < 40 || start + 40 > payload.Length)
            {
                failure = AudioContainerFailure.MalformedFormatChunk;
                return false;
            }

            ReadOnlySpan<byte> ext = payload.Slice((int)start + 16, 24);
            channelMask = ReadUInt32(ext.Slice(4, 4));
            ReadOnlySpan<byte> subFormat = ext.Slice(8, 16);
            if (subFormat.SequenceEqual(SubFormatFloat))
            {
                formatTag = 0x0003;
            }
            else if (subFormat.SequenceEqual(SubFormatPcm))
            {
                formatTag = 0x0001;
            }
            else
            {
                failure = AudioContainerFailure.UnknownSubFormat;
                return false;
            }
        }

        if (channelMask != 0U && BitOperations.PopCount(channelMask) != channels)
        {
            failure = AudioContainerFailure.ChannelMaskMismatch;
            return false;
        }

        AudioSampleEncoding encoding = ResolveEncoding(formatTag, bitDepth, out bool compressed);
        if (compressed)
        {
            info = new AudioContainerInfo(
                AudioContainerKind.Wav,
                AudioSampleEncoding.Compressed,
                MapLayout(channels, channelMask),
                channels,
                sampleRate,
                bitDepth,
                0,
                blockAlign,
                channelMask,
                formatTag);
            return true;
        }

        if (encoding == AudioSampleEncoding.Unknown)
        {
            failure = bitDepth is 8 or 16 or 24 or 32 or 64
                ? AudioContainerFailure.UnsupportedFormatTag
                : AudioContainerFailure.UnsupportedBitDepth;
            return false;
        }

        int expectedAlign = channels * (bitDepth / 8);
        if (blockAlign != expectedAlign)
        {
            failure = AudioContainerFailure.ConflictingBlockAlign;
            return false;
        }

        info = new AudioContainerInfo(
            AudioContainerKind.Wav,
            encoding,
            MapLayout(channels, channelMask),
            channels,
            sampleRate,
            bitDepth,
            0,
            blockAlign,
            channelMask,
            formatTag);
        return true;
    }

    private static AudioSampleEncoding ResolveEncoding(ushort formatTag, int bitDepth, out bool compressed)
    {
        compressed = false;

        if (formatTag is not (0x0001 or 0x0003 or 0xFFFE))
        {
            compressed = true;
            return AudioSampleEncoding.Compressed;
        }

        if (formatTag == 0x0003)
        {
            return bitDepth switch
            {
                32 => AudioSampleEncoding.PcmFloat32,
                64 => AudioSampleEncoding.PcmFloat64,
                _ => AudioSampleEncoding.Unknown,
            };
        }

        return bitDepth switch
        {
            8 => AudioSampleEncoding.PcmInt8,
            16 => AudioSampleEncoding.PcmInt16,
            24 => AudioSampleEncoding.PcmInt24,
            32 => AudioSampleEncoding.PcmInt32,
            _ => AudioSampleEncoding.Unknown,
        };
    }

    private static AudioChannelLayout MapLayout(int channels, uint mask)
    {
        if (mask != 0U)
        {
            return mask switch
            {
                0x04U => AudioChannelLayout.Mono,
                0x03U => AudioChannelLayout.Stereo,
                0x33U => AudioChannelLayout.Quad,
                0x3FU => AudioChannelLayout.Surround5Point1,
                0xFFU => AudioChannelLayout.Surround7Point1,
                _ => AudioChannelLayout.Discrete,
            };
        }

        return channels switch
        {
            1 => AudioChannelLayout.Mono,
            2 => AudioChannelLayout.Stereo,
            4 => AudioChannelLayout.Quad,
            6 => AudioChannelLayout.Surround5Point1,
            8 => AudioChannelLayout.Surround7Point1,
            _ => AudioChannelLayout.Discrete,
        };
    }

    private static bool LooksLikeMp3(ReadOnlySpan<byte> payload)
    {
        if (payload.Length >= 3 && payload[..3].SequenceEqual(Id3Magic))
        {
            return true;
        }

        for (int i = 0; i + 1 < payload.Length && i < 16384; i++)
        {
            if (payload[i] == 0xFF && (payload[i + 1] & 0xE0U) == 0xE0U)
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryInspectCompressed(ReadOnlySpan<byte> payload, out AudioContainerInfo info, out AudioContainerFailure failure)
    {
        AudioContainerKind kind = SniffKind(payload);
        if (kind != AudioContainerKind.Unknown && kind != AudioContainerKind.Wav)
        {
            info = new AudioContainerInfo(kind, AudioSampleEncoding.Compressed, AudioChannelLayout.Unknown, 0, 0, 0, 0, 0, 0U, 0);
            failure = AudioContainerFailure.None;
            return true;
        }

        info = default;
        failure = AudioContainerFailure.UnrecognizedContainer;
        return false;
    }

    private static uint ReadUInt32(ReadOnlySpan<byte> span) => (uint)(span[0] | (span[1] << 8) | (span[2] << 16) | (span[3] << 24));

    private static int ReadUInt16(ReadOnlySpan<byte> span) => span[0] | (span[1] << 8);
}
