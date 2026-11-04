namespace Axrone.Audio;

/// <summary>
/// Bus registration.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioBusDefinition(
    AudioBusId Id,
    AudioBusId ParentId = default,
    float Volume = 1.0f,
    bool Mute = false,
    float Pan = 0.0f,
    object? Metadata = null);

/// <summary>
/// Committed bus state with effective gain.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioBusState(
    AudioBusId Id,
    AudioBusId ParentId,
    float Volume,
    bool Mute,
    float Pan,
    float EffectiveGain,
    int ChildCount,
    object? Metadata);

/// <summary>
/// Partial bus update.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioBusPatch(
    float? Volume = null,
    bool? Mute = null,
    float? Pan = null,
    AudioBusId? ParentId = null);

/// <summary>
/// Outcome of a bus removal. Children are re-parented to the removed bus's
/// own parent (or Master) rather than orphaned, so the graph always shrinks
/// without losing downstream gains.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct AudioBusRemoveResult(
    bool Removed,
    AudioBusId ReparentedTo,
    int ReparentedChildCount,
    int CancelledRampCount);

/// <summary>
/// Directed bus topology: id-indexed nodes with parent gain accumulation.
/// Muting a bus zeroes its subtree; gains clamp volume to [0, 4].
/// </summary>
public sealed class AudioBusRegistry
{
    [StructLayout(LayoutKind.Explicit, Size = 64)]
    internal struct BusNode
    {
        [FieldOffset(0)] public AudioBusDefinition Definition;
        [FieldOffset(32)] public float EffectiveGain;
        [FieldOffset(36)] public bool IsActive;
        [FieldOffset(40)] public int ChildCount;
    }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    private struct BusRamp
    {
        [FieldOffset(0)] public bool IsActive;
        [FieldOffset(1)] public bool MuteApplied;
        [FieldOffset(2)] public bool ToMute;
        [FieldOffset(4)] public float FromVolume;
        [FieldOffset(8)] public float ToVolume;
        [FieldOffset(12)] public float FromPan;
        [FieldOffset(16)] public float ToPan;
        [FieldOffset(20)] public MixerRampCurve Curve;
        [FieldOffset(32)] public double StartSeconds;
        [FieldOffset(40)] public double EndSeconds;
    }

    private readonly BusNode[] _nodes;
    private readonly BusRamp[] _ramps;
    private readonly int[][] _childrenIndices;
    private readonly AudioObservabilityRuntime _observability;
    private readonly Lock _gate = new();
    private readonly int _maxBuses;
    private long _clockBits;
    private int _activeRampCount;
    private uint _snapshotCounter;
    private System.Action<AudioBusId, AudioBusId>? _sourceRebindHook;

    /// <summary>
    /// Wires the callback that re-points registered sources and live voices
    /// when a bus is removed. Set once by the system owner; removal without a
    /// hook still keeps the graph consistent, but only through the hook can
    /// every RemoveBus entry point rebind sources atomically.
    /// </summary>
    public void SetSourceRebindHook(System.Action<AudioBusId, AudioBusId>? hook)
    {
        lock (_gate)
        {
            _sourceRebindHook = hook;
        }
    }

    /// <summary>Creates a registry with the default hierarchy.</summary>
    public AudioBusRegistry(AudioObservabilityRuntime observability, int maxBuses = 128)
    {
        _maxBuses = maxBuses;
        _nodes = new BusNode[maxBuses];
        _ramps = new BusRamp[maxBuses];
        _childrenIndices = new int[maxBuses][];
        for (int i = 0; i < maxBuses; i++)
        {
            _childrenIndices[i] = new int[maxBuses];
        }

        _observability = observability;

        InitializeDefaultHierarchy();
    }

