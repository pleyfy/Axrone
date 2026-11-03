namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioSourceRegistryTests : IDisposable
{
    private readonly CacheAlignedDiagnosticsCounters _counters = new();
    private readonly AudioObservabilityRuntime _observability;
    private readonly AudioClipStore _clips = new(16);
    private readonly AudioBusRegistry _buses;
    private readonly AudioListenerRegistry _listeners;
    private readonly AudioPlaybackRuntime _runtime;
    private readonly AudioSourceRegistry _sources;
    private readonly List<AudioClipRecord> _records = new();

    public AudioSourceRegistryTests()
    {
        _observability = new AudioObservabilityRuntime(_counters);
        _buses = new AudioBusRegistry(_observability);
        _listeners = new AudioListenerRegistry(_observability);
        _runtime = new AudioPlaybackRuntime(8, _buses, _clips, _listeners, _observability);
        _sources = new AudioSourceRegistry(64, _runtime, _observability);
    }

    public void Dispose()
    {
        _runtime.Dispose();
        _clips.Dispose();
        foreach (AudioClipRecord record in _records)
        {
            record.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private AudioClipId RegisterClip()
    {
        var memory = new NativeAudioMemory(48000, 1, 480);
        var record = new AudioClipRecord(new AudioClipId((uint)(_records.Count + 1)), memory);
        _records.Add(record);
        return _clips.Register(record);
    }

    [Fact]
    public void Upsert_Play_Renders()
    {
        AudioClipId clip = RegisterClip();
        var id = new AudioSourceId(1U);
        _sources.Upsert(id, new AudioSourceDefinition(ClipId: clip));

        AudioPlaybackHandle handle = _sources.Play(id, new AudioSourcePlayRequest());
        handle.IsValid.Should().BeTrue();

        Span<float> block = stackalloc float[256];
        _runtime.ProcessGraph(block);
    }

    [Fact]
    public void Play_Replaces_ActiveVoice()
    {
        AudioClipId clip = RegisterClip();
        var id = new AudioSourceId(1U);
        _sources.Upsert(id, new AudioSourceDefinition(ClipId: clip, Loop: true));

        AudioPlaybackHandle first = _sources.Play(id, new AudioSourcePlayRequest());
        AudioPlaybackHandle second = _sources.Play(id, new AudioSourcePlayRequest());
        second.Sequence.Should().NotBe(first.Sequence);
    }

    [Fact]
    public void Play_WithoutClip_Throws()
    {
        var id = new AudioSourceId(1U);
        _sources.Upsert(id, new AudioSourceDefinition());
        Action play = () => _sources.Play(id, new AudioSourcePlayRequest());
        play.Should().Throw<AudioSourceException>();
    }

    [Fact]
    public void Play_Unregistered_Throws()
    {
        Action play = () => _sources.Play(new AudioSourceId(9U), new AudioSourcePlayRequest());
        play.Should().Throw<AudioSourceException>();
    }

    [Fact]
    public void Pause_Resume_Stop_Flow()
    {
        AudioClipId clip = RegisterClip();
        var id = new AudioSourceId(1U);
        _sources.Upsert(id, new AudioSourceDefinition(ClipId: clip, Loop: true));
        _sources.Play(id, new AudioSourcePlayRequest());

        _sources.Pause(id);
        Span<float> paused = stackalloc float[128];
        _runtime.ProcessGraph(paused);
        paused.ToArray().Should().OnlyContain(v => v == 0.0f);

        _sources.Resume(id);
        Span<float> resumed = stackalloc float[128];
        _runtime.ProcessGraph(resumed);

        _sources.Stop(id);
        Span<float> stopped = stackalloc float[128];
        _runtime.ProcessGraph(stopped);
        stopped.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void PlayOneShot_Renders_WithoutRegistration()
    {
        AudioClipId clip = RegisterClip();
        AudioPlaybackHandle handle = _sources.PlayOneShot(clip, AudioSpatialization.Default2D);
        handle.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Autoplay_Starts_OnUpsert()
    {
        AudioClipId clip = RegisterClip();
        var id = new AudioSourceId(2U);
        _sources.Upsert(id, new AudioSourceDefinition(ClipId: clip, Loop: true, Autoplay: true));

        Span<float> block = stackalloc float[128];
        _runtime.ProcessGraph(block);
    }
}
