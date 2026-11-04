namespace Axrone.Physics3D;

/// <summary>
/// One tracked shape pair: the two bodies and shapes, whether the pair is a
/// trigger-only sensor overlap, and the contact manifold the solver iterates.
/// Mutable storage owned by the world; the solver rewrites impulses in place.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Contact3D
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>First shape.</summary>
    public ShapeId ShapeA;

    /// <summary>Second shape.</summary>
    public ShapeId ShapeB;

    /// <summary>Trigger-only overlap: reported but never solved.</summary>
    public bool IsSensor;

    /// <summary>Blended dynamic friction for the pair.</summary>
    public float Friction;

    /// <summary>Blended static friction for the pair.</summary>
    public float StaticFriction;

    /// <summary>Blended restitution for the pair.</summary>
    public float Restitution;

    /// <summary>Whether the pair surface properties have been blended.</summary>
    public bool Blended;

    /// <summary>Contact manifold; impulses accumulate across steps.</summary>
    public Manifold3D Manifold;
}
