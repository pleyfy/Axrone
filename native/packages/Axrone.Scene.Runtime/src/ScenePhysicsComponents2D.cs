namespace Axrone.Scene.Runtime;

/// <summary>Collider shape kinds understood by the 2D physics bridge.</summary>
public enum SceneColliderShape2D
{
    /// <summary>Uniform circle.</summary>
    Circle = 0,

    /// <summary>Axis-aligned box from half extents.</summary>
    Box = 1,

    /// <summary>Capsule along the X axis between two points.</summary>
    Capsule = 2
}

/// <summary>
/// Rigid-body data component for 2D scenes. The physics bridge reads this
/// payload to create and update the underlying body; 2D transforms are synced
/// back into <see cref="SceneTransform2D"/> after each step.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneRigidbody2D : ISceneDataComponent
{
    /// <summary>How the body moves.</summary>
    public SceneBodyType BodyType;

    /// <summary>Linear velocity applied at spawn or by kinematic drives.</summary>
    public Vec2 LinearVelocity;

    /// <summary>Angular velocity in radians per second.</summary>
    public float AngularVelocity;

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

    /// <summary>Default dynamic body with gravity and zero velocity.</summary>
    public static SceneRigidbody2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            BodyType = SceneBodyType.Dynamic,
            GravityScale = 1.0f,
            Enabled = true
        };
    }

    /// <summary>Default static body for level geometry and platforms.</summary>
    public static SceneRigidbody2D Static
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            BodyType = SceneBodyType.Static,
            Enabled = true
        };
    }
}

/// <summary>
/// Collider data component for 2D scenes. One entity carries at most one
/// collider; the physics bridge attaches it as a shape on the owning body.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneCollider2D : ISceneDataComponent
{
    /// <summary>Shape kind.</summary>
    public SceneColliderShape2D Shape;

    /// <summary>Half extents for box colliders.</summary>
    public Vec2 BoxHalfExtents;

    /// <summary>Radius for circle and capsule colliders.</summary>
    public float Radius;

    /// <summary>Half length of the capsule segment along X.</summary>
    public float CapsuleHalfHeight;

    /// <summary>Local-space offset from the entity origin.</summary>
    public Vec2 Offset;

    /// <summary>Mass per unit area.</summary>
    public float Density;

    /// <summary>Coulomb friction.</summary>
    public float Friction;

    /// <summary>Restitution in [0, 1].</summary>
    public float Restitution;

    /// <summary>Whether the collider reports overlap events without resolving contacts.</summary>
    public bool IsTrigger;

    /// <summary>Whether the collider participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default unit-circle collider with default material.</summary>
    public static SceneCollider2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Shape = SceneColliderShape2D.Circle,
            BoxHalfExtents = new Vec2(0.5f, 0.5f),
            Radius = 0.5f,
            CapsuleHalfHeight = 0.5f,
            Density = 1.0f,
            Friction = 0.2f,
            Restitution = 0.0f,
            IsTrigger = false,
            Enabled = true
        };
    }

    /// <summary>Creates a box collider from half extents.</summary>
    public static SceneCollider2D Box(float halfX, float halfY, float density = 1.0f)
    {
        var collider = Default;
        collider.Shape = SceneColliderShape2D.Box;
        collider.BoxHalfExtents = new Vec2(halfX, halfY);
        collider.Density = density;
        return collider;
    }
}
