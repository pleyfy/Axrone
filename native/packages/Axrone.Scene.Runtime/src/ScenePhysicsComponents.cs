namespace Axrone.Scene.Runtime;

/// <summary>How a scene entity's physics body moves.</summary>
public enum SceneBodyType
{
    /// <summary>Simulated under gravity and forces.</summary>
    Dynamic = 0,

    /// <summary>Infinite mass, driven only by transforms.</summary>
    Static = 1,

    /// <summary>Driven by user velocity, unaffected by forces.</summary>
    Kinematic = 2
}

/// <summary>
/// Rigid-body data component. The physics bridge reads this payload to create
/// and update the underlying <c>BodyId</c>; transforms are synced from the
/// physics world back into <c>SceneTransform3D</c> after each step.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneRigidbody3D : ISceneDataComponent
{
    /// <summary>How the body moves.</summary>
    public SceneBodyType BodyType;

    /// <summary>Linear velocity applied at spawn or by kinematic drives.</summary>
    public Vec3 LinearVelocity;

    /// <summary>Angular velocity in radians per second.</summary>
    public Vec3 AngularVelocity;

    /// <summary>Linear damping.</summary>
    public float LinearDamping;

    /// <summary>Angular damping.</summary>
    public float AngularDamping;

    /// <summary>Gravity multiplier.</summary>
    public float GravityScale;

    /// <summary>Mass override; zero uses density-derived mass from colliders.</summary>
    public float Mass;

    /// <summary>Whether the body participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default dynamic body with gravity, zero velocity.</summary>
    public static SceneRigidbody3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            BodyType = SceneBodyType.Dynamic,
            LinearVelocity = default,
            AngularVelocity = default,
            LinearDamping = 0.0f,
            AngularDamping = 0.0f,
            GravityScale = 1.0f,
            Mass = 0.0f,
            Enabled = true
        };
    }

    /// <summary>Default static body for level geometry.</summary>
    public static SceneRigidbody3D Static
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            BodyType = SceneBodyType.Static,
            Enabled = true
        };
    }
}

/// <summary>Collider shape kinds understood by the 3D physics bridge.</summary>
public enum SceneColliderShape3D
{
    /// <summary>Uniform sphere.</summary>
    Sphere = 0,

    /// <summary>Axis-aligned box from half extents.</summary>
    Box = 1,

    /// <summary>Capsule along the Y axis.</summary>
    Capsule = 2
}

/// <summary>
/// Collider data component. One entity can carry multiple colliders; the
/// physics bridge attaches each as a shape on the owning body.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneCollider3D : ISceneDataComponent
{
    /// <summary>Shape kind.</summary>
    public SceneColliderShape3D Shape;

    /// <summary>Half extents for box colliders.</summary>
    public Vec3 BoxHalfExtents;

    /// <summary>Radius for sphere and capsule colliders.</summary>
    public float Radius;

    /// <summary>Half height for capsule colliders.</summary>
    public float CapsuleHalfHeight;

    /// <summary>Local-space offset from the entity origin.</summary>
    public Vec3 Offset;

    /// <summary>Mass per unit volume.</summary>
    public float Density;

    /// <summary>Coulomb friction.</summary>
    public float Friction;

    /// <summary>Restitution in [0, 1].</summary>
    public float Restitution;

    /// <summary>Whether the collider reports overlap events without resolving contacts.</summary>
    public bool IsTrigger;

    /// <summary>Whether the collider participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default unit-sphere collider with default material.</summary>
    public static SceneCollider3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Shape = SceneColliderShape3D.Sphere,
            BoxHalfExtents = new Vec3(0.5f, 0.5f, 0.5f),
            Radius = 0.5f,
            CapsuleHalfHeight = 0.5f,
            Offset = default,
            Density = 1.0f,
            Friction = 0.2f,
            Restitution = 0.0f,
            IsTrigger = false,
            Enabled = true
        };
    }

    /// <summary>Creates a box collider from full extents.</summary>
    public static SceneCollider3D Box(float halfX, float halfY, float halfZ, float density = 1.0f)
    {
        var collider = Default;
        collider.Shape = SceneColliderShape3D.Box;
        collider.BoxHalfExtents = new Vec3(halfX, halfY, halfZ);
        collider.Density = density;
        return collider;
    }
}
