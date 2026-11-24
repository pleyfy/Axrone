namespace Axrone.Scene.Runtime;

/// <summary>
/// Identifies one committed terrain chunk rendered by a scene entity. The runtime
/// resolves the terrain engine through <see cref="TerrainId"/>; the component itself stays
/// unmanaged so it can live in the scene component column.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneTerrainChunk3D : ISceneDataComponent
{
    /// <summary>Terrain runtime identity.</summary>
    public uint TerrainId;

    /// <summary>Chunk column.</summary>
    public int ChunkX;

    /// <summary>Chunk row.</summary>
    public int ChunkZ;

    /// <summary>Selected LOD level; zero for the base mesh.</summary>
    public int LodLevel;

    /// <summary>Whether the chunk renders and collides.</summary>
    public bool Enabled;

    /// <summary>Gets the chunk coordinate.</summary>
    public readonly TerrainChunkCoord Coord
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(ChunkX, ChunkZ);
    }

    /// <summary>Default chunk address with rendering enabled.</summary>
    public static SceneTerrainChunk3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new() { TerrainId = 1, LodLevel = 0, Enabled = true };
    }
}

/// <summary>Profile registration for terrain chunk components.</summary>
public static class SceneTerrainProfileExtensions
{
    /// <summary>Registers the terrain chunk component.</summary>
    /// <param name="builder">Profile builder.</param>
    /// <returns>The same builder.</returns>
    public static SceneProfileBuilder AddTerrain3D(this SceneProfileBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.AddData<SceneTerrainChunk3D>(
            "TerrainChunk3D",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 90);

        return builder;
    }
}

/// <summary>Configuration for <see cref="SceneTerrainRuntime"/>.</summary>
public sealed class SceneTerrainRuntimeOptions
{
    /// <summary>Gets the terrain runtime identity. Defaults to 1.</summary>
    public uint TerrainId { get; init; } = 1;

    /// <summary>Gets the material assigned to generated chunk meshes.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId { get; init; }

    /// <summary>Gets the render pass assigned to generated chunk meshes.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId { get; init; } = SceneRenderPassIds.Main;

    /// <summary>Gets whether chunk heightfields are attached to the 3D physics world.</summary>
    public bool AttachPhysics { get; init; } = true;
}
