namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public class NativeAudioMemoryTests
{
    [Fact]
    public void Allocates_Zeroed_Buffer()
    {
        using var memory = new NativeAudioMemory(48000, 2, 1024);
        memory.SampleRate.Should().Be(48000);
        memory.ChannelCount.Should().Be(2);
        memory.SampleCount.Should().Be(1024);
        memory.AsSpan().ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public unsafe void Pointer_Is_CacheAligned()
    {
        using var memory = new NativeAudioMemory(44100, 1, 256);
        ((nuint)memory.Pointer % 64).Should().Be(0);
        memory.AsSpan()[0] = 0.5f;
        memory.AsReadOnlySpan()[0].Should().Be(0.5f);
    }

    [Fact]
    public void Invalid_Arguments_Throw_Config()
    {
        Action badRate = () => _ = new NativeAudioMemory(0, 2, 128);
        Action badChannels = () => _ = new NativeAudioMemory(48000, 9, 128);
        Action badCount = () => _ = new NativeAudioMemory(48000, 2, 0);
        badRate.Should().Throw<AudioConfigurationException>();
        badChannels.Should().Throw<AudioConfigurationException>();
        badCount.Should().Throw<AudioConfigurationException>();
    }

    [Fact]
    public void Use_AfterDispose_Throws()
    {
        var memory = new NativeAudioMemory(48000, 1, 64);
        memory.Dispose();
        Action read = () => _ = memory.AsSpan();
        read.Should().Throw<AudioDisposedException>();
        memory.Dispose();
    }
}
