namespace Axrone.Animation;

/// <summary>Layer composition mode.</summary>
public enum LayerMode
{
    /// <summary>Masked override blend.</summary>
    Override = 0,

    /// <summary>Rest-relative additive blend.</summary>
    Additive = 1,
}

/// <summary>One state machine lane with weight, mode, and optional bone mask.</summary>
public sealed class AnimationLayer
{
    /// <summary>Layer identity.</summary>
    public LayerId Id { get; }

    /// <summary>Driven state machine.</summary>
    public StateMachineInstance Machine { get; }

    /// <summary>Composition mode.</summary>
    public LayerMode Mode { get; init; } = LayerMode.Override;

    /// <summary>Layer weight.</summary>
    public float Weight { get; set; } = 1.0f;

    /// <summary>Optional bone mask (null includes everything).</summary>
    public AnimationMask? BoneMask { get; init; }

    private readonly List<AnimationIkLayer> _ikLayers = new();

    /// <summary>IK jobs applied to this layer's pose before composition.</summary>
    public IReadOnlyList<AnimationIkLayer> IkLayers => _ikLayers;

    /// <summary>Creates a layer.</summary>
    public AnimationLayer(LayerId id, StateMachineInstance machine)
    {
        ArgumentNullException.ThrowIfNull(machine);
        Id = id;
        Machine = machine;
    }

    /// <summary>Appends an IK layer evaluated after this layer's state machine.</summary>
    /// <param name="layer">IK layer bound to the controller rig.</param>
    public void AddIkLayer(AnimationIkLayer layer)
    {
        ArgumentNullException.ThrowIfNull(layer);
        _ikLayers.Add(layer);
    }
}

/// <summary>
/// Top-level runtime: advances layer state machines, composes override/additive
/// layers onto the current frame, extracts layer-zero root motion, and clears
/// triggers at the frame boundary.
/// </summary>
public sealed class AnimationController : IDisposable
{
    private readonly List<AnimationLayer> _layers = new();
    private readonly CurveLayout _curveLayout;

    /// <summary>Driven rig.</summary>
    public Rig Rig { get; }

    /// <summary>Shared parameters.</summary>
    public ParameterStore Parameters { get; }

    /// <summary>Composed output frame.</summary>
    public AnimationFrame CurrentFrame { get; }

    /// <summary>Scratch arena.</summary>
    public FrameArena Arena { get; }

    /// <summary>Creates a controller over a rig.</summary>
    public AnimationController(Rig rig, ParameterStore parameters, CurveLayout? curveLayout, int arenaCapacity = 64)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        ArgumentNullException.ThrowIfNull(curveLayout);
        Rig = rig;
        Parameters = parameters;
        _curveLayout = curveLayout;
        CurrentFrame = new AnimationFrame(rig.BoneCount, curveLayout);
        Arena = new FrameArena(rig.BoneCount, curveLayout, arenaCapacity);
        CurrentFrame.ResetToRest(rig);
    }

    /// <summary>
    /// Resolves every layer motion (parameters, curves, bone ranges) once before
    /// the first update. Optional — unbound graphs keep working through the
    /// compat path — but bound graphs skip all per-frame lookups.
    /// </summary>
    public void BindAll()
    {
        var context = new MotionBindingContext(Parameters, _curveLayout, Rig);
        for (int i = 0; i < _layers.Count; i++)
        {
            _layers[i].Machine.Bind(in context);
        }
    }

    /// <summary>Adds a layer (index 0 is the base).</summary>
    public void AddLayer(AnimationLayer layer)
    {
        ArgumentNullException.ThrowIfNull(layer);
        _layers.Add(layer);
    }

    /// <summary>Layer count.</summary>
    public int LayerCount => _layers.Count;

    /// <summary>
    /// Advances all weighted layers, composes the frame, and reports root motion.
    /// The event list is caller-owned and cleared first.
    /// </summary>
    public void Update(float deltaTime, ICollection<ClipEvent> outEvents, out Vec3 rootMotionDeltaPos, out Quat rootMotionDeltaRot)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        long startTimestamp = Stopwatch.GetTimestamp();
        outEvents.Clear();
        Arena.Reset();

        for (int i = 0; i < _layers.Count; i++)
        {
            AnimationLayer layer = _layers[i];
            if (layer.Weight <= 0.0f)
            {
                continue;
            }

            layer.Machine.Update(deltaTime, Parameters, outEvents, layer.Weight);
        }

        if (_layers.Count > 0 && _layers[0].Weight > 0.0f)
        {
            _layers[0].Machine.Evaluate(CurrentFrame, Arena, Rig, Parameters);
            ApplyIkLayers(_layers[0], CurrentFrame);
            _layers[0].Machine.ExtractRootDelta(Rig, out rootMotionDeltaPos, out rootMotionDeltaRot);
        }
        else
        {
            CurrentFrame.ResetToRest(Rig);
            rootMotionDeltaPos = Vec3.Zero;
            rootMotionDeltaRot = Quat.Identity;
        }

        for (int i = 1; i < _layers.Count; i++)
        {
            AnimationLayer layer = _layers[i];
            float weight = FastMath.Clamp01(layer.Weight);
            if (weight <= 0.0f)
            {
                continue;
            }

            AnimationFrame layerFrame = Arena.Alloc();
            layer.Machine.Evaluate(layerFrame, Arena, Rig, Parameters);
            ApplyIkLayers(layer, layerFrame);

            if (layer.Mode == LayerMode.Override)
            {
                BlendingKernels.BlendFrame(CurrentFrame, CurrentFrame, layerFrame, weight, layer.BoneMask);
            }
            else
            {
                BlendingKernels.ApplyAdditiveFrame(CurrentFrame, CurrentFrame, layerFrame, Rig, weight);
            }

            Arena.Free();
        }

        Parameters.ClearTriggers();

        AnimationTelemetry.RecordFrameEvaluated();
        AnimationTelemetry.RecordEvaluationLatency(Stopwatch.GetElapsedTime(startTimestamp).TotalMilliseconds);
    }

    private static void ApplyIkLayers(AnimationLayer layer, AnimationFrame frame)
    {
        IReadOnlyList<AnimationIkLayer> ikLayers = layer.IkLayers;
        for (int i = 0; i < ikLayers.Count; i++)
        {
            ikLayers[i].Apply(frame);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Arena.Reset();
        GC.SuppressFinalize(this);
    }
}
