namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Buffers.Binary;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mesh;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlMorphMeshTests
{
    [Fact]
    public void MorphCacheDeformsAPerActorMesh()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = RegisterMorphMesh(assets);

        using SceneWorld world = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/gl-morph")))
            .AddTransform3D()
            .Build()
            .CreateWorld();
        SceneActor actor = world.CreateActor("Morph");

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var weights = new SceneMorphWeightStore();
        weights.ApplyMorphWeights(actor, [1.0f]);
        using var morphCache = new SceneGlMorphMeshCache(cache, weights);

        morphCache.TryGetMesh(actor, meshId, out GLMesh? mesh).Should().BeTrue();
        mesh.Should().NotBeNull();
        morphCache.Count.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("BufferSubData(", StringComparison.Ordinal));

        int subDataCount = api.CallLog.Count(call => call.StartsWith("BufferSubData(", StringComparison.Ordinal));
        morphCache.TryGetMesh(actor, meshId, out _).Should().BeTrue();
        api.CallLog.Count(call => call.StartsWith("BufferSubData(", StringComparison.Ordinal))
            .Should().Be(subDataCount);
    }

    [Fact]
    public void MorphCacheFallsBackWhenWeightsAreEmpty()
    {
        var api = new MockGLApi();
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = RegisterMorphMesh(assets);

        using SceneWorld world = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/gl-morph-empty")))
            .AddTransform3D()
            .Build()
            .CreateWorld();
        SceneActor actor = world.CreateActor("Morph");

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        using var morphCache = new SceneGlMorphMeshCache(cache, new SceneMorphWeightStore());

        morphCache.TryGetMesh(actor, meshId, out GLMesh? mesh).Should().BeFalse();
        mesh.Should().BeNull();
        morphCache.Count.Should().Be(0);
    }

    private static SceneAssetId<MeshAssetTag> RegisterMorphMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/morph-gl");
        byte[] vertices = new byte[3 * 12];
        byte[] deltas = new byte[3 * 12];
        for (int i = 0; i < 3; i++)
        {
            BinaryPrimitives.WriteSingleLittleEndian(vertices.AsSpan(i * 12, 4), i);
            BinaryPrimitives.WriteSingleLittleEndian(deltas.AsSpan(i * 12, 4), 1.0f);
        }

        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            vertices,
            [new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)],
            vertexCount: 3,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f),
            morphTargets:
            [
                new SceneMorphTargetDefinition(SceneMorphTargetSemantic.Position, deltas, 12, 3),
            ]));
        return id;
    }
}
