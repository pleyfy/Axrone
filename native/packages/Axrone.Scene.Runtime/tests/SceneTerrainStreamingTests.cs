namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using Axrone.Terrain;
using FluentAssertions;
using Xunit;

public sealed class SceneTerrainStreamingTests
{
    private sealed class FlatSurface : ITerrainSurface
    {
        public float SampleHeight(float worldX, float worldZ) => 0.5f;

        public void SampleRow(float startX, float worldZ, float stepX, Span<float> destination) =>
            destination.Fill(0.5f);
    }

    private static TerrainChunkEngine CreateEngine(int poolCapacity = 64) =>
        new(new TerrainChunkEngineOptions
        {
            Surface = new FlatSurface(),
            CellSize = 1f,
            MaxHeight = 10f,
            PoolCapacity = poolCapacity,
        });

    [Fact]
    public void LodMeshReducesGeometryAndAddsSkirt()
    {
        using TerrainChunkEngine engine = CreateEngine();
        var coord = new TerrainChunkCoord(0, 0);
        engine.CommitChunk(coord);

        TerrainVertexMesh lod0 = engine.BuildChunkLodMesh(coord, 0)!;
        TerrainVertexMesh lod1 = engine.BuildChunkLodMesh(coord, 1)!;
        TerrainVertexMesh lod2 = engine.BuildChunkLodMesh(coord, 2)!;

        lod0.VertexCount.Should().Be(TerrainChunkLod.VertexCount(0));
        lod0.TriangleCount.Should().Be(TerrainChunkLod.IndexCount(0) / 3);
        lod1.VertexCount.Should().Be(TerrainChunkLod.VertexCount(1));
        lod2.VertexCount.Should().Be(TerrainChunkLod.VertexCount(2));
        lod1.VertexCount.Should().BeLessThan(lod0.VertexCount);
        lod2.VertexCount.Should().BeLessThan(lod1.VertexCount);
        lod0.VertexCount.Should().BeGreaterThan(TerrainChunkLayout.VertexCount);

        int skirtStart = TerrainChunkLod.GridVertexCount(0);
        lod0.Vertices[skirtStart].Position.Y.Should().BeLessThan(lod0.Vertices[0].Position.Y);
    }

    [Fact]
    public void RuntimeRebuildsChunkAtNewLodWithoutReleasingTerrainData()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 1, AttachPhysics = false });
        var coord = new TerrainChunkCoord(0, 0);
        terrain.CommitChunk(coord).Should().BeTrue();
        float before = engine.SampleElevation(16f, 16f);

        terrain.RebuildChunk(coord, 1).Should().BeTrue();

        terrain.TryGetChunk(coord, out SceneTerrainChunkHandle handle).Should().BeTrue();
        handle.LodLevel.Should().Be(1);
        world.TryGetData(handle.Entity, out SceneTerrainChunk3D component).Should().BeTrue();
        component.LodLevel.Should().Be(1);
        world.TryGetData(handle.Entity, out SceneMeshRenderer renderer).Should().BeTrue();
        assets.Meshes.TryGet(renderer.MeshId, out SceneMeshDefinition? definition).Should().BeTrue();
        definition!.VertexCount.Should().Be(TerrainChunkLod.VertexCount(1));
        engine.ChunkCount.Should().Be(1);
        engine.SampleElevation(16f, 16f).Should().BeApproximately(before, 1e-6f);
    }

    [Fact]
    public void StreamingLoadsTheViewAroundFocus()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 1, AttachPhysics = false });
        using var streaming = new SceneTerrainStreamingRuntime(
            terrain,
            new SceneTerrainStreamingOptions
            {
                ViewRadiusChunks = 1,
                Lod0Radius = 0,
                Lod1Radius = 1,
                MaxCommitsPerUpdate = 100,
                MaxRebuildsPerUpdate = 100,
                MaxDecommitsPerUpdate = 100,
            });

        SceneTerrainStreamingStats stats = streaming.Update(new Vec3(16f, 0f, 16f));

        stats.Committed.Should().Be(9);
        terrain.ChunkCount.Should().Be(9);
        terrain.TryGetChunk(new TerrainChunkCoord(0, 0), out SceneTerrainChunkHandle center).Should().BeTrue();
        center.LodLevel.Should().Be(0);
        terrain.TryGetChunk(new TerrainChunkCoord(1, 0), out SceneTerrainChunkHandle ring).Should().BeTrue();
        ring.LodLevel.Should().Be(1);
    }

    [Fact]
    public void StreamingEvictsChunksOutsideFocus()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 1, AttachPhysics = false });
        using var streaming = new SceneTerrainStreamingRuntime(
            terrain,
            new SceneTerrainStreamingOptions
            {
                ViewRadiusChunks = 1,
                Lod0Radius = 0,
                Lod1Radius = 1,
                MaxCommitsPerUpdate = 100,
                MaxRebuildsPerUpdate = 100,
                MaxDecommitsPerUpdate = 100,
            });

        streaming.Update(new Vec3(16f, 0f, 16f));
        streaming.Update(new Vec3((5f * 32f) + 16f, 0f, 16f));

        terrain.ChunkCount.Should().Be(9);
        terrain.TryGetChunk(new TerrainChunkCoord(0, 0), out _).Should().BeFalse();
        terrain.TryGetChunk(new TerrainChunkCoord(5, 0), out _).Should().BeTrue();
    }

    [Fact]
    public void StreamingRespectsTheCommitBudget()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 1, AttachPhysics = false });
        using var streaming = new SceneTerrainStreamingRuntime(
            terrain,
            new SceneTerrainStreamingOptions
            {
                ViewRadiusChunks = 1,
                Lod0Radius = 0,
                Lod1Radius = 1,
                MaxCommitsPerUpdate = 2,
                MaxRebuildsPerUpdate = 1,
                MaxDecommitsPerUpdate = 10,
            });

        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(2);
        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(2);
        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(2);
        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(2);
        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(1);
        streaming.Update(new Vec3(16f, 0f, 16f)).Committed.Should().Be(0);

        terrain.ChunkCount.Should().Be(9);
    }

    [Fact]
    public void StreamingRejectsInvalidOptions()
    {
        using SceneWorld world = SceneRuntimeProfiles.ThreeD.Profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        using TerrainChunkEngine engine = CreateEngine();
        using var terrain = new SceneTerrainRuntime(
            world,
            assets,
            engine,
            new SceneTerrainRuntimeOptions { TerrainId = 1, AttachPhysics = false });

        new SceneTerrainStreamingOptions { ViewRadiusChunks = 1, Lod0Radius = 2 }
            .Invoking(options => _ = new SceneTerrainStreamingRuntime(terrain, options))
            .Should().Throw<TerrainException>();
    }
}
