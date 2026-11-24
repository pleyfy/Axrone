namespace Axrone.Animation;

/// <summary>Blend-tree motion kind.</summary>
public enum MotionKind
{
    /// <summary>Single clip.</summary>
    Clip = 0,

    /// <summary>One-parameter blend.</summary>
    Blend1D = 1,

    /// <summary>Two-parameter blend.</summary>
    Blend2D = 2,

    /// <summary>Per-child weight blend.</summary>
    Direct = 3,

    /// <summary>Rest-relative additive layer.</summary>
    Additive = 4,

    /// <summary>Database-selected clip sample.</summary>
    MotionMatching = 5,
}

/// <summary>Evaluatable motion node: clips and blends share one recursive contract.</summary>
public abstract class MotionNode
{
    /// <summary>Node kind.</summary>
    public abstract MotionKind Kind { get; }

    /// <summary>Playback rate multiplier.</summary>
    public float TimeScale { get; init; } = 1.0f;

    /// <summary>Cycle offset in normalized time.</summary>
    public float CycleOffset { get; init; }

    /// <summary>Wall-clock duration at unit speed.</summary>
    public abstract float GetDuration();

    /// <summary>Evaluates into a frame; depth guards recursion.</summary>
    public abstract void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth);

    /// <summary>
    /// Resolves string/dictionary lookups to handles once (bind time). Partial:
    /// resolves whichever context parts are present. Idempotent.
    /// </summary>
    public abstract void Bind(in MotionBindingContext context);

    /// <summary>Root-joint delta between two normalized times.</summary>
    public abstract void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot);

    /// <summary>Collects clip events into a zero-allocation sink.</summary>
    public abstract void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
        where TSink : struct, IClipEventSink;

    /// <summary>Collects clip events in the interval, scaled by layer weight.</summary>
    public abstract void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents);
}

/// <summary>Leaf node: samples one clip with time scale and cycle offset honored.</summary>
public sealed class ClipMotionNode : MotionNode
{
    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.Clip;

    /// <summary>Sampled clip.</summary>
    public AnimationClip Clip { get; }

    /// <summary>Whether time wraps at the clip end.</summary>
    public bool IsLooping { get; init; } = true;

