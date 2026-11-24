namespace Axrone.Animation;

/// <summary>Temporal curve applied to transition progress.</summary>
public enum TransitionEasing
{
    /// <summary>Constant-rate blend.</summary>
    Linear = 0,

    /// <summary>Smooth acceleration and deceleration.</summary>
    SmoothStep = 1,

    /// <summary>Accelerating blend.</summary>
    EaseIn = 2,

    /// <summary>Decelerating blend.</summary>
    EaseOut = 3,

    /// <summary>Accelerate then decelerate.</summary>
    EaseInOut = 4,
}

/// <summary>Conditional edge between states with duration and priority.</summary>
public sealed class StateTransition
{
    private readonly ParameterCondition[] _conditions;

    /// <summary>Destination state index.</summary>
    public int TargetStateIndex { get; init; }

    /// <summary>Blend duration (seconds when fixed, normalized otherwise).</summary>
    public float Duration
    {
        get;
        init
        {
            if (value < 0.0f || float.IsNaN(value))
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Transition duration {value} is negative or NaN.");
            }

            field = value;
        }
    }

    /// <summary>Destination start offset in normalized time.</summary>
    public float Offset
    {
        get;
        init
        {
            if (float.IsNaN(value))
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, "Transition offset is NaN.");
            }

            field = value;
        }
    }

    /// <summary>Normalized exit time gate, when set.</summary>
    public float? ExitTime { get; init; }

    /// <summary>Whether Duration is seconds (true) or normalized (false).</summary>
    public bool HasFixedDuration { get; init; }

    /// <summary>Whether a newer transition may steal this one past halfway.</summary>
    public bool CanInterrupt { get; init; }

    /// <summary>Arbitration priority.</summary>
    public int Priority { get; init; }

    /// <summary>Deterministic tie-breaker.</summary>
    public int TieBreakerIndex { get; init; }

    /// <summary>Temporal curve applied to normalized progress.</summary>
    public TransitionEasing Easing
    {
        get;
        init
        {
            if ((uint)value > (uint)TransitionEasing.EaseInOut)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Unknown transition easing '{value}'.");
            }

            field = value;
        }
    } = TransitionEasing.Linear;

    /// <summary>Guard conditions.</summary>
    public ReadOnlySpan<ParameterCondition> Conditions => _conditions;

    /// <summary>Creates a transition.</summary>
    public StateTransition(int targetStateIndex, float duration, params ReadOnlySpan<ParameterCondition> conditions)
    {
        TargetStateIndex = targetStateIndex;
        Duration = duration;
        _conditions = conditions.ToArray();
    }

    /// <summary>Resolves guard conditions against a store (bind time, idempotent).</summary>
    internal void BindConditions(ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        for (int i = 0; i < _conditions.Length; i++)
        {
            ParameterCondition condition = _conditions[i];
            condition.ResolvedHandle = parameters.ResolveHandle(condition.ParameterName);
            condition.IsResolved = true;
            _conditions[i] = condition;
        }
    }
}

/// <summary>State: motion plus speed plus outgoing transitions.</summary>
public sealed class AnimationState
{
    private readonly StateTransition[] _transitions;

    /// <summary>State identity.</summary>
    public StateId Id { get; }

    /// <summary>Root motion.</summary>
    public MotionNode RootMotion { get; }

    /// <summary>Playback speed.</summary>
    public float Speed
    {
        get;
        init
        {
            if (float.IsNaN(value) || float.IsInfinity(value))
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"State speed {value} is NaN or infinite.");
            }

            field = value;
        }
    } = 1.0f;

    /// <summary>Outgoing transitions.</summary>
    public ReadOnlySpan<StateTransition> Transitions => _transitions;

    /// <summary>Creates a state.</summary>
    public AnimationState(StateId id, MotionNode motion, params ReadOnlySpan<StateTransition> transitions)
    {
        ArgumentNullException.ThrowIfNull(motion);
        Id = id;
        RootMotion = motion;
        _transitions = transitions.ToArray();
    }
}

/// <summary>Live state machine: time advance, transition arbitration, evaluation.</summary>
public sealed class StateMachineInstance
{
    /// <summary>
    /// In-flight blend snapshot: plain values, no references, no null states.
    /// Copied from the triggering transition at start; completion reads it back.
    /// </summary>
    private struct ActiveTransitionData
    {
        public int SourceStateIndex;
        public int TargetStateIndex;
        public float Progress;
        public float DurationSec;
        public float TargetPreviousNormalizedTime;
        public float TargetNormalizedTime;
        public bool HasFixedDuration;
        public bool CanInterrupt;
        public bool IsActive;
        public TransitionEasing Easing;
    }

