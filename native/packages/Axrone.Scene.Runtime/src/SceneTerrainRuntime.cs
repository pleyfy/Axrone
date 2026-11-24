namespace Axrone.Scene.Runtime;

using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;

/// <summary>Scene entity and optional physics attachment owned by one terrain chunk.</summary>
/// <param name="Entity">Rendering entity.</param>
/// <param name="Physics">Heightfield attachment, or <see langword="null"/> without physics.</param>
/// <param name="LodLevel">Current mesh LOD level.</param>
public readonly record struct SceneTerrainChunkHandle(
    SceneEntity Entity,
    TerrainPhysicsAttachment? Physics,
    int LodLevel);

/// <summary>
/// Binds a <see cref="TerrainChunkEngine"/> to the scene: each committed chunk becomes a
/// mesh asset, an entity with a mesh renderer and <see cref="SceneTerrainChunk3D"/>, and an
/// optional static heightfield body.
/// </summary>
public sealed class SceneTerrainRuntime : IDisposable
{
    private readonly SceneWorld _world;
    private readonly SceneAssetRegistry _assets;
    private readonly TerrainChunkEngine _engine;
    private readonly ScenePhysicsBridge3D? _physics;
    private readonly SceneTerrainRuntimeOptions _options;
    private readonly SceneAssetId<MaterialAssetTag> _materialId;
    private readonly Dictionary<TerrainChunkCoord, TerrainChunkEntity> _chunks = [];
    private bool _disposed;

    /// <summary>Creates a terrain runtime over explicit scene services.</summary>
    /// <param name="world">Scene world that receives chunk entities.</param>
    /// <param name="assets">Asset catalog that receives chunk meshes.</param>
    /// <param name="engine">Terrain chunk engine; the runtime does not own it.</param>
    /// <param name="options">Terrain presentation options.</param>
    /// <param name="physics">Optional physics bridge.</param>
    public SceneTerrainRuntime(
        SceneWorld world,
        SceneAssetRegistry assets,
        TerrainChunkEngine engine,
        SceneTerrainRuntimeOptions options,
        ScenePhysicsBridge3D? physics = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);