    /// <summary>Creates a leaf.</summary>
    public ClipMotionNode(AnimationClip clip)
    {
        ArgumentNullException.ThrowIfNull(clip);
        Clip = clip;
    }

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context) => Clip.Bind(in context);

    /// <inheritdoc/>
    public override float GetDuration()
    {
        float speed = MathF.Abs(TimeScale);
        return speed > AnimationConstants.SoaEpsilon ? Clip.Duration / speed : Clip.Duration;
    }

    /// <inheritdoc/>
    public override void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth)
    {
        outFrame.ResetToRest(rig);
        float scaled = (normalizedTime * TimeScale) + CycleOffset;
        float time = IsLooping
            ? FastMath.WrapTime(scaled * Clip.Duration, Clip.Duration)
            : Math.Clamp(scaled * Clip.Duration, 0.0f, Clip.Duration);
        Clip.Sample(time, outFrame, IsLooping);
    }

    /// <inheritdoc/>
    [SkipLocalsInit]
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        float duration = Clip.Duration;
        if (duration <= AnimationConstants.SoaEpsilon || Clip.Channels.Length == 0)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        float t0 = MapTime(prevNormTime, duration);
        float t1 = MapTime(curNormTime, duration);

        Span<float> buf0 = stackalloc float[4];
        Span<float> buf1 = stackalloc float[4];
        Span<float> bufEnd = stackalloc float[4];
        Span<float> bufStart = stackalloc float[4];

        Vec3 p0 = Vec3.Zero;
        Vec3 p1 = Vec3.Zero;
        Quat r0 = Quat.Identity;
        Quat r1 = Quat.Identity;

        foreach (AnimationChannel channel in Clip.Channels)
        {
            if (channel.BoneIndex != 0 || channel.IsEmpty)
            {
                continue;
            }

            if (channel.Target == ChannelTarget.Translation)
            {
                channel.Sample(t0, buf0);
                p0 = new Vec3(buf0[0], buf0[1], buf0[2]);
                channel.Sample(t1, buf1);
                p1 = new Vec3(buf1[0], buf1[1], buf1[2]);
            }
            else if (channel.Target == ChannelTarget.Rotation)
            {
                channel.Sample(t0, buf0);
                r0 = new Quat(buf0[0], buf0[1], buf0[2], buf0[3]);
                channel.Sample(t1, buf1);
                r1 = new Quat(buf1[0], buf1[1], buf1[2], buf1[3]);
            }
        }

        deltaPos = p1 - p0;
        deltaRot = Quat.Normalize(Quat.Inverse(r0) * r1);
        if (t1 >= t0)
        {
            return;
        }

        foreach (AnimationChannel channel in Clip.Channels)
        {
            if (channel.BoneIndex != 0 || channel.IsEmpty)
            {
                continue;
            }

            if (channel.Target == ChannelTarget.Translation)
            {
                channel.Sample(duration, bufEnd);
                channel.Sample(0.0f, bufStart);
                Vec3 pEnd = new(bufEnd[0], bufEnd[1], bufEnd[2]);
                Vec3 pStart = new(bufStart[0], bufStart[1], bufStart[2]);
                deltaPos = (pEnd - p0) + (p1 - pStart);
            }
            else if (channel.Target == ChannelTarget.Rotation)
            {
                channel.Sample(duration, bufEnd);
                channel.Sample(0.0f, bufStart);
                Quat rEnd = new(bufEnd[0], bufEnd[1], bufEnd[2], bufEnd[3]);
                Quat rStart = new(bufStart[0], bufStart[1], bufStart[2], bufStart[3]);
                deltaRot = Quat.Normalize((Quat.Inverse(rStart) * r1) * (Quat.Inverse(r0) * rEnd));
            }
        }
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        float duration = Clip.Duration;
        float t0 = MapTime(prevNormTime, duration);
        float t1 = MapTime(curNormTime, duration);
        Clip.CollectEvents(t0, t1, ref sink);
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private float MapTime(float normalizedTime, float duration)
    {
        float scaled = (normalizedTime * TimeScale) + CycleOffset;
        float time = scaled * duration;
        return IsLooping ? FastMath.WrapTime(time, duration) : Math.Clamp(time, 0.0f, duration);
    }
}

/// <summary>Segment bracketing a Blend1D parameter value.</summary>
public readonly record struct Blend1DSegment(int Index0, int Index1, float Weight);

/// <summary>Weighting strategy for a two-parameter blend.</summary>
public enum Blend2DMode
{
    /// <summary>Inverse-distance weights over every child (smooth outside the hull too).</summary>
    InverseDistance = 0,

    /// <summary>Barycentric weights inside the precomputed Delaunay hull; inverse distance outside.</summary>
    Freeform = 1,
}

/// <summary>One-parameter blend over sorted threshold children.</summary>
public sealed class Blend1DMotionNode : MotionNode
{
    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.Blend1D;

    private readonly float[] _thresholds;
    private readonly MotionNode[] _children;
    private ParameterHandle _parameterHandle;
    private bool _parameterBound;

    /// <summary>Driving parameter name.</summary>
    public string ParameterName { get; }

    /// <summary>Sorted thresholds.</summary>
    public ReadOnlySpan<float> Thresholds => _thresholds;

    /// <summary>Children aligned with thresholds.</summary>
    public ReadOnlySpan<MotionNode> Children => _children;

    /// <summary>Creates a blend; entries sort by threshold.</summary>
    public Blend1DMotionNode(string parameterName, (float Threshold, MotionNode Child)[] entries)
    {
        ArgumentNullException.ThrowIfNull(parameterName);
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Length == 0)
        {
            AnimationThrowHelper.ThrowCompilation(AnimationErrorCode.CompilationEmptyChildren, "Blend1D requires at least one child.");
        }

