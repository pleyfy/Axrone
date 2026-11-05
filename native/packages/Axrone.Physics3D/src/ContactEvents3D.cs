namespace Axrone.Physics3D;

/// <summary>
/// Contact lifecycle observer for one world. PreSolve fires once per step slice
/// after manifolds are built and blended, before velocities are solved, and may
/// mutate the blended friction and restitution of the contact. PostSolve fires
/// once per step with the final accumulated impulses. Implementations must not
/// mutate world structure during a callback. The web reference and Physics.Core
/// reserve pre/post-solve slots; the shared cross-dimension contract is pending
/// from Physics.Core, so this 3D-local surface is the single emit point.
/// </summary>
public interface IContactEvents3D
{
    /// <summary>Called before the velocity solve of a slice; the contact is writable.</summary>
    void PreSolve(ref Contact3D contact);

    /// <summary>Called after the step with the solved contact; impulses are final.</summary>
    void PostSolve(in Contact3D contact);
}
