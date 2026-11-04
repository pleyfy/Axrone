namespace Axrone.Audio.OpenAL;

using Axrone.Audio;
using Silk.NET.OpenAL;

/// <summary>
/// Thin <see cref="IAudioDriver"/> over Silk.NET OpenAL: owns the device,
/// context, one streaming source and its buffer queue. All calls check the
/// AL error flag and raise <see cref="AudioDriverException"/> on failure.
/// </summary>
public sealed unsafe class SilkAudioDriver : IAudioDriver
{
    private readonly AL _al;
    private readonly ALContext _alc;
    private Device* _device;
    private Context* _context;
    private bool _disposed;

    /// <summary>Creates a driver.</summary>
    public SilkAudioDriver()
    {
        _al = AL.GetApi();
        _alc = ALContext.GetApi();
    }

    /// <inheritdoc/>
    public bool IsOpen => _device != null && _context != null;

    /// <inheritdoc/>
    public void Open(string? deviceName, int frequency)
    {
        ThrowIfDisposed();
        if (IsOpen)
        {
            return;
        }

        _device = _alc.OpenDevice(deviceName);
        if (_device == null)
        {
            throw new AudioDriverException("OpenDevice", "No audio device available.");
        }

        CheckContextError("OpenDevice");

        _context = _alc.CreateContext(_device, null);
        if (_context == null)
        {
            Close();
            throw new AudioDriverException("CreateContext", "Context creation failed.");
        }

        CheckContextError("CreateContext");

        if (!_alc.MakeContextCurrent(_context))
        {
            Close();
            throw new AudioDriverException("MakeContextCurrent", "Context activation failed.");
        }

        CheckContextError("MakeContextCurrent");

        _ = frequency;
    }

    /// <inheritdoc/>
    public void Close()
    {
        if (_context != null)
        {
            _alc.MakeContextCurrent(null);
            _alc.DestroyContext(_context);
            _context = null;
        }

        if (_device != null)
        {
            _alc.CloseDevice(_device);
            _device = null;
        }
    }

    /// <inheritdoc/>
    public uint[] GenBuffers(int count)
    {
        uint[] buffers = new uint[count];
        fixed (uint* ptr = buffers)
        {
            _al.GenBuffers(count, ptr);
        }

        CheckError("GenBuffers");
        return buffers;
    }

    /// <inheritdoc/>
    public uint GenSource()
    {
        uint source = _al.GenSource();
        CheckError("GenSource");
        return source;
    }

    /// <inheritdoc/>
    public void DeleteBuffers(uint[] buffers)
    {
        ArgumentNullException.ThrowIfNull(buffers);
        fixed (uint* ptr = buffers)
        {
            _al.DeleteBuffers(buffers.Length, ptr);
        }

        CheckError("DeleteBuffers");
    }

    /// <inheritdoc/>
    public void DeleteSource(uint source)
    {
        _al.DeleteSource(source);
        CheckError("DeleteSource");
    }

    /// <inheritdoc/>
    public void BufferDataShort(uint buffer, ReadOnlySpan<short> interleavedStereo, int frequency)
    {
        fixed (short* ptr = interleavedStereo)
        {
            _al.BufferData(buffer, BufferFormat.Stereo16, ptr, interleavedStereo.Length * sizeof(short), frequency);
        }

        CheckError("BufferData");
    }

    /// <inheritdoc/>
    public void BufferDataFloat(uint buffer, ReadOnlySpan<float> interleavedStereo, int frequency)
    {
        fixed (float* ptr = interleavedStereo)
        {
            _al.BufferData(buffer, (BufferFormat)0x10011, ptr, interleavedStereo.Length * sizeof(float), frequency);
        }

        CheckError("BufferData");
    }

    /// <inheritdoc/>
    public bool IsExtensionPresent(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        return _al.IsExtensionPresent(name);
    }

    /// <inheritdoc/>
    public void QueueBuffers(uint source, ReadOnlySpan<uint> buffers)
    {
        if (buffers.IsEmpty)
        {
            return;
        }

        fixed (uint* ptr = buffers)
        {
            _al.SourceQueueBuffers(source, buffers.Length, ptr);
        }

        CheckError("SourceQueueBuffers");
    }

    /// <inheritdoc/>
    public int UnqueueProcessed(uint source, uint[] destination)
    {
        ArgumentNullException.ThrowIfNull(destination);
        int processed = 0;
        _al.GetSourceProperty(source, GetSourceInteger.BuffersProcessed, &processed);
        CheckError("GetSourceProperty");

        int count = Math.Min(processed, destination.Length);
        if (count == 0)
        {
            return 0;
        }

        fixed (uint* ptr = destination)
        {
            _al.SourceUnqueueBuffers(source, count, ptr);
        }

        CheckError("SourceUnqueueBuffers");
        return count;
    }

    /// <inheritdoc/>
    public AudioDriverSourceState GetSourceState(uint source)
    {
        int state = 0;
        _al.GetSourceProperty(source, GetSourceInteger.SourceState, &state);
        CheckError("GetSourceProperty");
        return (SourceState)state switch
        {
            SourceState.Playing => AudioDriverSourceState.Playing,
            SourceState.Paused => AudioDriverSourceState.Paused,
            SourceState.Stopped => AudioDriverSourceState.Stopped,
            _ => AudioDriverSourceState.Initial,
        };
    }

    /// <inheritdoc/>
    public void Play(uint source)
    {
        _al.SourcePlay(source);
        CheckError("SourcePlay");
    }

    /// <inheritdoc/>
    public void StopPlayback(uint source)
    {
        _al.SourceStop(source);
        CheckError("SourceStop");
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Close();
        _al.Dispose();
        _alc.Dispose();
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new AudioDisposedException(nameof(SilkAudioDriver));
        }
    }

    private void CheckError(string operation)
    {
        AudioError error = _al.GetError();
        if (error != AudioError.NoError)
        {
            throw new AudioDriverException(operation, error.ToString());
        }
    }

    private void CheckContextError(string operation)
    {
        if (_device == null)
        {
            return;
        }

        ContextError error = _alc.GetError(_device);
        if (error != ContextError.NoError)
        {
            throw new AudioDriverException(operation, error.ToString());
        }
    }
}
