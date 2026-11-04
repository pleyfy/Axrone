namespace Axrone.Audio;

using Axrone.Utility.Descriptors;

/// <summary>
/// Listener tuning descriptor. Unmanaged and positional-compatible:
/// the first four parameters keep their order so existing call sites
/// compile unchanged. Occlusion layers collapse to a 32-bit mask and
/// the string ambient clip becomes an <see cref="AudioClipId"/>; managed
/// metadata stays out and arrives with the asset round.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioListenerDescriptor(
    Vector3 Position = default,
    Vector3 Forward = default,
    Vector3 Up = default,
    float GlobalVolume = 1.0f,
    float DopplerFactor = 1.0f,
    AudioSpeakerMode SpeakerMode = AudioSpeakerMode.Stereo,
    int SampleRate = 48000,
    int DspBufferSize = 1024,
    int RealVoices = 32,
    int VirtualVoices = 128,
    AudioVirtualVoiceBehavior VirtualVoiceBehavior = AudioVirtualVoiceBehavior.PlaySilent,
    AudioHrtfPlugin HrtfPlugin = AudioHrtfPlugin.None,
    AudioOcclusionMode OcclusionMode = AudioOcclusionMode.RaycastDiffraction,
    uint OcclusionMask = 0xC9U,
    AudioReverbPreset ReverbPreset = AudioReverbPreset.Off,
    float ReverbLevel = 0.0f,
    AudioClipId AmbientClip = default,
    float AmbientVolume = 0.5f,
    bool FollowCamera = true) : IDescriptor<AudioListenerDescriptor>
{
    /// <summary>Origin-facing listener at unity gain.</summary>
    public static AudioListenerDescriptor Default => new(
        Vector3.Zero,
        -Vector3.UnitZ,
        Vector3.UnitY,
        1.0f);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Validate(in AudioListenerDescriptor descriptor)
    {
        if (!float.IsFinite(descriptor.Position.X) || !float.IsFinite(descriptor.Position.Y) || !float.IsFinite(descriptor.Position.Z))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener position must be finite.");
        }

        if (!float.IsFinite(descriptor.Forward.X) || !float.IsFinite(descriptor.Forward.Y) || !float.IsFinite(descriptor.Forward.Z))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener forward must be finite.");
        }

        if (!float.IsFinite(descriptor.Up.X) || !float.IsFinite(descriptor.Up.Y) || !float.IsFinite(descriptor.Up.Z))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener up must be finite.");
        }

        if (!float.IsFinite(descriptor.GlobalVolume) || descriptor.GlobalVolume < 0.0f || descriptor.GlobalVolume > 1.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener global volume must be in [0, 1].");
        }

        if (!float.IsFinite(descriptor.DopplerFactor) || descriptor.DopplerFactor < 0.0f || descriptor.DopplerFactor > 5.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener doppler factor must be in [0, 5].");
        }

        if (!IsSpeakerMode(descriptor.SpeakerMode))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener speaker mode is unknown.");
        }

        if (!IsSampleRate(descriptor.SampleRate))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener sample rate is not a supported rate.");
        }

        if (!IsDspBufferSize(descriptor.DspBufferSize))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener DSP buffer size is not a supported size.");
        }

        if (descriptor.RealVoices < 1 || descriptor.RealVoices > 256)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener real voices must be in [1, 256].");
        }

        if (descriptor.VirtualVoices < 1 || descriptor.VirtualVoices > 1024)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener virtual voices must be in [1, 1024].");
        }

        if (!IsVirtualVoiceBehavior(descriptor.VirtualVoiceBehavior))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener virtual voice behavior is unknown.");
        }

        if (!IsHrtfPlugin(descriptor.HrtfPlugin))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener HRTF plugin is unknown.");
        }

        if (!IsOcclusionMode(descriptor.OcclusionMode))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener occlusion mode is unknown.");
        }

        if (!IsReverbPreset(descriptor.ReverbPreset))
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener reverb preset is unknown.");
        }

        if (!float.IsFinite(descriptor.ReverbLevel) || descriptor.ReverbLevel < 0.0f || descriptor.ReverbLevel > 1.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener reverb level must be in [0, 1].");
        }

        if (!float.IsFinite(descriptor.AmbientVolume) || descriptor.AmbientVolume < 0.0f || descriptor.AmbientVolume > 1.0f)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener ambient volume must be in [0, 1].");
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static string Describe(in AudioListenerDescriptor descriptor) => descriptor.ToString();

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsSpeakerMode(AudioSpeakerMode mode) => mode is
        AudioSpeakerMode.Mono or
        AudioSpeakerMode.Stereo or
        AudioSpeakerMode.Quad or
        AudioSpeakerMode.Surround51 or
        AudioSpeakerMode.Surround71;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsSampleRate(int rate) => rate is 22050 or 44100 or 48000 or 96000;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsDspBufferSize(int size) => size is 128 or 256 or 512 or 1024 or 2048 or 4096;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsVirtualVoiceBehavior(AudioVirtualVoiceBehavior behavior) => behavior is
        AudioVirtualVoiceBehavior.PlaySilent or
        AudioVirtualVoiceBehavior.PlayInaudible or
        AudioVirtualVoiceBehavior.StopImmediately or
        AudioVirtualVoiceBehavior.SwapWithReal;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsHrtfPlugin(AudioHrtfPlugin plugin) => plugin is
        AudioHrtfPlugin.None or
        AudioHrtfPlugin.Oculus or
        AudioHrtfPlugin.Steam or
        AudioHrtfPlugin.Resonance or
        AudioHrtfPlugin.WindowsSonic;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsOcclusionMode(AudioOcclusionMode mode) => mode is
        AudioOcclusionMode.Raycast or
        AudioOcclusionMode.RaycastDiffraction or
        AudioOcclusionMode.None;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsReverbPreset(AudioReverbPreset preset) => preset is
        AudioReverbPreset.Off or
        AudioReverbPreset.Generic or
        AudioReverbPreset.Room or
        AudioReverbPreset.Bathroom or
        AudioReverbPreset.StoneRoom or
        AudioReverbPreset.Auditorium or
        AudioReverbPreset.ConcertHall or
        AudioReverbPreset.Cave or
        AudioReverbPreset.Forest or
        AudioReverbPreset.City or
        AudioReverbPreset.Underwater;
}

