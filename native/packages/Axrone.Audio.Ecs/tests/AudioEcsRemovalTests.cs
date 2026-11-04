namespace Axrone.Audio.Ecs.Tests;

public sealed class AudioEcsRemovalTests : IDisposable
{
    private readonly AudioSystem _system = new(maxVoices: 4);
    private readonly World _world = new();
    private readonly AudioEcsBinder _binder;
    private readonly List<AudioClipRecord> _records = new();

    public AudioEcsRemovalTests()
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

    private AudioClipId RegisterClip(uint serial)
    {
        NativeAudioMemory memory = new(48000, 1, 480);
        memory.AsSpan().Fill(0.25f);
        AudioClipRecord record = new(new AudioClipId(serial), memory);
        _records.Add(record);
        return _system.Clips.Register(record);
    }

    private Entity SpawnSource(AudioSourceId id, AudioClipId clip, bool autoplay = false)
    {
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioSourceRef(id)
        {
            ClipId = clip,
            BusId = AudioBusId.Master,
            Loop = true,
            Autoplay = autoplay,
        });
        _binder.AttachSource(entity);
        _binder.Update();
        return entity;
    }

    [Fact]
    public void DetachSource_RemovesRegistration_AndReleasesVoice()
    {
        AudioClipId clip = RegisterClip(1U);
        AudioSourceId sourceId = new(7U);
        Entity entity = SpawnSource(sourceId, clip, autoplay: true);

        _system.Sources.RegisteredCount.Should().Be(1);
        _system.Playback.ActiveVoiceCount.Should().BeGreaterThan(0);

        _binder.DetachSource(entity);

        _system.Playback.ActiveVoiceCount.Should().Be(0);
        _system.Sources.TryGetDefinition(sourceId, out _).Should().BeFalse();
        _system.Sources.RegisteredCount.Should().Be(0);
    }

    [Fact]
    public void DestroyedEntitySweep_ReleasesVoiceAndRegistration()
    {
        AudioClipId clip = RegisterClip(2U);
        AudioSourceId sourceId = new(8U);
        Entity entity = SpawnSource(sourceId, clip, autoplay: true);

        _world.DestroyEntity(entity);
        _binder.Update().Should().BeEmpty();

        _system.Playback.ActiveVoiceCount.Should().Be(0);
        _system.Sources.TryGetDefinition(sourceId, out _).Should().BeFalse();
    }

    [Fact]
    public void DetachListener_RemovesRegistration()
    {
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioListenerRef(new AudioListenerId(3U), active: true));
        _binder.AttachListener(entity);

        _system.Listeners.RegisteredCount.Should().Be(2);

        _binder.DetachListener(entity);

        _system.Listeners.RegisteredCount.Should().Be(1);
        _system.Listeners.TryGetDescriptor(new AudioListenerId(3U), out _).Should().BeFalse();
        _system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
    }

    [Fact]
    public void Sweep_KeepsTheLastListenerRegistered()
    {
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioListenerRef(AudioListenerId.Primary, active: true));
        _binder.AttachListener(entity);

        _world.DestroyEntity(entity);
        _binder.Update().Should().BeEmpty();

        _system.Listeners.RegisteredCount.Should().Be(1);
        _system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
    }

    [Fact]
    public void DetachListener_LastListener_KeepsRegistrationWithoutThrowing()
    {
        Entity entity = _world.BeginEntity().Commit();
        _world.AddComponent(entity, new AudioListenerRef(AudioListenerId.Primary, active: true));
        _binder.AttachListener(entity);

        _binder.DetachListener(entity);

        _system.Listeners.RegisteredCount.Should().Be(1);
        _system.Listeners.TryGetDescriptor(AudioListenerId.Primary, out _).Should().BeTrue();
        _system.Listeners.ActiveListenerId.Should().Be(AudioListenerId.Primary);
    }

    [Fact]
    public void RemovedSource_ReportsTypedError_WhenPlayedAgain()
    {
        AudioClipId clip = RegisterClip(4U);
        AudioSourceId sourceId = new(9U);
        Entity entity = SpawnSource(sourceId, clip);
        _binder.Play(entity);
        _binder.Update();

        _binder.DetachSource(entity);

        Action play = () => _system.Sources.Play(sourceId, new AudioSourcePlayRequest());
        play.Should().Throw<AudioSourceException>().Which.Code.Should().Be("audio.invalid-source");
    }
}
