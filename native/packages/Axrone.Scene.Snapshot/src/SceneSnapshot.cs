namespace Axrone.Scene.Snapshot;

/// <summary>Stable snapshot error codes.</summary>
public static class SceneSnapshotErrorCodes
{
    /// <summary>The snapshot payload is malformed.</summary>
    public const string Invalid = "scene.snapshot.invalid";

    /// <summary>The snapshot version is not supported.</summary>
    public const string Version = "scene.snapshot.version";

    /// <summary>Loading failed and the partial payload was rolled back.</summary>
    public const string LoadFailed = "scene.snapshot.load-failed";

    /// <summary>A JSON string sequence contains an explicit null element.</summary>
    public const string InvalidNullElement = "scene.snapshot.invalid-null-element";
}

/// <summary>Snapshot failure with a stable error code.</summary>
public sealed class SceneSnapshotException : SceneException
{
    /// <summary>Creates a snapshot failure.</summary>
    public SceneSnapshotException(string code, string message, Exception? inner = null)
        : base(code, message, inner)
    {
    }
}

/// <summary>
/// Self-contained scene payload: the asset definitions a scene needs plus the
/// prefab that describes its actor hierarchy and component snapshots.
/// </summary>
public sealed class SceneSnapshot
{
    /// <summary>Current snapshot wire version.</summary>
    public const int Version = 1;

    /// <summary>Creates a snapshot.</summary>
    public SceneSnapshot(
        ScenePrefabDefinition prefab,
        IReadOnlyList<SceneShaderDefinition> shaders,
        IReadOnlyList<SceneMeshDefinition> meshes,
        IReadOnlyList<SceneMaterialDefinition> materials,
        IReadOnlyList<SceneTextureDefinition> textures,
        IReadOnlyList<SceneSamplerDefinition> samplers,
        IReadOnlyList<SceneRenderPassDefinition> renderPasses)
    {
        ArgumentNullException.ThrowIfNull(prefab);
        ArgumentNullException.ThrowIfNull(shaders);
        ArgumentNullException.ThrowIfNull(meshes);
        ArgumentNullException.ThrowIfNull(materials);
        ArgumentNullException.ThrowIfNull(textures);
        ArgumentNullException.ThrowIfNull(samplers);
        ArgumentNullException.ThrowIfNull(renderPasses);

        Prefab = prefab;
        Shaders = [.. shaders];
        Meshes = [.. meshes];
        Materials = [.. materials];
        Textures = [.. textures];
        Samplers = [.. samplers];
        RenderPasses = [.. renderPasses];
    }

    /// <summary>Scene hierarchy and component payloads.</summary>
    public ScenePrefabDefinition Prefab { get; }

    /// <summary>Shader definitions in load order.</summary>
    public IReadOnlyList<SceneShaderDefinition> Shaders { get; }

    /// <summary>Mesh definitions in load order.</summary>
    public IReadOnlyList<SceneMeshDefinition> Meshes { get; }

    /// <summary>Material definitions in load order.</summary>
    public IReadOnlyList<SceneMaterialDefinition> Materials { get; }

    /// <summary>Texture definitions in load order.</summary>
    public IReadOnlyList<SceneTextureDefinition> Textures { get; }

    /// <summary>Sampler definitions in load order.</summary>
    public IReadOnlyList<SceneSamplerDefinition> Samplers { get; }

    /// <summary>Render-pass definitions in load order.</summary>
    public IReadOnlyList<SceneRenderPassDefinition> RenderPasses { get; }

    /// <summary>Captures the live world and every asset registered in the catalog.</summary>
    public static SceneSnapshot Capture(
        SceneWorld world,
        SceneCodecRegistry codecs,
        SceneAssetRegistry assets,
        string prefabId,
        ScenePrefabMetadata? metadata = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(codecs);
        ArgumentNullException.ThrowIfNull(assets);

        ScenePrefabDefinition prefab = ScenePrefabFactory.Create(world, codecs, prefabId, metadata);

        return new SceneSnapshot(
            prefab,
            assets.Shaders.Definitions(),
            assets.Meshes.Definitions(),
            assets.Materials.Definitions(),
            assets.Textures.Definitions(),
            assets.Samplers.Definitions(),
            assets.RenderPasses.Definitions());
    }
}
