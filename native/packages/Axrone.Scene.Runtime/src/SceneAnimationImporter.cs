namespace Axrone.Scene.Runtime;

using System.Diagnostics.CodeAnalysis;

using Axrone.Animation;
using Axrone.Numeric;
using Axrone.Scene.Assets;

/// <summary>
/// Builds native animation runtime objects from scene asset definitions: a skin's joints become a
/// <see cref="Rig"/>, glTF track definitions become <see cref="AnimationClip"/> instances, and the
/// first clip becomes a ready-to-bind <see cref="AnimationController"/>.
/// </summary>
/// <remarks>
/// This is the engine-side content bridge. It intentionally does not read glTF bytes, JSON or the
/// editor document; callers hand in the already-converted <see cref="SceneSkinDefinition"/>,
/// clip definitions and the node map produced by the scene importer. The controller starts with
/// one state so a scene can play immediately; callers that need a graph can build states from
/// <see cref="SceneAnimationImportResult.Clips"/>.
/// </remarks>
public static class SceneAnimationImporter
{
    /// <summary>
    /// Creates the runtime animation objects for one skinned actor. Returns false with a
    /// human-readable reason when the skin, clips or node map are insufficient.
    /// </summary>
    [SuppressMessage(
        "Reliability",
        "CA2000:Dispose objects before losing scope",
        Justification = "Ownership transfers to the returned SceneAnimationImportResult.")]
    public static bool TryImport(
        SceneWorld world,
        SceneSkinDefinition skin,
        IReadOnlyList<SceneAnimationClipDefinition> clips,
        IReadOnlyDictionary<string, SceneActor> nodeMap,
        IReadOnlyDictionary<string, string?> parentByNodeId,
        [NotNullWhen(true)] out SceneAnimationImportResult? result,
        out string reason)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(skin);
        ArgumentNullException.ThrowIfNull(clips);
        ArgumentNullException.ThrowIfNull(nodeMap);
        ArgumentNullException.ThrowIfNull(parentByNodeId);

        result = null;
        reason = string.Empty;

        if (skin.JointNodeIds.Count == 0)
        {
            reason = "skin has no joints";
            return false;
        }

        if (clips.Count == 0)
        {
            reason = "conversion has no animation clips";
            return false;
        }

        if (FindSkinnedActor(world, nodeMap) is not { } meshActor)
        {
            reason = "node map contains no live actor";
            return false;
        }

        world.UpdateTransforms();

        int jointCount = skin.JointNodeIds.Count;
        var jointIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        var jointActors = new SceneActor[jointCount];
        var bones = new BoneInfo[jointCount];

        for (int i = 0; i < jointCount; i++)
        {
            string nodeId = skin.JointNodeIds[i];
            jointIndex[nodeId] = i;

            if (!nodeMap.TryGetValue(nodeId, out SceneActor actor) || !world.TryGetActor(actor, out _))
            {
                reason = $"joint '{nodeId}' is missing from the instantiated hierarchy";
                return false;
            }

            jointActors[i] = actor;
            (Vec3 translation, Quat rotation, Vec3 scale) = ReadLocalTransform(world, actor);

            bones[i] = new BoneInfo
            {
                Name = nodeId,
                ParentIndex = ResolveParentJoint(jointIndex, parentByNodeId, nodeId),
                RestTranslation = translation,
                RestRotation = rotation,
                RestScale = scale,
            };
        }

        var rig = new Rig(new RigId($"skin:{skin.Id}"), bones);
        var runtimeClips = new List<AnimationClip>(clips.Count);
        SceneAnimationClipDefinition? defaultDefinition = null;

        foreach (SceneAnimationClipDefinition definition in clips)
        {
            AnimationClip? clip = BuildClip(definition, jointIndex);
            if (clip is not null)
            {
                runtimeClips.Add(clip);
                defaultDefinition ??= definition;
            }
        }

        if (runtimeClips.Count == 0)
        {
            reason = "no clip contained a usable joint track";
            return false;
        }

        var inverseBind = new Mat4[jointCount];
        ReadOnlySpan<float> inverseBindSource = skin.InverseBindMatrices.Span;
        for (int i = 0; i < jointCount; i++)
        {
            inverseBind[i] = ReadMatrix(inverseBindSource, i);
        }

        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        Dictionary<CurveId, int> curveSlots = BuildCurveLayout(clips);
        var curveLayout = new CurveLayout(curveSlots);
        int morphCurveOffset = 0;
        int morphCurveCount = 0;
        int morphCurveEnd = -1;
        foreach (KeyValuePair<CurveId, int> slot in curveSlots)
        {
            if (slot.Key.Value.Contains(":morph:", StringComparison.Ordinal))
            {
                morphCurveOffset = morphCurveCount == 0 ? slot.Value : Math.Min(morphCurveOffset, slot.Value);
                morphCurveEnd = Math.Max(morphCurveEnd, slot.Value);
                morphCurveCount = morphCurveEnd - morphCurveOffset + 1;
            }
        }

