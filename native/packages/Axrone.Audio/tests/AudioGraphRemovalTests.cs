namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioGraphRemovalTests
{
    private static readonly AudioClipId ClipId = new(5U);
    private static readonly byte[] WavPayload = WavFactory.Pcm([16384, 8192, 4096, 2048, 1024, 512, 256, 128], 2, 16);

    [Fact]
    public void RemoveBus_Master_IsATypedError()
    {
        using AudioSystem system = new();

        Action remove = () => system.RemoveBus(AudioBusId.Master);

        remove.Should().Throw<AudioBusException>()
            .Which.Code.Should().Be("audio.invalid-bus");
        system.Buses.TryGetBus(AudioBusId.Master, out _).Should().BeTrue();
    }

    [Fact]
    public void RemoveBus_UnknownBus_ReturnsFalse()
    {
        using AudioSystem system = new();

        AudioBusRemoveResult result = system.RemoveBus(new AudioBusId(99U));

        result.Removed.Should().BeFalse();
        result.ReparentedTo.Should().Be(AudioBusId.Invalid);
        result.ReparentedChildCount.Should().Be(0);
    }

    [Fact]
    public void RemoveBus_ReparentsChildrenToTheRemovedBusParent()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId deep = new(20U);
        system.Buses.Upsert(new AudioBusDefinition(deep, AudioBusId.Ui, 0.5f));
        system.Buses.GetEffectiveGain(deep).Should().Be(0.5f);

        AudioBusRemoveResult result = system.RemoveBus(AudioBusId.Ui);

        result.Removed.Should().BeTrue();
        result.ReparentedTo.Should().Be(AudioBusId.Sfx);
        result.ReparentedChildCount.Should().Be(1);
        system.Buses.TryGetBus(deep, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Sfx);
        state.EffectiveGain.Should().Be(0.5f);
        system.Buses.TryGetBus(AudioBusId.Ui, out _).Should().BeFalse();
    }

    [Fact]
    public void RemoveBus_FallsBackToMaster_WhenTheRemovedBusWasARoot()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId root = new(20U);
        AudioBusId child = new(21U);
        system.Buses.Upsert(new AudioBusDefinition(root, AudioBusId.Invalid, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(child, root, 0.25f));

        AudioBusRemoveResult result = system.RemoveBus(root);

        result.ReparentedTo.Should().Be(AudioBusId.Master);
        system.Buses.TryGetBus(child, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Master);
        state.EffectiveGain.Should().Be(0.25f);
    }

    [Fact]
    public void RemoveBus_ReassignsRegisteredSourcesAndLiveVoices()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Ambient, AudioBusId.Music, 0.5f));
        system.Sources.Upsert(new AudioSourceId(1U), new AudioSourceDefinition(BusId: AudioBusId.Ambient, ClipId: ClipId));
        system.Sources.Play(new AudioSourceId(1U), new AudioSourcePlayRequest());

        AudioBusRemoveResult result = system.RemoveBus(AudioBusId.Ambient);

        result.ReparentedTo.Should().Be(AudioBusId.Music);
        system.Sources.TryGetDefinition(new AudioSourceId(1U), out AudioSourceDefinition definition).Should().BeTrue();
        definition.BusId.Should().Be(AudioBusId.Music);

        float[] block = new float[8];
        system.ProcessAudioRenderBlock(block);
        block[0].Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void RemoveBus_CancelsThePendingRampOfThatBus()
    {
        using AudioSystem system = new();
        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Ui, AudioBusId.Sfx, 0.0f));
        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 1.0);
        system.Buses.PendingRampCount.Should().Be(8);

        AudioBusRemoveResult result = system.RemoveBus(AudioBusId.Ui);

        result.CancelledRampCount.Should().Be(1);
        system.Buses.PendingRampCount.Should().Be(7);
        system.AdvanceMixerClock(1.0);
        system.Buses.PendingRampCount.Should().Be(0);
    }

    [Fact]
    public void RemoveBus_ThenUpsertSameId_ReregistersCleanly()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId bus = new(20U);
        system.Buses.Upsert(new AudioBusDefinition(bus, AudioBusId.Sfx, 0.25f));
        system.RemoveBus(bus);

        system.Buses.Upsert(new AudioBusDefinition(bus, AudioBusId.Music, 0.5f));

        system.Buses.TryGetBus(bus, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(AudioBusId.Music);
        state.EffectiveGain.Should().Be(0.5f);
    }

    [Fact]
    public void RemoveBus_CountsMutations_AndEmitsBusRemoved()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId bus = new(20U);
        system.Buses.Upsert(new AudioBusDefinition(bus, AudioBusId.Sfx, 1.0f));
        long before = system.Counters.BusMutationCount;
        RecordingListener listener = new();
        system.Observability.Subscribe(listener);

        system.RemoveBus(bus);

        system.Counters.BusMutationCount.Should().BeGreaterThan(before);
        listener.Types.Should().Contain(AudioEventType.BusRemoved);
        system.Observability.Unsubscribe(listener);
    }

    [Fact]
    public void RemoveBus_NeverCreatesACycle_WhenChildrenMoveUp()
    {
        using AudioSystem system = new(maxBuses: 32);
        AudioBusId a = new(20U);
        AudioBusId b = new(21U);
        AudioBusId c = new(22U);
        system.Buses.Upsert(new AudioBusDefinition(a, AudioBusId.Master, 1.0f));
        system.Buses.Upsert(new AudioBusDefinition(b, a, 0.5f));
        system.Buses.Upsert(new AudioBusDefinition(c, b, 0.25f));

        system.RemoveBus(b);

        system.Buses.GetEffectiveGain(c).Should().Be(0.25f);
        system.Buses.TryGetBus(c, out AudioBusState state).Should().BeTrue();
        state.ParentId.Should().Be(a);
    }

    [Fact]
    public void RemoveListener_Unknown_ReturnsFalse()
    {
        using AudioSystem system = new();

        system.Listeners.RemoveListener(new AudioListenerId(60U)).Should().BeFalse();
        system.Listeners.RegisteredCount.Should().Be(1);
    }

    [Fact]
    public void RemoveListener_ActiveFallsBackToTheLowestRemaining()
    {
        using AudioSystem system = new();
        AudioListenerId second = new(2U);
        AudioListenerId third = new(3U);
        system.Listeners.Upsert(second, AudioListenerDescriptor.Default with { GlobalVolume = 0.5f });
        system.Listeners.Upsert(third, AudioListenerDescriptor.Default with { GlobalVolume = 0.25f });
        system.Listeners.SetActive(second);

        system.Listeners.RemoveListener(second).Should().BeTrue();

        system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
        system.Listeners.GetActiveDescriptor().GlobalVolume.Should().Be(1.0f);
        system.Listeners.RegisteredCount.Should().Be(2);

        system.Listeners.RemoveListener(AudioListenerId.Primary).Should().BeTrue();

        system.Listeners.ActiveListenerId.Should().Be(third);
        system.Listeners.GetActiveDescriptor().GlobalVolume.Should().Be(0.25f);
        system.Listeners.RegisteredCount.Should().Be(1);
    }

    [Fact]
    public void RemoveListener_LastRegistered_IsATypedError()
    {
        using AudioSystem system = new();

        Action remove = () => system.Listeners.RemoveListener(AudioListenerId.Primary);

        remove.Should().Throw<AudioListenerException>().Which.Code.Should().Be("audio.invalid-listener");
        system.Listeners.RegisteredCount.Should().Be(1);
        system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
    }

    [Fact]
    public void RemoveSource_ReleasesVoicesAndUnregisters()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate, maxVoices: 4);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        AudioSourceId source = new(1U);
        system.Sources.Upsert(source, new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
        system.Sources.Play(source, new AudioSourcePlayRequest());
        system.Playback.ActiveVoiceCount.Should().Be(1);

        system.Sources.RemoveSource(source).Should().Be(1);

        system.Playback.ActiveVoiceCount.Should().Be(0);
        system.Sources.TryGetDefinition(source, out _).Should().BeFalse();
        system.Sources.RegisteredCount.Should().Be(0);
        system.Clips.TryGet(ClipId, out _).Should().BeTrue();
    }

    [Fact]
    public void RemoveSource_UnknownSource_ReleasesNothing()
    {
        using AudioSystem system = new();

        system.Sources.RemoveSource(new AudioSourceId(77U)).Should().Be(0);
    }

    [Fact]
    public void RemovedSource_CannotBePlayedAgain_WithoutReRegistration()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        AudioSourceId source = new(1U);
        system.Sources.Upsert(source, new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
        system.Sources.RemoveSource(source);

        Action play = () => system.Sources.Play(source, new AudioSourcePlayRequest());

        play.Should().Throw<AudioSourceException>().Which.Code.Should().Be("audio.invalid-source");
    }

    [Fact]
    public void RemoveSource_FreesSlotsForNewVoices()
    {
        using AudioSystem system = new(maxVoices: 2, outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        for (uint i = 1; i <= 2; i++)
        {
            AudioSourceId id = new(i);
            system.Sources.Upsert(id, new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
            system.Sources.Play(id, new AudioSourcePlayRequest());
        }

        system.Sources.RemoveSource(new AudioSourceId(1U));
        AudioSourceId third = new(3U);
        system.Sources.Upsert(third, new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
        AudioPlaybackHandle handle = system.Sources.Play(third, new AudioSourcePlayRequest());

        handle.IsValid.Should().BeTrue();
        system.Playback.TryGetState(handle, out AudioPlaybackState state).Should().BeTrue();
        state.Should().Be(AudioPlaybackState.Playing);
    }

    [Fact]
    public void StaleHandle_OnDisposedRuntime_IsATypedError()
    {
        AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        AudioSourceId source = new(1U);
        system.Sources.Upsert(source, new AudioSourceDefinition(BusId: AudioBusId.Master, ClipId: ClipId));
        AudioPlaybackHandle handle = system.Sources.Play(source, new AudioSourcePlayRequest());
        handle.IsValid.Should().BeTrue();

        system.Dispose();

        Action stop = () => handle.Stop();
        Action pause = () => handle.Pause();
        Action resume = () => handle.Resume();

        stop.Should().Throw<AudioDisposedException>().Which.Code.Should().Be("audio.disposed");
        pause.Should().Throw<AudioDisposedException>();
        resume.Should().Throw<AudioDisposedException>();
    }

    [Fact]
    public void UnregisteringAClipFreesItsNativeBuffer()
    {
        using AudioClipStore store = new(4);
        AudioClipIngest ingest = new();
        long before = NativeAudioMemory.LiveBufferCount;

        AudioClipId id = ingest.Register(store, ClipId, WavPayload);
        NativeAudioMemory.LiveBufferCount.Should().Be(before + 1);

        store.Unregister(id).Should().BeTrue();
        NativeAudioMemory.LiveBufferCount.Should().Be(before);
    }

    [Fact]
    public void LruEvictionFreesNativeBuffers()
    {
        long before = NativeAudioMemory.LiveBufferCount;
        using (AudioClipStore store = new(2))
        {
            AudioClipIngest ingest = new();
            ingest.Register(store, new AudioClipId(1U), WavPayload);
            ingest.Register(store, new AudioClipId(2U), WavPayload);
            NativeAudioMemory.LiveBufferCount.Should().Be(before + 2);

            ingest.Register(store, new AudioClipId(3U), WavPayload);
            NativeAudioMemory.LiveBufferCount.Should().Be(before + 2);
            store.TryGet(new AudioClipId(1U), out _).Should().BeFalse();
        }

        NativeAudioMemory.LiveBufferCount.Should().Be(before);
    }

    [Fact]
    public void ReplacingAClipRecordFreesThePreviousBuffer()
    {
        long before = NativeAudioMemory.LiveBufferCount;
        using AudioClipStore store = new(4);
        AudioClipIngest ingest = new();
        ingest.Register(store, ClipId, WavPayload);
        store.TryGet(ClipId, out AudioClipRecord? first).Should().BeTrue();
        long withFirst = NativeAudioMemory.LiveBufferCount;

        ingest.Register(store, ClipId, WavFactory.Pcm([0, 0], 1, 16));

        Action useOld = () => first!.Buffer.AsSpan();
        useOld.Should().Throw<AudioDisposedException>();
        NativeAudioMemory.LiveBufferCount.Should().Be(withFirst);
    }

    private sealed class RecordingListener : IAudioEventListener
    {
        public List<AudioEventType> Types { get; } = [];

        public void OnAudioEvent(in AudioRuntimeEvent ev) => Types.Add(ev.Type);
    }
}
