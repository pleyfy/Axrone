namespace Axrone.Audio.Tests;

/// <summary>
/// Serializes the tests that read the process-wide
/// <see cref="NativeAudioMemory.LiveBufferCount"/> gauge. xUnit runs
/// collections without this marker in parallel and collections with it
/// sequentially after them, so gauge deltas stay exact without disabling
/// parallelism for the whole assembly.
/// </summary>
[CollectionDefinition(TestCollections.NativeMemoryGauge)]
public sealed class GaugeIsolation
{
}

internal static class TestCollections
{
    internal const string NativeMemoryGauge = "native-memory-gauge";
}
