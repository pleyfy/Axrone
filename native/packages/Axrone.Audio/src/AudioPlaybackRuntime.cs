namespace Axrone.Audio;

/// <summary>
/// Voice playback state.
/// </summary>
public enum AudioPlaybackState : byte
{
    /// <summary>Free slot.</summary>
    Idle = 0,

    /// <summary>Rendering.</summary>
    Playing = 1,

    /// <summary>Suspended.</summary>
    Paused = 2,

    /// <summary>Finished.</summary>
    Stopped = 3,

    /// <summary>Runtime disposed.</summary>
    Disposed = 4,
}

/// <summary>
/// Voice allocation request.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioSourcePlayRequest(
    float? OffsetSeconds = null,
    float? DurationSeconds = null,
    bool Replace = true,
    float? Volume = null,
    float? PlaybackRate = null,
    float? DetuneCents = null,
    float? Pan = null);

/// <summary>
/// Live voice handle: source, sequence and owning runtime.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioPlaybackHandle(AudioSourceId SourceId, uint Sequence, AudioPlaybackRuntime Runtime)
{
    /// <summary>No voice.</summary>
    public static readonly AudioPlaybackHandle Invalid = new(AudioSourceId.Invalid, 0U, null!);

    /// <summary>Whether the handle addresses a live voice.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        get => SourceId.IsValid && Sequence != 0U && Runtime != null;
    }

    /// <summary>Stops the voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void Stop()
    {
        if (IsValid)
        {
            Runtime.StopVoice(this);
        }
    }

    /// <summary>Pauses the voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void Pause()
    {
        if (IsValid)
        {
            Runtime.PauseVoice(this);
        }
    }

    /// <summary>Resumes the voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void Resume()
    {
        if (IsValid)
        {
            Runtime.ResumeVoice(this);
        }
    }
}

/// <summary>
/// Fixed voice pool with linear-resampling stereo mixer. Voices render into
/// an interleaved stereo block: mono clips upmix, stereo clips mix per
/// channel, detune and rate scale the read step, loops wrap.
/// </summary>
public sealed class AudioPlaybackRuntime : IDisposable
{
    [StructLayout(LayoutKind.Explicit, Size = 192)]
    private struct HardwareVoiceSlot
    {
        [FieldOffset(0)] public AudioSourceId SourceId;
        [FieldOffset(4)] public AudioClipId ClipId;
        [FieldOffset(8)] public AudioBusId BusId;
        [FieldOffset(12)] public AudioPlaybackState State;
        [FieldOffset(16)] public uint Sequence;
        [FieldOffset(20)] public float Volume;
        [FieldOffset(24)] public float EffectiveGain;
        [FieldOffset(28)] public float LeftGain;
        [FieldOffset(32)] public float RightGain;
        [FieldOffset(40)] public double ReadIndex;
        [FieldOffset(48)] public float StepRate;
        [FieldOffset(52)] public bool Loop;
        [FieldOffset(53)] public bool IsActive;
        [FieldOffset(64)] public AudioSpatialization Spatial;
        [FieldOffset(128)] public float DurationRemaining;
    }

    private readonly HardwareVoiceSlot[] _voices;
    private readonly AudioBusRegistry _busMixer;
    private readonly AudioClipStore _clipStore;
    private readonly AudioListenerRegistry _listenerRegistry;
    private readonly AudioObservabilityRuntime _observability;
    private readonly Lock _gate = new();
    private readonly int _maxVoices;
    private readonly int _outputSampleRate;
    private uint _sequenceCounter = 1U;
    private int _disposed;

    /// <summary>Output sample rate in Hz; voices resample to this.</summary>
    public int OutputSampleRate => _outputSampleRate;

    /// <summary>
    /// Live voice slots. Diagnostics and removal assertions only: the scan
    /// takes the gate so it never sits on the render path.
    /// </summary>
    public int ActiveVoiceCount
    {
        get
        {
            lock (_gate)
            {
                int count = 0;
                for (int i = 0; i < _maxVoices; i++)
                {
                    if (_voices[i].IsActive)
                    {
                        count++;
                    }
                }

                return count;
            }
        }
    }