    private void InitializeDefaultHierarchy()
    {
        ReadOnlySpan<AudioBusDefinition> defaults =
        [
            new(AudioBusId.Master, AudioBusId.Invalid, 1.0f, false, 0.0f),
            new(AudioBusId.Music, AudioBusId.Master, 1.0f, false, 0.0f),
            new(AudioBusId.Sfx, AudioBusId.Master, 1.0f, false, 0.0f),
            new(AudioBusId.Voice, AudioBusId.Master, 1.0f, false, 0.0f),
            new(AudioBusId.Ambient, AudioBusId.Music, 1.0f, false, 0.0f),
            new(AudioBusId.Soundtrack, AudioBusId.Music, 1.0f, false, 0.0f),
            new(AudioBusId.Ui, AudioBusId.Sfx, 1.0f, false, 0.0f),
            new(AudioBusId.World, AudioBusId.Sfx, 1.0f, false, 0.0f),
        ];

        lock (_gate)
        {
            for (int i = 0; i < defaults.Length; i++)
            {
                UpsertInternal(defaults[i]);
            }

            RebuildHierarchyTopology();
        }
    }

    /// <summary>Registers or replaces a bus.</summary>
    public AudioBusState Upsert(in AudioBusDefinition definition)
    {
        lock (_gate)
        {
            AudioBusState state = UpsertInternal(definition);
            RebuildHierarchyTopology();
            _observability.Counters.IncrementBusMutations();
            _observability.Dispatch(AudioEventType.BusUpserted, definition.Id.Value, definition.ParentId.Value, state.EffectiveGain);
            return state;
        }
    }

