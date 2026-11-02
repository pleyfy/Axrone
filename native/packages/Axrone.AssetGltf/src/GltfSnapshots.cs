namespace Axrone.AssetGltf;

/// <summary>Animation controller metadata.</summary>
public sealed class GltfAnimationControllerMetadata
{
    /// <summary>Parameter names.</summary>
    public ImmutableArray<string> Parameters { get; init; } = ImmutableArray<string>.Empty;

    /// <summary>Layer names.</summary>
    public ImmutableArray<string> Layers { get; init; } = ImmutableArray<string>.Empty;

    /// <summary>Clip asset keys.</summary>
    public ImmutableArray<string> Clips { get; init; } = ImmutableArray<string>.Empty;

    /// <summary>Root motion node id.</summary>
    public string? RootMotionNodeId { get; init; }
}

/// <summary>Actor component snapshot base.</summary>
public abstract record GltfComponentSnapshot;

/// <summary>Transform component snapshot.</summary>
public sealed record GltfTransformComponent(
    Vec3 Position,
    Quat Rotation,
    Vec3 Scale) : GltfComponentSnapshot;

/// <summary>Camera component snapshot.</summary>
public sealed record GltfCameraComponent(
    bool Primary,
    float Near,
    float Far,
    float FieldOfView,
    bool Orthographic,
    float OrthographicSize) : GltfComponentSnapshot;

/// <summary>Directional light component snapshot.</summary>
public sealed record GltfDirectionalLightComponent(
    Vec3 Color,
    float Intensity,
    bool Primary) : GltfComponentSnapshot;

/// <summary>Point light component snapshot.</summary>
public sealed record GltfPointLightComponent(
    Vec3 Color,
    float Intensity,
    float Range) : GltfComponentSnapshot;

/// <summary>Spot light component snapshot.</summary>
public sealed record GltfSpotLightComponent(
    Vec3 Color,
    float Intensity,
    float Range,
    float InnerConeAngle,
    float OuterConeAngle) : GltfComponentSnapshot;

/// <summary>Mesh renderer component snapshot.</summary>
public sealed record GltfMeshRendererComponent(
    string MeshId,
    string? MaterialId,
    bool Visible,
    int RenderOrder,
    string PassId,
    bool ReceiveLighting,
    string? SkinId,
    int MorphTargetCount) : GltfComponentSnapshot
{
    /// <summary>Initial morph weights (node override or mesh default).</summary>
    public ImmutableArray<float> MorphWeights { get; init; } = ImmutableArray<float>.Empty;
}

/// <summary>Animator component snapshot.</summary>
public sealed record GltfAnimatorComponent(
    ImmutableArray<string> Clips,
    string? DefaultClipId,
    bool PlayOnStart,
    bool Loop,
    float Speed) : GltfComponentSnapshot;

/// <summary>Actor snapshot.</summary>
public sealed class GltfActorSnapshot
{
    /// <summary>Node id.</summary>
    public required string NodeId { get; init; }

    /// <summary>Parent node id.</summary>
    public string? ParentNodeId { get; init; }

    /// <summary>Actor name.</summary>
    public required string Name { get; init; }

    /// <summary>Layer index.</summary>
    public int Layer { get; init; }

    /// <summary>Tag.</summary>
    public string Tag { get; init; } = "Default";

    /// <summary>Active flag.</summary>
    public bool Active { get; init; } = true;

    /// <summary>Persistent flag.</summary>
    public bool Persistent { get; init; }

    /// <summary>Pooled flag.</summary>
    public bool Pooled { get; init; }

    /// <summary>Components.</summary>
    public required ImmutableArray<GltfComponentSnapshot> Components { get; init; }
}

/// <summary>Prefab definition: actor list.</summary>
public sealed class GltfPrefabDefinition
{
    /// <summary>Actors.</summary>
    public required ImmutableArray<GltfActorSnapshot> Actors { get; init; }
}