/// <summary>
/// Slot-indexed listener store with one active listener.
/// </summary>
public sealed class AudioListenerRegistry
{
    [StructLayout(LayoutKind.Sequential)]
    private struct ListenerNode
    {
        public AudioListenerDescriptor Descriptor;
        public bool IsRegistered;
    }

    private readonly ListenerNode[] _nodes;
    private readonly AudioObservabilityRuntime _observability;
    private readonly Lock _gate = new();
    private readonly int _maxListeners;
    private uint _activeRaw = AudioListenerId.Primary.Value;

    /// <summary>Active listener.</summary>
    public AudioListenerId ActiveListenerId => new(Volatile.Read(ref _activeRaw));

    /// <summary>Creates a registry with the primary listener.</summary>
    public AudioListenerRegistry(AudioObservabilityRuntime observability, int maxListeners = 16)
    {
        _maxListeners = maxListeners;
        _nodes = new ListenerNode[maxListeners];
        _observability = observability;

        Upsert(AudioListenerId.Primary, AudioListenerDescriptor.Default);
        SetActive(AudioListenerId.Primary);
    }

    /// <summary>Registers or replaces a listener.</summary>
    public void Upsert(AudioListenerId id, in AudioListenerDescriptor descriptor)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxListeners)
            {
                AudioThrowHelper.ThrowConfig("audio.invalid-listener", "Listener id exceeds registry bounds.");
            }

            _nodes[idx].Descriptor = descriptor;
            _nodes[idx].IsRegistered = true;

            _observability.Counters.IncrementListenerMutations();
            _observability.Dispatch(AudioEventType.ListenerUpserted, id.Value);
        }
    }

    /// <summary>Selects the active listener.</summary>
    public void SetActive(AudioListenerId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxListeners || !_nodes[idx].IsRegistered)
            {
                AudioThrowHelper.ThrowListener(id, "Listener is not registered.");
            }

            Volatile.Write(ref _activeRaw, id.Value);
            _observability.Dispatch(AudioEventType.ListenerActivated, id.Value);
        }
    }

    /// <summary>Reads the active descriptor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public AudioListenerDescriptor GetActiveDescriptor()
    {
        uint idx = Volatile.Read(ref _activeRaw);
        return _nodes[idx].Descriptor;
    }

    /// <summary>Registered listener count.</summary>
    public int RegisteredCount
    {
        get
        {
            lock (_gate)
            {
                int count = 0;
                for (int i = 0; i < _maxListeners; i++)
                {
                    if (_nodes[i].IsRegistered)
                    {
                        count++;
                    }
                }

                return count;
            }
        }
    }

    /// <summary>Reads one registered descriptor.</summary>
    public bool TryGetDescriptor(AudioListenerId id, out AudioListenerDescriptor descriptor)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxListeners || !_nodes[idx].IsRegistered)
            {
                descriptor = default;
                return false;
            }

            descriptor = _nodes[idx].Descriptor;
            return true;
        }
    }

    /// <summary>
    /// Removes a listener and, when it was active, promotes the lowest
    /// remaining listener. The last registered listener is protected: the mixer
    /// always needs one active descriptor, so removing it is a typed error
    /// rather than an implicit fall back to a phantom listener.
    /// </summary>
    public bool RemoveListener(AudioListenerId id)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxListeners || !_nodes[idx].IsRegistered)
            {
                return false;
            }

            int registered = 0;
            for (int i = 0; i < _maxListeners; i++)
            {
                if (_nodes[i].IsRegistered)
                {
                    registered++;
                }
            }

            if (registered <= 1)
            {
                AudioThrowHelper.ThrowListener(id, "At least one listener must stay registered for the mixer.");
            }

            _nodes[idx] = default;

            if (Volatile.Read(ref _activeRaw) == idx)
            {
                uint fallback = 1U;
                for (int i = 1; i < _maxListeners; i++)
                {
                    if (_nodes[i].IsRegistered)
                    {
                        fallback = (uint)i;
                        break;
                    }
                }

                Volatile.Write(ref _activeRaw, fallback);
            }

            _observability.Counters.IncrementListenerMutations();
            _observability.Dispatch(AudioEventType.ListenerRemoved, id.Value);
            return true;
        }
    }
}