    /// <summary>Creates a runtime.</summary>
    public AudioPlaybackRuntime(
        int maxVoices,
        AudioBusRegistry busMixer,
        AudioClipStore clipStore,
        AudioListenerRegistry listenerRegistry,
        AudioObservabilityRuntime observability,
        int outputSampleRate = 48000)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(outputSampleRate);
        _maxVoices = maxVoices;
        _voices = new HardwareVoiceSlot[maxVoices];
        _busMixer = busMixer;
        _clipStore = clipStore;
        _listenerRegistry = listenerRegistry;
        _observability = observability;
        _outputSampleRate = outputSampleRate;
    }

    /// <summary>Allocates a voice, evicting the quietest when full.</summary>
    public AudioPlaybackHandle AllocateVoice(
        AudioSourceId sourceId,
        AudioClipId clipId,
        AudioBusId busId,
        in AudioSourcePlayRequest request,
        in AudioSpatialization spatial,
        bool loop,
        float baseVolume,
        float baseRate,
        float baseDetune)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            AudioThrowHelper.ThrowDisposed(nameof(AudioPlaybackRuntime));
        }

        lock (_gate)
        {
            int slot = AcquireFreeSlot();
            if (slot == -1)
            {
                slot = EvictQuietestSlot();
                if (slot == -1)
                {
                    return AudioPlaybackHandle.Invalid;
                }
            }

            uint seq = Interlocked.Increment(ref _sequenceCounter);
            ref HardwareVoiceSlot voice = ref _voices[slot];

            voice.SourceId = sourceId;
            voice.ClipId = clipId;
            voice.BusId = busId.IsValid ? busId : AudioBusId.Master;
            voice.State = AudioPlaybackState.Playing;
            voice.Sequence = seq;
            voice.Volume = (request.Volume ?? 1.0f) * baseVolume;
            voice.Loop = loop;

            float pitchCents = (request.DetuneCents ?? 0.0f) + baseDetune;
            float detuneMultiplier = MathF.Pow(2.0f, pitchCents / 1200.0f);
            float rate = Math.Max(0.01f, (request.PlaybackRate ?? 1.0f) * baseRate);
            float resampleRatio = 1.0f;
            int clipRate = 0;
            if (_clipStore.TryGet(clipId, out AudioClipRecord? clipForRate))
            {
                clipRate = clipForRate.SampleRate;
                resampleRatio = clipRate > 0 ? (float)clipRate / _outputSampleRate : 1.0f;
            }

            voice.StepRate = rate * detuneMultiplier * resampleRatio;

            voice.ReadIndex = request.OffsetSeconds.HasValue ? request.OffsetSeconds.Value * clipRate : 0.0;
            if (request.DurationSeconds is float duration && (!float.IsFinite(duration) || duration < 0.0f))
            {
                AudioThrowHelper.ThrowConfig("audio.invalid-duration", "Play duration must be finite and non-negative.");
            }

            voice.DurationRemaining = request.DurationSeconds ?? float.MaxValue;
            voice.Spatial = spatial;
            voice.IsActive = true;

            _observability.Counters.IncrementCommands();
            _observability.Dispatch(AudioEventType.SourcePlayed, sourceId.Value, seq, voice.Volume);

            return new AudioPlaybackHandle(sourceId, seq, this);
        }
    }

    /// <summary>Stops a voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void StopVoice(in AudioPlaybackHandle handle)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int idx = FindVoiceIndex(in handle);
            if (idx != -1)
            {
                _voices[idx].State = AudioPlaybackState.Stopped;
                _voices[idx].IsActive = false;
                _observability.Counters.IncrementCompletions();
                _observability.Dispatch(AudioEventType.SourceStopped, handle.SourceId.Value, handle.Sequence);
            }
        }
    }

    /// <summary>
    /// Releases every live voice bound to a source. Used by source removal so
    /// a dropped entity cannot pin a voice slot or its clip reference.
    /// </summary>
    public int ReleaseVoicesForSource(AudioSourceId sourceId)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int released = 0;
            for (int i = 0; i < _maxVoices; i++)
            {
                ref HardwareVoiceSlot voice = ref _voices[i];
                if (voice.IsActive && voice.SourceId == sourceId)
                {
                    voice.State = AudioPlaybackState.Stopped;
                    voice.IsActive = false;
                    released++;
                    _observability.Counters.IncrementCompletions();
                    _observability.Dispatch(AudioEventType.SourceStopped, sourceId.Value, voice.Sequence);
                }
            }

            return released;
        }
    }

    /// <summary>
    /// Re-points live voices at a replacement bus. Returns the number of
    /// updated voices so a bus removal can be verified end to end.
    /// </summary>
    public int ReassignVoiceBus(AudioBusId from, AudioBusId to)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int updated = 0;
            for (int i = 0; i < _maxVoices; i++)
            {
                ref HardwareVoiceSlot voice = ref _voices[i];
                if (voice.IsActive && voice.BusId == from)
                {
                    voice.BusId = to;
                    updated++;
                }
            }

            return updated;
        }
    }

    /// <summary>Pauses a voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void PauseVoice(in AudioPlaybackHandle handle)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int idx = FindVoiceIndex(in handle);
            if (idx != -1 && _voices[idx].State == AudioPlaybackState.Playing)
            {
                _voices[idx].State = AudioPlaybackState.Paused;
                _observability.Dispatch(AudioEventType.SourcePaused, handle.SourceId.Value, handle.Sequence);
            }
        }
    }

    /// <summary>Resumes a voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void ResumeVoice(in AudioPlaybackHandle handle)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int idx = FindVoiceIndex(in handle);
            if (idx != -1 && _voices[idx].State == AudioPlaybackState.Paused)
            {
                _voices[idx].State = AudioPlaybackState.Playing;
                _observability.Dispatch(AudioEventType.SourceResumed, handle.SourceId.Value, handle.Sequence);
            }
        }
    }

    /// <summary>Renders all voices into an interleaved stereo block.</summary>
    public void ProcessGraph(Span<float> interleavedStereoOut)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            interleavedStereoOut.Clear();
            return;
        }

        interleavedStereoOut.Clear();
        AudioListenerDescriptor listener = _listenerRegistry.GetActiveDescriptor();

        Vector3 lPos = listener.Position;
        Vector3 lFwd = SpatialKinematics.SafeNormalize(listener.Forward);
        Vector3 lUp = SpatialKinematics.SafeNormalize(listener.Up);
        Vector3 lRight = SpatialKinematics.SafeNormalize(Vector3.Cross(lFwd, lUp));

        lock (_gate)
        {
            for (int i = 0; i < _maxVoices; i++)
            {
                ref HardwareVoiceSlot voice = ref _voices[i];
                if (!voice.IsActive || voice.State != AudioPlaybackState.Playing)
                {
                    continue;
                }

                if (!_clipStore.TryGet(voice.ClipId, out AudioClipRecord? clip))
                {
                    voice.State = AudioPlaybackState.Stopped;
                    voice.IsActive = false;
                    _observability.Counters.IncrementErrors();
                    _observability.Dispatch(AudioEventType.SourceError, voice.SourceId.Value, voice.Sequence);
                    continue;
                }

                float busGain = _busMixer.GetEffectiveGain(voice.BusId);
                float spatialGain = 1.0f;
                float pan = 0.0f;

                if (voice.Spatial.Mode == AudioSpatialMode.ThreeDimensional)
                {
                    AudioSpatialization spatial = voice.Spatial;
                    Vector3 sourcePos = spatial.Position;
                    Vector3 sourceFwd = spatial.Orientation;
                    float distance = (sourcePos - lPos).Length();
                    spatialGain = SpatialKinematics.CalculateDistanceGain(spatial.Attenuation, distance);

                    float cone = SpatialKinematics.CalculateConeGain(
                        in sourcePos,
                        in sourceFwd,
                        in lPos,
                        spatial.ConeInnerAngle,
                        spatial.ConeOuterAngle,
                        spatial.ConeOuterGain);

                    spatialGain *= cone;
                    pan = SpatialKinematics.CalculateStereoPan(in lPos, in lRight, in sourcePos);
                }

                voice.EffectiveGain = voice.Volume * busGain * spatialGain * listener.GlobalVolume;

                EqualPowerPanningPolicy.ComputeGains(pan, out float pLeft, out float pRight);
                voice.LeftGain = voice.EffectiveGain * pLeft;
                voice.RightGain = voice.EffectiveGain * pRight;

                MixVoiceStereo(ref voice, clip, interleavedStereoOut);
            }
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        lock (_gate)
        {
            for (int i = 0; i < _maxVoices; i++)
            {
                _voices[i].IsActive = false;
                _voices[i].State = AudioPlaybackState.Disposed;
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static unsafe void MixVoiceStereo(ref HardwareVoiceSlot voice, AudioClipRecord clip, Span<float> output)
    {
        int frameCount = output.Length >> 1;
        NativeAudioMemory mem = clip.Buffer;
        float* pSrc = mem.Pointer;
        int totalSamples = mem.SampleCount;
        int channels = mem.ChannelCount;

        double readIdx = voice.ReadIndex;
        double consumedFrom = readIdx;
        double step = voice.StepRate;
        float leftGain = voice.LeftGain;
        float rightGain = voice.RightGain;

        fixed (float* pDstBase = output)
        {
            float* pDst = pDstBase;

            if (channels == 1)
            {
                for (int f = 0; f < frameCount; f++)
                {
                    int i0 = (int)readIdx;
                    if (i0 >= totalSamples)
                    {
                        if (voice.Loop)
                        {
                            readIdx = 0.0;
                            i0 = 0;
                        }
                        else
                        {
                            voice.State = AudioPlaybackState.Stopped;
                            voice.IsActive = false;
                            break;
                        }
                    }

                    int i1 = i0 + 1 < totalSamples ? i0 + 1 : (voice.Loop ? 0 : i0);
                    float frac = (float)(readIdx - i0);
                    float sample = pSrc[i0] + (frac * (pSrc[i1] - pSrc[i0]));

                    *pDst++ += sample * leftGain;
                    *pDst++ += sample * rightGain;

                    readIdx += step;
                }
            }
            else
            {
                int totalFrames = totalSamples / channels;
                for (int f = 0; f < frameCount; f++)
                {
                    int i0 = (int)readIdx;
                    if (i0 >= totalFrames)
                    {
                        if (voice.Loop)
                        {
                            readIdx = 0.0;
                            i0 = 0;
                        }
                        else
                        {
                            voice.State = AudioPlaybackState.Stopped;
                            voice.IsActive = false;
                            break;
                        }
                    }

                    int i1 = i0 + 1 < totalFrames ? i0 + 1 : (voice.Loop ? 0 : i0);
                    float frac = (float)(readIdx - i0);

                    int idx0 = i0 * channels;
                    int idx1 = i1 * channels;

                    float sLeft = pSrc[idx0] + (frac * (pSrc[idx1] - pSrc[idx0]));
                    float sRight = pSrc[idx0 + 1] + (frac * (pSrc[idx1 + 1] - pSrc[idx0 + 1]));

                    *pDst++ += sLeft * leftGain;
                    *pDst++ += sRight * rightGain;

                    readIdx += step;
                }
            }
        }

        voice.ReadIndex = readIdx;

        // Scheduled play duration: consume clip-seconds advanced this block
        // and retire the voice when the window closes. Voices without an
        // explicit duration keep the MaxValue sentinel and skip the path.
        if (voice.IsActive && voice.DurationRemaining < float.MaxValue)
        {
            int clipRate = mem.SampleRate;
            double consumed = clipRate > 0 ? (readIdx - consumedFrom) / clipRate : 0.0;
            voice.DurationRemaining -= (float)consumed;
            if (voice.DurationRemaining <= 0.0f)
            {
                voice.State = AudioPlaybackState.Stopped;
                voice.IsActive = false;
            }
        }
    }

    private int AcquireFreeSlot()
    {
        for (int i = 0; i < _maxVoices; i++)
        {
            if (!_voices[i].IsActive)
            {
                return i;
            }
        }

        return -1;
    }

    private int EvictQuietestSlot()
    {
        int victim = -1;
        float minGain = float.MaxValue;
        for (int i = 0; i < _maxVoices; i++)
        {
            if (_voices[i].EffectiveGain < minGain)
            {
                minGain = _voices[i].EffectiveGain;
                victim = i;
            }
        }

        return victim;
    }

    /// <summary>Reads an active voice state.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetState(in AudioPlaybackHandle handle, out AudioPlaybackState state)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            state = AudioPlaybackState.Disposed;
            return false;
        }

        lock (_gate)
        {
            int idx = FindVoiceIndex(in handle);
            if (idx < 0)
            {
                state = AudioPlaybackState.Stopped;
                return false;
            }

            state = _voices[idx].State;
            return _voices[idx].IsActive;
        }
    }

    /// <summary>Pushes fresh spatialization into a live voice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void UpdateSpatial(in AudioPlaybackHandle handle, in AudioSpatialization spatial)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            int idx = FindVoiceIndex(in handle);
            if (idx >= 0)
            {
                _voices[idx].Spatial = spatial;
            }
        }
    }

    /// <summary>Pushes fresh spatialization into a live voice by source.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryUpdateSpatial(AudioSourceId sourceId, in AudioSpatialization spatial)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            return false;
        }

        lock (_gate)
        {
            for (int i = 0; i < _maxVoices; i++)
            {
                if (_voices[i].IsActive && _voices[i].SourceId == sourceId)
                {
                    _voices[i].Spatial = spatial;
                    return true;
                }
            }

            return false;
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            AudioThrowHelper.ThrowDisposed(nameof(AudioPlaybackRuntime));
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int FindVoiceIndex(in AudioPlaybackHandle handle)
    {
        for (int i = 0; i < _maxVoices; i++)
        {
            if (_voices[i].IsActive && _voices[i].SourceId == handle.SourceId && _voices[i].Sequence == handle.Sequence)
            {
                return i;
            }
        }

        return -1;
    }
}
