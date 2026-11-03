namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioContainerIngestTests
{
    private static readonly AudioClipId ClipId = new(7U);

    [Theory]
    [InlineData(8)]
    [InlineData(16)]
    [InlineData(24)]
    [InlineData(32)]
    public void PcmRoundTrip_PreservesEveryCodeAndBitDepth(int bitsPerSample)
    {
        int[] codes = CodesFor(bitsPerSample);
        byte[] wav = WavFactory.Pcm(codes, 1, bitsPerSample);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out AudioException? error)
            .Should().BeTrue(error?.ToString() ?? "ok");

        using (record)
        {
            info.Encoding.Should().Be(bitsPerSample == 8
                ? AudioSampleEncoding.PcmInt8
                : bitsPerSample == 16
                    ? AudioSampleEncoding.PcmInt16
                    : bitsPerSample == 24
                        ? AudioSampleEncoding.PcmInt24
                        : AudioSampleEncoding.PcmInt32);
            info.ChannelCount.Should().Be(1);
            info.Layout.Should().Be(AudioChannelLayout.Mono);
            info.SampleRate.Should().Be(WavFactory.DefaultRate);
            info.FrameCount.Should().Be(codes.Length);

            ReadOnlySpan<float> decoded = record!.Buffer.AsReadOnlySpan();
            decoded.Length.Should().Be(codes.Length);
            for (int i = 0; i < codes.Length; i++)
            {
                decoded[i].Should().Be(WavFactory.Expected(codes[i], bitsPerSample));
            }
        }
    }

    [Fact]
    public void Pcm24_SignExtendsNegativeAndPositive()
    {
        int[] codes = [-8388608, -1, 1, 8388607];
        byte[] wav = WavFactory.Pcm(codes, 2, 24);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Layout.Should().Be(AudioChannelLayout.Stereo);
            ReadOnlySpan<float> decoded = record!.Buffer.AsReadOnlySpan();
            decoded[0].Should().Be(-1.0f);
            decoded[1].Should().Be(-1.0f / 8388608.0f);
            decoded[2].Should().Be(1.0f / 8388608.0f);
            decoded[3].Should().Be(0.99999988f);
        }
    }

    [Theory]
    [InlineData(32)]
    [InlineData(64)]
    public void FloatRoundTrip_IsBitExact(int bitsPerSample)
    {
        float[] values = [0.0f, 0.25f, -0.5f, 1.0f, -1.0f, 0.125f];
        byte[] wav = WavFactory.FloatPcm(values, 1, bitsPerSample);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Encoding.Should().Be(bitsPerSample == 32 ? AudioSampleEncoding.PcmFloat32 : AudioSampleEncoding.PcmFloat64);
            ReadOnlySpan<float> decoded = record!.Buffer.AsReadOnlySpan();
            decoded.ToArray().Should().Equal(values);
        }
    }

    [Theory]
    [InlineData(1, AudioChannelLayout.Mono)]
    [InlineData(2, AudioChannelLayout.Stereo)]
    [InlineData(4, AudioChannelLayout.Quad)]
    [InlineData(6, AudioChannelLayout.Surround5Point1)]
    [InlineData(8, AudioChannelLayout.Surround7Point1)]
    [InlineData(3, AudioChannelLayout.Discrete)]
    public void ChannelCounts_MapToLayouts(int channels, AudioChannelLayout expected)
    {
        int[] codes = new int[channels * 2];
        for (int i = 0; i < codes.Length; i++)
        {
            codes[i] = i;
        }

        byte[] wav = WavFactory.Pcm(codes, channels, 16);
        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Layout.Should().Be(expected);
            info.ChannelCount.Should().Be(channels);
            record!.Buffer.ChannelCount.Should().Be(channels);
            record.Buffer.SampleCount.Should().Be(codes.Length);
        }
    }

    [Fact]
    public void ExtensibleHeader_MapsChannelMaskAndSubFormat()
    {
        byte[] wav = WavFactory.Extensible([0, 0, 32767, -32768, 100, -100, 5, -5], 4, 16, 0x33U, pcmSubFormat: true);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Layout.Should().Be(AudioChannelLayout.Quad);
            info.ChannelMask.Should().Be(0x33U);
            info.Encoding.Should().Be(AudioSampleEncoding.PcmInt16);
            record!.Buffer.SampleCount.Should().Be(8);
        }
    }

    [Fact]
    public void ExtensibleFloatSubFormat_IsResolved()
    {
        byte[] wav = WavFactory.Extensible([0, 0x3F800000], 1, 32, 0x04U, pcmSubFormat: false);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Encoding.Should().Be(AudioSampleEncoding.PcmFloat32);
            record!.Buffer.AsReadOnlySpan()[1].Should().Be(1.0f);
        }
    }

    [Fact]
    public void OddSizedPadderChunk_IsSkippedAndStillDecodes()
    {
        byte[] padding = [0x4C, 0x49, 0x53, 0x54, 1, 0, 0, 0, 0x41, 0x00];

        byte[] wav = WavFactory.Concat(
            WavFactory.Header(1, WavFactory.DefaultRate, 16, 1, 0),
            padding,
            WavFactory.Data([0x00, 0x40]));

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.FrameCount.Should().Be(1);
            record!.Buffer.AsReadOnlySpan()[0].Should().Be(0.5f);
        }
    }

    [Fact]
    public void EmptyBuffer_IsTypedFailure_NotSilentClip()
    {
        byte[] wav = WavFactory.Concat(WavFactory.Header(1, WavFactory.DefaultRate, 16, 1, 36), WavFactory.Data(Array.Empty<byte>()));

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out _, out AudioException? error)
            .Should().BeFalse();

        record.Should().BeNull();
        error.Should().BeOfType<AudioContainerException>();
        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.EmptySampleData);
        error.As<AudioContainerException>().Code.Should().Be("audio.container.malformed");
    }

    [Fact]
    public void TruncatedDataSize_IsTypedFailure()
    {
        byte[] wav = WavFactory.Pcm([0, 1, 2, 3], 1, 16);
        byte[] broken = WavFactory.WithChunkSize(wav, WavFactory.DataOffset(wav) + 4, 1_000_000);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, broken, out AudioClipRecord? record, out _, out AudioException? error)
            .Should().BeFalse();

        record.Should().BeNull();
        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.TruncatedChunk);
    }

    [Fact]
    public void WrongFormType_IsTypedFailure()
    {
        byte[] wav = WavFactory.Pcm([0, 1], 1, 16);
        byte[] broken = (byte[])wav.Clone();
        broken[8] = (byte)'A';

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, broken, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.NotWave);
    }

    [Fact]
    public void MissingFormatChunk_IsTypedFailure()
    {
        byte[] broken = WavFactory.Concat("RIFF"u8.ToArray(), [16, 0, 0, 0], "WAVE"u8.ToArray(), WavFactory.Data([1, 2, 3, 4]));

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, broken, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.MissingFormatChunk);
    }

    [Fact]
    public void PartialFrame_IsTypedFailure()
    {
        byte[] wav = WavFactory.Concat(
            WavFactory.Header(2, WavFactory.DefaultRate, 16, 1, 0),
            WavFactory.Data([1, 2, 3]));

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.TruncatedFrame);
    }

    [Fact]
    public void ConflictingBlockAlign_IsTypedFailure()
    {
        byte[] wav = WavFactory.Concat(
            WavFactory.Header(2, WavFactory.DefaultRate, 16, 1, 0, blockAlign: 2),
            WavFactory.Data([1, 2, 3, 4]));

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out _, out AudioException? error).Should().BeFalse();

        AudioContainerException container = error.As<AudioContainerException>();
        container.Failure.Should().Be(AudioContainerFailure.ConflictingBlockAlign);
        container.IsStructural.Should().BeTrue();
    }

    [Fact]
    public void ChannelMaskPopulationMismatch_IsTypedFailure()
    {
        byte[] wav = WavFactory.Extensible([0, 0, 0, 0], 2, 16, 0x33U, pcmSubFormat: true);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.ChannelMaskMismatch);
    }

    [Fact]
    public void UnknownSubFormat_IsUnsupportedNotMalformed()
    {
        byte[] wav = WavFactory.Extensible([0, 0], 1, 16, 0x04U, pcmSubFormat: true);
        byte[] broken = (byte[])wav.Clone();
        broken[44] = 0x99;

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, broken, out _, out _, out AudioException? error).Should().BeFalse();

        AudioContainerException container = error.As<AudioContainerException>();
        container.Failure.Should().Be(AudioContainerFailure.UnknownSubFormat);
        container.Code.Should().Be("audio.container.unsupported");
        container.IsStructural.Should().BeFalse();
    }

    [Fact]
    public void OutOfRangeChannelCount_IsTypedFailure()
    {
        byte[] wav = WavFactory.Pcm([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 10, 16);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.UnsupportedChannelCount);
    }

    [Fact]
    public void OutOfRangeSampleRate_IsTypedFailure()
    {
        byte[] wav = WavFactory.Pcm([0, 0], 1, 16, sampleRate: 4000);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.UnsupportedSampleRate);
    }

    [Fact]
    public void NonFiniteFloatSample_IsTypedFailure()
    {
        byte[] wav = WavFactory.FloatPcm([float.NaN, 0.5f], 1, 32);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.NonFiniteSample);
    }

    [Fact]
    public void AdpcmWav_IsSniffedAsCompressed_NotPcm()
    {
        byte[] wav = WavFactory.WithFormatTag(WavFactory.Pcm([0, 0, 0, 0], 1, 16), 0x0011);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, wav, out _, out AudioContainerInfo info, out AudioException? error).Should().BeFalse();

        info.Encoding.Should().Be(AudioSampleEncoding.Compressed);
        error.Should().BeOfType<AudioDecoderException>();
        error.As<AudioDecoderException>().Failure.Should().Be(AudioDecoderFailure.DecoderMissing);
    }

    [Theory]
    [InlineData("OggS", AudioContainerKind.Ogg)]
    [InlineData("fLaC", AudioContainerKind.Flac)]
    public void CompressedMagics_AreSniffed(string magic, AudioContainerKind expected)
    {
        byte[] payload = WavFactory.Concat(Ascii(magic), [0, 0, 0, 0, 0, 0, 0, 0]);

        AudioClipIngest.SniffContainerKind(payload).Should().Be(expected);
    }

    [Fact]
    public void Mp3Payload_IsSniffedAndFailsClosedWithoutDecoder()
    {
        byte[] payload = WavFactory.Concat("ID3"u8.ToArray(), new byte[41]);

        AudioClipIngest.SniffContainerKind(payload).Should().Be(AudioContainerKind.Mp3);

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, payload, out AudioClipRecord? record, out AudioContainerInfo info, out AudioException? error)
            .Should().BeFalse();

        record.Should().BeNull();
        info.Kind.Should().Be(AudioContainerKind.Mp3);
        error.As<AudioDecoderException>().IsUnavailable.Should().BeTrue();
        error.As<AudioDecoderException>().Code.Should().Be("audio.decoder.missing");
    }

    [Fact]
    public void UnrecognizedBytes_AreTypedFailure()
    {
        byte[] payload = new byte[64];

        AudioClipIngest ingest = new();
        ingest.TryCreateRecord(ClipId, payload, out _, out _, out AudioException? error).Should().BeFalse();

        error.As<AudioContainerException>().Failure.Should().Be(AudioContainerFailure.UnrecognizedContainer);
    }

    [Fact]
    public void InvalidClipId_IsRejectedBeforeDecode()
    {
        AudioClipIngest ingest = new();

        Action create = () => ingest.CreateRecord(AudioClipId.Invalid, WavFactory.Pcm([0], 1, 16));

        create.Should().Throw<AudioAssetException>();
    }

    [Fact]
    public void Register_Failure_LeavesStoreUntouched()
    {
        using AudioClipStore store = new(4);
        AudioClipIngest ingest = new();

        Action register = () => ingest.Register(store, ClipId, new byte[64]);

        register.Should().Throw<AudioContainerException>();
        store.TryGet(ClipId, out _).Should().BeFalse();
    }

    [Fact]
    public void Register_Success_RoundTripsThroughStore()
    {
        using AudioClipStore store = new(4);
        AudioClipIngest ingest = new();

        AudioClipId id = ingest.Register(store, ClipId, WavFactory.Pcm([0, 16384, -16384], 1, 16));

        store.TryGet(id, out AudioClipRecord? found).Should().BeTrue();
        found!.Buffer.AsReadOnlySpan()[1].Should().Be(0.5f);
    }

    [Fact]
    public void Decode_DirectApi_ThrowsTypedError()
    {
        Action decode = () => AudioWavReader.Decode(new byte[64], out _);

        decode.Should().Throw<AudioContainerException>();
    }

    [Fact]
    public void MultichannelClip_MixesFirstTwoChannels()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        AudioClipIngest ingest = new();
        ingest.Register(system.Clips, ClipId, WavFactory.Pcm([16384, 8192, -2, 0, -32768, 0, 0, 0], 4, 16));

        system.Sources.Upsert(new AudioSourceId(1U), new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
        system.Sources.Play(new AudioSourceId(1U), new AudioSourcePlayRequest());

        float[] block = new float[64];
        system.ProcessAudioRenderBlock(block);

        block[0].Should().BeApproximately(0.5f * 0.70710678f, 1e-5f);
        block[1].Should().BeApproximately(0.25f * 0.70710678f, 1e-5f);
        block[2].Should().BeApproximately(-1.0f * 0.70710678f, 1e-5f);
        block[3].Should().BeApproximately(0.0f, 1e-6f);
    }

    private static int[] CodesFor(int bitsPerSample) => bitsPerSample switch
    {
        8 => [0, 1, 127, 128, 255],
        16 => [0, 1, -1, 32767, -32768],
        24 => [0, 1, -1, 8388607, -8388608],
        _ => [0, 1, -1, int.MaxValue, int.MinValue],
    };

    private static byte[] Ascii(string text) => System.Text.Encoding.ASCII.GetBytes(text);
}
