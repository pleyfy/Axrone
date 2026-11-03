namespace Axrone.Audio;

using Axrone.Utility.Descriptors;

/// <summary>
/// Source registration: tuning plus clip and bus bindings.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioSourceDefinition(
    AudioBusId BusId = default,
    AudioClipId ClipId = default,
    float Volume = 1.0f,
    bool Muted = false,
    bool Loop = false,
    bool Autoplay = false,
    float PlaybackRate = 1.0f,
    float DetuneCents = 0.0f,
    float Pan = 0.0f,
    AudioSpatialization Spatial = default,
    float StartOffsetSeconds = 0.0f) : IDescriptor<AudioSourceDefinition>
{
    /// <summary>Flat-stereo default.</summary>
    public static AudioSourceDefinition Default => new(
        default,
        default,
        1.0f,
        false,
        false,
        false,
        1.0f,
        0.0f,
        0.0f,
        AudioSpatialization.Default2D,
        0.0f);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Validate(in AudioSourceDefinition descriptor)
    {
        if (!float.IsFinite(descriptor.Volume) || descriptor.Volume < 0.0f || descriptor.Volume > 4.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source volume must be in [0, 4].");
        }

        if (!float.IsFinite(descriptor.PlaybackRate) || descriptor.PlaybackRate < 0.25f || descriptor.PlaybackRate > 4.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source playback rate must be in [0.25, 4].");
        }

        if (!float.IsFinite(descriptor.DetuneCents) || descriptor.DetuneCents < -1200.0f || descriptor.DetuneCents > 1200.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source detune must be in [-1200, 1200] cents.");
        }

        if (!float.IsFinite(descriptor.Pan) || descriptor.Pan < -1.0f || descriptor.Pan > 1.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source pan must be in [-1, 1].");
        }

        if (!float.IsFinite(descriptor.StartOffsetSeconds) || descriptor.StartOffsetSeconds < 0.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source start offset must be non-negative and finite.");
        }

        AudioSpatialization spatial = descriptor.Spatial;
        AudioSpatialization.Validate(in spatial);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static string Describe(in AudioSourceDefinition descriptor) => descriptor.ToString();
}

/// <summary>
/// Slot-indexed source store with one active voice per source.
/// </summary>
public sealed class AudioSourceRegistry
{
    private struct SourceEntry
    {
        public AudioSourceDefinition Definition;
        public AudioPlaybackHandle ActiveHandle;
        public bool IsRegistered;
    }

    private readonly SourceEntry[] _sources;
    private readonly AudioPlaybackRuntime _runtime;
    private readonly AudioObservabilityRuntime _observability;
    private readonly Lock _gate = new();
    private readonly int _maxSources;
    private int _transientIdCounter = 10_000_000;

    /// <summary>Creates a registry.</summary>
    public AudioSourceRegistry(
        int maxSources,
        AudioPlaybackRuntime runtime,
        AudioObservabilityRuntime observability)
    {
        _maxSources = maxSources;
        _sources = new SourceEntry[maxSources];
        _runtime = runtime;
        _observability = observability;
    }

    /// <summary>Registers or replaces a source; autoplays when requested.</summary>
    public void Upsert(AudioSourceId id, in AudioSourceDefinition definition)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxSources)
            {
                AudioThrowHelper.ThrowConfig("audio.invalid-source", "Source id exceeds registry bounds.");
            }

            _sources[idx].Definition = definition;
            _sources[idx].IsRegistered = true;

            _observability.Counters.IncrementSourceMutations();
            _observability.Dispatch(AudioEventType.SourceUpserted, id.Value);

            if (definition.Autoplay && definition.ClipId.IsValid)
            {
                Play(id, new AudioSourcePlayRequest());
            }
        }
    }

    /// <summary>Plays a source, replacing its active voice.</summary>
    public AudioPlaybackHandle Play(AudioSourceId id, in AudioSourcePlayRequest request)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxSources || !_sources[idx].IsRegistered)
            {
                AudioThrowHelper.ThrowSource(id, "Source is not registered.");
            }

            ref SourceEntry entry = ref _sources[idx];
            if (entry.ActiveHandle.IsValid && request.Replace)
            {
                entry.ActiveHandle.Stop();
            }

            if (!entry.Definition.ClipId.IsValid)
            {
                AudioThrowHelper.ThrowSource(id, "No clip is bound to the source.");
            }

            AudioSourceDefinition definition = entry.Definition;
            AudioSpatialization spatial = definition.Spatial;
            entry.ActiveHandle = _runtime.AllocateVoice(
                id,
                definition.ClipId,
                definition.BusId,
                in request,
                in spatial,
                definition.Loop,
                definition.Volume,
                definition.PlaybackRate,
                definition.DetuneCents);

            return entry.ActiveHandle;
        }
    }

    /// <summary>Plays a clip without registration.</summary>
    public AudioPlaybackHandle PlayOneShot(AudioClipId clipId, in AudioSpatialization spatial, float volume = 1.0f)
    {
        uint transient = (uint)Interlocked.Increment(ref _transientIdCounter);
        AudioSourceId sid = new(transient);
        AudioSourcePlayRequest req = new(Volume: volume);

        return _runtime.AllocateVoice(
            sid,
            clipId,
            AudioBusId.Master,
            in req,
            in spatial,
            false,
            volume,
            1.0f,
            0.0f);
    }

    /// <summary>Reads the committed playback state.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetPlaybackState(AudioSourceId id, out AudioPlaybackState state)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxSources || !_sources[idx].IsRegistered)
            {
                state = AudioPlaybackState.Stopped;
                return false;
            }

            return _runtime.TryGetState(in _sources[idx].ActiveHandle, out state);
        }
    }

    /// <summary>Pauses a source.</summary>
    public void Pause(AudioSourceId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx < (uint)_maxSources && _sources[idx].IsRegistered)
            {
                _sources[idx].ActiveHandle.Pause();
            }
        }
    }

    /// <summary>Resumes a source.</summary>
    public void Resume(AudioSourceId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx < (uint)_maxSources && _sources[idx].IsRegistered)
            {
                _sources[idx].ActiveHandle.Resume();
            }
        }
    }

    /// <summary>Stops a source.</summary>
    public void Stop(AudioSourceId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx < (uint)_maxSources && _sources[idx].IsRegistered)
            {
                _sources[idx].ActiveHandle.Stop();
                _sources[idx].ActiveHandle = AudioPlaybackHandle.Invalid;
            }
        }
    }

    /// <summary>
    /// Removes a source and releases everything it owns: the active voice is
    /// stopped through the runtime, the slot is cleared and the registry entry
    /// becomes unknown, so a later play must re-register first.
    /// </summary>
    public int RemoveSource(AudioSourceId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxSources || !_sources[idx].IsRegistered)
            {
                return 0;
            }

            int released = _runtime.ReleaseVoicesForSource(id);
            _sources[idx] = default;

            _observability.Counters.IncrementSourceMutations();
            _observability.Dispatch(AudioEventType.SourceRemoved, id.Value, (uint)released);
            return released;
        }
    }

    /// <summary>
    /// Re-points registered sources from one bus to another and updates their
    /// live voices. Used when a bus is removed so no source keeps a dangling
    /// bus id and falls permanently silent.
    /// </summary>
    public int ReassignBus(AudioBusId from, AudioBusId to)
    {
        if (from == to)
        {
            return 0;
        }

        lock (_gate)
        {
            int updated = 0;
            for (int i = 0; i < _maxSources; i++)
            {
                if (_sources[i].IsRegistered && _sources[i].Definition.BusId == from)
                {
                    _sources[i].Definition = _sources[i].Definition with { BusId = to };
                    updated++;
                }
            }

            if (updated != 0)
            {
                _ = _runtime.ReassignVoiceBus(from, to);
            }

            return updated;
        }
    }

    /// <summary>Registered source count.</summary>
    public int RegisteredCount
    {
        get
        {
            lock (_gate)
            {
                int count = 0;
                for (int i = 0; i < _maxSources; i++)
                {
                    if (_sources[i].IsRegistered)
                    {
                        count++;
                    }
                }

                return count;
            }
        }
    }

    /// <summary>Reads one registered definition.</summary>
    public bool TryGetDefinition(AudioSourceId id, out AudioSourceDefinition definition)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxSources || !_sources[idx].IsRegistered)
            {
                definition = default;
                return false;
            }

            definition = _sources[idx].Definition;
            return true;
        }
    }
}
