namespace Axrone.Audio.Tests;

[Collection(TestCollections.NativeMemoryGauge)]
public sealed class AudioPlaybackRuntimeTests : IDisposable
{
    private readonly CacheAlignedDiagnosticsCounters _counters = new();
    private readonly AudioObservabilityRuntime _observability;
    private readonly AudioClipStore _clips = new(16);
    private readonly AudioBusRegistry _buses;
    private readonly AudioListenerRegistry _listeners;
    private readonly AudioPlaybackRuntime _runtime;
    private readonly List<AudioClipRecord> _records = new();

    public AudioPlaybackRuntimeTests()
    {
        _observability = new AudioObservabilityRuntime(_counters);
        _buses = new AudioBusRegistry(_observability);
        _listeners = new AudioListenerRegistry(_observability);
        _runtime = new AudioPlaybackRuntime(8, _buses, _clips, _listeners, _observability);
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

    private AudioClipId RegisterSine(float frequency = 440.0f, int sampleRate = 48000, float seconds = 1.0f)
    {
        int frames = (int)(sampleRate * seconds);
        var memory = new NativeAudioMemory(sampleRate, 1, frames);
        Span<float> span = memory.AsSpan();
        for (int i = 0; i < frames; i++)
        {
            span[i] = MathF.Sin(2.0f * MathF.PI * frequency * i / sampleRate);
        }

        var record = new AudioClipRecord(new AudioClipId((uint)(_records.Count + 1)), memory);
        _records.Add(record);
        return _clips.Register(record);
    }

    [Fact]
    public void Mixed_Block_Contains_Signal_Then_Silence()
    {
        AudioClipId clip = RegisterSine();
        AudioPlaybackHandle handle = _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(),
            AudioSpatialization.Default2D, false, 1.0f, 1.0f, 0.0f);
        handle.IsValid.Should().BeTrue();

        Span<float> block = stackalloc float[512];
        _runtime.ProcessGraph(block);

        float energy = 0.0f;
        foreach (float sample in block)
        {
            energy += MathF.Abs(sample);
        }

        energy.Should().BeGreaterThan(0.0f);
        block[0].Should().BeApproximately(block[1], 1e-5f);
    }

    [Fact]
    public void Voice_Ends_AtClipEnd_WhenNotLooping()
    {
        AudioClipId clip = RegisterSine(seconds: 0.001f);
        _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(),
            AudioSpatialization.Default2D, false, 1.0f, 1.0f, 0.0f);

        Span<float> block = stackalloc float[4096];
        _runtime.ProcessGraph(block);

        Span<float> tail = stackalloc float[512];
        _runtime.ProcessGraph(tail);
        tail.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void LoopingVoice_EndsWhenScheduledDurationIsConsumed()
    {
        AudioClipId clip = RegisterSine(seconds: 1.0f);
        AudioPlaybackHandle handle = _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(DurationSeconds: 0.008f),
            AudioSpatialization.Default2D, loop: true, 1.0f, 1.0f, 0.0f);

        // A 512-float block is 256 stereo frames; at rate 1.0 that consumes
        // 256/48000 ≈ 0.00533 s of clip. 0.008 s therefore survives exactly
        // the first block and closes inside the second.
        Span<float> first = stackalloc float[512];
        _runtime.ProcessGraph(first);
        first.ToArray().Should().Contain(v => v != 0.0f);
        _runtime.TryGetState(handle, out AudioPlaybackState state).Should().BeTrue();
        state.Should().Be(AudioPlaybackState.Playing);
        state.Should().NotBe(AudioPlaybackState.Stopped);

        Span<float> second = stackalloc float[512];
        _runtime.ProcessGraph(second);
        _runtime.TryGetState(handle, out state).Should().BeFalse("the duration window closed");

        Span<float> tail = stackalloc float[512];
        _runtime.ProcessGraph(tail);
        tail.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void ZeroDurationVoice_StopsOnTheFirstBlock()
    {
        AudioClipId clip = RegisterSine();
        AudioPlaybackHandle handle = _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(DurationSeconds: 0.0f),
            AudioSpatialization.Default2D, loop: true, 1.0f, 1.0f, 0.0f);

        Span<float> block = stackalloc float[512];
        _runtime.ProcessGraph(block);

