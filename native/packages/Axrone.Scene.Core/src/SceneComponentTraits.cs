namespace Axrone.Scene;

/// <summary>
/// Registration traits that drive attachment rules, serialization and profile
/// validation. Flags are metadata only; they never enter the per-frame path.
/// </summary>
[Flags]
public enum SceneComponentTraits : ushort
{
    /// <summary>No special traits.</summary>
    None = 0,

    /// <summary>At most one instance may be attached to an entity.</summary>
    Singleton = 1 << 0,

    /// <summary>Every entity created through the world receives this component.</summary>
    Required = 1 << 1,

    /// <summary>The component is visible to editor inspectors.</summary>
    EditorVisible = 1 << 2,

    /// <summary>The component participates in snapshot serialization.</summary>
    Serializable = 1 << 3,

    /// <summary>The component is exposed but not yet production-ready.</summary>
    Experimental = 1 << 4,

    /// <summary>The component is retained for compatibility and will be removed.</summary>
    Deprecated = 1 << 5,

    /// <summary>The component may appear more than once on an entity.</summary>
    MultiInstance = 1 << 6
}
