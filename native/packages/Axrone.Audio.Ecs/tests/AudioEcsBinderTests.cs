namespace Axrone.Audio.Ecs.Tests;

public sealed class AudioEcsBinderTests : IDisposable
{
    private readonly AudioSystem _system = new();
    private readonly World _world = new();
    private readonly AudioEcsBinder _binder;
    private readonly List<AudioClipRecord> _records = new();

    public AudioEcsBinderTests()
    {
        ComponentRegistry.Register<AudioSourceRef>();
        ComponentRegistry.Register<AudioListenerRef>();
        _binder = new AudioEcsBinder(_system, _world);
    }

    public void Dispose()
    {
        _binder.Dispose();
        _world.Dispose();
        _system.Dispose();
        foreach (AudioClipRecord record in _records)
        {
            record.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    private AudioClipId RegisterClip()
    {
        var memory = new NativeAudioMemory(48000, 1, 480);
        memory.AsSpan().Fill(0.25f);
        var record = new AudioClipRecord(new AudioClipId((uint)(_records.Count + 1)), memory);
        _records.Add(record);
        return _system.Clips.Register(record);
    }

    private Entity SpawnSource(AudioSourceId id, AudioClipId clip, bool loop = true)
    {
        Entity entity = _world.BeginEntity().Commit();
        var link = new AudioSourceRef(id)
        {
            ClipId = clip,
            BusId = AudioBusId.Master,
            Loop = loop,
        };
        _world.AddComponent(entity, link);
        _binder.AttachSource(entity);
        return entity;
    }

    [Fact]
    public void PlayCommand_Renders_AndSyncs_State()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = SpawnSource(sourceId, clip);
        _binder.Play(entity);

        IReadOnlyList<AudioBinderFailure> failures = _binder.Update();
        failures.Should().BeEmpty();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().Contain(v => v != 0.0f);

        _world.GetComponent<AudioSourceRef>(entity).PlaybackState.Should().Be(AudioPlaybackState.Playing);
    }

    [Fact]
    public void Tuning_Propagates_OnUpsert()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = SpawnSource(sourceId, clip);
        _binder.Update();

        ref AudioSourceRef link = ref _world.GetComponent<AudioSourceRef>(entity);
        link.Volume = 0.25f;
        _binder.Update();

        _binder.Play(entity);
        _binder.Update();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);

        float energy = 0.0f;
        foreach (float sample in block)
        {
            energy += MathF.Abs(sample);
        }

        energy.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void StopCommand_Silences_AndSyncs_State()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = SpawnSource(sourceId, clip);
        _binder.Play(entity);
        _binder.Update();
        _binder.Stop(entity);
        _binder.Update();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().OnlyContain(v => v == 0.0f);
        _world.GetComponent<AudioSourceRef>(entity).PlaybackState.Should().Be(AudioPlaybackState.Stopped);
    }

    [Fact]
    public void Failures_Are_Reported_Without_Stalling()
    {
        var sourceId = new AudioSourceId(9U);
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioSourceRef(sourceId));
        _binder.AttachSource(entity);
        _binder.Play(entity);

        AudioClipId clip = RegisterClip();
        var goodId = new AudioSourceId(10U);
        _system.Sources.Upsert(goodId, new AudioSourceDefinition());
        Entity good = _world.BeginEntity().Commit();
        _world.AddComponent(good, new AudioSourceRef(goodId) { ClipId = clip, BusId = AudioBusId.Master, Loop = true });
        _binder.AttachSource(good);
        _binder.Play(good);

        IReadOnlyList<AudioBinderFailure> failures = _binder.Update();

        failures.Should().ContainSingle();
        failures[0].Entity.Should().Be(entity);
        failures[0].Command.Should().Be(AudioSourceCommandType.Play);

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().Contain(v => v != 0.0f);
    }

    [Fact]
    public void Destroyed_Entity_Drops_Queue()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = SpawnSource(sourceId, clip);
        _binder.Play(entity);
        _world.DestroyEntity(entity);
        _binder.Update().Should().BeEmpty();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void DetachSource_Stops_Immediately()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = SpawnSource(sourceId, clip);
        _binder.Play(entity);
        _binder.Update();
        _binder.DetachSource(entity);

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void Autoplay_Fires_OnAttach()
    {
        AudioClipId clip = RegisterClip();
        var sourceId = new AudioSourceId(1U);
        _system.Sources.Upsert(sourceId, new AudioSourceDefinition());

        Entity entity = _world.BeginEntity().Commit();
        var link = new AudioSourceRef(sourceId) { Autoplay = true, ClipId = clip, BusId = AudioBusId.Master };
        _world.AddComponent(entity, link);
        _binder.AttachSource(entity);
        _binder.Update();

        Span<float> block = stackalloc float[256];
        _system.ProcessAudioRenderBlock(block);
        block.ToArray().Should().Contain(v => v != 0.0f);
    }

    [Fact]
    public void AttachListener_Registers_AndActivates()
    {
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioListenerRef(new AudioListenerId(3U), active: true));
        _binder.AttachListener(entity);
        _binder.Update();

        _system.Listeners.ActiveListenerId.Should().Be(new AudioListenerId(3U));
        _binder.DetachListener(entity);
        _binder.Update();
    }

    [Fact]
    public void Update_DoesNotReUpsertUnchangedSources()
    {
        AudioClipId clip = RegisterClip();
        var listener = new UpsertCountingListener();
        _system.Observability.Subscribe(listener);

        Entity entity = SpawnSource(new AudioSourceId(1U), clip);
        _binder.Update();
        int afterFirst = listener.SourceUpserts;
        afterFirst.Should().BeGreaterThan(0);

        _binder.Update();
        _binder.Update();

        listener.SourceUpserts.Should().Be(afterFirst, "an unchanged definition must not emit upserts every frame");
    }

    [Fact]
    public void Update_ReUpsertsWhenTuningChanges()
    {
        AudioClipId clip = RegisterClip();
        var listener = new UpsertCountingListener();
        _system.Observability.Subscribe(listener);

        Entity entity = SpawnSource(new AudioSourceId(1U), clip);
        _binder.Update();
        int afterFirst = listener.SourceUpserts;

        ref AudioSourceRef link = ref _world.GetComponent<AudioSourceRef>(entity);
        link.Volume = 0.5f;

        _binder.Update();

        listener.SourceUpserts.Should().Be(afterFirst + 1);
    }

    private sealed class UpsertCountingListener : IAudioEventListener
    {
        public int SourceUpserts;

        public void OnAudioEvent(in AudioRuntimeEvent ev)
        {
            if (ev.Type == AudioEventType.SourceUpserted)
            {
                SourceUpserts++;
            }
        }
    }
}