        var controller = new AnimationController(rig, parameters, curveLayout);
        var states = new AnimationState[runtimeClips.Count];
        for (int i = 0; i < runtimeClips.Count; i++)
        {
            string stateName = runtimeClips[i].Id.ToString();
            if (string.IsNullOrWhiteSpace(stateName))
            {
                stateName = $"clip{i}";
            }

            states[i] = new AnimationState(new StateId(stateName), new ClipMotionNode(runtimeClips[i]));
        }

        var baseLayer = new AnimationLayer(
            new LayerId("base"),
            new StateMachineInstance(states, Array.Empty<StateTransition>(), 0));
        controller.AddLayer(baseLayer);

        var binding = new SceneAnimationBinding
        {
            Skin = skin.Id,
            DefaultClip = defaultDefinition?.Id ?? default,
        };
        if (world.Registry.TryGetDataByType(typeof(SceneAnimationBinding), out _))
        {
            if (world.HasData<SceneAnimationBinding>(meshActor))
            {
                world.SetData(meshActor, binding);
            }
            else
            {
                world.AddData(meshActor, binding);
            }
        }

        if (world.Registry.TryGetDataByType(typeof(SceneAnimator), out _))
        {
            if (world.HasData<SceneAnimator>(meshActor))
            {
                ref SceneAnimator live = ref world.GetData<SceneAnimator>(meshActor);
                live.MorphCurveOffset = morphCurveOffset;
                live.MorphCurveCount = morphCurveCount;
            }
            else
            {
                SceneAnimator animator = SceneAnimator.Default;
                animator.MorphCurveOffset = morphCurveOffset;
                animator.MorphCurveCount = morphCurveCount;
                world.AddData(meshActor, animator);
            }
        }

