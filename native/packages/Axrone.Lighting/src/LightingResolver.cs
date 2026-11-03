namespace Axrone.Lighting;

/// <summary>Compile-time monomorphized frame resolver.</summary>
public sealed class LightingFrameResolver
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct ScoredCandidate
    {
        public LightData Light;
        public float Score;
        public ulong Sequence;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly record struct MemoizedKey(
        RigId RigId,
        RigVersion Version,
        ushort PolicyId,
        bool HasCamera,
        Vec3 CameraPosition)
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool Matches(RigId rigId, RigVersion version, ushort policyId, in Vec3? camera)
        {
            if (RigId != rigId || Version != version || PolicyId != policyId || HasCamera != camera.HasValue)
            {
                return false;
            }

            return !camera.HasValue || CameraPosition == camera.Value;
        }
    }

    /// <summary>Resolver capacity.</summary>
    public LightingCapacity Capacity { get; }

    private readonly float[] _directionalDirections;
    private readonly float[] _directionalColors;
    private readonly float[] _directionalAmbientColors;
    private readonly float[] _directionalIntensities;

    private readonly float[] _pointPositions;
    private readonly float[] _pointColors;
    private readonly float[] _pointIntensities;
    private readonly float[] _pointRanges;
    private readonly float[] _pointAttenuations;

    private readonly float[] _spotPositions;
    private readonly float[] _spotDirections;
    private readonly float[] _spotColors;
    private readonly float[] _spotIntensities;
    private readonly float[] _spotRanges;
    private readonly float[] _spotInnerConeCosines;
    private readonly float[] _spotOuterConeCosines;

    private readonly int[] _localKinds;
    private readonly float[] _localPositions;
    private readonly float[] _localDirections;
    private readonly float[] _localColors;
    private readonly float[] _localIntensities;
    private readonly float[] _localRanges;
    private readonly float[] _localAttenuations;
    private readonly float[] _localInnerConeCosines;
    private readonly float[] _localOuterConeCosines;

    private readonly ScoredCandidate[] _directionalScratch;
    private readonly ScoredCandidate[] _pointScratch;
    private readonly ScoredCandidate[] _spotScratch;
    private readonly ScoredCandidate[] _localScratch;

    private LightData[] _snapshotBuffer;
    private readonly LightingSelectionState _selectionState;

    private MemoizedKey _cacheKey;
    private bool _hasCacheKey;

    /// <summary>Creates a resolver.</summary>
    public LightingFrameResolver(in LightingCapacity? capacity = null)
    {
        Capacity = capacity ?? LightingCapacity.Default;

        int maxDir = Capacity.MaxDirectionalLights;
        int maxPoint = Capacity.MaxPointLights;
        int maxSpot = Capacity.MaxSpotLights;
        int maxLocal = Capacity.MaxLocalLights;

        _directionalDirections = GC.AllocateArray<float>(Math.Max(1, maxDir * 3), pinned: true);
        _directionalColors = GC.AllocateArray<float>(Math.Max(1, maxDir * 3), pinned: true);
        _directionalAmbientColors = GC.AllocateArray<float>(Math.Max(1, maxDir * 3), pinned: true);
        _directionalIntensities = GC.AllocateArray<float>(Math.Max(1, maxDir), pinned: true);

        _pointPositions = GC.AllocateArray<float>(Math.Max(1, maxPoint * 3), pinned: true);
        _pointColors = GC.AllocateArray<float>(Math.Max(1, maxPoint * 3), pinned: true);
        _pointIntensities = GC.AllocateArray<float>(Math.Max(1, maxPoint), pinned: true);
        _pointRanges = GC.AllocateArray<float>(Math.Max(1, maxPoint), pinned: true);
        _pointAttenuations = GC.AllocateArray<float>(Math.Max(1, maxPoint), pinned: true);

        _spotPositions = GC.AllocateArray<float>(Math.Max(1, maxSpot * 3), pinned: true);
        _spotDirections = GC.AllocateArray<float>(Math.Max(1, maxSpot * 3), pinned: true);
        _spotColors = GC.AllocateArray<float>(Math.Max(1, maxSpot * 3), pinned: true);
        _spotIntensities = GC.AllocateArray<float>(Math.Max(1, maxSpot), pinned: true);
        _spotRanges = GC.AllocateArray<float>(Math.Max(1, maxSpot), pinned: true);
        _spotInnerConeCosines = GC.AllocateArray<float>(Math.Max(1, maxSpot), pinned: true);
        _spotOuterConeCosines = GC.AllocateArray<float>(Math.Max(1, maxSpot), pinned: true);

        _localKinds = GC.AllocateArray<int>(Math.Max(1, maxLocal), pinned: true);
        _localPositions = GC.AllocateArray<float>(Math.Max(1, maxLocal * 3), pinned: true);
        _localDirections = GC.AllocateArray<float>(Math.Max(1, maxLocal * 3), pinned: true);
        _localColors = GC.AllocateArray<float>(Math.Max(1, maxLocal * 3), pinned: true);
        _localIntensities = GC.AllocateArray<float>(Math.Max(1, maxLocal), pinned: true);
        _localRanges = GC.AllocateArray<float>(Math.Max(1, maxLocal), pinned: true);
        _localAttenuations = GC.AllocateArray<float>(Math.Max(1, maxLocal), pinned: true);
        _localInnerConeCosines = GC.AllocateArray<float>(Math.Max(1, maxLocal), pinned: true);
        _localOuterConeCosines = GC.AllocateArray<float>(Math.Max(1, maxLocal), pinned: true);

        _directionalScratch = new ScoredCandidate[maxDir];
        _pointScratch = new ScoredCandidate[maxPoint];
        _spotScratch = new ScoredCandidate[maxSpot];
        _localScratch = new ScoredCandidate[maxLocal];

        _snapshotBuffer = new LightData[64];
        _selectionState = new LightingSelectionState();
    }

    /// <summary>Resolves a frame with a scoring policy.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public LightingSelectionState Resolve<TPolicy>(LightingRig rig, in ResolveOptions options = default)
        where TPolicy : struct, ILightScoringPolicy
    {
        ArgumentNullException.ThrowIfNull(rig);

        if (!rig.TryAcquireReader(out RigVersion currentVersion))
        {
            ThrowHelper.ThrowDisposed(rig.Id);
        }

        try
        {
            Vec3? camera = options.CameraPosition;

            if (_hasCacheKey && _cacheKey.Matches(rig.Id, currentVersion, TPolicy.PolicyId, camera))
            {
                return _selectionState;
            }

            int lightCount = 0;
            EnsureSnapshotCapacity(rig.Count);
            rig.SnapshotStorage(_snapshotBuffer, ref lightCount);

            int totalLights = 0;
            int totalDir = 0;
            int totalPoint = 0;
            int totalSpot = 0;

            int selDirCount = 0;
            int selPointCount = 0;
            int selSpotCount = 0;
            int selLocalCount = 0;

            Span<ScoredCandidate> dirScratch = _directionalScratch;
            Span<ScoredCandidate> ptScratch = _pointScratch;
            Span<ScoredCandidate> spScratch = _spotScratch;
            Span<ScoredCandidate> locScratch = _localScratch;

            ReadOnlySpan<LightData> lights = _snapshotBuffer.AsSpan(0, lightCount);
            Vec3 camPos = camera.GetValueOrDefault();
            bool hasCam = camera.HasValue;

            for (int i = 0; i < lights.Length; i++)
            {
                ref readonly LightData light = ref lights[i];
                if (!light.IsEnabled)
                {
                    continue;
                }

                totalLights++;
                ulong seq = light.Sequence;

                switch (light.Type)
                {
                    case LightType.Directional:
                        {
                            totalDir++;
                            float score = TPolicy.ScoreDirectional(in light);
                            InsertCandidate(dirScratch, ref selDirCount, Capacity.MaxDirectionalLights, in light, score, seq);
                            break;
                        }

                    case LightType.Point:
                        {
                            totalPoint++;
                            float score = TPolicy.ScorePoint(in light, in camPos, hasCam);
                            InsertCandidate(ptScratch, ref selPointCount, Capacity.MaxPointLights, in light, score, seq);
                            InsertCandidate(locScratch, ref selLocalCount, Capacity.MaxLocalLights, in light, score, seq);
                            break;
                        }

                    case LightType.Spot:
                        {
                            totalSpot++;
                            float score = TPolicy.ScoreSpot(in light, in camPos, hasCam);
                            InsertCandidate(spScratch, ref selSpotCount, Capacity.MaxSpotLights, in light, score, seq);
                            InsertCandidate(locScratch, ref selLocalCount, Capacity.MaxLocalLights, in light, score, seq);
                            break;
                        }

                    default:
                        break;
                }
            }

            FillDirectionalBuffers(dirScratch, selDirCount);
            FillPointBuffers(ptScratch, selPointCount);
            FillSpotBuffers(spScratch, selSpotCount);
            FillLocalBuffers(locScratch, selLocalCount);

            _selectionState.DirectionalDirections = new GpuBufferView<float>(_directionalDirections, 3, selDirCount);
            _selectionState.DirectionalColors = new GpuBufferView<float>(_directionalColors, 3, selDirCount);
            _selectionState.DirectionalAmbientColors = new GpuBufferView<float>(_directionalAmbientColors, 3, selDirCount);
            _selectionState.DirectionalIntensities = new GpuBufferView<float>(_directionalIntensities, 1, selDirCount);

            _selectionState.PointPositions = new GpuBufferView<float>(_pointPositions, 3, selPointCount);
            _selectionState.PointColors = new GpuBufferView<float>(_pointColors, 3, selPointCount);
            _selectionState.PointIntensities = new GpuBufferView<float>(_pointIntensities, 1, selPointCount);
            _selectionState.PointRanges = new GpuBufferView<float>(_pointRanges, 1, selPointCount);
            _selectionState.PointAttenuations = new GpuBufferView<float>(_pointAttenuations, 1, selPointCount);

            _selectionState.SpotPositions = new GpuBufferView<float>(_spotPositions, 3, selSpotCount);
            _selectionState.SpotDirections = new GpuBufferView<float>(_spotDirections, 3, selSpotCount);
            _selectionState.SpotColors = new GpuBufferView<float>(_spotColors, 3, selSpotCount);
            _selectionState.SpotIntensities = new GpuBufferView<float>(_spotIntensities, 1, selSpotCount);
            _selectionState.SpotRanges = new GpuBufferView<float>(_spotRanges, 1, selSpotCount);
            _selectionState.SpotInnerConeCosines = new GpuBufferView<float>(_spotInnerConeCosines, 1, selSpotCount);
            _selectionState.SpotOuterConeCosines = new GpuBufferView<float>(_spotOuterConeCosines, 1, selSpotCount);

            _selectionState.LocalKinds = new GpuBufferView<int>(_localKinds, 1, selLocalCount);
            _selectionState.LocalPositions = new GpuBufferView<float>(_localPositions, 3, selLocalCount);
            _selectionState.LocalDirections = new GpuBufferView<float>(_localDirections, 3, selLocalCount);
            _selectionState.LocalColors = new GpuBufferView<float>(_localColors, 3, selLocalCount);
            _selectionState.LocalIntensities = new GpuBufferView<float>(_localIntensities, 1, selLocalCount);
            _selectionState.LocalRanges = new GpuBufferView<float>(_localRanges, 1, selLocalCount);
            _selectionState.LocalAttenuations = new GpuBufferView<float>(_localAttenuations, 1, selLocalCount);
            _selectionState.LocalInnerConeCosines = new GpuBufferView<float>(_localInnerConeCosines, 1, selLocalCount);
            _selectionState.LocalOuterConeCosines = new GpuBufferView<float>(_localOuterConeCosines, 1, selLocalCount);

            _selectionState.Stats = new LightingStats(
                TotalLightCount: totalLights,
                TotalDirectionalCount: totalDir,
                TotalPointCount: totalPoint,
                TotalSpotCount: totalSpot,
                SelectedDirectionalCount: selDirCount,
                SelectedPointCount: selPointCount,
                SelectedSpotCount: selSpotCount,
                SelectedLocalLightCount: selLocalCount,
                OmittedDirectionalCount: totalDir - selDirCount,
                OmittedPointCount: totalPoint - selPointCount,
                OmittedSpotCount: totalSpot - selSpotCount,
                OmittedLocalLightCount: (totalPoint + totalSpot) - selLocalCount);

            _selectionState.Environment = rig.Environment;

            _cacheKey = new MemoizedKey(rig.Id, currentVersion, TPolicy.PolicyId, hasCam, camPos);
            _hasCacheKey = true;

            return _selectionState;
        }
        finally
        {
            rig.ReleaseReader();
        }
    }

    /// <summary>Resolves a frame with a sort strategy.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public LightingSelectionState Resolve(LightingRig rig, in ResolveOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(rig);

        return options.SortStrategy switch
        {
            LightSortStrategy.Priority => Resolve<PriorityScoringPolicy>(rig, options),
            LightSortStrategy.None => Resolve<FifoScoringPolicy>(rig, options),
            _ => Resolve<InfluenceScoringPolicy>(rig, options),
        };
    }

    private void EnsureSnapshotCapacity(int capacity)
    {
        if (_snapshotBuffer.Length < capacity)
        {
            int newCap = (int)BitOperations.RoundUpToPowerOf2((uint)Math.Max(capacity, 16));
            _snapshotBuffer = new LightData[newCap];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void InsertCandidate(
        Span<ScoredCandidate> scratch,
        ref int count,
        int capacity,
        in LightData light,
        float score,
        ulong sequence)
    {
        if (capacity <= 0)
        {
            return;
        }

        if (count < capacity)
        {
            int i = count - 1;
            while (i >= 0 && ShouldPrecede(score, sequence, scratch[i].Score, scratch[i].Sequence))
            {
                scratch[i + 1] = scratch[i];
                i--;
            }

            scratch[i + 1] = new ScoredCandidate { Light = light, Score = score, Sequence = sequence };
            count++;
        }
        else
        {
            if (!ShouldPrecede(score, sequence, scratch[capacity - 1].Score, scratch[capacity - 1].Sequence))
            {
                return;
            }

            int i = capacity - 2;
            while (i >= 0 && ShouldPrecede(score, sequence, scratch[i].Score, scratch[i].Sequence))
            {
                scratch[i + 1] = scratch[i];
                i--;
            }

            scratch[i + 1] = new ScoredCandidate { Light = light, Score = score, Sequence = sequence };
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool ShouldPrecede(float scoreA, ulong seqA, float scoreB, ulong seqB)
    {
        if (scoreA > scoreB)
        {
            return true;
        }

        if (scoreA < scoreB)
        {
            return false;
        }

        return seqA < seqB;
    }

    private void FillDirectionalBuffers(ReadOnlySpan<ScoredCandidate> selected, int count)
    {
        Span<float> dirs = _directionalDirections.AsSpan();
        Span<float> colors = _directionalColors.AsSpan();
        Span<float> ambients = _directionalAmbientColors.AsSpan();
        Span<float> intensities = _directionalIntensities.AsSpan();

        for (int i = 0; i < count; i++)
        {
            ref readonly LightData d = ref selected[i].Light;
            int idx3 = i * 3;

            dirs[idx3 + 0] = d.Direction.X;
            dirs[idx3 + 1] = d.Direction.Y;
            dirs[idx3 + 2] = d.Direction.Z;

            colors[idx3 + 0] = d.Color.X;
            colors[idx3 + 1] = d.Color.Y;
            colors[idx3 + 2] = d.Color.Z;

            ambients[idx3 + 0] = d.Ambient.X;
            ambients[idx3 + 1] = d.Ambient.Y;
            ambients[idx3 + 2] = d.Ambient.Z;

            intensities[i] = d.Intensity.Value;
        }
    }

    private void FillPointBuffers(ReadOnlySpan<ScoredCandidate> selected, int count)
    {
        Span<float> positions = _pointPositions.AsSpan();
        Span<float> colors = _pointColors.AsSpan();
        Span<float> intensities = _pointIntensities.AsSpan();
        Span<float> ranges = _pointRanges.AsSpan();
        Span<float> attenuations = _pointAttenuations.AsSpan();

        for (int i = 0; i < count; i++)
        {
            ref readonly LightData p = ref selected[i].Light;
            int idx3 = i * 3;

            positions[idx3 + 0] = p.Position.X;
            positions[idx3 + 1] = p.Position.Y;
            positions[idx3 + 2] = p.Position.Z;

            colors[idx3 + 0] = p.Color.X;
            colors[idx3 + 1] = p.Color.Y;
            colors[idx3 + 2] = p.Color.Z;

            intensities[i] = p.Intensity.Value;
            ranges[i] = p.Range.Value;
            attenuations[i] = p.Attenuation.Value;
        }
    }

    private void FillSpotBuffers(ReadOnlySpan<ScoredCandidate> selected, int count)
    {
        Span<float> positions = _spotPositions.AsSpan();
        Span<float> dirs = _spotDirections.AsSpan();
        Span<float> colors = _spotColors.AsSpan();
        Span<float> intensities = _spotIntensities.AsSpan();
        Span<float> ranges = _spotRanges.AsSpan();
        Span<float> inCones = _spotInnerConeCosines.AsSpan();
        Span<float> outCones = _spotOuterConeCosines.AsSpan();

        for (int i = 0; i < count; i++)
        {
            ref readonly LightData s = ref selected[i].Light;
            int idx3 = i * 3;

            positions[idx3 + 0] = s.Position.X;
            positions[idx3 + 1] = s.Position.Y;
            positions[idx3 + 2] = s.Position.Z;

            dirs[idx3 + 0] = s.Direction.X;
            dirs[idx3 + 1] = s.Direction.Y;
            dirs[idx3 + 2] = s.Direction.Z;

            colors[idx3 + 0] = s.Color.X;
            colors[idx3 + 1] = s.Color.Y;
            colors[idx3 + 2] = s.Color.Z;

            intensities[i] = s.Intensity.Value;
            ranges[i] = s.Range.Value;
            inCones[i] = s.InnerConeCosine.Value;
            outCones[i] = s.OuterConeCosine.Value;
        }
    }

    private void FillLocalBuffers(ReadOnlySpan<ScoredCandidate> selected, int count)
    {
        Span<int> kinds = _localKinds.AsSpan();
        Span<float> positions = _localPositions.AsSpan();
        Span<float> dirs = _localDirections.AsSpan();
        Span<float> colors = _localColors.AsSpan();
        Span<float> intensities = _localIntensities.AsSpan();
        Span<float> ranges = _localRanges.AsSpan();
        Span<float> attenuations = _localAttenuations.AsSpan();
        Span<float> inCones = _localInnerConeCosines.AsSpan();
        Span<float> outCones = _localOuterConeCosines.AsSpan();

        for (int i = 0; i < count; i++)
        {
            ref readonly LightData l = ref selected[i].Light;
            int idx3 = i * 3;

            kinds[i] = (int)l.Type;

            positions[idx3 + 0] = l.Position.X;
            positions[idx3 + 1] = l.Position.Y;
            positions[idx3 + 2] = l.Position.Z;

            dirs[idx3 + 0] = l.Direction.X;
            dirs[idx3 + 1] = l.Direction.Y;
            dirs[idx3 + 2] = l.Direction.Z;

            colors[idx3 + 0] = l.Color.X;
            colors[idx3 + 1] = l.Color.Y;
            colors[idx3 + 2] = l.Color.Z;

            intensities[i] = l.Intensity.Value;
            ranges[i] = l.Range.Value;
            attenuations[i] = l.Attenuation.Value;
            inCones[i] = l.Type == LightType.Spot ? l.InnerConeCosine.Value : 0.0f;
            outCones[i] = l.Type == LightType.Spot ? l.OuterConeCosine.Value : 0.0f;
        }
    }
}