        Array.Sort(entries, static (a, b) => a.Threshold.CompareTo(b.Threshold));
        ParameterName = parameterName;
        _thresholds = new float[entries.Length];
        _children = new MotionNode[entries.Length];
        for (int i = 0; i < entries.Length; i++)
        {
            _thresholds[i] = entries[i].Threshold;
            _children[i] = entries[i].Child;
        }
    }

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            _parameterHandle = context.Parameters.ResolveHandle(ParameterName);
            _parameterBound = true;
        }

        MotionNode[] children = _children;
        for (int i = 0; i < children.Length; i++)
        {
            children[i].Bind(in context);
        }
    }

    /// <summary>Finds the bracketing segment: linear scan for few children, binary beyond.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Blend1DSegment FindSegment(float paramValue)
    {
        int length = _thresholds.Length;
        if (length == 1 || paramValue <= _thresholds[0])
        {
            return new Blend1DSegment(0, 0, 1.0f);
        }

        if (paramValue >= _thresholds[length - 1])
        {
            return new Blend1DSegment(length - 1, length - 1, 1.0f);
        }

        int index0 = 0;
        if (length <= AnimationConstants.Blend1DLinearScanLimit)
        {
            for (int i = 0; i < length - 1; i++)
            {
                if (paramValue <= _thresholds[i + 1])
                {
                    index0 = i;
                    break;
                }
            }
        }
        else
        {
            int probe = Array.BinarySearch(_thresholds, paramValue);
            index0 = probe >= 0 ? probe : ~probe - 1;
        }

        int index1 = index0 + 1;
        float span = _thresholds[index1] - _thresholds[index0];
        float weight = span > AnimationConstants.SoaEpsilon ? (paramValue - _thresholds[index0]) / span : 0.0f;
        return new Blend1DSegment(index0, index1, FastMath.Clamp01(weight));
    }

    /// <inheritdoc/>
    public override float GetDuration()
    {
        if (Children.Length == 0)
        {
            return 0.0f;
        }

        float sum = 0.0f;
        for (int i = 0; i < Children.Length; i++)
        {
            sum += MotionDispatcher.GetDuration(Children[i]);
        }

        return sum / Children.Length;
    }

    /// <summary>Duration of the active segment, interpolated by blend weight.</summary>
    public float GetDuration(ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        Blend1DSegment segment = FindSegment(ReadParameter(parameters));
        if (segment.Index0 == segment.Index1 || segment.Weight <= 0.0f)
        {
            return MotionDispatcher.GetDuration(Children[segment.Index0], parameters);
        }

        float from = MotionDispatcher.GetDuration(Children[segment.Index0], parameters);
        float to = MotionDispatcher.GetDuration(Children[segment.Index1], parameters);
        return from + ((to - from) * segment.Weight);
    }

    /// <summary>Root delta of the active segment, interpolated by blend weight.</summary>
    public void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, ParameterStore parameters, out Vec3 deltaPos, out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        Blend1DSegment segment = FindSegment(ReadParameter(parameters));
        if (segment.Index0 == segment.Index1 || segment.Weight <= 0.0f)
        {
            MotionDispatcher.ComputeRootDelta(Children[segment.Index0], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
            return;
        }

        if (segment.Weight >= 1.0f)
        {
            MotionDispatcher.ComputeRootDelta(Children[segment.Index1], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
            return;
        }

        MotionDispatcher.ComputeRootDelta(Children[segment.Index0], prevNormTime, curNormTime, rig, out Vec3 fromPos, out Quat fromRot);
        MotionDispatcher.ComputeRootDelta(Children[segment.Index1], prevNormTime, curNormTime, rig, out Vec3 toPos, out Quat toRot);
        deltaPos = Vec3.Lerp(fromPos, toPos, segment.Weight);
        deltaRot = FastMath.Slerp(fromRot, toRot, segment.Weight);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private float ReadParameter(ParameterStore parameters) =>
        _parameterBound ? parameters.GetFloat(in _parameterHandle) : parameters.GetFloat(ParameterName);

    /// <inheritdoc/>
    public override void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        ArgumentNullException.ThrowIfNull(arena);
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        if (depth >= AnimationConstants.MaxBlendDepth)
        {
            AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationDepthOverflow, "Maximum blend recursion depth exceeded.");
        }

        float paramValue = _parameterBound
            ? parameters.GetFloat(in _parameterHandle)
            : parameters.GetFloat(ParameterName);
        Blend1DSegment segment = FindSegment(paramValue);

        if (segment.Index0 == segment.Index1 || segment.Weight <= 0.0f)
        {
            MotionDispatcher.Evaluate(Children[segment.Index0], normalizedTime, outFrame, arena, rig, parameters, depth + 1);
            return;
        }

        if (segment.Weight >= 1.0f)
        {
            MotionDispatcher.Evaluate(Children[segment.Index1], normalizedTime, outFrame, arena, rig, parameters, depth + 1);
            return;
        }

        AnimationFrame frame0 = arena.Alloc();
        AnimationFrame frame1 = arena.Alloc();

        MotionDispatcher.Evaluate(Children[segment.Index0], normalizedTime, frame0, arena, rig, parameters, depth + 1);
        MotionDispatcher.Evaluate(Children[segment.Index1], normalizedTime, frame1, arena, rig, parameters, depth + 1);

        BlendingKernels.BlendFrame(outFrame, frame0, frame1, segment.Weight);

        arena.Free();
        arena.Free();
    }

    /// <inheritdoc/>
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        if (Children.Length == 0)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        MotionDispatcher.ComputeRootDelta(Children[0], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        for (int i = 0; i < Children.Length; i++)
        {
            MotionDispatcher.CollectEvents(Children[i], prevNormTime, curNormTime, layerWeight, ref sink);
        }
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }
}