        result = new SceneAnimationImportResult(
            meshActor,
            rig,
            runtimeClips,
            controller,
            inverseBind,
            jointActors,
            baseLayer,
            curveLayout);
        return true;
    }

    private static Dictionary<CurveId, int> BuildCurveLayout(IReadOnlyList<SceneAnimationClipDefinition> clips)
    {
        var slots = new Dictionary<CurveId, int>();
        foreach (SceneAnimationClipDefinition clip in clips)
        {
            foreach (SceneAnimationTrackDefinition track in clip.Tracks)
            {
                if (track.Path != SceneAnimationPath.Weights ||
                    track.ValueComponentCount <= 0 ||
                    string.IsNullOrEmpty(track.TargetNodeId))
                {
                    continue;
                }

                for (int component = 0; component < track.ValueComponentCount; component++)
                {
                    var id = new CurveId($"{track.TargetNodeId}:morph:{component}");
                    if (!slots.ContainsKey(id))
                    {
                        slots[id] = slots.Count;
                    }
                }
            }
        }

        return slots;
    }

    private static AnimationClip? BuildClip(
        SceneAnimationClipDefinition definition,
        Dictionary<string, int> jointIndex)
    {
        List<AnimationChannel> channels = [];

        foreach (SceneAnimationTrackDefinition track in definition.Tracks)
        {
            if (track.KeyframeCount == 0)
            {
                continue;
            }

            InterpolationMode interpolation = track.Interpolation switch
            {
                SceneAnimationInterpolation.Step => InterpolationMode.Step,
                SceneAnimationInterpolation.CubicSpline => InterpolationMode.CubicSpline,
                _ => InterpolationMode.Linear,
            };

            if (track.Path == SceneAnimationPath.Weights)
            {
                AppendMorphChannels(channels, track, interpolation);
                continue;
            }

            if (!jointIndex.TryGetValue(track.TargetNodeId, out int boneIndex))
            {
                continue;
            }

            ChannelTarget? target = track.Path switch
            {
                SceneAnimationPath.Translation => ChannelTarget.Translation,
                SceneAnimationPath.Rotation => ChannelTarget.Rotation,
                SceneAnimationPath.Scale => ChannelTarget.Scale,
                _ => null,
            };

            if (target is null)
            {
                continue;
            }

            int componentCount = target.Value switch
            {
                ChannelTarget.Rotation => 4,
                _ => 3,
            };

            if (track.ValueComponentCount < componentCount)
            {
                continue;
            }

            channels.Add(new AnimationChannel(
                boneIndex,
                target.Value,
                interpolation,
                track.Times.ToArray(),
                track.Values.ToArray()));
        }

        if (channels.Count == 0)
        {
            return null;
        }

        return new AnimationClip(
            new ClipId(definition.Id.ToString()),
            definition.Duration,
            channels.ToArray(),
            tags: definition.Tags);
    }

    private static void AppendMorphChannels(
        List<AnimationChannel> channels,
        SceneAnimationTrackDefinition track,
        InterpolationMode interpolation)
    {
        if (track.ValueComponentCount <= 0 || string.IsNullOrEmpty(track.TargetNodeId))
        {
            return;
        }

        ReadOnlySpan<float> times = track.Times.Span;
        ReadOnlySpan<float> values = track.Values.Span;
        int stride = track.SampleStride;
        int components = track.ValueComponentCount;
        bool cubic = interpolation == InterpolationMode.CubicSpline;
        int keyCount = track.KeyframeCount;

        for (int component = 0; component < components; component++)
        {
            var componentValues = new float[keyCount * (cubic ? 3 : 1)];
            for (int key = 0; key < keyCount; key++)
            {
                int offset = (key * stride) + (cubic ? component * 3 : component);
                if (cubic)
                {
                    componentValues[(key * 3) + 0] = values[offset + 0];
                    componentValues[(key * 3) + 1] = values[offset + 1];
                    componentValues[(key * 3) + 2] = values[offset + 2];
                }
                else
                {
                    componentValues[key] = values[offset];
                }
            }

            channels.Add(new AnimationChannel(
                -1,
                ChannelTarget.Curve,
                interpolation,
                times.ToArray(),
                componentValues,
                new CurveId($"{track.TargetNodeId}:morph:{component}")));
        }
    }

    private static SceneActor? FindSkinnedActor(
        SceneWorld world,
        IReadOnlyDictionary<string, SceneActor> nodeMap)
    {
        SceneActor? fallback = null;

        foreach (SceneActor actor in nodeMap.Values)
        {
            if (!world.TryGetActor(actor, out _))
            {
                continue;
            }

            fallback ??= actor;
            if (world.HasData<global::Axrone.Scene.Rendering.SceneSkinnedMeshRenderer>(actor))
            {
                return actor;
            }
        }

        return fallback;
    }

    private static (Vec3 Translation, Quat Rotation, Vec3 Scale) ReadLocalTransform(
        SceneWorld world,
        SceneActor actor)
    {
        if (!world.TryGetData(actor, out SceneTransform3D transform))
        {
            return (Vec3.Zero, Quat.Identity, Vec3.One);
        }

        return (transform.Position, transform.Rotation, transform.Scale);
    }

    private static int ResolveParentJoint(
        Dictionary<string, int> jointIndex,
        IReadOnlyDictionary<string, string?> parentByNodeId,
        string nodeId)
    {
        string? parent = parentByNodeId.TryGetValue(nodeId, out string? direct) ? direct : null;

        while (parent is not null)
        {
            if (jointIndex.TryGetValue(parent, out int index))
            {
                return index;
            }

            parent = parentByNodeId.TryGetValue(parent, out string? next) ? next : null;
        }

        return -1;
    }

    private static Mat4 ReadMatrix(ReadOnlySpan<float> matrices, int index)
    {
        int offset = index * 16;
        if (matrices.Length < offset + 16)
        {
            return Mat4.Identity;
        }

        return new Mat4(
            matrices[offset + 0], matrices[offset + 1], matrices[offset + 2], matrices[offset + 3],
            matrices[offset + 4], matrices[offset + 5], matrices[offset + 6], matrices[offset + 7],
            matrices[offset + 8], matrices[offset + 9], matrices[offset + 10], matrices[offset + 11],
            matrices[offset + 12], matrices[offset + 13], matrices[offset + 14], matrices[offset + 15]);
    }
}

/// <summary>Runtime animation objects produced from one converted scene skin.</summary>
public sealed record SceneAnimationImportResult(
    SceneActor MeshActor,
    Rig Rig,
    IReadOnlyList<AnimationClip> Clips,
    AnimationController Controller,
    IReadOnlyList<Mat4> InverseBind,
    IReadOnlyList<SceneActor> JointActors,
    AnimationLayer BaseLayer,
    CurveLayout CurveLayout) : IDisposable
{
    /// <summary>Disposes the owned controller.</summary>
    public void Dispose() => Controller.Dispose();
}
