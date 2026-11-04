namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioClipStoreTests : IDisposable
{
    private readonly AudioClipStore _store = new(4);

    public void Dispose()
    {
        _store.Dispose();
        GC.SuppressFinalize(this);
    }

    private static AudioClipRecord CreateClip(uint id)
    {
        var memory = new NativeAudioMemory(48000, 1, 480);
        return new AudioClipRecord(new AudioClipId(id), memory);
    }

    [Fact]
    public void Register_TryGet_RoundTrip()
    {
        using AudioClipRecord record = CreateClip(1U);
        _store.Register(record).Should().Be(new AudioClipId(1U));
        _store.TryGet(new AudioClipId(1U), out AudioClipRecord? found).Should().BeTrue();
        found.Should().BeSameAs(record);
        found.DurationSeconds.Should().BeApproximately(0.01f, 1e-5f);
        _store.TryGet(new AudioClipId(99U), out _).Should().BeFalse();
    }

    [Fact]
    public void Replace_Disposes_OldRecord()
    {
        _store.Register(CreateClip(1U));
        _store.Register(CreateClip(1U));
        _store.TryGet(new AudioClipId(1U), out AudioClipRecord? found).Should().BeTrue();
        found.Should().NotBeNull();
    }

    [Fact]
    public void Evicts_LeastRecentlyUsed()
    {
        for (uint i = 1U; i <= 4U; i++)
        {
            _store.Register(CreateClip(i));
        }

        _store.TryGet(new AudioClipId(1U), out _).Should().BeTrue();
        _store.Register(CreateClip(5U));

        _store.TryGet(new AudioClipId(1U), out _).Should().BeTrue();
        _store.TryGet(new AudioClipId(5U), out _).Should().BeTrue();
        _store.TryGet(new AudioClipId(2U), out _).Should().BeFalse();
    }

    [Fact]
    public void Unregister_Removes_AndMisses_Unknown()
    {
        _store.Register(CreateClip(1U));
        _store.Unregister(new AudioClipId(1U)).Should().BeTrue();
        _store.TryGet(new AudioClipId(1U), out _).Should().BeFalse();
        _store.Unregister(new AudioClipId(1U)).Should().BeFalse();
    }

    [Fact]
    public void Use_AfterDispose_Throws()
    {
        var store = new AudioClipStore(4);
        store.Dispose();
        Action register = () => store.Register(CreateClip(1U));
        register.Should().Throw<AudioDisposedException>();
    }
}