/// <summary>Two-parameter inverse-distance blend over positioned children.</summary>
public sealed class Blend2DMotionNode : MotionNode
{
    private readonly Vec2[] _positions;
    private readonly MotionNode[] _children;
    private readonly int[] _triangles;
    private AnimationFrame[]? _frameScratch;
    private float[]? _weightScratch;
    private ParameterHandle _parameterXHandle;
    private ParameterHandle _parameterYHandle;
    private bool _parametersBound;

    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.Blend2D;

    /// <summary>X driving parameter.</summary>
    public string ParameterX { get; }

    /// <summary>Y driving parameter.</summary>
    public string ParameterY { get; }

    /// <summary>Child positions in blend space.</summary>
    public ReadOnlySpan<Vec2> Positions => _positions;

    /// <summary>Children aligned with positions.</summary>
    public ReadOnlySpan<MotionNode> Children => _children;

    /// <summary>Weighting strategy.</summary>
    public Blend2DMode Mode { get; }

    /// <summary>Creates a blend.</summary>
    public Blend2DMotionNode(
        string parameterX,
        string parameterY,
        (Vec2 Position, MotionNode Child)[] entries,
        Blend2DMode mode = Blend2DMode.InverseDistance)
    {
        ArgumentNullException.ThrowIfNull(parameterX);
        ArgumentNullException.ThrowIfNull(parameterY);
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Length == 0)
        {
            AnimationThrowHelper.ThrowCompilation(AnimationErrorCode.CompilationEmptyChildren, "Blend2D requires at least one child.");
        }

