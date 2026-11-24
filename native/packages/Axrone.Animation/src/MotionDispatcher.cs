namespace Axrone.Animation;

/// <summary>
/// Closed-world graph dispatch: the motion kinds form a fixed set of sealed
/// node types, so every edge routes through a <see cref="MotionKind"/> switch
/// instead of a virtual call. Each arm targets a sealed override the JIT can
/// inline — a heterogeneous recursive graph cannot be monomorphized with
/// static-abstract members (storage would erase the type), and this switch
/// is the exact C#-idiomatic equivalent: one predictable branch per edge,
/// zero vtable, inlinable leaves.
/// Virtual members stay as the extensibility contract; every internal edge
/// uses this dispatcher.
/// </summary>
public static class MotionDispatcher
{
    /// <summary>Evaluates a node into a frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Evaluate(
        MotionNode node,
        float normalizedTime,
        AnimationFrame outFrame,
        FrameArena arena,
        Rig rig,
        ParameterStore parameters,
        int depth)
    {
        ArgumentNullException.ThrowIfNull(node);
        switch (node.Kind)
        {
            case MotionKind.Clip:
                ((ClipMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            case MotionKind.Blend1D:
                ((Blend1DMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            case MotionKind.Blend2D:
                ((Blend2DMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            case MotionKind.Direct:
                ((DirectMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            case MotionKind.Additive:
                ((AdditiveMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            case MotionKind.MotionMatching:
                ((MotionMatchingMotionNode)node).Evaluate(normalizedTime, outFrame, arena, rig, parameters, depth);
                break;
            default:
                AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'.");
                break;
        }
    }

    /// <summary>Computes a node's root-joint delta.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ComputeRootDelta(
        MotionNode node,
        float prevNormTime,
        float curNormTime,
        Rig rig,
        out Vec3 deltaPos,
        out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(node);
        switch (node.Kind)
        {
            case MotionKind.Clip:
                ((ClipMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.Blend1D:
                ((Blend1DMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.Blend2D:
                ((Blend2DMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.Direct:
                ((DirectMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.Additive:
                ((AdditiveMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.MotionMatching:
                ((MotionMatchingMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            default:
                AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'.");
                deltaPos = Vec3.Zero;
                deltaRot = Quat.Identity;
                break;
        }
    }

    /// <summary>Computes a node's root-joint delta for the current blend parameters.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ComputeRootDelta(
        MotionNode node,
        float prevNormTime,
        float curNormTime,
        Rig rig,
        ParameterStore parameters,
        out Vec3 deltaPos,
        out Quat deltaRot)
    {
        ArgumentNullException.ThrowIfNull(node);
        ArgumentNullException.ThrowIfNull(parameters);
        switch (node.Kind)
        {
            case MotionKind.Clip:
                ((ClipMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.Blend1D:
                ((Blend1DMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, parameters, out deltaPos, out deltaRot);
                break;
            case MotionKind.Blend2D:
                ((Blend2DMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, parameters, out deltaPos, out deltaRot);
                break;
            case MotionKind.Direct:
                ((DirectMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, parameters, out deltaPos, out deltaRot);
                break;
            case MotionKind.Additive:
                ((AdditiveMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            case MotionKind.MotionMatching:
                ((MotionMatchingMotionNode)node).ComputeRootDelta(prevNormTime, curNormTime, rig, out deltaPos, out deltaRot);
                break;
            default:
                AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'.");
                deltaPos = Vec3.Zero;
                deltaRot = Quat.Identity;
                break;
        }
    }

    /// <summary>Collects a node's clip events into a zero-allocation sink.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static void CombineWeightedRootDeltas(
        MotionNode[] children,
        ReadOnlySpan<float> weights,
        float prevNormTime,
        float curNormTime,
        Rig rig,
        out Vec3 deltaPos,
        out Quat deltaRot)
    {
        Vec3 position = Vec3.Zero;
        Vec4 rotation = Vec4.Zero;
        Quat reference = Quat.Identity;
        float totalWeight = 0.0f;
        bool first = true;

        int count = Math.Min(children.Length, weights.Length);
        for (int i = 0; i < count; i++)
        {
            float weight = weights[i];
            if (!float.IsFinite(weight) || weight <= 0.0f)
            {
                continue;
            }

            ComputeRootDelta(children[i], prevNormTime, curNormTime, rig, out Vec3 childPos, out Quat childRot);
            totalWeight += weight;
            position += childPos * weight;

            if (first)
            {
                reference = childRot;
                first = false;
            }

            float dot = Quat.Dot(childRot, reference);
            Vec4 lane = new(childRot.X, childRot.Y, childRot.Z, childRot.W);
            rotation += dot < 0.0f ? -lane * weight : lane * weight;
        }

        if (totalWeight <= AnimationConstants.BlendEpsilon)
        {
            deltaPos = Vec3.Zero;
            deltaRot = Quat.Identity;
            return;
        }

        float inverse = 1.0f / totalWeight;
        deltaPos = position * inverse;
        deltaRot = Quat.Normalize(new Quat(rotation.X, rotation.Y, rotation.Z, rotation.W));
    }

    /// <summary>Collects a node's clip events into a zero-allocation sink.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void CollectEvents<TSink>(
        MotionNode node,
        float prevNormTime,
        float curNormTime,
        float layerWeight,
        ref TSink sink)
        where TSink : struct, IClipEventSink
    {
        ArgumentNullException.ThrowIfNull(node);
        switch (node.Kind)
        {
            case MotionKind.Clip:
                ((ClipMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            case MotionKind.Blend1D:
                ((Blend1DMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            case MotionKind.Blend2D:
                ((Blend2DMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            case MotionKind.Direct:
                ((DirectMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            case MotionKind.Additive:
                ((AdditiveMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            case MotionKind.MotionMatching:
                ((MotionMatchingMotionNode)node).CollectEvents(prevNormTime, curNormTime, layerWeight, ref sink);
                break;
            default:
                AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'.");
                break;
        }
    }

    /// <summary>Collects a node's clip events into a collection.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void CollectEvents(
        MotionNode node,
        float prevNormTime,
        float curNormTime,
        float layerWeight,
        ICollection<ClipEvent> outEvents)
    {
        ArgumentNullException.ThrowIfNull(outEvents);
        var adapter = new CollectionEventSinkAdapter(outEvents);
        CollectEvents(node, prevNormTime, curNormTime, layerWeight, ref adapter);
    }

    /// <summary>Reads a node's wall-clock duration.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float GetDuration(MotionNode node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return node.Kind switch
        {
            MotionKind.Clip => ((ClipMotionNode)node).GetDuration(),
            MotionKind.Blend1D => ((Blend1DMotionNode)node).GetDuration(),
            MotionKind.Blend2D => ((Blend2DMotionNode)node).GetDuration(),
            MotionKind.Direct => ((DirectMotionNode)node).GetDuration(),
            MotionKind.Additive => ((AdditiveMotionNode)node).GetDuration(),
            MotionKind.MotionMatching => ((MotionMatchingMotionNode)node).GetDuration(),
            _ => throw new EvaluationException(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'."),
        };
    }

    /// <summary>
    /// Reads a node's wall-clock duration for the current blend parameters. Blend
    /// nodes follow the active child weights instead of averaging every child, so
    /// a locomotion blend advances at the speed of the clips actually playing.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float GetDuration(MotionNode node, ParameterStore parameters)
    {
        ArgumentNullException.ThrowIfNull(node);
        ArgumentNullException.ThrowIfNull(parameters);
        return node.Kind switch
        {
            MotionKind.Clip => ((ClipMotionNode)node).GetDuration(),
            MotionKind.Blend1D => ((Blend1DMotionNode)node).GetDuration(parameters),
            MotionKind.Blend2D => ((Blend2DMotionNode)node).GetDuration(parameters),
            MotionKind.Direct => ((DirectMotionNode)node).GetDuration(parameters),
            MotionKind.Additive => GetDuration(((AdditiveMotionNode)node).BaseChild, parameters),
            MotionKind.MotionMatching => ((MotionMatchingMotionNode)node).GetDuration(parameters),
            _ => throw new EvaluationException(AnimationErrorCode.EvaluationMotionKindInvalid, $"Unknown motion kind '{node.Kind}'."),
        };
    }
}
