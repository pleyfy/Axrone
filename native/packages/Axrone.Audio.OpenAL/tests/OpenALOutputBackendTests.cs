namespace Axrone.Audio.OpenAL.Tests;

using System.Collections.Generic;
using System.Diagnostics;

internal sealed class FakeAudioDriver : IAudioDriver
{
    public bool IsOpen { get; private set; }
    public int OpenCalls;
    public int CloseCalls;
    public int BufferDataCalls;
    public int BufferDataFloatCalls;
    public int QueueCalls;
    public int PlayCalls;
    public int StopCalls;
    public bool SupportsFloat;
    public bool Record = true;
    public readonly List<short> Uploaded = new();
    public readonly List<float> UploadedFloat = new();
    public readonly Queue<uint> Processed = new();
    public AudioDriverSourceState State = AudioDriverSourceState.Playing;
    private uint _nextBuffer = 1;

    public void Open(string? deviceName, int frequency)
    {
        OpenCalls++;
        IsOpen = true;
        _ = deviceName;
        _ = frequency;
    }

    public void Close()
    {
        CloseCalls++;
        IsOpen = false;
    }

    public int GenSourceCalls;
    public int GenBuffersCalls;
    public int DeleteSourceCalls;
    public int DeleteBufferCalls;
    public readonly List<uint> QueuedHandles = new();
    public readonly List<uint> DeletedSources = new();
    public readonly List<uint> DeletedBuffers = new();

    public uint[] GenBuffers(int count)
    {
        GenBuffersCalls++;
        uint[] buffers = new uint[count];
        for (int i = 0; i < count; i++)
        {
            buffers[i] = _nextBuffer++;
        }

        return buffers;
    }

    public uint GenSource()
    {
        GenSourceCalls++;
        return 100U;
    }

    public void DeleteBuffers(uint[] buffers)
    {
        DeleteBufferCalls++;
        DeletedBuffers.AddRange(buffers);
    }

    public void DeleteSource(uint source)
    {
        DeleteSourceCalls++;
        DeletedSources.Add(source);
    }

    public void BufferDataShort(uint buffer, ReadOnlySpan<short> interleavedStereo, int frequency)
    {
        _ = buffer;
        _ = frequency;
        BufferDataCalls++;
        if (Record)
        {
            foreach (short sample in interleavedStereo)
            {
                Uploaded.Add(sample);
            }
        }
    }

    public void BufferDataFloat(uint buffer, ReadOnlySpan<float> interleavedStereo, int frequency)
    {
        _ = buffer;
        _ = frequency;
        BufferDataFloatCalls++;
        if (Record)
        {
            foreach (float sample in interleavedStereo)
            {
                UploadedFloat.Add(sample);
            }
        }
    }

    public bool IsExtensionPresent(string name)
    {
        _ = name;
        return SupportsFloat;
    }

    public void QueueBuffers(uint source, ReadOnlySpan<uint> buffers)
    {
        _ = source;
        QueueCalls++;
        if (Record)
        {
            for (int i = 0; i < buffers.Length; i++)
            {
                QueuedHandles.Add(buffers[i]);
            }
        }
    }

    public int UnqueueProcessed(uint source, uint[] destination)
    {
        _ = source;
        int count = 0;
        while (count < destination.Length && Processed.Count > 0)
        {
            destination[count++] = Processed.Dequeue();
        }

        return count;
    }

    public AudioDriverSourceState GetSourceState(uint source)
    {
        _ = source;
        return State;
    }

    public void Play(uint source)
    {
        _ = source;
        PlayCalls++;
        State = AudioDriverSourceState.Playing;
    }

    public void StopPlayback(uint source)
    {
        _ = source;
        StopCalls++;
        State = AudioDriverSourceState.Stopped;
    }

    public void Dispose()
    {
    }
}

public sealed class OpenALOutputBackendTests : IDisposable
{
    private readonly AudioSystem _system = new();
    private readonly FakeAudioDriver _driver = new();
    private readonly OpenALOutputBackend _backend;

    public OpenALOutputBackendTests()
    {
        _backend = new OpenALOutputBackend(_system, _driver, blockFrames: 64, bufferCount: 3);
    }