        if ((uint)mode > (uint)Blend2DMode.Freeform)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Unknown Blend2D mode '{mode}'.");
        }

        ParameterX = parameterX;
        ParameterY = parameterY;
        Mode = mode;
        _positions = new Vec2[entries.Length];
        _children = new MotionNode[entries.Length];
        for (int i = 0; i < entries.Length; i++)
        {
            _positions[i] = entries[i].Position;
            _children[i] = entries[i].Child;
        }

        _triangles = mode == Blend2DMode.Freeform
            ? DelaunayTriangulation.Build(_positions)
            : [];
    }

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            _parameterXHandle = context.Parameters.ResolveHandle(ParameterX);
            _parameterYHandle = context.Parameters.ResolveHandle(ParameterY);
            _parametersBound = true;
        }

        MotionNode[] children = _children;
        for (int i = 0; i < children.Length; i++)
        {
            children[i].Bind(in context);
        }
    }

    /// <inheritdoc/>
    public override float GetDuration()
    {
        if (_children.Length == 0)
        {
            return 0.0f;
        }

        float sum = 0.0f;
        for (int i = 0; i < _children.Length; i++)
        {
            sum += MotionDispatcher.GetDuration(_children[i]);
        }

        return sum / _children.Length;
    }

    /// <summary>Duration of the active children, weighted like their poses.</summary>
    public float GetDuration(ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        int childCount = _children.Length;
        if (childCount == 0)
        {
            return 0.0f;
        }

        Span<float> weights = childCount <= AnimationConstants.MaxStackScratchFrames
            ? stackalloc float[childCount]
            : new float[childCount];

        int exact = ComputeWeights(ReadInput(parameters), weights);
        if (exact >= 0)
        {
            return MotionDispatcher.GetDuration(_children[exact], parameters);
        }

        float total = 0.0f;
        float sum = 0.0f;
        for (int i = 0; i < childCount; i++)
        {
            float weight = weights[i];
            if (!float.IsFinite(weight) || weight <= 0.0f)
            {
                continue;
            }

            total += weight;
            sum += weight * MotionDispatcher.GetDuration(_children[i], parameters);
        }

        return total > AnimationConstants.BlendEpsilon ? sum / total : GetDuration();
    }

    /// <summary>Root delta of the active children, weighted like their poses.</summary>
    public void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, ParameterStore parameters, out Vec3 deltaPos, out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        int childCount = _children.Length;
        if (childCount == 0)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        Span<float> weights = childCount <= AnimationConstants.MaxStackScratchFrames
            ? stackalloc float[childCount]
            : new float[childCount];

        int exact = ComputeWeights(ReadInput(parameters), weights);
        if (exact >= 0)
        {
            MotionDispatcher.ComputeRootDelta(_children[exact], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
            return;
        }

        MotionDispatcher.CombineWeightedRootDeltas(_children, weights, prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    private Vec2 ReadInput(ParameterStore parameters) => _parametersBound
        ? new Vec2(parameters.GetFloat(in _parameterXHandle), parameters.GetFloat(in _parameterYHandle))
        : new Vec2(parameters.GetFloat(ParameterX), parameters.GetFloat(ParameterY));

    /// <summary>
    /// Fills blend weights. Returns an exact-hit child index, or -1 when the
    /// weights span multiple children.
    /// </summary>
    private int ComputeWeights(Vec2 input, Span<float> weights)
    {
        if (Mode == Blend2DMode.Freeform &&
            _triangles.Length > 0 &&
            TryComputeFreeformWeights(input, weights))
        {
            return -1;
        }

        return ComputeInverseDistanceWeights(input, weights);
    }

    private int ComputeInverseDistanceWeights(Vec2 input, Span<float> weights)
    {
        for (int i = 0; i < _positions.Length; i++)
        {
            float distanceSq = Vec2.DistanceSquared(input, _positions[i]);
            if (distanceSq <= AnimationConstants.BlendDistanceEpsilonSq)
            {
                return i;
            }

            weights[i] = 1.0f / MathF.Sqrt(distanceSq);
        }

        return -1;
    }

    private bool TryComputeFreeformWeights(Vec2 input, Span<float> weights)
    {
        const float epsilon = 1e-5f;
        weights.Clear();

        for (int t = 0; t < _triangles.Length; t += 3)
        {
            int a = _triangles[t];
            int b = _triangles[t + 1];
            int c = _triangles[t + 2];
            Vec2 pa = _positions[a];
            Vec2 pb = _positions[b];
            Vec2 pc = _positions[c];
            float area = Vec2.Cross(pb - pa, pc - pa);
            if (MathF.Abs(area) <= epsilon)
            {
                continue;
            }

            float wa = Vec2.Cross(pb - input, pc - input) / area;
            float wb = Vec2.Cross(pc - input, pa - input) / area;
            float wc = 1.0f - wa - wb;
            if (wa < -epsilon || wb < -epsilon || wc < -epsilon)
            {
                continue;
            }

            wa = MathF.Max(0.0f, wa);
            wb = MathF.Max(0.0f, wb);
            wc = MathF.Max(0.0f, wc);
            float total = wa + wb + wc;
            if (total <= AnimationConstants.BlendEpsilon)
            {
                continue;
            }

            float inverse = 1.0f / total;
            weights[a] = wa * inverse;
            weights[b] = wb * inverse;
            weights[c] = wc * inverse;
            return true;
        }

        return false;
    }

    /// <inheritdoc/>
    [SkipLocalsInit]
    public override void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        ArgumentNullException.ThrowIfNull(arena);
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        if (depth >= AnimationConstants.MaxBlendDepth)
        {
            AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationDepthOverflow, "Maximum blend recursion depth exceeded.");
        }

        Vec2 input = ReadInput(parameters);
        int childCount = _children.Length;
        // Holder must be a managed array (stackalloc forbids reference types);
        // weights are unmanaged and honor the stack budget. Both buffers are
        // cached per node so steady-state evaluation never touches the pool.
        AnimationFrame[] holder = _frameScratch ??= new AnimationFrame[childCount];
        float[]? weightArray = childCount > AnimationConstants.MaxStackScratchFrames
            ? _weightScratch ??= new float[childCount]
            : null;
        Span<float> weights = weightArray is not null
            ? weightArray.AsSpan(0, childCount)
            : stackalloc float[childCount];
        int exact = ComputeWeights(input, weights);
        if (exact >= 0)
        {
            MotionDispatcher.Evaluate(_children[exact], normalizedTime, outFrame, arena, rig, parameters, depth + 1);
            return;
        }

        for (int i = 0; i < childCount; i++)
        {
            holder[i] = arena.Alloc();
            MotionDispatcher.Evaluate(_children[i], normalizedTime, holder[i], arena, rig, parameters, depth + 1);
        }

        BlendingKernels.BlendWeightedFrames(outFrame, holder.AsSpan(0, childCount), weights, rig);

        for (int i = 0; i < childCount; i++)
        {
            arena.Free();
        }
    }

    /// <inheritdoc/>
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        if (_children.Length == 0)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        MotionDispatcher.ComputeRootDelta(_children[0], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        for (int i = 0; i < _children.Length; i++)
        {
            MotionDispatcher.CollectEvents(_children[i], prevNormTime, curNormTime, layerWeight, ref sink);
        }
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }
}

