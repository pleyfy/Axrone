namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioDecoderContractTests
{
    private static readonly AudioClipId ClipId = new(11U);
    private static readonly byte[] OggPayload = WavFactory.Concat("OggS"u8.ToArray(), new byte[32]);

    private sealed class StubDecoder : IAudioSampleDecoder
    {
        private readonly bool _accept;
        private readonly bool _throw;
        private readonly bool _empty;
        private readonly int _sampleRate;
        private readonly int _channels;

        internal StubDecoder(string id, bool accept = true, bool throwInside = false, bool empty = false, int sampleRate = 48000, int channels = 1)
        {
            Id = id;
            _accept = accept;
            _throw = throwInside;
            _empty = empty;
            _sampleRate = sampleRate;
            _channels = channels;
        }

        internal int Calls { get; private set; }

        public string Id { get; }

        public bool CanDecode(in AudioContainerInfo container) =>
            _accept && container.Kind is AudioContainerKind.Ogg or AudioContainerKind.Mp3 or AudioContainerKind.Flac or AudioContainerKind.Wav;

        public bool TryDecode(
            in AudioContainerInfo container,
            ReadOnlyMemory<byte> payload,
            out NativeAudioMemory? samples,
            out string? failureReason)
        {
            Calls++;
            _ = container;
            _ = payload;

            if (_throw)
            {
                throw new InvalidOperationException("decoder exploded");
            }

            if (_empty)
            {
                samples = null;
                failureReason = "unsupported stream";
                return false;
            }

            NativeAudioMemory buffer = new(_sampleRate, _channels, _channels * 8);
            buffer.AsSpan()[0] = 0.25f;
            samples = buffer;
            failureReason = null;
            return true;
        }
    }

    [Fact]
    public void NoDecoderRegistered_FailsClosed_WithoutProducingClip()
    {
        AudioClipIngest ingest = new();

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        AudioDecoderException decoder = error.As<AudioDecoderException>();
        decoder.Failure.Should().Be(AudioDecoderFailure.DecoderMissing);
        decoder.Code.Should().Be("audio.decoder.missing");
        decoder.IsUnavailable.Should().BeTrue();
        decoder.Message.Should().Contain(nameof(IAudioSampleDecoder));
    }

    [Fact]
    public void RegisteredDecoder_ProducesDecodedSamples()
    {
        StubDecoder decoder = new("stub.vorbis");
        AudioDecoderRegistry registry = new();
        registry.Register(decoder).Should().BeTrue();
        AudioClipIngest ingest = new(registry);

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Kind.Should().Be(AudioContainerKind.Ogg);
            record!.Buffer.ChannelCount.Should().Be(1);
            record.Buffer.SampleCount.Should().Be(8);
            record.Buffer.AsReadOnlySpan()[0].Should().Be(0.25f);
        }

        decoder.Calls.Should().Be(1);
    }

    [Fact]
    public void DecoderRejection_IsDistinctFromMissingDecoder()
    {
        AudioClipIngest ingest = new(new AudioDecoderRegistry(new StubDecoder("stub.reject", accept: false)));

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        AudioDecoderException decoder = error.As<AudioDecoderException>();
        decoder.Failure.Should().Be(AudioDecoderFailure.DecoderMissing);
        decoder.Code.Should().Be("audio.decoder.missing");
    }

    [Fact]
    public void DecoderReturningFalse_IsTypedFailure_NotEmptyClip()
    {
        AudioClipIngest ingest = new(new AudioDecoderRegistry(new StubDecoder("stub.refuse", empty: true)));

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        AudioDecoderException decoder = error.As<AudioDecoderException>();
        decoder.Failure.Should().Be(AudioDecoderFailure.DecoderRejected);
        decoder.Code.Should().Be("audio.decoder.failed");
        decoder.DecoderId.Should().Be("stub.refuse");
        decoder.Message.Should().Contain("unsupported stream");
    }

    [Fact]
    public void DecoderThrowing_IsReportedAsFaulted()
    {
        AudioClipIngest ingest = new(new AudioDecoderRegistry(new StubDecoder("stub.throw", throwInside: true)));

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        AudioDecoderException decoder = error.As<AudioDecoderException>();
        decoder.Failure.Should().Be(AudioDecoderFailure.DecoderFaulted);
        decoder.Message.Should().Contain("decoder exploded");
        decoder.InnerException.Should().BeOfType<InvalidOperationException>();
    }

    [Fact]
    public void DecoderProducingNoSamples_IsReportedAsEmpty_AndFreed()
    {
        long before = NativeAudioMemory.LiveBufferCount;
        AudioClipIngest ingest = new(new AudioDecoderRegistry(new ProducesEmptyDecoder()));

        ingest.TryCreateRecord(ClipId, OggPayload, out AudioClipRecord? record, out _, out AudioException? error).Should().BeFalse();

        record.Should().BeNull();
        error.As<AudioDecoderException>().Failure.Should().Be(AudioDecoderFailure.DecoderProducedEmpty);
        NativeAudioMemory.LiveBufferCount.Should().Be(before);
    }

    private sealed class ProducesEmptyDecoder : IAudioSampleDecoder
    {
        public string Id => "stub.empty-buffer";

        public bool CanDecode(in AudioContainerInfo container) => true;

        public bool TryDecode(
            in AudioContainerInfo container,
            ReadOnlyMemory<byte> payload,
            out NativeAudioMemory? samples,
            out string? failureReason)
        {
            _ = container;
            _ = payload;
            samples = null;
            failureReason = null;
            return true;
        }
    }

    [Fact]
    public void DuplicateRegistration_IsRejected_ById()
    {
        AudioDecoderRegistry registry = new();
        registry.Register(new StubDecoder("dup")).Should().BeTrue();
        registry.Register(new StubDecoder("dup")).Should().BeFalse();
        registry.Count.Should().Be(1);
    }

    [Fact]
    public void RegisterOrReplace_KeepsResolutionOrder()
    {
        StubDecoder first = new("a", accept: false);
        StubDecoder second = new("b");
        StubDecoder replacement = new("a");

        AudioDecoderRegistry registry = new();
        registry.Register(first);
        registry.Register(second);
        registry.RegisterOrReplace(replacement);

        registry.Count.Should().Be(2);
        registry.TryResolve(OggInfo(), out IAudioSampleDecoder? resolved).Should().BeTrue();
        resolved!.Id.Should().Be("a");
        ReferenceEquals(resolved, replacement).Should().BeTrue();
        ReferenceEquals(FindById(registry, "a"), replacement).Should().BeTrue();
        ReferenceEquals(FindById(registry, "b"), second).Should().BeTrue();
        foreach (IAudioSampleDecoder decoder in registry)
        {
            _ = decoder;
        }

        registry.Count.Should().Be(2);
    }

    [Fact]
    public void Unregister_RemovesDecoder_AndFailsClosedAgain()
    {
        AudioDecoderRegistry registry = new(new StubDecoder("temp"));
        AudioClipIngest ingest = new(registry);

        ingest.TryCreateRecord(ClipId, OggPayload, out _, out _, out _).Should().BeTrue();
        registry.Unregister("temp").Should().BeTrue();
        registry.Unregister("temp").Should().BeFalse();
        registry.Count.Should().Be(0);

        ingest.TryCreateRecord(new AudioClipId(12U), OggPayload, out _, out _, out AudioException? error).Should().BeFalse();
        error.As<AudioDecoderException>().IsUnavailable.Should().BeTrue();
    }

    [Fact]
    public void Clear_EmptiesRegistry()
    {
        AudioDecoderRegistry registry = new();
        registry.Register(new StubDecoder("a"));
        registry.Register(new StubDecoder("b"));

        registry.Clear();

        registry.Count.Should().Be(0);
        registry.Supports(OggInfo()).Should().BeFalse();
    }

    [Fact]
    public void AdpcmInWav_IsRoutedToDecoder_NotMisdecodedAsPcm()
    {
        byte[] wav = WavFactory.WithFormatTag(WavFactory.Pcm([0, 0, 0, 0, 0, 0, 0, 0], 1, 16), 0x0011);
        StubDecoder decoder = new("stub.adpcm");
        AudioDecoderRegistry registry = new();
        registry.Register(decoder);

        AudioClipIngest ingest = new(registry);
        ingest.TryCreateRecord(ClipId, wav, out AudioClipRecord? record, out AudioContainerInfo info, out _)
            .Should().BeTrue();

        using (record)
        {
            info.Encoding.Should().Be(AudioSampleEncoding.Compressed);
            decoder.Calls.Should().Be(1);
        }
    }

    [Fact]
    public void DecodedClip_RegistersInStore_AndFreesOnUnregister()
    {
        using AudioClipStore store = new(4);
        AudioClipIngest ingest = new(new AudioDecoderRegistry(new StubDecoder("stub.vorbis")));
        long before = NativeAudioMemory.LiveBufferCount;

        AudioClipId id = ingest.Register(store, ClipId, OggPayload);

        NativeAudioMemory.LiveBufferCount.Should().Be(before + 1);
        store.Unregister(id).Should().BeTrue();
        NativeAudioMemory.LiveBufferCount.Should().Be(before);
    }

    [Fact]
    public void IngestRegistersThroughSystem_AndPlaysBack()
    {
        using AudioSystem system = new(decoders: new AudioDecoderRegistry(new StubDecoder("stub.vorbis", channels: 2, sampleRate: 48000)));

        AudioClipId id = system.RegisterClip(ClipId, OggPayload);

        system.Sources.Upsert(new AudioSourceId(3U), new AudioSourceDefinition(BusId: AudioBusId.Sfx, ClipId: id));
        system.Sources.Play(new AudioSourceId(3U), new AudioSourcePlayRequest());

        float[] block = new float[8];
        system.ProcessAudioRenderBlock(block);

        block[0].Should().BeApproximately(0.25f * 0.70710678f, 1e-5f);
        system.Sources.Stop(new AudioSourceId(3U));
    }

    private static AudioContainerInfo OggInfo() =>
        new(AudioContainerKind.Ogg, AudioSampleEncoding.Compressed, AudioChannelLayout.Unknown, 0, 0, 0, 0, 0, 0U, 0);

    private static IAudioSampleDecoder? FindById(AudioDecoderRegistry registry, string id)
    {
        foreach (IAudioSampleDecoder decoder in registry)
        {
            if (decoder.Id == id)
            {
                return decoder;
            }
        }

        return null;
    }
}
