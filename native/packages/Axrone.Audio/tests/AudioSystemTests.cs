namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioSystemTests : IDisposable
{
    private readonly AudioSystem _system = AudioSystemBuilder<TypestateInitial>.Create()
        .WithCapacity(maxVoices: 8, maxSources: 64)
        .Build();
    private readonly List<AudioClipRecord> _records = new();

    public void Dispose()
    {
        _system.Dispose();
        foreach (AudioClipRecord record in _records)
        {
            record.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Builder_Honors_Capacities()
    {
        _system.Status.Should().Be(AudioSystemStatus.Running);
        _system.Buses.GetEffectiveGain(AudioBusId.Master).Should().BeApproximately(1.0f, 1e-5f);
        _system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
    }

    [Fact]
    public void EndToEnd_Play_Renders_Signal()
    {
        var memory = new NativeAudioMemory(48000, 1, 480);
        memory.AsSpan().Fill(0.25f);
        var record = new AudioClipRecord(new AudioClipId(1U), memory);
        _records.Add(record);
        _system.Clips.Register(record);

        var id = new AudioSourceId(1U);
        _system.Sources.Upsert(id, new AudioSourceDefinition(ClipId: new AudioClipId(1U), Loop: true));
        _system.Sources.Play(id, new AudioSourcePlayRequest()).IsValid.Should().BeTrue();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().Contain(v => v != 0.0f);
        _system.Counters.PlaybackCommandCount.Should().Be(1);
    }

    [Fact]
    public void Suspend_Clears_Output_Resume_Restores()
    {
        _system.Suspend();
        _system.Status.Should().Be(AudioSystemStatus.Suspended);

        Span<float> block = stackalloc float[128];
        block.Fill(1.0f);
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().OnlyContain(v => v == 0.0f);

        _system.Resume();
        _system.Status.Should().Be(AudioSystemStatus.Running);
    }

    [Fact]
    public void Use_AfterDispose_Throws()
    {
        var system = new AudioSystem();
        system.Dispose();
        Action suspend = () => system.Suspend();
        suspend.Should().Throw<AudioDisposedException>();
    }
}
