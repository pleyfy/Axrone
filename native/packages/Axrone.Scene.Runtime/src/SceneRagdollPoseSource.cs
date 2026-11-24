namespace Axrone.Scene.Runtime;

using Axrone.Animation;
using Axrone.Numeric;

/// <summary>
/// Binds one animated actor's bones to scene actors driven by physics and blends
/// their world transforms into the animation pose. The physics layer creates the
/// bodies and joints; this source only reads the resulting actor transforms, so it
/// stays independent of a specific ragdoll solver.
/// </summary>
public sealed class SceneRagdollPoseSource
{
    private readonly SceneWorld _world;
    private readonly Dictionary<SceneActor, SceneActor[]> _bones = new();
    private readonly Lock _gate = new();

    /// <summary>Creates a ragdoll pose source over a world.</summary>
    public SceneRagdollPoseSource(SceneWorld world)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
    }

    /// <summary>Number of bound ragdolls.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _bones.Count;
            }
        }
    }

    /// <summary>
    /// Binds bone actors in rig order. The array length must equal the rig's bone
    /// count at apply time; rebinding replaces the previous mapping.
    /// </summary>
    public void Bind(SceneActor animatedActor, ReadOnlySpan<SceneActor> boneActors)
    {
        if (!animatedActor.IsValid)
        {
            throw new ArgumentException("Animated actor is invalid.", nameof(animatedActor));
        }

        lock (_gate)
        {
            _bones[animatedActor] = boneActors.ToArray();
        }
    }

    /// <summary>Removes a binding.</summary>
    public bool Unbind(SceneActor animatedActor)
    {
        lock (_gate)
        {
            return _bones.Remove(animatedActor);
        }
    }

    /// <summary>
    /// Samples the bound bone actors and blends their world pose onto
    /// <paramref name="frame"/>. Returns false when no binding exists or an actor
    /// disappeared.
    /// </summary>
    public bool TryApply(SceneActor animatedActor, Rig rig, AnimationFrame frame, float weight = 1.0f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(frame);

        SceneActor[]? boneActors;
        lock (_gate)
        {
            if (!_bones.TryGetValue(animatedActor, out boneActors))
            {
                return false;
            }
        }

        if (boneActors.Length != rig.BoneCount || frame.BoneCount != rig.BoneCount)
        {
            return false;
        }

        var positions = new Vec3[boneActors.Length];
        var rotations = new Quat[boneActors.Length];
        for (int i = 0; i < boneActors.Length; i++)
        {
            SceneActor actor = boneActors[i];
            if (!actor.IsValid || !_world.TryGetActor(actor, out _))
            {
                return false;
            }

            Mat4 world = _world.GetWorldMatrix3D(actor);
            positions[i] = world.Translation;
            rotations[i] = Quat.Normalize(Quat.CreateFromRotationMatrix(world));
        }

        PhysicsPoseBlender.BlendWorldPose(rig, frame, positions, rotations, weight);
        return true;
    }
}
