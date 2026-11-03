namespace Axrone.Audio.Tests;

public sealed class AudioGraphZeroAllocationTests
{
    private const int Iterations = 2000;
    private static readonly AudioClipId ClipId = new(9U);
    private static readonly byte[] WavPayload = WavFactory.Pcm([16384, 8192, 4096, 2048, 1024, 512, 256, 128], 2, 16);

    [Fact]
    public void RenderBlock_WithPlayingClipAndActiveRamp_IsZeroAlloc()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        system.Sources.Upsert(new AudioSourceId(1U), new AudioSourceDefinition(BusId: AudioBusId.Sfx, ClipId: ClipId, Loop: true));
        system.Sources.Play(new AudioSourceId(1U), new AudioSourcePlayRequest());

        AudioMixerSnapshot snapshot = system.CaptureMixerSnapshot();
        system.Buses.Upsert(new AudioBusDefinition(AudioBusId.Sfx, AudioBusId.Master, 0.0f));
        system.ApplyMixerSnapshot(snapshot, atTime: 0.0, durationSeconds: 100.0);
        system.Buses.PendingRampCount.Should().Be(8);

        float[] block = new float[256];
        for (int i = 0; i < 200; i++)
        {
            system.ProcessAudioRenderBlock(block);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Iterations; i++)
        {
            system.ProcessAudioRenderBlock(block);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0L);
        system.MixerClockSeconds.Should().BeGreaterThan(0.0);
        system.Buses.PendingRampCount.Should().Be(8);
        system.Buses.GetEffectiveGain(AudioBusId.Sfx).Should().BeGreaterThan(0.0f);
        system.Playback.ActiveVoiceCount.Should().Be(1);
        block.Sum(value => MathF.Abs(value)).Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void EffectiveGainLookup_IsZeroAlloc()
    {
        using AudioSystem system = new();
        float expected = system.Buses.GetEffectiveGain(AudioBusId.Ambient);

        float[] sink = new float[1];
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Iterations; i++)
        {
            sink[0] = system.Buses.GetEffectiveGain(AudioBusId.Ambient);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0L);
        sink[0].Should().Be(expected);
    }

    [Fact]
    public void RampMath_IsZeroAlloc()
    {
        float[] sink = new float[1];
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Iterations; i++)
        {
            float t = MixerRamp.Progress(i * 0.001, 0.0, 1.0);
            sink[0] = MixerRamp.Interpolate(MixerRampCurve.Linear, 0.25f, 1.0f, t);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0L);
        sink[0].Should().Be(1.0f);
        MixerRamp.Progress(0.5, 0.0, 1.0).Should().Be(0.5f);
        MixerRamp.Progress(2.0, 0.0, 1.0).Should().Be(1.0f);
        MixerRamp.Progress(-1.0, 0.0, 1.0).Should().Be(0.0f);
    }

    [Fact]
    public void ClipLookupAndBusEnumeration_IsZeroAlloc()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);

        AudioClipId id = ClipId;
        int hits = 0;
        int busVisits = 0;
        float gainSum = 0.0f;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Iterations; i++)
        {
            if (system.Clips.TryGet(id, out AudioClipRecord? record))
            {
                hits++;
                _ = record!.DurationSeconds;
            }

            foreach (AudioBusState bus in system.Buses)
            {
                busVisits++;
                gainSum += bus.EffectiveGain;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0L);
        hits.Should().Be(Iterations);
        busVisits.Should().Be(Iterations * 8);
        gainSum.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void RemovalAndSnapshot_QueriesDoNotRegressRenderPath()
    {
        using AudioSystem system = new(outputSampleRate: WavFactory.DefaultRate);
        system.Ingest.Register(system.Clips, ClipId, WavPayload);
        system.Sources.Upsert(new AudioSourceId(1U), new AudioSourceDefinition(BusId: AudioBusId.Ui, ClipId: ClipId, Loop: true));
        system.Sources.Play(new AudioSourceId(1U), new AudioSourcePlayRequest());

        system.RemoveBus(AudioBusId.Ui);
        system.Sources.TryGetDefinition(new AudioSourceId(1U), out AudioSourceDefinition definition).Should().BeTrue();
        definition.BusId.Should().Be(AudioBusId.Sfx);

        float[] block = new float[128];
        for (int i = 0; i < 200; i++)
        {
            system.ProcessAudioRenderBlock(block);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Iterations; i++)
        {
            system.ProcessAudioRenderBlock(block);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0L);
        system.Playback.ActiveVoiceCount.Should().Be(1);
        block.Sum(value => MathF.Abs(value)).Should().BeGreaterThan(0.0f);
    }
}