    private readonly AnimationState[] _states;
    private readonly StateTransition[] _anyStateTransitions;
    private ParameterStore? _boundParameters;

    private ActiveTransitionData _activeTransition;

    /// <summary>Current state index.</summary>
    public int CurrentStateIndex { get; private set; }

    /// <summary>Current normalized time.</summary>
    public float StateNormalizedTime { get; private set; }

    /// <summary>Previous normalized time (event window).</summary>
    public float PreviousNormalizedTime { get; private set; }

    /// <summary>Whether a blend is currently in flight.</summary>
    public bool HasActiveTransition
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _activeTransition.IsActive;
    }

    /// <summary>Creates an instance over states with any-state edges and an entry.</summary>
    public StateMachineInstance(AnimationState[] states, StateTransition[] anyStateTransitions, int entryStateIndex)
    {
        ArgumentNullException.ThrowIfNull(states);
        ArgumentNullException.ThrowIfNull(anyStateTransitions);
        if (states.Length == 0)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationControllerEmpty, "State machine requires at least one state.");
        }

        if ((uint)entryStateIndex >= (uint)states.Length)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.StateMachineInvalidTransition, "Entry state index out of range.");
        }

        var stateIds = new HashSet<StateId>(states.Length);
        for (int i = 0; i < states.Length; i++)
        {
            AnimationState state = states[i];
            if (string.IsNullOrWhiteSpace(state.Id.Value))
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"State {i} has an empty id.");
            }

            if (!stateIds.Add(state.Id))
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.StateMachineInvalidTransition, $"Duplicate state id '{state.Id}'.");
            }

            foreach (StateTransition transition in state.Transitions)
            {
                if ((uint)transition.TargetStateIndex >= (uint)states.Length)
                {
                    AnimationThrowHelper.ThrowValidation(
                        AnimationErrorCode.StateMachineInvalidTransition,
                        $"State '{state.Id}' targets missing state index {transition.TargetStateIndex}.");
                }
            }
        }

        foreach (StateTransition transition in anyStateTransitions)
        {
            if ((uint)transition.TargetStateIndex >= (uint)states.Length)
            {
                AnimationThrowHelper.ThrowValidation(
                    AnimationErrorCode.StateMachineInvalidTransition,
                    $"Any-state transition targets missing state index {transition.TargetStateIndex}.");
            }
        }

        _states = states;
        _anyStateTransitions = anyStateTransitions;
        CurrentStateIndex = entryStateIndex;
    }

    /// <summary>Snaps to a state without blending.</summary>
    public void ForceState(int stateIndex, float normalizedTime = 0.0f)
    {
        if ((uint)stateIndex >= (uint)_states.Length)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.StateMachineInvalidTransition, "Forced state index out of range.");
        }

        CurrentStateIndex = stateIndex;
        StateNormalizedTime = normalizedTime;
        PreviousNormalizedTime = normalizedTime;
        _activeTransition = default;
    }

    /// <summary>
    /// Copies the source machine's current state, normalized time and in-flight
    /// transition onto this machine when the state ids resolve here. Used by
    /// masked layers that share a locomotion graph with the base layer.
    /// </summary>
    /// <returns>True when the source state exists on this machine.</returns>
    public bool SyncFrom(StateMachineInstance source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!TryFindState(source._states[source.CurrentStateIndex].Id, out int localState))
        {
            return false;
        }

        int localTarget = -1;
        bool sourceTransition = source._activeTransition.IsActive;
        if (sourceTransition)
        {
            _ = TryFindState(
                source._states[source._activeTransition.TargetStateIndex].Id,
                out localTarget);
        }

        _activeTransition = default;
        CurrentStateIndex = localState;
        StateNormalizedTime = source.StateNormalizedTime;
        PreviousNormalizedTime = source.PreviousNormalizedTime;

        if (sourceTransition && localTarget >= 0)
        {
            _activeTransition = source._activeTransition;
            _activeTransition.SourceStateIndex = localState;
            _activeTransition.TargetStateIndex = localTarget;
        }

        return true;
    }

    private bool TryFindState(StateId id, out int index)
    {
        for (int i = 0; i < _states.Length; i++)
        {
            if (_states[i].Id == id)
            {
                index = i;
                return true;
            }
        }

        index = -1;
        return false;
    }

    /// <summary>Starts a manual cross-fade.</summary>
    public void CrossFade(int targetStateIndex, float duration, float offset = 0.0f)
    {
        if ((uint)targetStateIndex >= (uint)_states.Length)
        {
            AnimationThrowHelper.ThrowValidation(AnimationErrorCode.StateMachineInvalidTransition, "Cross-fade target out of range.");
        }

        if (targetStateIndex == CurrentStateIndex && !_activeTransition.IsActive)
        {
            return;
        }

        _activeTransition = new ActiveTransitionData
        {
            IsActive = true,
            SourceStateIndex = CurrentStateIndex,
            TargetStateIndex = targetStateIndex,
            Progress = 0.0f,
            DurationSec = duration,
            TargetPreviousNormalizedTime = offset,
            TargetNormalizedTime = offset,
            HasFixedDuration = true,
            CanInterrupt = true,
            Easing = TransitionEasing.Linear,
        };
    }

    /// <summary>
    /// Binds motions and guard conditions to whichever context parts are present.
    /// Idempotent; re-running overwrites the same handles.
    /// </summary>
    public void Bind(in MotionBindingContext context)
    {
        if (context.Parameters is not null)
        {
            BindConditions(context.Parameters);
            _boundParameters = context.Parameters;
        }

        if (context.Parameters is not null || context.CurveLayout is not null || context.Rig is not null)
        {
            for (int i = 0; i < _states.Length; i++)
            {
                _states[i].RootMotion.Bind(in context);
            }
        }
    }

    private void BindConditions(ParameterStore parameters)
    {
        for (int i = 0; i < _anyStateTransitions.Length; i++)
        {
            _anyStateTransitions[i].BindConditions(parameters);
        }

        for (int i = 0; i < _states.Length; i++)
        {
            foreach (StateTransition transition in _states[i].Transitions)
            {
                transition.BindConditions(parameters);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EnsureBound(ParameterStore parameters)
    {
        if (!ReferenceEquals(_boundParameters, parameters))
        {
            Bind(new MotionBindingContext(parameters, null, null));
        }
    }

    /// <summary>Advances time into a zero-allocation sink.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void Update<TSink>(float deltaTime, ParameterStore parameters, ref TSink outEvents, float layerWeight = 1.0f)
        where TSink : struct, IClipEventSink
    {
        ArgumentNullException.ThrowIfNull(parameters);
        EnsureBound(parameters);

        AnimationState current = _states[CurrentStateIndex];
        float motionDuration = MotionDispatcher.GetDuration(current.RootMotion, parameters);
        float speedMagnitude = MathF.Max(MathF.Abs(current.Speed), AnimationConstants.SoaEpsilon);
        float stateDuration = MathF.Max(motionDuration / speedMagnitude, AnimationConstants.MinStateDuration);

        float sourceStart = PreviousNormalizedTime;
        PreviousNormalizedTime = StateNormalizedTime;
        StateNormalizedTime += deltaTime / stateDuration;
        float sourceEnd = StateNormalizedTime;

        bool transitionWasActive = _activeTransition.IsActive;
        int targetIndexBefore = transitionWasActive ? _activeTransition.TargetStateIndex : -1;
        float targetStartBefore = transitionWasActive ? _activeTransition.TargetPreviousNormalizedTime : 0.0f;
        float targetEndBefore = transitionWasActive ? _activeTransition.TargetNormalizedTime : 0.0f;

        if (transitionWasActive)
        {
            AdvanceTransition(deltaTime, parameters, current, stateDuration);
        }
        else
        {
            StateTransition? next = CheckTransitions(current, parameters);
            if (next != null)
            {
                _activeTransition = new ActiveTransitionData
                {
                    IsActive = true,
                    SourceStateIndex = CurrentStateIndex,
                    TargetStateIndex = next.TargetStateIndex,
                    Progress = 0.0f,
                    DurationSec = next.HasFixedDuration ? next.Duration : next.Duration * stateDuration,
                    TargetPreviousNormalizedTime = next.Offset,
                    TargetNormalizedTime = next.Offset,
                    HasFixedDuration = next.HasFixedDuration,
                    CanInterrupt = next.CanInterrupt,
                    Easing = next.Easing,
                };
                ConsumeTransitionTriggers(next, parameters);
            }
        }

        MotionDispatcher.CollectEvents(
            current.RootMotion,
            sourceStart,
            sourceEnd,
            layerWeight,
            ref outEvents);

        if (transitionWasActive)
        {
            ActiveTransitionData active = _activeTransition;
            if (active.TargetStateIndex != targetIndexBefore)
            {
                AnimationState previousTarget = _states[targetIndexBefore];
                MotionDispatcher.CollectEvents(
                    previousTarget.RootMotion,
                    targetStartBefore,
                    targetEndBefore,
                    layerWeight,
                    ref outEvents);
            }

            AnimationState target = _states[active.TargetStateIndex];
            MotionDispatcher.CollectEvents(
                target.RootMotion,
                active.TargetPreviousNormalizedTime,
                active.TargetNormalizedTime,
                layerWeight,
                ref outEvents);
        }
    }

    /// <summary>Advances time, starts due transitions, and drives the active blend.</summary>
    public void Update(float deltaTime, ParameterStore parameters, ICollection<ClipEvent> outEvents, float layerWeight)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        Update(deltaTime, parameters, ref adapter, layerWeight);
    }

    private void AdvanceTransition(float deltaTime, ParameterStore parameters, AnimationState current, float stateDuration)
    {
        ActiveTransitionData active = _activeTransition;
        AnimationState target = _states[active.TargetStateIndex];
        float targetMotionDuration = MotionDispatcher.GetDuration(target.RootMotion, parameters);
        float targetSpeed = MathF.Max(MathF.Abs(target.Speed), AnimationConstants.SoaEpsilon);
        float targetDuration = MathF.Max(targetMotionDuration / targetSpeed, AnimationConstants.MinStateDuration);

        active.TargetPreviousNormalizedTime = active.TargetNormalizedTime;
        active.TargetNormalizedTime += deltaTime / targetDuration;
        active.Progress += active.DurationSec > AnimationConstants.SoaEpsilon ? deltaTime / active.DurationSec : 1.0f;

        if (active.CanInterrupt)
        {
            StateTransition? interrupt = CheckTransitions(current, parameters);
            if (interrupt != null && interrupt.TargetStateIndex != active.TargetStateIndex)
            {
                if (active.Progress >= AnimationConstants.TransitionInterruptThreshold)
                {
                    active.SourceStateIndex = active.TargetStateIndex;
                }

                active.TargetStateIndex = interrupt.TargetStateIndex;
                active.Progress = 0.0f;
                active.DurationSec = interrupt.HasFixedDuration ? interrupt.Duration : interrupt.Duration * stateDuration;
                active.TargetPreviousNormalizedTime = interrupt.Offset;
                active.TargetNormalizedTime = interrupt.Offset;
                active.HasFixedDuration = interrupt.HasFixedDuration;
                active.CanInterrupt = interrupt.CanInterrupt;
                active.Easing = interrupt.Easing;
                _activeTransition = active;
                ConsumeTransitionTriggers(interrupt, parameters);
                return;
            }
        }

        if (active.Progress >= 1.0f)
        {
            CurrentStateIndex = active.TargetStateIndex;
            StateNormalizedTime = active.TargetNormalizedTime;
            PreviousNormalizedTime = active.TargetNormalizedTime;
            active.IsActive = false;
        }

        _activeTransition = active;
    }

    private static void ConsumeTransitionTriggers(StateTransition transition, ParameterStore parameters)
    {
        foreach (ParameterCondition condition in transition.Conditions)
        {
            if (parameters.IsTrigger(condition.ParameterName))
            {
                parameters.ConsumeTrigger(condition.ParameterName);
            }
        }
    }

    private StateTransition? CheckTransitions(AnimationState current, ParameterStore parameters)
    {
        StateTransition? best = null;

        for (int i = 0; i < _anyStateTransitions.Length; i++)
        {
            StateTransition candidate = _anyStateTransitions[i];
            if (EvaluateTransition(candidate, parameters, StateNormalizedTime, PreviousNormalizedTime)
                && (best == null || CompareTransitions(candidate, best) > 0))
            {
                best = candidate;
            }
        }

        foreach (StateTransition candidate in current.Transitions)
        {
            if (EvaluateTransition(candidate, parameters, StateNormalizedTime, PreviousNormalizedTime)
                && (best == null || CompareTransitions(candidate, best) > 0))
            {
                best = candidate;
            }
        }

        return best;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static int CompareTransitions(StateTransition a, StateTransition b)
    {
        int priority = a.Priority.CompareTo(b.Priority);
        if (priority != 0)
        {
            return priority;
        }

        return b.TieBreakerIndex.CompareTo(a.TieBreakerIndex);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool EvaluateTransition(StateTransition transition, ParameterStore parameters, float curNormTime, float prevNormTime)
    {
        if (transition.ExitTime.HasValue)
        {
            float exit = transition.ExitTime.Value;
            // Floor-normalized (not %): negative times still land in [0, 1).
            float prev = prevNormTime - MathF.Floor(prevNormTime);
            float cur = curNormTime - MathF.Floor(curNormTime);
            bool crossed = (prev < exit && exit <= cur) || (prev > cur && (exit >= prev || exit <= cur));
            if (!crossed)
            {
                return false;
            }
        }

        foreach (ParameterCondition condition in transition.Conditions)
        {
            if (!parameters.EvaluateCondition(condition))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Evaluates the current (possibly transitioning) motion into a frame.</summary>
    public void Evaluate(AnimationFrame outFrame, FrameArena arena, Rig rig, ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(outFrame);
        ArgumentNullException.ThrowIfNull(arena);
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);
        EnsureBound(parameters);

        ActiveTransitionData active = _activeTransition;
        if (!active.IsActive)
        {
            MotionDispatcher.Evaluate(_states[CurrentStateIndex].RootMotion, StateNormalizedTime, outFrame, arena, rig, parameters, 0);
            return;
        }

        AnimationFrame sourceFrame = arena.Alloc();
        AnimationFrame targetFrame = arena.Alloc();

        MotionDispatcher.Evaluate(_states[active.SourceStateIndex].RootMotion, StateNormalizedTime, sourceFrame, arena, rig, parameters, 0);
        MotionDispatcher.Evaluate(_states[active.TargetStateIndex].RootMotion, active.TargetNormalizedTime, targetFrame, arena, rig, parameters, 0);

        BlendingKernels.BlendFrame(outFrame, sourceFrame, targetFrame, ApplyEasing(active.Easing, active.Progress));

        arena.Free();
        arena.Free();
    }

    /// <summary>
    /// Root-joint delta over the last update. Mid-blend this mixes the source and
    /// target deltas by transition progress — matching the rendered blend instead
    /// of snapping to one side.
    /// </summary>
    public void ExtractRootDelta(Rig rig, out Vec3 deltaPos, out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(rig);

        ActiveTransitionData active = _activeTransition;
        if (!active.IsActive)
        {
            MotionDispatcher.ComputeRootDelta(_states[CurrentStateIndex].RootMotion, PreviousNormalizedTime, StateNormalizedTime, rig, out deltaPos, out deltaRot);
            return;
        }

        MotionDispatcher.ComputeRootDelta(_states[active.SourceStateIndex].RootMotion, PreviousNormalizedTime, StateNormalizedTime, rig, out Vec3 sourcePos, out Quat sourceRot);
        MotionDispatcher.ComputeRootDelta(_states[active.TargetStateIndex].RootMotion, active.TargetPreviousNormalizedTime, active.TargetNormalizedTime, rig, out Vec3 targetPos, out Quat targetRot);

        float weight = ApplyEasing(active.Easing, active.Progress);
        deltaPos = Vec3.Lerp(sourcePos, targetPos, weight);
        deltaRot = FastMath.Slerp(sourceRot, targetRot, weight);
    }

    /// <summary>
    /// Extracts the root delta for the current blend parameters. Blend-tree nodes
    /// weight their children's deltas, matching the pose that was evaluated.
    /// </summary>
    public void ExtractRootDelta(Rig rig, ParameterStore parameters, out Vec3 deltaPos, out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(parameters);

        ActiveTransitionData active = _activeTransition;
        if (!active.IsActive)
        {
            MotionDispatcher.ComputeRootDelta(_states[CurrentStateIndex].RootMotion, PreviousNormalizedTime, StateNormalizedTime, rig, parameters, out deltaPos, out deltaRot);
            return;
        }

        MotionDispatcher.ComputeRootDelta(_states[active.SourceStateIndex].RootMotion, PreviousNormalizedTime, StateNormalizedTime, rig, parameters, out Vec3 sourcePos, out Quat sourceRot);
        MotionDispatcher.ComputeRootDelta(_states[active.TargetStateIndex].RootMotion, active.TargetPreviousNormalizedTime, active.TargetNormalizedTime, rig, parameters, out Vec3 targetPos, out Quat targetRot);

        float weight = ApplyEasing(active.Easing, active.Progress);
        deltaPos = Vec3.Lerp(sourcePos, targetPos, weight);
        deltaRot = FastMath.Slerp(sourceRot, targetRot, weight);
    }

    private static float ApplyEasing(TransitionEasing easing, float progress)
    {
        float t = FastMath.Clamp01(progress);
        return easing switch
        {
            TransitionEasing.SmoothStep => t * t * (3.0f - (2.0f * t)),
            TransitionEasing.EaseIn => t * t,
            TransitionEasing.EaseOut => 1.0f - ((1.0f - t) * (1.0f - t)),
            TransitionEasing.EaseInOut => t < 0.5f
                ? 2.0f * t * t
                : 1.0f - (MathF.Pow((-2.0f * t) + 2.0f, 2.0f) * 0.5f),
            _ => t,
        };
    }
}
