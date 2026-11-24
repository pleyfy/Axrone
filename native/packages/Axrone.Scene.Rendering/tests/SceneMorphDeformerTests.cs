namespace Axrone.Scene.Rendering.Tests;

using System.Buffers.Binary;
using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

public sealed class SceneMorphDeformerTests
{
    private const int Stride = 24;

    [Fact]
    public void ApplyAddsWeightedPositionDeltas()
    {
        SceneMeshDefinition mesh = CreateMesh();
        byte[] destination = new byte[mesh.Vertices.Length];

        SceneMorphDeformer.Apply(mesh, [1.0f, 0.5f], destination);

        ReadVertex(destination, 0, 0).Should().BeApproximately(3.0f, 1e-5f);
        ReadVertex(destination, 0, 4).Should().BeApproximately(2.0f, 1e-5f);
        ReadVertex(destination, 1, 0).Should().BeApproximately(7.0f, 1e-5f);
        ReadVertex(destination, 1, 8).Should().BeApproximately(3.0f, 1e-5f);

        ReadVertex(destination, 0, 12).Should().BeApproximately(0.0f, 1e-5f);
        ReadVertex(destination, 0, 16).Should().BeApproximately(1.25f, 1e-5f);
    }

    [Fact]
    public void ZeroWeightLeavesTheBaseMeshUntouched()
    {
        SceneMeshDefinition mesh = CreateMesh();
        byte[] destination = new byte[mesh.Vertices.Length];

        SceneMorphDeformer.Apply(mesh, [0.0f, 0.0f], destination);

        destination.Should().Equal(mesh.Vertices.ToArray());
    }

    [Fact]
    public void OversizedDestinationIsPartiallyWrittenOnly()
    {
        SceneMeshDefinition mesh = CreateMesh();
        byte[] destination = new byte[mesh.Vertices.Length + 16];

        SceneMorphDeformer.Apply(mesh, [1.0f], destination);

        destination.AsSpan(mesh.Vertices.Length).ToArray().Should().OnlyContain(value => value == 0);
    }

    [Fact]
    public void ShortDestinationIsRejected()
    {
        SceneMeshDefinition mesh = CreateMesh();

        Action apply = () => SceneMorphDeformer.Apply(mesh, [1.0f], new byte[4]);

        apply.Should().Throw<ArgumentException>();
    }

    private static SceneMeshDefinition CreateMesh()
    {
        byte[] vertices = new byte[2 * Stride];
        WriteVertex(vertices, 0, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f, 0.0f);
        WriteVertex(vertices, 1, 3.0f, 2.0f, 1.0f, 0.0f, 1.0f, 0.0f);

        byte[] positionDeltas = new byte[2 * 12];
        WriteDelta(positionDeltas, 0, 2.0f, 1.0f, 0.0f);
        WriteDelta(positionDeltas, 1, 4.0f, 0.0f, 2.0f);

        byte[] normalDeltas = new byte[2 * 12];
        WriteDelta(normalDeltas, 0, 0.0f, 0.5f, 0.0f);
        WriteDelta(normalDeltas, 1, 0.0f, 0.0f, 0.5f);

        return new SceneMeshDefinition(
            SceneAssetId<MeshAssetTag>.FromName("mesh/morph"),
            vertices,
            [
                new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, Stride),
                new SceneVertexAttribute(SceneMeshSemantic.Normal, 3, 12, Stride),
            ],
            vertexCount: 2,
            morphTargets:
            [
                new SceneMorphTargetDefinition(SceneMorphTargetSemantic.Position, positionDeltas, 12, 3),
                new SceneMorphTargetDefinition(SceneMorphTargetSemantic.Normal, normalDeltas, 12, 3),
            ]);
    }

    private static void WriteVertex(byte[] vertices, int vertex, float px, float py, float pz, float nx, float ny, float nz)
    {
        int offset = vertex * Stride;
        WriteFloat(vertices, offset + 0, px);
        WriteFloat(vertices, offset + 4, py);
        WriteFloat(vertices, offset + 8, pz);
        WriteFloat(vertices, offset + 12, nx);
        WriteFloat(vertices, offset + 16, ny);
        WriteFloat(vertices, offset + 20, nz);
    }

    private static void WriteDelta(byte[] deltas, int vertex, float x, float y, float z)
    {
        int offset = vertex * 12;
        WriteFloat(deltas, offset + 0, x);
        WriteFloat(deltas, offset + 4, y);
        WriteFloat(deltas, offset + 8, z);
    }

    private static float ReadVertex(byte[] vertices, int vertex, int componentOffset) =>
        BinaryPrimitives.ReadSingleLittleEndian(vertices.AsSpan((vertex * Stride) + componentOffset, 4));

    private static void WriteFloat(byte[] target, int offset, float value) =>
        BinaryPrimitives.WriteSingleLittleEndian(target.AsSpan(offset, 4), value);
}
