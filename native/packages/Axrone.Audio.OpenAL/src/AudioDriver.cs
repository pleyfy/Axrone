namespace Axrone.Audio.OpenAL;

/// <summary>
/// Output source state, driver-neutral.
/// </summary>
public enum AudioDriverSourceState : byte
{
    /// <summary>Initial.</summary>
    Initial = 0,

    /// <summary>Playing.</summary>
    Playing = 1,

    /// <summary>Paused.</summary>
    Paused = 2,

    /// <summary>Stopped.</summary>
    Stopped = 3,
}

/// <summary>
/// Output driver seam: the streaming backend programs against this, so pump
/// logic tests run on a fake without audio hardware.
/// </summary>
public interface IAudioDriver : IDisposable
{
    /// <summary>Whether a device is open.</summary>
    bool IsOpen { get; }

    /// <summary>Opens the default or named device at a sample rate.</summary>
    void Open(string? deviceName, int frequency);

    /// <summary>Closes the device.</summary>
    void Close();

    /// <summary>Generates buffer handles.</summary>
    uint[] GenBuffers(int count);

    /// <summary>Generates a source handle.</summary>
    uint GenSource();

    /// <summary>Deletes buffer handles.</summary>
    void DeleteBuffers(uint[] buffers);

    /// <summary>Deletes a source handle.</summary>
    void DeleteSource(uint source);

    /// <summary>Uploads interleaved stereo 16-bit frames.</summary>
    void BufferDataShort(uint buffer, ReadOnlySpan<short> interleavedStereo, int frequency);

    /// <summary>Uploads interleaved stereo float frames; requires AL_EXT_float32.</summary>
    void BufferDataFloat(uint buffer, ReadOnlySpan<float> interleavedStereo, int frequency);

    /// <summary>Whether an extension is present.</summary>
    bool IsExtensionPresent(string name);

    /// <summary>Queues buffers on a source. The span view keeps the pump allocation-free.</summary>
    void QueueBuffers(uint source, ReadOnlySpan<uint> buffers);

    /// <summary>Unqueues processed buffers; returns the count written.</summary>
    int UnqueueProcessed(uint source, uint[] destination);

    /// <summary>Reads the source state.</summary>
    AudioDriverSourceState GetSourceState(uint source);

    /// <summary>Starts playback.</summary>
    void Play(uint source);

    /// <summary>Stops playback.</summary>
    void StopPlayback(uint source);
}
