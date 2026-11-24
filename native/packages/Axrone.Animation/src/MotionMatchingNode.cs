namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Motion-matching leaf: searches a database for the pose that best matches the
/// query parameters, then samples the selected clip and reports its root delta and
/// events. Selections are throttled and biased toward the current clip to avoid
/// frame-to-frame flapping.
/// </summary>
/// <remarks>
/// Query parameters are world-space trajectory X/Z and facing X/Z. The node keeps
/// mutable selection state and follows the package's single-evaluation-thread
/// contract. A database with no candidates falls back to the first clip.
/// </remarks>
public sealed class MotionMatchingMotionNode : MotionNode
{
    private readonly MotionMatchingDatabase _database;
    private readonly ClipMotionNode[] _clips;
    private readonly string _trajectoryX;
    private readonly string _trajectoryZ;
    private readonly string _facingX;
    private readonly string _facingZ;
    private readonly float _reselectInterval;
    private readonly float _continuityBias;
    private ParameterHandle _trajectoryXHandle;
    private ParameterHandle _trajectoryZHandle;
    private ParameterHandle _facingXHandle;
    private ParameterHandle _facingZHandle;
    private bool _parametersBound;
    private int _selectedClip;
    private float _selectedStartTime;
    private float _selectedDuration;
    private float _lastNormalizedTime;
    private bool _hasSelection;

    /// <summary>Creates a motion-matching leaf over a precomputed database.</summary>
    public MotionMatchingMotionNode(
        MotionMatchingDatabase database,
        string trajectoryXParameter,
        string trajectoryZParameter,
        string facingXParameter,
        string facingZParameter,
        float reselectIntervalSeconds = 0.2f,
        float continuityBias = 1.0f)
    {
        ArgumentNullException.ThrowIfNull(database);
        if (database.Clips.IsEmpty)
        {
            AnimationThrowHelper.ThrowCompilation(
                AnimationErrorCode.CompilationEmptyChildren,
                "Motion matching requires at least one clip.");
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(trajectoryXParameter);
        ArgumentException.ThrowIfNullOrWhiteSpace(trajectoryZParameter);
        ArgumentException.ThrowIfNullOrWhiteSpace(facingXParameter);
        ArgumentException.ThrowIfNullOrWhiteSpace(facingZParameter);
        if (!float.IsFinite(reselectIntervalSeconds) || reselectIntervalSeconds < 0.0f)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                "Motion-matching reselect interval must be finite and non-negative.");
        }

        if (!float.IsFinite(continuityBias) || continuityBias < 0.0f)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                "Motion-matching continuity bias must be finite and non-negative.");
        }

        _database = database;
        _trajectoryX = trajectoryXParameter;
        _trajectoryZ = trajectoryZParameter;
        _facingX = facingXParameter;
        _facingZ = facingZParameter;
        _reselectInterval = reselectIntervalSeconds;
        _continuityBias = continuityBias;

        _clips = new ClipMotionNode[database.Clips.Length];
        for (int i = 0; i < _clips.Length; i++)
        {
            _clips[i] = new ClipMotionNode(database.Clips[i]) { IsLooping = true };
        }

        _selectedDuration = _clips[0].GetDuration();
    }

    /// <inheritdoc/>
    public override MotionKind Kind => MotionKind.MotionMatching;

    /// <summary>Clip selected by the last search.</summary>
    public int SelectedClipIndex => _selectedClip;

    /// <summary>Database time of the selected sample.</summary>
    public float SelectedTime => _selectedStartTime;

    /// <inheritdoc/>
    public override void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            _trajectoryXHandle = context.Parameters.ResolveHandle(_trajectoryX);
            _trajectoryZHandle = context.Parameters.ResolveHandle(_trajectoryZ);
            _facingXHandle = context.Parameters.ResolveHandle(_facingX);
            _facingZHandle = context.Parameters.ResolveHandle(_facingZ);
            _parametersBound = true;
        }

        for (int i = 0; i < _clips.Length; i++)
        {
            _clips[i].Bind(in context);
        }
    }

    /// <inheritdoc/>
    public override float GetDuration() => _selectedDuration;

    /// <summary>Duration of the clip selected for the current parameters.</summary>
    public float GetDuration(ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        return _hasSelection ? _selectedDuration : _clips[0].GetDuration();
    }

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

        UpdateSelection(normalizedTime, parameters);
        _clips[_selectedClip].Evaluate(MapTime(normalizedTime), outFrame, arena, rig, parameters, depth + 1);
    }

    /// <inheritdoc/>
    public override void ComputeRootDelta(float prevNormTime, float curNormTime, Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        _clips[_selectedClip].ComputeRootDelta(MapTime(prevNormTime), MapTime(curNormTime), rig, out deltaPos, out deltaRot);
    }

    /// <inheritdoc/>
    public override void CollectEvents<TSink>(float prevNormTime, float curNormTime, float layerWeight, ref TSink sink)
    {
        if (layerWeight <= 0.0f)
        {
            return;
        }

        _clips[_selectedClip].CollectEvents(MapTime(prevNormTime), MapTime(curNormTime), layerWeight, ref sink);
    }

    /// <inheritdoc/>
    public override void CollectEvents(float prevNormTime, float curNormTime, float layerWeight, ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(prevNormTime, curNormTime, layerWeight, ref adapter);
    }

    private void UpdateSelection(float normalizedTime, ParameterStore parameters)
    {
        float elapsed = (normalizedTime - _lastNormalizedTime) * _selectedDuration;
        bool looped = normalizedTime < _lastNormalizedTime;
        _lastNormalizedTime = normalizedTime;

        if (_hasSelection && !looped && elapsed < _reselectInterval)
        {
            return;
        }

        float trajectoryX = _parametersBound ? parameters.GetFloat(in _trajectoryXHandle) : parameters.GetFloat(_trajectoryX);
        float trajectoryZ = _parametersBound ? parameters.GetFloat(in _trajectoryZHandle) : parameters.GetFloat(_trajectoryZ);
        float facingX = _parametersBound ? parameters.GetFloat(in _facingXHandle) : parameters.GetFloat(_facingX);
        float facingZ = _parametersBound ? parameters.GetFloat(in _facingZHandle) : parameters.GetFloat(_facingZ);

        var query = new MotionMatchQuery(
            new Vec3(trajectoryX, 0.0f, trajectoryZ),
            new Vec3(facingX, 0.0f, facingZ),
            ContinuityBias: _continuityBias,
            ContinuityClipIndex: _selectedClip);

        int best = MotionMatching.Search(query, _database.Candidates, out _);
        if (best < 0)
        {
            _hasSelection = true;
            return;
        }

        MotionMatchCandidate candidate = _database.Candidates[best];
        _selectedClip = candidate.ClipIndex;
        _selectedStartTime = candidate.Time;
        _selectedDuration = _clips[_selectedClip].GetDuration();
        _hasSelection = true;
    }

    private float MapTime(float normalizedTime)
    {
        if (_selectedDuration <= AnimationConstants.SoaEpsilon)
        {
            return 0.0f;
        }

        float clipDuration = _clips[_selectedClip].Clip.Duration;
        float absolute = _selectedStartTime + (normalizedTime * _selectedDuration);
        return clipDuration > AnimationConstants.SoaEpsilon ? absolute / clipDuration : 0.0f;
    }
}