/// <summary>Per-child parameter-weighted blend with single-active fast path.</summary>
public sealed class DirectMotionNode : MotionNode
{
    private readonly string[] _parameterNames;
    private readonly MotionNode[] _children;
    private AnimationFrame[]? _frameScratch;
    private float[]? _weightScratch;
    private ParameterHandle[] _parameterHandles = Array.Empty<ParameterHandle>();
    private bool _parametersBound;

    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.Direct;

    /// <summary>Driving parameter per child.</summary>
    public ReadOnlySpan<string> ParameterNames => _parameterNames;

    /// <summary>Children aligned with parameters.</summary>
    public ReadOnlySpan<MotionNode> Children => _children;

    /// <summary>Creates a blend.</summary>
    public DirectMotionNode((string Parameter, MotionNode Child)[] entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Length == 0)
        {
            AnimationThrowHelper.ThrowCompilation(AnimationErrorCode.CompilationEmptyChildren, "Direct blend requires at least one child.");
        }

        _parameterNames = new string[entries.Length];
        _children = new MotionNode[entries.Length];
        for (int i = 0; i < entries.Length; i++)
        {
            _parameterNames[i] = entries[i].Parameter;
            _children[i] = entries[i].Child;
        }
    }

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            ParameterHandle[] handles = new ParameterHandle[_parameterNames.Length];
            for (int i = 0; i < _parameterNames.Length; i++)
            {
                handles[i] = context.Parameters.ResolveHandle(_parameterNames[i]);
            }

            _parameterHandles = handles;
            _parametersBound = true;
        }

        MotionNode[] children = _children;
        for (int i = 0; i < children.Length; i++)
        {
            children[i].Bind(in context);
        }
    }

    /// <inheritdoc/>
    public override float GetDuration()
    {
        float max = 0.0f;
        for (int i = 0; i < _children.Length; i++)
        {
            max = MathF.Max(max, MotionDispatcher.GetDuration(_children[i]));
        }

        return max;
    }

    /// <summary>Duration of the active children, weighted by their parameters.</summary>
    public float GetDuration(ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        int childCount = _children.Length;
        Span<float> weights = childCount <= AnimationConstants.MaxStackScratchFrames
            ? stackalloc float[childCount]
            : new float[childCount];
        ReadWeights(parameters, weights);

        float total = 0.0f;
        float sum = 0.0f;
        for (int i = 0; i < childCount; i++)
        {
            float weight = weights[i];
            if (weight <= 0.0f)
            {
                continue;
            }

            total += weight;
            sum += weight * MotionDispatcher.GetDuration(_children[i], parameters);
        }

        return total > AnimationConstants.BlendEpsilon ? sum / total : GetDuration();
    }

    /// <summary>Root delta of the active children, weighted by their parameters.</summary>
    public void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, ParameterStore parameters, out Vec3 deltaPos, out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        int childCount = _children.Length;
        Span<float> weights = childCount <= AnimationConstants.MaxStackScratchFrames
            ? stackalloc float[childCount]
            : new float[childCount];
        ReadWeights(parameters, weights);
        MotionDispatcher.CombineWeightedRootDeltas(_children, weights, prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    private void ReadWeights(ParameterStore parameters, Span<float> weights)
    {
        ParameterHandle[] handles = _parameterHandles;
        bool bound = _parametersBound && handles.Length == _children.Length;
        for (int i = 0; i < _children.Length; i++)
        {
            float raw = bound ? parameters.GetFloat(in handles[i]) : parameters.GetFloat(_parameterNames[i]);
            weights[i] = MathF.Max(0.0f, raw);
        }
    }

    /// <inheritdoc/>
    [SkipLocalsInit]
    public override void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        ArgumentNullException.ThrowIfNull(arena);
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        if (depth >= AnimationConstants.MaxBlendDepth)
        {
            AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationDepthOverflow, "Maximum blend recursion depth exceeded.");
        }

        int childCount = _children.Length;
        AnimationFrame[] holder = _frameScratch ??= new AnimationFrame[childCount];
        float[]? weightArray = childCount > AnimationConstants.MaxStackScratchFrames
            ? _weightScratch ??= new float[childCount]
            : null;
        Span<float> weights = weightArray is not null
            ? weightArray.AsSpan(0, childCount)
            : stackalloc float[childCount];

        int activeCount = 0;
        int singleIndex = -1;

        ParameterHandle[] handles = _parameterHandles;
        bool bound = _parametersBound && handles.Length == childCount;
        for (int i = 0; i < childCount; i++)
        {
            float raw = bound ? parameters.GetFloat(in handles[i]) : parameters.GetFloat(_parameterNames[i]);
            float w = MathF.Max(0.0f, raw);
            weights[i] = w;
            if (w > 0.0f)
            {
                activeCount++;
                singleIndex = i;
            }
        }

        if (activeCount == 0)
        {
            outFrame.ResetToRest(rig);
            return;
        }

        if (activeCount == 1)
        {
            MotionDispatcher.Evaluate(_children[singleIndex], normalizedTime, outFrame, arena, rig, parameters, depth + 1);
            return;
        }

        for (int i = 0; i < childCount; i++)
        {
            holder[i] = arena.Alloc();
            MotionDispatcher.Evaluate(_children[i], normalizedTime, holder[i], arena, rig, parameters, depth + 1);
        }

        BlendingKernels.BlendWeightedFrames(outFrame, holder.AsSpan(0, childCount), weights, rig);

        for (int i = 0; i < childCount; i++)
        {
            arena.Free();
        }
    }

    /// <inheritdoc/>
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        if (_children.Length == 0)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        MotionDispatcher.ComputeRootDelta(_children[0], prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        for (int i = 0; i < _children.Length; i++)
        {
            MotionDispatcher.CollectEvents(_children[i], prevNormTime, curNormTime, layerWeight, ref sink);
        }
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }
}

