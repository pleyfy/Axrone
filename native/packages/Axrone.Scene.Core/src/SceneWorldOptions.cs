namespace Axrone.Scene;

/// <summary>How the world reacts to a managed behaviour fault.</summary>
public enum SceneWorldErrorPolicy : byte
{
    /// <summary>Report the fault and continue with the remaining behaviours.</summary>
    IsolateBehaviours = 0,

    /// <summary>Report the fault and rethrow it, aborting the phase.</summary>
    FailFast = 1
}

/// <summary>Construction settings for a scene world.</summary>
public readonly record struct SceneWorldOptions
{
    /// <summary>Initial entity slot capacity.</summary>
    public int InitialCapacity { get; init; }

    /// <summary>Fault policy for managed behaviours.</summary>
    public SceneWorldErrorPolicy ErrorPolicy { get; init; }

    /// <summary>Creates default options: 64 entity slots and isolated behaviour faults.</summary>
    public SceneWorldOptions()
    {
        InitialCapacity = 64;
        ErrorPolicy = SceneWorldErrorPolicy.IsolateBehaviours;
    }

    /// <summary>Creates options with explicit settings.</summary>
    public SceneWorldOptions(
        int initialCapacity,
        SceneWorldErrorPolicy errorPolicy = SceneWorldErrorPolicy.IsolateBehaviours)
    {
        if (initialCapacity <= 0)
        {
            SceneThrowHelper.ThrowInvalidCapacity(initialCapacity);
        }

        InitialCapacity = initialCapacity;
        ErrorPolicy = errorPolicy;
    }
}

/// <summary>Creation settings for one scene entity.</summary>
public readonly record struct SceneEntityConfig
{
    /// <summary>Optional entity name; the default name is used when null.</summary>
    public string? Name { get; init; }

    /// <summary>Optional entity tag; the default tag is used when null.</summary>
    public string? Tag { get; init; }

    /// <summary>Entity layer.</summary>
    public ushort Layer { get; init; }

    /// <summary>Whether the entity starts active locally.</summary>
    public bool Active { get; init; }

    /// <summary>Whether the entity survives scene changes.</summary>
    public bool Persistent { get; init; }

    /// <summary>Whether the entity participates in pooling.</summary>
    public bool Pooled { get; init; }

    /// <summary>Creates default settings: active, layer zero, no persistence.</summary>
    public SceneEntityConfig()
    {
        Name = null;
        Tag = null;
        Layer = 0;
        Active = true;
        Persistent = false;
        Pooled = false;
    }

    /// <summary>Creates explicit settings.</summary>
    public SceneEntityConfig(
        string? name,
        string? tag = null,
        ushort layer = 0,
        bool active = true,
        bool persistent = false,
        bool pooled = false)
    {
        Name = name;
        Tag = tag;
        Layer = layer;
        Active = active;
        Persistent = persistent;
        Pooled = pooled;
    }
}