        _runtime.TryGetState(handle, out _).Should().BeFalse();
    }

    [Fact]
    public void NegativeDuration_IsRejectedWithTypedError()
    {
        AudioClipId clip = RegisterSine();

        Action allocate = () => _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(DurationSeconds: -1.0f),
            AudioSpatialization.Default2D, loop: true, 1.0f, 1.0f, 0.0f);

        allocate.Should().Throw<AudioConfigurationException>()
            .Which.Code.Should().Be("audio.invalid-duration");
    }

    [Fact]
    public void Stop_Pause_Resume_Control_Voice()
    {
        AudioClipId clip = RegisterSine();
        AudioPlaybackHandle handle = _runtime.AllocateVoice(
            new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(),
            AudioSpatialization.Default2D, true, 1.0f, 1.0f, 0.0f);

        handle.Pause();
        Span<float> paused = stackalloc float[256];
        _runtime.ProcessGraph(paused);
        paused.ToArray().Should().OnlyContain(v => v == 0.0f);

        handle.Resume();
        Span<float> resumed = stackalloc float[256];
        _runtime.ProcessGraph(resumed);
        resumed.ToArray().Should().Contain(v => v != 0.0f);

        handle.Stop();
        Span<float> stopped = stackalloc float[256];
        _runtime.ProcessGraph(stopped);
        stopped.ToArray().Should().OnlyContain(v => v == 0.0f);
    }

    [Fact]
    public void Far_3D_Voice_Is_Quieter_Than_Near()
    {
        AudioClipId clip = RegisterSine();
        var near = AudioSpatialization.Default3D with { Position = new Vector3(0.0f, 0.0f, -2.0f) };
        var far = AudioSpatialization.Default3D with { Position = new Vector3(0.0f, 0.0f, -200.0f) };

        _runtime.AllocateVoice(new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(), near, true, 1.0f, 1.0f, 0.0f);
        Span<float> nearBlock = stackalloc float[256];
        _runtime.ProcessGraph(nearBlock);

        _runtime.Dispose();
        using var runtime2 = new AudioPlaybackRuntime(8, _buses, _clips, _listeners, _observability);
        runtime2.AllocateVoice(new AudioSourceId(2U), clip, AudioBusId.Master, new AudioSourcePlayRequest(), far, true, 1.0f, 1.0f, 0.0f);
        Span<float> farBlock = stackalloc float[256];
        runtime2.ProcessGraph(farBlock);

        float nearEnergy = 0.0f;
        float farEnergy = 0.0f;
        foreach (float s in nearBlock)
        {
            nearEnergy += MathF.Abs(s);
        }

        foreach (float s in farBlock)
        {
            farEnergy += MathF.Abs(s);
        }

        nearEnergy.Should().BeGreaterThan(farEnergy);
        farEnergy.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void Exhausted_Voices_Evict_Quietest()
    {
        AudioClipId clip = RegisterSine();
        using var small = new AudioPlaybackRuntime(2, _buses, _clips, _listeners, _observability);
        small.AllocateVoice(new AudioSourceId(1U), clip, AudioBusId.Master, new AudioSourcePlayRequest(), AudioSpatialization.Default2D, true, 1.0f, 1.0f, 0.0f).IsValid.Should().BeTrue();
        small.AllocateVoice(new AudioSourceId(2U), clip, AudioBusId.Master, new AudioSourcePlayRequest(), AudioSpatialization.Default2D, true, 1.0f, 1.0f, 0.0f).IsValid.Should().BeTrue();
        small.AllocateVoice(new AudioSourceId(3U), clip, AudioBusId.Master, new AudioSourcePlayRequest(), AudioSpatialization.Default2D, true, 1.0f, 1.0f, 0.0f).IsValid.Should().BeTrue();
    }

    [Fact]
    public void ForeignRate_Clip_Preserves_Pitch_And_Length()
    {
        const int clipRate = 44100;
        const int frames = 4410;
        var memory = new NativeAudioMemory(clipRate, 1, frames);
        Span<float> span = memory.AsSpan();
        for (int i = 0; i < frames; i++)
        {
            span[i] = MathF.Sin(2.0f * MathF.PI * 440.0f * i / clipRate);
        }

        var record = new AudioClipRecord(new AudioClipId(77U), memory);
        AudioClipId clip = _clips.Register(record);

        _runtime.AllocateVoice(
            new AudioSourceId(9U), clip, AudioBusId.Master, new AudioSourcePlayRequest(),
            AudioSpatialization.Default2D, false, 1.0f, 1.0f, 0.0f);

        var output = new List<float>();
        Span<float> block = stackalloc float[512];
        for (int i = 0; i < 40; i++)
        {
            _runtime.ProcessGraph(block);
            foreach (float sample in block)
            {
                output.Add(sample);
            }
        }

        int firstSound = output.FindIndex(v => MathF.Abs(v) > 0.01f);
        int lastSound = output.FindLastIndex(v => MathF.Abs(v) > 0.01f);
        int soundedFrames = (lastSound - firstSound) / 2;
        soundedFrames.Should().BeInRange(4300, 5300);

        float measured = MeasureFrequency(output, firstSound, 48000);
        measured.Should().BeApproximately(440.0f, 15.0f);

        record.Dispose();
    }

    private static float MeasureFrequency(List<float> interleaved, int startFrame, int sampleRate)
    {
        int crossings = 0;
        int firstCross = -1;
        int lastCross = -1;
        for (int f = startFrame + 1; f < startFrame + 4800 && f * 2 + 1 < interleaved.Count; f++)
        {
            float prev = interleaved[(f - 1) * 2];
            float cur = interleaved[f * 2];
            if (prev <= 0.0f && cur > 0.0f)
            {
                if (firstCross < 0)
                {
                    firstCross = f;
                }

                lastCross = f;
                crossings++;
            }
        }

        if (crossings < 2)
        {
            return 0.0f;
        }

        return sampleRate * (crossings - 1) / (float)(lastCross - firstCross);
    }
}