    /// <summary>Applies a partial update.</summary>
    public AudioBusState UpdateBus(AudioBusId id, in AudioBusPatch patch)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx >= (uint)_maxBuses || !_nodes[idx].IsActive)
            {
                AudioThrowHelper.ThrowBus(id, "Bus is not registered.");
            }

            ref BusNode node = ref _nodes[idx];
            AudioBusDefinition def = node.Definition;
            AudioBusId newParent = patch.ParentId ?? def.ParentId;

            if (newParent != def.ParentId)
            {
                ValidateParentWrite(id, newParent, idx);
            }

            CancelRamp((int)idx);
            node.Definition = def with
            {
                Volume = patch.Volume ?? def.Volume,
                Mute = patch.Mute ?? def.Mute,
                Pan = patch.Pan ?? def.Pan,
                ParentId = newParent,
            };

            RebuildHierarchyTopology();
            _observability.Counters.IncrementBusMutations();
            _observability.Dispatch(AudioEventType.BusUpserted, id.Value, node.Definition.ParentId.Value, node.EffectiveGain);

            return BuildBusState((int)idx);
        }
    }

    /// <summary>Reads effective gain; zero when unknown.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public float GetEffectiveGain(AudioBusId id)
    {
        uint idx = id.Value;
        return idx < (uint)_maxBuses && _nodes[idx].IsActive ? _nodes[idx].EffectiveGain : 0.0f;
    }

    /// <summary>
    /// Mixer clock in seconds. Scheduled ramps advance against this clock,
    /// which the system drives from rendered frames, never wall time.
    /// </summary>
    public double ClockSeconds => BitConverter.Int64BitsToDouble(Volatile.Read(ref _clockBits));

    /// <summary>Ramps still awaiting their target clock.</summary>
    public int PendingRampCount => Volatile.Read(ref _activeRampCount);

    /// <summary>Active bus count.</summary>
    public int ActiveBusCount
    {
        get
        {
            lock (_gate)
            {
                int count = 0;
                for (int i = 0; i < _maxBuses; i++)
                {
                    if (_nodes[i].IsActive)
                    {
                        count++;
                    }
                }

                return count;
            }
        }
    }

    /// <summary>
    /// Advances the mixer clock and evaluates scheduled ramps. Deterministic:
    /// the same clock sequence always produces the same gains.
    /// </summary>
    public void AdvanceClock(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds < 0.0)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-time", "Mixer clock advance must be finite and non-negative.");
        }

        if (seconds == 0.0)
        {
            return;
        }

        lock (_gate)
        {
            double clock = ClockSeconds + seconds;
            Volatile.Write(ref _clockBits, BitConverter.DoubleToInt64Bits(clock));

            if (Volatile.Read(ref _activeRampCount) == 0)
            {
                return;
            }

            EvaluateRamps(clock);
        }
    }

    /// <summary>Captures the committed tuning and topology of every active bus.</summary>
    public AudioMixerSnapshot CaptureMixerSnapshot() => CaptureMixerSnapshot(null);

    /// <summary>Captures a mixer snapshot under an explicit identity.</summary>
    public AudioMixerSnapshot CaptureMixerSnapshot(AudioSnapshotId? id)
    {
        lock (_gate)
        {
            AudioSnapshotId snapshotId = id ?? new AudioSnapshotId(Interlocked.Increment(ref _snapshotCounter));
            if (snapshotId.Value == 0U)
            {
                AudioThrowHelper.ThrowConfig("audio.invalid-snapshot", "Snapshot id must be valid.");
            }

            AudioMixerSnapshotEntry[] entries = new AudioMixerSnapshotEntry[CountActive()];
            int written = 0;
            for (int i = 0; i < _maxBuses; i++)
            {
                if (!_nodes[i].IsActive)
                {
                    continue;
                }

                ref readonly BusNode node = ref _nodes[i];
                entries[written++] = new AudioMixerSnapshotEntry(
                    node.Definition.Id,
                    node.Definition.ParentId,
                    node.Definition.Volume,
                    node.Definition.Mute,
                    node.Definition.Pan,
                    node.EffectiveGain);
            }

            _observability.Counters.IncrementSnapshots();
            _observability.Dispatch(AudioEventType.SnapshotCaptured, snapshotId.Value, (uint)written);
            return new AudioMixerSnapshot(snapshotId, ClockSeconds, entries);
        }
    }

    /// <summary>
    /// Schedules a restore. Topology is reinstated immediately; volume and pan
    /// interpolate from the committed values to the captured targets between
    /// <paramref name="atTime"/> and <paramref name="atTime"/> plus
    /// <paramref name="durationSeconds"/> on the mixer clock. Buses that are no
    /// longer registered are counted as skipped and never created.
    /// </summary>
    public AudioSnapshotApplyResult ApplyMixerSnapshot(
        AudioMixerSnapshot snapshot,
        double? atTime = null,
        double? durationSeconds = null,
        MixerRampCurve curve = MixerRampCurve.Linear)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        double clock = ClockSeconds;
        double start = atTime ?? clock;
        double duration = durationSeconds ?? 0.0;

        if (!double.IsFinite(start) || start < 0.0)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-time", "Snapshot atTime must be finite and non-negative.");
        }

        if (!double.IsFinite(duration) || duration < 0.0)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-time", "Snapshot durationSeconds must be finite and non-negative.");
        }

        double end = start + duration;
        if (end < start)
        {
            end = double.MaxValue;
        }

        lock (_gate)
        {
            int applied = 0;
            int skipped = 0;
            int topologyRestored = 0;
            ReadOnlySpan<AudioMixerSnapshotEntry> entries = snapshot.Entries;

            for (int e = 0; e < entries.Length; e++)
            {
                AudioMixerSnapshotEntry entry = entries[e];
                uint idx = entry.Id.Value;
                if (idx == 0U || idx >= (uint)_maxBuses || !_nodes[idx].IsActive)
                {
                    skipped++;
                    continue;
                }

                ref BusNode node = ref _nodes[idx];
                if (RestoreTopology(ref node, entry.ParentId))
                {
                    topologyRestored++;
                }

                float fromVolume = node.Definition.Volume;
                float fromPan = node.Definition.Pan;

                if (duration <= 0.0 || clock >= end)
                {
                    CommitTarget(ref node, in entry);
                    _ramps[idx] = default;
                }
                else
                {
                    ref BusRamp ramp = ref _ramps[idx];
                    bool wasActive = ramp.IsActive;
                    ramp = new BusRamp
                    {
                        IsActive = true,
                        FromVolume = fromVolume,
                        ToVolume = entry.Volume,
                        FromPan = fromPan,
                        ToPan = entry.Pan,
                        ToMute = entry.Mute,
                        MuteApplied = clock >= start,
                        Curve = curve,
                        StartSeconds = start,
                        EndSeconds = end,
                    };

                    if (ramp.MuteApplied)
                    {
                        node.Definition = node.Definition with { Mute = entry.Mute };
                    }

                    if (!wasActive)
                    {
                        Interlocked.Increment(ref _activeRampCount);
                    }
                }

                applied++;
            }

            if (applied != 0)
            {
                RebuildHierarchyTopology();
                _observability.Counters.IncrementBusMutations();
            }

            _observability.Counters.IncrementSnapshots();
            _observability.Dispatch(AudioEventType.SnapshotRestored, snapshot.Id.Value, (uint)applied, (float)Math.Min(end, double.MaxValue));

            return new AudioSnapshotApplyResult(applied, skipped, topologyRestored, end);
        }
    }

    /// <summary>
    /// Removes a bus and re-parents its direct children to the removed bus's
    /// own parent, falling back to Master. Master itself is a hard error: it is
    /// the mixer root, so every bus must resolve to it.
    /// </summary>
    public AudioBusRemoveResult RemoveBus(AudioBusId id)
    {
        if (id == AudioBusId.Master)
        {
            AudioThrowHelper.ThrowBus(id, "The master bus is the mixer root and cannot be removed.");
        }

        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxBuses || !_nodes[idx].IsActive)
            {
                return new AudioBusRemoveResult(false, AudioBusId.Invalid, 0, 0);
            }

            AudioBusId fallback = ResolveFallbackParent(_nodes[idx].Definition.ParentId, idx);

            int reparented = 0;
            for (int i = 0; i < _maxBuses; i++)
            {
                if (i != (int)idx && _nodes[i].IsActive && _nodes[i].Definition.ParentId == id)
                {
                    _nodes[i].Definition = _nodes[i].Definition with { ParentId = fallback };
                    reparented++;
                }
            }

            int cancelled = CancelRamp((int)idx) ? 1 : 0;
            _nodes[idx] = default;
            RebuildHierarchyTopology();

            // Rebind registered sources and live voices before the removal
            // becomes externally visible, so every RemoveBus entry point —
            // the facade or the registry directly — leaves no dangling bus id.
            _sourceRebindHook?.Invoke(id, fallback);

            _observability.Counters.IncrementBusMutations();
            _observability.Dispatch(AudioEventType.BusRemoved, id.Value, fallback.Value, reparented);

            return new AudioBusRemoveResult(true, fallback, reparented, cancelled);
        }
    }

    /// <summary>Reads one committed bus state.</summary>
    public bool TryGetBus(AudioBusId id, out AudioBusState state)
    {
        lock (_gate)
        {
            uint idx = id.Value;
            if (idx == 0U || idx >= (uint)_maxBuses || !_nodes[idx].IsActive)
            {
                state = default;
                return false;
            }

            state = BuildBusState((int)idx);
            return true;
        }
    }

    /// <summary>Enumerates active buses.</summary>
    public BusEnumerator GetEnumerator() => new(_nodes);

    /// <summary>Duck-typed zero-allocation enumerator over active buses.</summary>
    public ref struct BusEnumerator
    {
        private readonly BusNode[] _nodes;
        private int _index;

        /// <summary>Creates an enumerator.</summary>
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal BusEnumerator(BusNode[] nodes)
        {
            _nodes = nodes;
            _index = -1;
        }

        /// <summary>Advances to the next active bus.</summary>
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool MoveNext()
        {
            while (++_index < _nodes.Length)
            {
                if (_nodes[_index].IsActive)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>Current bus state.</summary>
        public readonly AudioBusState Current
        {
            [MethodImpl(MethodImplOptions.AggressiveInlining)]
            get
            {
                ref readonly BusNode n = ref _nodes[_index];
                return new AudioBusState(
                    n.Definition.Id,
                    n.Definition.ParentId,
                    n.Definition.Volume,
                    n.Definition.Mute,
                    n.Definition.Pan,
                    n.EffectiveGain,
                    n.ChildCount,
                    n.Definition.Metadata);
            }
        }
    }

    private AudioBusState UpsertInternal(in AudioBusDefinition definition)
    {
        uint idx = definition.Id.Value;
        if (idx >= (uint)_maxBuses)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-bus", "Bus id exceeds registry bounds.");
        }

        ValidateParentWrite(definition.Id, definition.ParentId, idx);
        CancelRamp((int)idx);
        _nodes[idx].Definition = definition;
        _nodes[idx].IsActive = true;
        return BuildBusState((int)idx);
    }

    private void ValidateParentWrite(AudioBusId id, AudioBusId parentId, uint idx)
    {
        uint p = parentId.Value;
        if (p == 0U)
        {
            return;
        }

        if (p == idx)
        {
            throw new AudioBusCycleException(id, parentId);
        }

        if (p >= (uint)_maxBuses)
        {
            AudioThrowHelper.ThrowConfig("audio.invalid-bus", "Parent bus id exceeds registry bounds.");
        }

        // Re-applying the parent a node already has cannot change the graph.
        if (_nodes[idx].IsActive && _nodes[idx].Definition.ParentId.Value == p)
        {
            return;
        }

        // The write is a cycle when this bus is reachable by walking parents
        // up from the proposed parent. Gain resolution would then recurse
        // without bound, so reject before the write commits and
        // RebuildHierarchyTopology never sees a loop.
        if (_nodes[p].IsActive && IsAncestorPathCyclic((int)p, idx))
        {
            throw new AudioBusCycleException(id, parentId);
        }
    }

    private int CountActive()
    {
        int count = 0;
        for (int i = 0; i < _maxBuses; i++)
        {
            if (_nodes[i].IsActive)
            {
                count++;
            }
        }

        return count;
    }

    private AudioBusId ResolveFallbackParent(AudioBusId parentId, uint removedIdx)
    {
        uint p = parentId.Value;
        if (p == 0U || p == removedIdx || p >= (uint)_maxBuses || !_nodes[p].IsActive)
        {
            return AudioBusId.Master;
        }

        return parentId;
    }

    private bool RestoreTopology(ref BusNode node, AudioBusId targetParent)
    {
        if (node.Definition.ParentId == targetParent)
        {
            return false;
        }

        uint self = node.Definition.Id.Value;
        uint p = targetParent.Value;
        if (p == self || (p != 0U && (p >= (uint)_maxBuses || !_nodes[p].IsActive)))
        {
            return false;
        }

        // Restoring a captured parent is only safe while the parent is not a
        // descendant of this bus anymore; otherwise the hierarchy would become
        // cyclic and gain resolution would not terminate.
        if (p != 0U && IsAncestorPathCyclic((int)p, self))
        {
            return false;
        }

        node.Definition = node.Definition with { ParentId = targetParent };
        return true;
    }

    private bool IsAncestorPathCyclic(int startIdx, uint stopId)
    {
        int cursor = startIdx;
        for (int steps = 0; steps < _maxBuses; steps++)
        {
            if ((uint)cursor == stopId)
            {
                return true;
            }

            uint parent = _nodes[cursor].Definition.ParentId.Value;
            if (parent == 0U || parent >= (uint)_maxBuses || !_nodes[parent].IsActive || parent == (uint)cursor)
            {
                return false;
            }

            cursor = (int)parent;
        }

        return true;
    }

    private static void CommitTarget(ref BusNode node, in AudioMixerSnapshotEntry entry)
    {
        node.Definition = node.Definition with
        {
            Volume = entry.Volume,
            Mute = entry.Mute,
            Pan = entry.Pan,
        };
    }

    private void EvaluateRamps(double clock)
    {
        int remaining = 0;
        for (int i = 0; i < _maxBuses; i++)
        {
            ref BusRamp ramp = ref _ramps[i];
            if (!ramp.IsActive)
            {
                continue;
            }

            if (!_nodes[i].IsActive)
            {
                ramp = default;
                continue;
            }

            if (clock < ramp.StartSeconds)
            {
                remaining++;
                continue;
            }

            ref BusNode node = ref _nodes[i];
            if (!ramp.MuteApplied)
            {
                node.Definition = node.Definition with { Mute = ramp.ToMute };
                ramp.MuteApplied = true;
            }

            float t = MixerRamp.Progress(clock, ramp.StartSeconds, ramp.EndSeconds);
            node.Definition = node.Definition with
            {
                Volume = MixerRamp.Interpolate(ramp.Curve, ramp.FromVolume, ramp.ToVolume, t),
                Pan = MixerRamp.Interpolate(ramp.Curve, ramp.FromPan, ramp.ToPan, t),
            };

            if (t >= 1.0f)
            {
                ramp = default;
                continue;
            }

            remaining++;
        }

        int previous = Interlocked.Exchange(ref _activeRampCount, remaining);
        if (remaining != 0 || previous != 0)
        {
            RebuildHierarchyTopology();
        }
    }

    private bool CancelRamp(int idx)
    {
        ref BusRamp ramp = ref _ramps[idx];
        if (!ramp.IsActive)
        {
            return false;
        }

        ramp = default;
        Interlocked.Decrement(ref _activeRampCount);
        return true;
    }

    private void RebuildHierarchyTopology()
    {
        for (int i = 0; i < _maxBuses; i++)
        {
            _nodes[i].ChildCount = 0;
        }

        for (int i = 0; i < _maxBuses; i++)
        {
            if (!_nodes[i].IsActive)
            {
                continue;
            }

            uint parentIdx = _nodes[i].Definition.ParentId.Value;
            if (parentIdx != 0U && parentIdx < (uint)_maxBuses && _nodes[parentIdx].IsActive && parentIdx != (uint)i)
            {
                int count = _nodes[parentIdx].ChildCount;
                _childrenIndices[parentIdx][count] = i;
                _nodes[parentIdx].ChildCount = count + 1;
            }
        }

        Span<bool> visited = stackalloc bool[_maxBuses];
        for (int i = 0; i < _maxBuses; i++)
        {
            if (_nodes[i].IsActive && !visited[i])
            {
                ComputeGainsRecursive(i, visited);
            }
        }
    }

    private float ComputeGainsRecursive(int idx, Span<bool> visited)
    {
        if (visited[idx])
        {
            return _nodes[idx].EffectiveGain;
        }

        ref BusNode node = ref _nodes[idx];
        if (!node.IsActive)
        {
            return 0.0f;
        }

        // Mark on entry: even if an upstream guard is ever bypassed, a cyclic
        // parent chain terminates here instead of overflowing the stack.
        visited[idx] = true;

        if (node.Definition.Mute)
        {
            node.EffectiveGain = 0.0f;
            return 0.0f;
        }

        float parentGain = 1.0f;
        uint p = node.Definition.ParentId.Value;
        if (p != 0U && p < (uint)_maxBuses && p != (uint)idx)
        {
            parentGain = ComputeGainsRecursive((int)p, visited);
        }

        node.EffectiveGain = Math.Clamp(node.Definition.Volume, 0.0f, 4.0f) * parentGain;
        return node.EffectiveGain;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private AudioBusState BuildBusState(int idx)
    {
        ref BusNode n = ref _nodes[idx];
        return new AudioBusState(
            n.Definition.Id,
            n.Definition.ParentId,
            n.Definition.Volume,
            n.Definition.Mute,
            n.Definition.Pan,
            n.EffectiveGain,
            n.ChildCount,
            n.Definition.Metadata);
    }
}