/// <summary>Rest-relative additive layer over a base motion, weighted by a parameter.</summary>
public sealed class AdditiveMotionNode : MotionNode
{
    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.Additive;

    /// <summary>Base motion.</summary>
    public MotionNode BaseChild { get; }

    /// <summary>Additive motion.</summary>
    public MotionNode AdditiveChild { get; }

    /// <summary>Weight parameter name.</summary>
    public string WeightParameter { get; }

    private ParameterHandle _weightHandle;
    private bool _weightBound;

    /// <summary>Creates an additive node.</summary>
    public AdditiveMotionNode(MotionNode baseChild, MotionNode additiveChild, string weightParameter)
    {
        ArgumentNullException.ThrowIfNull(baseChild);
        ArgumentNullException.ThrowIfNull(additiveChild);
        ArgumentNullException.ThrowIfNull(weightParameter);
        BaseChild = baseChild;
        AdditiveChild = additiveChild;
        WeightParameter = weightParameter;
    }

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            _weightHandle = context.Parameters.ResolveHandle(WeightParameter);
            _weightBound = true;
        }

        BaseChild.Bind(in context);
        AdditiveChild.Bind(in context);
    }

    /// <inheritdoc/>
    public override float GetDuration() => MotionDispatcher.GetDuration(BaseChild);

    /// <inheritdoc/>
    public override void Evaluate(float normalizedTime, AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters, int depth)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        ArgumentNullException.ThrowIfNull(arena);
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        if (depth >= AnimationConstants.MaxBlendDepth)
        {
            AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationDepthOverflow, "Maximum blend recursion depth exceeded.");
        }

        float weight = FastMath.Clamp01(_weightBound
            ? parameters.GetFloat(in _weightHandle)
            : parameters.GetFloat(WeightParameter));
        if (weight <= 0.0f)
        {
            MotionDispatcher.Evaluate(BaseChild, normalizedTime, outFrame, arena, rig, parameters, depth + 1);
            return;
        }

        AnimationFrame baseFrame = arena.Alloc();
        AnimationFrame additiveFrame = arena.Alloc();

        MotionDispatcher.Evaluate(BaseChild, normalizedTime, baseFrame, arena, rig, parameters, depth + 1);
        MotionDispatcher.Evaluate(AdditiveChild, normalizedTime, additiveFrame, arena, rig, parameters, depth + 1);

        BlendingKernels.ApplyAdditiveFrame(outFrame, baseFrame, additiveFrame, rig, weight);

        arena.Free();
        arena.Free();
    }

    /// <inheritdoc/>
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        MotionDispatcher.ComputeRootDelta(BaseChild, prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        MotionDispatcher.CollectEvents(BaseChild, prevNormTime, curNormTime, layerWeight, ref sink);
        MotionDispatcher.CollectEvents(AdditiveChild, prevNormTime, curNormTime, layerWeight, ref sink);
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }
}
