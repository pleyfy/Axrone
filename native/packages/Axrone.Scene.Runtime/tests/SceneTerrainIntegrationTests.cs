namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Physics3D;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using Axrone.Terrain;
using FluentAssertions;
using Xunit;

public sealed class SceneTerrainIntegrationTests
{
    private sealed class FlatSurface : ITerrainSurface
    {
        public float SampleHeight(float worldX, float worldZ) => 0.5f;

        public void SampleRow(float startX, float worldZ, float stepX, Span<float> destination) =>
            destination.Fill(0.5f);
    }

    private static TerrainChunkEngine CreateEngine(int poolCapacity = 4) =>
        new(new TerrainChunkEngineOptions
        {
            Surface = new FlatSurface(),
            CellSize = 1f,
            MaxHeight = 10f,
            PoolCapacity = poolCapacity,
        });

    [Fact]
    public void MeshAdapterProducesSceneVertexLayout()
    {
        using TerrainChunkEngine engine = CreateEngine();
        var coord = new TerrainChunkCoord(0, 0);
        engine.CommitChunk(coord);
        TerrainVertexMesh mesh = engine.BuildChunkVertexMesh(coord)!;

        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("terrain/test");
        SceneMeshDefinition definition = TerrainChunkMeshAdapter.Create(id, mesh);

        definition.VertexStride.Should().Be(TerrainChunkMeshAdapter.VertexStride);
        definition.VertexCount.Should().Be(TerrainChunkLayout.VertexCount);
        definition.IndexFormat.Should().Be(SceneIndexFormat.UInt32);
        definition.IndexCount.Should().Be(TerrainChunkLayout.IndexCount);
        definition.Bounds.Should().NotBeNull();

        Vec3 first = TerrainChunkMeshAdapter.ReadPosition(definition.Vertices.Span, 0);
        first.X.Should().BeApproximately(mesh.Vertices[0].Position.X, 1e-5f);
        first.Y.Should().BeApproximately(mesh.Vertices[0].Position.Y, 1e-5f);
        first.Z.Should().BeApproximately(mesh.Vertices[0].Position.Z, 1e-5f);
    }

    [Fact]
    public void RuntimeBindsChunkToEntityMeshAndComponent()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 7, AttachPhysics = false });

        var coord = new TerrainChunkCoord(0, 0);
        terrain.CommitChunk(coord).Should().BeTrue();

        terrain.ChunkCount.Should().Be(1);
        engine.ChunkCount.Should().Be(1);
        assets.Meshes.Count.Should().Be(1);
        world.ActiveEntityCount.Should().Be(1);

        SceneEntity entity = default;
        foreach (SceneEntity candidate in world.Entities)
        {
            entity = candidate;
            break;
        }

        world.TryGetData(entity, out SceneTerrainChunk3D component).Should().BeTrue();
        component.TerrainId.Should().Be(7u);
        component.Coord.Should().Be(coord);

        world.TryGetData(entity, out SceneMeshRenderer renderer).Should().BeTrue();
        assets.Meshes.TryGet(renderer.MeshId, out _).Should().BeTrue();
        renderer.MaterialId.IsValid.Should().BeTrue();
        assets.Materials.TryGet(renderer.MaterialId, out _).Should().BeTrue();

        terrain.TryGetChunk(coord, out SceneTerrainChunkHandle handle).Should().BeTrue();
        handle.Entity.Should().Be(entity);
        handle.Physics.Should().BeNull();

        terrain.DecommitChunk(coord).Should().BeTrue();
        terrain.ChunkCount.Should().Be(0);
        engine.ChunkCount.Should().Be(0);
        assets.Meshes.Count.Should().Be(0);
        world.ActiveEntityCount.Should().Be(0);
    }

    [Fact]
    public void RuntimeAttachesAndDetachesHeightfield()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        using var bridge = new ScenePhysicsBridge3D(world);
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 3, AttachPhysics = true },
            bridge);

        var coord = new TerrainChunkCoord(0, 0);
        terrain.CommitChunk(coord).Should().BeTrue();

        terrain.TryGetChunk(coord, out SceneTerrainChunkHandle handle).Should().BeTrue();
        handle.Physics.Should().NotBeNull();
        bridge.PhysicsWorld.Bodies.IsValid(handle.Physics!.Value.Body).Should().BeTrue();

        terrain.DecommitChunk(coord).Should().BeTrue();
        bridge.PhysicsWorld.Bodies.IsValid(handle.Physics.Value.Body).Should().BeFalse();
    }

    [Fact]
    public void PhysicsBinderAttachesHeightfieldDirectly()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        using var bridge = new ScenePhysicsBridge3D(world);
        using TerrainChunkEngine engine = CreateEngine();
        var coord = new TerrainChunkCoord(0, 0);
        engine.CommitChunk(coord);
        TerrainHeightfieldSource source = engine.CreateHeightfieldSource(coord)!;

        TerrainPhysicsAttachment attachment = SceneTerrainPhysicsBinder.Attach(
            bridge,
            source,
            new Vec3(16f, 0f, 16f));

        bridge.PhysicsWorld.Bodies.IsValid(attachment.Body).Should().BeTrue();

        SceneTerrainPhysicsBinder.Detach(bridge, attachment);

        bridge.PhysicsWorld.Bodies.IsValid(attachment.Body).Should().BeFalse();
    }

    [Fact]
    public void DisposeReleasesBoundChunks()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 9, AttachPhysics = false });
        terrain.CommitChunk(new TerrainChunkCoord(0, 0));

        terrain.Dispose();

        assets.Meshes.Count.Should().Be(0);
        world.ActiveEntityCount.Should().Be(0);
        engine.ChunkCount.Should().Be(0);
    }

    [Fact]
    public void TerrainProfileRegistersTheChunkComponent()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();

        world.Registry.TryGetDataByType(typeof(SceneTerrainChunk3D), out _).Should().BeTrue();
    }
}
