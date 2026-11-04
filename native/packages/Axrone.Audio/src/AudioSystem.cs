namespace Axrone.Audio;

/// <summary>
/// System status.
/// </summary>
public enum AudioSystemStatus : byte
{
    /// <summary>Constructed, not yet running.</summary>
    Idle = 0,

    /// <summary>Rendering.</summary>
    Running = 1,

    /// <summary>Output muted, graph retained.</summary>
    Suspended = 2,

    /// <summary>Disposed.</summary>
    Disposed = 3,
}

/// <summary>
/// Top-level audio facade: owns counters, observability, clips, buses,
/// listeners, playback and sources with one consistent lifecycle.
/// </summary>
public sealed class AudioSystem : IDisposable, IAsyncDisposable
{
    private readonly CacheAlignedDiagnosticsCounters _counters;
    private readonly AudioObservabilityRuntime _observability;
    private readonly AudioClipStore _clipStore;
    private readonly AudioBusRegistry _busMixer;
    private readonly AudioListenerRegistry _listenerRegistry;
    private readonly AudioPlaybackRuntime _playbackRuntime;
    private readonly AudioSourceRegistry _sourceRegistry;
    private readonly AudioClipIngest _ingest;
    private readonly int _outputSampleRate;

    private int _systemStatus = (int)AudioSystemStatus.Running;
    private int _disposed;

    /// <summary>Diagnostics counters.</summary>
    public CacheAlignedDiagnosticsCounters Counters => _counters;

    /// <summary>Observability runtime.</summary>
    public AudioObservabilityRuntime Observability => _observability;

    /// <summary>Clip store.</summary>
    public AudioClipStore Clips => _clipStore;

    /// <summary>Bus mixer.</summary>
    public AudioBusRegistry Buses => _busMixer;

    /// <summary>Listener registry.</summary>
    public AudioListenerRegistry Listeners => _listenerRegistry;

    /// <summary>Playback runtime.</summary>
    public AudioPlaybackRuntime Playback => _playbackRuntime;

    /// <summary>Source registry.</summary>
    public AudioSourceRegistry Sources => _sourceRegistry;

    /// <summary>Container ingest: WAV in-engine, compressed families through the decoder registry.</summary>
    public AudioClipIngest Ingest => _ingest;

    /// <summary>Decoder registry used by <see cref="Ingest"/>.</summary>
    public AudioDecoderRegistry Decoders => _ingest.Decoders;

    /// <summary>Current status.</summary>
    public AudioSystemStatus Status => (AudioSystemStatus)Volatile.Read(ref _systemStatus);

    /// <summary>Creates a system.</summary>
    public AudioSystem(
        int maxVoices = 64,
        int maxSources = 1024,
        int maxBuses = 128,
        int clipCacheCapacity = 512,
        int outputSampleRate = 48000,
        AudioDecoderRegistry? decoders = null)
    {
        _counters = new CacheAlignedDiagnosticsCounters();
        _observability = new AudioObservabilityRuntime(_counters);
        _clipStore = new AudioClipStore(clipCacheCapacity);
        _busMixer = new AudioBusRegistry(_observability, maxBuses);
        _listenerRegistry = new AudioListenerRegistry(_observability);
        _ingest = new AudioClipIngest(decoders);
        _outputSampleRate = outputSampleRate;

        _playbackRuntime = new AudioPlaybackRuntime(
            maxVoices,
            _busMixer,
            _clipStore,
            _listenerRegistry,
            _observability,
            outputSampleRate);

        _sourceRegistry = new AudioSourceRegistry(maxSources, _playbackRuntime, _observability);
        _busMixer.SetSourceRebindHook((from, to) => _sourceRegistry.ReassignBus(from, to));
    }

