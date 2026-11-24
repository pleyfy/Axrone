namespace Axrone.Scene.Runtime;

using Axrone.Animation;
using Axrone.Numeric;

/// <summary>
/// Binds one animated entity's bones to scene entities driven by physics and blends
/// their world transforms into the animation pose. The physics layer creates the
/// bodies and joints; this source only reads the resulting entity transforms, so it
/// stays independent of a specific ragdoll solver.
/// </summary>
public sealed class SceneRagdollPoseSource
{
    private readonly SceneWorld _world;
    private readonly Dictionary<SceneEntity, SceneEntity[]> _bones = new();
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
    /// Binds bone entities in rig order. The array length must equal the rig's bone
    /// count at apply time; rebinding replaces the previous mapping.
    /// </summary>
    public void Bind(SceneEntity animatedEntity, ReadOnlySpan<SceneEntity> boneEntities)
    {
        if (!animatedEntity.IsValid)
        {
            throw new ArgumentException("Animated entity is invalid.", nameof(animatedEntity));
        }

        lock (_gate)
        {
            _bones[animatedEntity] = boneEntities.ToArray();
        }
    }

    /// <summary>Removes a binding.</summary>
    public bool Unbind(SceneEntity animatedEntity)
    {
        lock (_gate)
        {
            return _bones.Remove(animatedEntity);
        }
    }

    /// <summary>
    /// Samples the bound bone entities and blends their world pose onto
    /// <paramref name="frame"/>. Returns false when no binding exists or an entity
    /// disappeared.
    /// </summary>
    public bool TryApply(SceneEntity animatedEntity, Rig rig, AnimationFrame frame, float weight = 1.0f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(frame);

        SceneEntity[]? boneEntities;
        lock (_gate)
        {
            if (!_bones.TryGetValue(animatedEntity, out boneEntities))
            {
                return false;
            }
        }

        if (boneEntities.Length != rig.BoneCount || frame.BoneCount != rig.BoneCount)
        {
            return false;
        }

        var positions = new Vec3[boneEntities.Length];
        var rotations = new Quat[boneEntities.Length];
        for (int i = 0; i < boneEntities.Length; i++)
        {
            SceneEntity entity = boneEntities[i];
            if (!entity.IsValid || !_world.TryGetEntity(entity, out _))
            {
                return false;
            }

            Mat4 world = _world.GetWorldMatrix3D(entity);
            positions[i] = world.Translation;
            rotations[i] = Quat.Normalize(Quat.CreateFromRotationMatrix(world));
        }

        PhysicsPoseBlender.BlendWorldPose(rig, frame, positions, rotations, weight);
        return true;
    }
}