    public void Dispose()
    {
        _backend.Dispose();
        _driver.Dispose();
        _system.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Start_PrimesQueue_AndPlays()
    {
        _backend.Start();
        _backend.IsRunning.Should().BeTrue();
        _driver.OpenCalls.Should().Be(1);
        _driver.BufferDataCalls.Should().Be(3);
        _driver.PlayCalls.Should().Be(1);
        _backend.Stop();
        _backend.IsRunning.Should().BeFalse();
        _driver.CloseCalls.Should().Be(1);
    }

    [Fact]
    public void PumpOnce_Refills_ProcessedBuffers()
    {
        using OpenALOutputBackend backend = new(_system, _driver, blockFrames: 64, bufferCount: 3, autoPump: false);
        backend.Start();
        int before = _driver.BufferDataCalls;
        _driver.Processed.Enqueue(1U);
        _driver.Processed.Enqueue(2U);
        backend.PumpOnce();
        _driver.BufferDataCalls.Should().Be(before + 2);
        _driver.QueueCalls.Should().Be(2);
        _driver.QueuedHandles.Should().Equal(1U, 2U, 3U, 1U, 2U);
        backend.Stop();
    }

    [Fact]
    public void PumpOnce_Restarts_StalledSource()
    {
        using OpenALOutputBackend backend = new(_system, _driver, blockFrames: 64, bufferCount: 3, autoPump: false);
        backend.Start();
        _driver.State = AudioDriverSourceState.Stopped;
        int plays = _driver.PlayCalls;
        backend.PumpOnce();
        _driver.PlayCalls.Should().Be(plays + 1);
        backend.Stop();
    }

    [Fact]
    public void ManualPump_Start_DoesNotSpawnRefillThread()
    {
        int before = Process.GetCurrentProcess().Threads.Count;
        using OpenALOutputBackend backend = new(_system, _driver, blockFrames: 64, bufferCount: 2, autoPump: false);
        backend.Start();

        backend.IsRunning.Should().BeFalse();
        _driver.PlayCalls.Should().Be(1);
        backend.Stop();

        int after = Process.GetCurrentProcess().Threads.Count;
        Math.Abs(after - before).Should().BeLessThanOrEqualTo(2);
    }

    [Fact]
    public void ManualPump_DoubleStart_DoesNotRegenerateOrReopenHandles()
    {
        using OpenALOutputBackend backend = new(_system, _driver, blockFrames: 64, bufferCount: 2, autoPump: false);
        backend.Start();
        backend.Start();

        _driver.OpenCalls.Should().Be(1);
        _driver.GenSourceCalls.Should().Be(1);
        _driver.GenBuffersCalls.Should().Be(1);
        backend.Stop();

        _driver.DeleteSourceCalls.Should().Be(1);
        _driver.DeleteBufferCalls.Should().Be(1);
    }

    [Fact]
    public void Stop_IsIdempotent_AndStartTwice_IsSingle()
    {
        _backend.Start();
        _backend.Start();
        _driver.OpenCalls.Should().Be(1);
        _backend.Stop();
        _backend.Stop();
        _driver.CloseCalls.Should().Be(1);
    }

    [Fact]
    public void FloatPath_Used_When_Supported()
    {
        _driver.SupportsFloat = true;
        using var backend = new OpenALOutputBackend(_system, _driver, blockFrames: 64, bufferCount: 2);
        backend.Start();
        _driver.BufferDataFloatCalls.Should().Be(2);
        _driver.BufferDataCalls.Should().Be(0);
        _driver.UploadedFloat.Should().NotBeEmpty();
        backend.Stop();
    }

    [Fact]
    public void ShortPath_Used_When_FloatUnsupported()
    {
        _driver.SupportsFloat = false;
        using var backend = new OpenALOutputBackend(_system, _driver, blockFrames: 64, bufferCount: 2, preferFloat: true);
        backend.Start();
        _driver.BufferDataCalls.Should().Be(2);
        _driver.BufferDataFloatCalls.Should().Be(0);
        backend.Stop();
    }

    [Fact]
    public void Stop_DeletesSourceAndEveryBufferExactlyOnce()
    {
        _backend.Start();
        _driver.GenSourceCalls.Should().Be(1);
        _driver.GenBuffersCalls.Should().Be(1);

        _backend.Stop();

        _driver.DeleteSourceCalls.Should().Be(1);
        _driver.DeletedSources.Should().Equal(100U);
        _driver.DeleteBufferCalls.Should().Be(1);
        _driver.DeletedBuffers.Should().Equal(1U, 2U, 3U);
    }

    [Fact]
    public void Restart_DeletesPreviousGenerationBeforeRegeneratingHandles()
    {
        _backend.Start();
        _backend.Stop();
        _backend.Start();
        _backend.Stop();

        _driver.GenSourceCalls.Should().Be(2);
        _driver.DeleteSourceCalls.Should().Be(2);
        _driver.GenBuffersCalls.Should().Be(2);
        _driver.DeletedBuffers.Should().Equal(1U, 2U, 3U, 4U, 5U, 6U);
    }

    [Fact]
    public void Stop_AfterDeviceClosedUnderneath_ClearsHandlesAndCanRestart()
    {
        _backend.Start();
        _driver.Close();

        _backend.Stop();

        _driver.DeleteSourceCalls.Should().Be(0);
        _driver.CloseCalls.Should().Be(1);

        _backend.Start();
        _backend.Stop();

        _driver.GenSourceCalls.Should().Be(2);
        _driver.DeleteSourceCalls.Should().Be(1);
    }

    [Fact]
    public void Start_AfterDispose_IsTypedDisposedError()
    {
        _backend.Start();
        _backend.Stop();
        _backend.Dispose();

        Action start = () => _backend.Start();

        start.Should().Throw<AudioDisposedException>().WithMessage("*OpenALOutputBackend*");
    }

    [Fact]
    public void PumpOnce_QueuesPartialBatchesWithoutAllocating()
    {
        using OpenALOutputBackend backend = new(_system, _driver, blockFrames: 64, bufferCount: 3, autoPump: false);
        backend.Start();
        _driver.Record = false;

        for (int i = 0; i < 400; i++)
        {
            _driver.Processed.Enqueue(1U);
            backend.PumpOnce();
        }

        int uploadBefore = _driver.BufferDataCalls;
        long measuredBefore = GC.GetAllocatedBytesForCurrentThread();

        for (int i = 0; i < 400; i++)
        {
            _driver.Processed.Enqueue(1U);
            backend.PumpOnce();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - measuredBefore;

        allocated.Should().Be(0L);
        _driver.BufferDataCalls.Should().Be(uploadBefore + 400);

        backend.Stop();
    }
}