    /// <summary>Suspends rendering; the graph is retained.</summary>
    public void Suspend()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            AudioThrowHelper.ThrowDisposed(nameof(AudioSystem));
        }

        if (Interlocked.CompareExchange(ref _systemStatus, (int)AudioSystemStatus.Suspended, (int)AudioSystemStatus.Running) == (int)AudioSystemStatus.Running)
        {
            _counters.IncrementLifecycle();
            _observability.Dispatch(AudioEventType.SystemSuspended, 0U);
        }
    }

    /// <summary>Resumes rendering.</summary>
    public void Resume()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            AudioThrowHelper.ThrowDisposed(nameof(AudioSystem));
        }

        if (Interlocked.CompareExchange(ref _systemStatus, (int)AudioSystemStatus.Running, (int)AudioSystemStatus.Suspended) == (int)AudioSystemStatus.Suspended)
        {
            _counters.IncrementLifecycle();
            _observability.Dispatch(AudioEventType.SystemResumed, 0U);
        }
    }

    /// <summary>Renders one interleaved stereo block.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void ProcessAudioRenderBlock(Span<float> interleavedStereoOut)
    {
        if (Status != AudioSystemStatus.Running)
        {
            interleavedStereoOut.Clear();
            return;
        }

        double secondsPerBlock = (interleavedStereoOut.Length >> 1) / (double)_outputSampleRate;
        _busMixer.AdvanceClock(secondsPerBlock);
        _playbackRuntime.ProcessGraph(interleavedStereoOut);
    }

    /// <summary>Mixer clock in seconds; ramps are scheduled against it.</summary>
    public double MixerClockSeconds => _busMixer.ClockSeconds;

    /// <summary>Advances the mixer clock explicitly, for deterministic tests and manual stepping.</summary>
    public void AdvanceMixerClock(double seconds) => _busMixer.AdvanceClock(seconds);

    /// <summary>Captures the committed tuning and topology of every active bus.</summary>
    public AudioMixerSnapshot CaptureMixerSnapshot() => _busMixer.CaptureMixerSnapshot();

    /// <summary>
    /// Restores a snapshot. Topology is reinstated immediately and gains
    /// interpolate to the captured targets over the mixer clock.
    /// </summary>
    public AudioSnapshotApplyResult ApplyMixerSnapshot(
        AudioMixerSnapshot snapshot,
        double? atTime = null,
        double? durationSeconds = null,
        MixerRampCurve curve = MixerRampCurve.Linear) =>
        _busMixer.ApplyMixerSnapshot(snapshot, atTime, durationSeconds, curve);

    /// <summary>
    /// Removes a bus, re-parenting its children and re-pointing its sources and
    /// live voices at the fallback bus through the registry hook. Master is
    /// protected by a typed error.
    /// </summary>
    public AudioBusRemoveResult RemoveBus(AudioBusId id) => _busMixer.RemoveBus(id);

    /// <summary>Removes a listener; the last registered listener is protected.</summary>
    public bool RemoveListener(AudioListenerId id) => _listenerRegistry.RemoveListener(id);

    /// <summary>Removes a source and releases its live voices; returns the released voice count.</summary>
    public int RemoveSource(AudioSourceId id) => _sourceRegistry.RemoveSource(id);

    /// <summary>Decodes a container and registers the clip; throws the typed ingest error on failure.</summary>
    public AudioClipId RegisterClip(AudioClipId id, ReadOnlyMemory<byte> container) => _ingest.Register(_clipStore, id, container);

    /// <summary>Decodes and registers a container, reporting the typed failure instead of throwing.</summary>
    public bool TryRegisterClip(
        AudioClipId id,
        ReadOnlyMemory<byte> container,
        out AudioContainerInfo info,
        [NotNullWhen(false)] out AudioException? error) =>
        _ingest.TryRegister(_clipStore, id, container, out _, out info, out error);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Volatile.Write(ref _systemStatus, (int)AudioSystemStatus.Disposed);
        _counters.IncrementLifecycle();
        _observability.Dispatch(AudioEventType.SystemDisposed, 0U);

        _playbackRuntime.Dispose();
        _clipStore.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Builder typestate marker: initial stage.
/// </summary>
public readonly struct TypestateInitial;

/// <summary>
/// Builder typestate marker: capacities configured.
/// </summary>
public readonly struct TypestateConfigured;

/// <summary>
/// Compile-time typestate builder: capacities must be set before Build.
/// </summary>
/// <typeparam name="TStage">Current stage.</typeparam>
public sealed class AudioSystemBuilder<TStage>
{
    private int _maxVoices = 64;
    private int _maxSources = 1024;
    private int _maxBuses = 128;
    private int _maxClipCapacity = 512;

    /// <summary>Creates a builder.</summary>
    internal AudioSystemBuilder()
    {
    }

    /// <summary>Creates a builder with capacities.</summary>
    internal AudioSystemBuilder(int maxVoices, int maxSources, int maxBuses, int maxClipCapacity)
    {
        _maxVoices = maxVoices;
        _maxSources = maxSources;
        _maxBuses = maxBuses;
        _maxClipCapacity = maxClipCapacity;
    }

    /// <summary>Starts a builder.</summary>
    public static AudioSystemBuilder<TypestateInitial> Create() => new();

    /// <summary>Sets capacities, advancing to the configured stage.</summary>
    public AudioSystemBuilder<TypestateConfigured> WithCapacity(
        int maxVoices = 64,
        int maxSources = 1024,
        int maxBuses = 128,
        int maxClipCapacity = 512) =>
        new(maxVoices, maxSources, maxBuses, maxClipCapacity);

    /// <summary>Builds a system from the configured capacities.</summary>
    internal AudioSystem Materialize() => new(_maxVoices, _maxSources, _maxBuses, _maxClipCapacity);
}

/// <summary>
/// Builder extensions: materialization is only available when configured.
/// </summary>
public static class AudioSystemBuilderExtensions
{
    /// <summary>Builds the system.</summary>
    public static AudioSystem Build(this AudioSystemBuilder<TypestateConfigured> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.Materialize();
    }
}