        _world = world;
        _assets = assets;
        _engine = engine;
        _options = options;
        _physics = physics;
        _materialId = options.MaterialId.IsValid
            ? options.MaterialId
            : SceneTerrainMaterialFactory.EnsureDefault(assets);
    }

    /// <summary>Creates a terrain runtime over a scene runtime's world, assets and physics.</summary>
    /// <param name="runtime">Scene runtime composition root.</param>
    /// <param name="engine">Terrain chunk engine; the runtime does not own it.</param>
    /// <param name="options">Terrain presentation options.</param>
    public SceneTerrainRuntime(
        SceneRuntime runtime,
        TerrainChunkEngine engine,
        SceneTerrainRuntimeOptions options)
        : this(
            (runtime ?? throw new ArgumentNullException(nameof(runtime))).World,
            runtime.Assets,
            engine,
            options,
            runtime.Physics)
    {
    }

    /// <summary>Gets the terrain chunk engine.</summary>
    public TerrainChunkEngine Engine => _engine;

    /// <summary>Gets the number of scene-bound chunks.</summary>
    public int ChunkCount => _chunks.Count;

    /// <summary>Gets the coordinates of every scene-bound chunk.</summary>
    public IEnumerable<TerrainChunkCoord> ChunkCoords => _chunks.Keys;

    /// <summary>Commits a terrain chunk at LOD zero.</summary>
    /// <param name="coord">Chunk coordinate.</param>
    /// <returns><see langword="true"/> when the chunk was bound.</returns>
    public bool CommitChunk(TerrainChunkCoord coord) => CommitChunk(coord, 0);

    /// <summary>Commits a terrain chunk and publishes its scene entity, mesh and collider.</summary>
    /// <param name="coord">Chunk coordinate.</param>
    /// <param name="lodLevel">Mesh LOD level in <c>[0, 2]</c>.</param>
    /// <returns><see langword="true"/> when the chunk was bound.</returns>
    /// <exception cref="TerrainException">The LOD level is invalid.</exception>
    /// <exception cref="ObjectDisposedException">The runtime is disposed.</exception>
    public bool CommitChunk(TerrainChunkCoord coord, int lodLevel)
    {
        ThrowIfDisposed();
        if (!TerrainChunkLod.IsValid(lodLevel))
        {
            throw new TerrainException(
                FormattableString.Invariant($"Invalid terrain LOD level: {lodLevel}."),
                TerrainErrorCode.ValidationFailed);
        }

        if (_chunks.ContainsKey(coord) || !_engine.CommitChunk(coord))
        {
            return false;
        }

        SceneEntity entity = default;
        SceneAssetId<MeshAssetTag> meshId = default;
        TerrainPhysicsAttachment? physics = null;
        var entityCreated = false;
        var meshRegistered = false;

        try
        {
            TerrainVertexMesh mesh = _engine.BuildChunkLodMesh(coord, lodLevel)
                ?? throw new TerrainException("Committed chunk produced no mesh.", TerrainErrorCode.ValidationFailed);

            string name = FormattableString.Invariant($"terrain/{_options.TerrainId}/{coord.X}/{coord.Z}");
            meshId = _assets.CreateId<MeshAssetTag>(name);
            _assets.Meshes.Register(TerrainChunkMeshAdapter.Create(meshId, mesh));
            meshRegistered = true;

            entity = _world.CreateEntity(new SceneEntityConfig(name));
            entityCreated = true;

            Vec3 center = ChunkCenter(coord);
            if (_world.HasTransform3D)
            {
                _world.GetTransform3D(entity).SetPosition(center);
            }

            SceneMeshRenderer renderer = SceneMeshRenderer.Default;
            renderer.MeshId = meshId;
            renderer.MaterialId = _materialId;
            renderer.PassId = _options.PassId;
            _world.AddData(entity, renderer);

            var component = new SceneTerrainChunk3D
            {
                TerrainId = _options.TerrainId,
                ChunkX = coord.X,
                ChunkZ = coord.Z,
                LodLevel = lodLevel,
                Enabled = true,
            };
            _world.AddData(entity, component);

            if (_options.AttachPhysics && _physics is not null)
            {
                TerrainHeightfieldSource? source = _engine.CreateHeightfieldSource(coord);
                if (source is not null)
                {
                    physics = SceneTerrainPhysicsBinder.Attach(_physics, source, center);
                }
            }

            _chunks.Add(coord, new TerrainChunkEntity(entity, meshId, physics, lodLevel));
            return true;
        }
        catch
        {
            if (physics is { } attachment && _physics is not null)
            {
                SceneTerrainPhysicsBinder.Detach(_physics, attachment);
            }

            if (entityCreated)
            {
                _world.DestroyEntity(entity);
            }

            if (meshRegistered)
            {
                _assets.Meshes.Remove(meshId, out _);
            }

            _engine.DecommitChunk(coord);
            throw;
        }
    }

    /// <summary>Removes a scene-bound chunk and its mesh, entity and collider.</summary>
    /// <param name="coord">Chunk coordinate.</param>
    /// <returns><see langword="true"/> when the chunk was bound.</returns>
    /// <exception cref="ObjectDisposedException">The runtime is disposed.</exception>
    public bool DecommitChunk(TerrainChunkCoord coord)
    {
        ThrowIfDisposed();
        return DecommitChunkCore(coord);
    }

    private bool DecommitChunkCore(TerrainChunkCoord coord)
    {
        if (!_chunks.Remove(coord, out TerrainChunkEntity entry))
        {
            return false;
        }

        if (entry.Physics is { } attachment && _physics is not null)
        {
            SceneTerrainPhysicsBinder.Detach(_physics, attachment);
        }

        _world.DestroyEntity(entry.Entity);
        _assets.Meshes.Remove(entry.MeshId, out _);
        _engine.DecommitChunk(coord);
        return true;
    }

    /// <summary>Rebuilds a bound chunk's mesh at a new LOD without releasing its terrain data.</summary>
    /// <param name="coord">Chunk coordinate.</param>
    /// <param name="lodLevel">New LOD level in <c>[0, 2]</c>.</param>
    /// <returns><see langword="true"/> when the chunk was bound and the mesh was rebuilt.</returns>
    /// <exception cref="TerrainException">The LOD level is invalid.</exception>
    /// <exception cref="ObjectDisposedException">The runtime is disposed.</exception>
    public bool RebuildChunk(TerrainChunkCoord coord, int lodLevel)
    {
        ThrowIfDisposed();
        if (!TerrainChunkLod.IsValid(lodLevel))
        {
            throw new TerrainException(
                FormattableString.Invariant($"Invalid terrain LOD level: {lodLevel}."),
                TerrainErrorCode.ValidationFailed);
        }

        if (!_chunks.TryGetValue(coord, out TerrainChunkEntity entry))
        {
            return false;
        }

        TerrainVertexMesh? mesh = _engine.BuildChunkLodMesh(coord, lodLevel);
        if (mesh is null)
        {
            return false;
        }

        _assets.Meshes.Register(TerrainChunkMeshAdapter.Create(entry.MeshId, mesh));

        ref SceneMeshRenderer renderer = ref _world.GetData<SceneMeshRenderer>(entry.Entity);
        renderer.MeshId = entry.MeshId;

        ref SceneTerrainChunk3D component = ref _world.GetData<SceneTerrainChunk3D>(entry.Entity);
        component.LodLevel = lodLevel;

        _chunks[coord] = entry with { LodLevel = lodLevel };
        return true;
    }

    /// <summary>Reads the scene handle for a bound chunk.</summary>
    /// <param name="coord">Chunk coordinate.</param>
    /// <param name="handle">Receives the entity and physics attachment.</param>
    /// <returns><see langword="true"/> when the chunk is bound.</returns>
    public bool TryGetChunk(TerrainChunkCoord coord, out SceneTerrainChunkHandle handle)
    {
        ThrowIfDisposed();
        if (_chunks.TryGetValue(coord, out TerrainChunkEntity entry))
        {
            handle = new SceneTerrainChunkHandle(entry.Entity, entry.Physics, entry.LodLevel);
            return true;
        }

        handle = default;
        return false;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        TerrainChunkCoord[] coords = [.. _chunks.Keys];
        foreach (TerrainChunkCoord coord in coords)
        {
            DecommitChunkCore(coord);
        }

        _disposed = true;
    }

    private Vec3 ChunkCenter(TerrainChunkCoord coord)
    {
        float half = _engine.ChunkSpan * 0.5f;
        return new Vec3((coord.X * _engine.ChunkSpan) + half, 0f, (coord.Z * _engine.ChunkSpan) + half);
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

    private readonly record struct TerrainChunkEntity(
        SceneEntity Entity,
        SceneAssetId<MeshAssetTag> MeshId,
        TerrainPhysicsAttachment? Physics,
        int LodLevel);
}
