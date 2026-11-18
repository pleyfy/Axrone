namespace Axrone.Scene.Gltf.Tests;

using System;
using System.Collections.Generic;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using FluentAssertions;
using Xunit;

/// <summary>
/// Verifies the procedural material-preview subjects: five-attribute layout, unit normals,
/// in-range UVs, orthonormal handed tangents and outward-facing winding on every shape.
/// </summary>
public sealed class MaterialPreviewGeometryTests
{
    private const int VertexStride = 56;
    private const int PositionOffset = 0;
    private const int NormalOffset = 12;
    private const int Uv0Offset = 24;
    private const int Uv1Offset = 32;
    private const int TangentOffset = 40;

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_UsesTheFiveAttributeSceneLayout(MaterialPreviewSubjectShape shape)
    {
        SceneMeshDefinition mesh = Build(shape);

        SceneVertexAttribute[] attributes = [.. mesh.Attributes];
        attributes.Should().HaveCount(5);
        attributes[0].Semantic.Should().Be(SceneMeshSemantic.Position);
        attributes[0].ComponentCount.Should().Be((byte)3);
        attributes[0].Offset.Should().Be(PositionOffset);
        attributes[1].Semantic.Should().Be(SceneMeshSemantic.Normal);
        attributes[1].ComponentCount.Should().Be((byte)3);
        attributes[1].Offset.Should().Be(NormalOffset);
        attributes[2].Semantic.Should().Be(SceneMeshSemantic.Uv0);
        attributes[2].ComponentCount.Should().Be((byte)2);
        attributes[2].Offset.Should().Be(Uv0Offset);
        attributes[3].Semantic.Should().Be(SceneMeshSemantic.Uv1);
        attributes[3].ComponentCount.Should().Be((byte)2);
        attributes[3].Offset.Should().Be(Uv1Offset);
        attributes[4].Semantic.Should().Be(SceneMeshSemantic.Tangent);
        attributes[4].ComponentCount.Should().Be((byte)4);
        attributes[4].Offset.Should().Be(TangentOffset);
        attributes.Should().OnlyContain(attribute => attribute.Stride == VertexStride);
        MaterialPreviewGeometry.VertexStride.Should().Be(VertexStride);
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_PayloadMatchesDeclaredCounts(MaterialPreviewSubjectShape shape)
    {
        SceneMeshDefinition mesh = Build(shape);

        mesh.VertexCount.Should().BePositive();
        mesh.Vertices.Length.Should().Be(mesh.VertexCount * VertexStride);
        mesh.IndexCount.Should().BePositive();
        mesh.Indices.Length.Should().Be(mesh.IndexCount * sizeof(uint));
        (mesh.IndexCount % 3).Should().Be(0);
        mesh.IndexFormat.Should().Be(SceneIndexFormat.UInt32);
        mesh.Topology.Should().Be(SceneMeshTopology.Triangles);
        mesh.Bounds.Should().NotBeNull();
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_NormalsAreUnitLength(MaterialPreviewSubjectShape shape)
    {
        foreach (DecodedVertex vertex in Decode(Build(shape)))
        {
            vertex.Normal.Length().Should().BeApproximately(1.0f, 1e-3f);
        }
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_TangentsAreNonZeroUnitLengthOrthogonalAndHanded(MaterialPreviewSubjectShape shape)
    {
        foreach (DecodedVertex vertex in Decode(Build(shape)))
        {
            Vec3 tangent = new(vertex.Tangent.X, vertex.Tangent.Y, vertex.Tangent.Z);

            tangent.LengthSquared().Should().BeGreaterThan(0.99f);
            tangent.Length().Should().BeApproximately(1.0f, 1e-3f);
            MathF.Abs(Vec3.Dot(tangent, vertex.Normal)).Should().BeLessThan(1e-2f);
            MathF.Abs(vertex.Tangent.W).Should().Be(1.0f);
        }
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_BothUvSetsStayInsideUnitRange(MaterialPreviewSubjectShape shape)
    {
        foreach (DecodedVertex vertex in Decode(Build(shape)))
        {
            vertex.Uv0.X.Should().BeInRange(0.0f, 1.0f);
            vertex.Uv0.Y.Should().BeInRange(0.0f, 1.0f);
            vertex.Uv1.X.Should().BeInRange(0.0f, 1.0f);
            vertex.Uv1.Y.Should().BeInRange(0.0f, 1.0f);
        }
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_ClosedShapesWindOutward(MaterialPreviewSubjectShape shape)
    {
        SceneMeshDefinition mesh = Build(shape);

        SignedVolume(mesh).Should().BePositive();
        FacesAlignWithVertexNormals(mesh).Should().BeTrue();
    }

    [Fact]
    public void Create_PlaneFacesPositiveZWithCounterClockwiseTriangles()
    {
        SceneMeshDefinition mesh = Build(MaterialPreviewSubjectShape.Plane);

        foreach (DecodedVertex vertex in Decode(mesh))
        {
            vertex.Normal.Z.Should().BeApproximately(1.0f, 1e-3f);
        }

        SignedAreaTowardsViewer(mesh).Should().BeGreaterThan(0.0f);
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere)]
    [InlineData(MaterialPreviewSubjectShape.Cube)]
    [InlineData(MaterialPreviewSubjectShape.Plane)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder)]
    [InlineData(MaterialPreviewSubjectShape.Capsule)]
    [InlineData(MaterialPreviewSubjectShape.Torus)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall)]
    public void Create_IsDeterministicAcrossCalls(MaterialPreviewSubjectShape shape)
    {
        SceneMeshDefinition first = Build(shape);
        SceneMeshDefinition second = Build(shape);

        first.Vertices.ToArray().Should().Equal(second.Vertices.ToArray());
        first.Indices.ToArray().Should().Equal(second.Indices.ToArray());
    }

    [Theory]
    [InlineData(MaterialPreviewSubjectShape.Sphere, MaterialPreviewGeometry.SphereMeshId)]
    [InlineData(MaterialPreviewSubjectShape.Cube, MaterialPreviewGeometry.CubeMeshId)]
    [InlineData(MaterialPreviewSubjectShape.Plane, MaterialPreviewGeometry.PlaneMeshId)]
    [InlineData(MaterialPreviewSubjectShape.Cylinder, MaterialPreviewGeometry.CylinderMeshId)]
    [InlineData(MaterialPreviewSubjectShape.Capsule, MaterialPreviewGeometry.CapsuleMeshId)]
    [InlineData(MaterialPreviewSubjectShape.Torus, MaterialPreviewGeometry.TorusMeshId)]
    [InlineData(MaterialPreviewSubjectShape.ShaderBall, MaterialPreviewGeometry.ShaderBallMeshId)]
    public void ResolveMeshId_IsStablePerShape(MaterialPreviewSubjectShape shape, string expected) =>
        MaterialPreviewGeometry.ResolveMeshId(shape).Should().Be(expected);

    [Fact]
    public void EnsureSubject_RegistersEachShapeOnce()
    {
        var assets = new SceneAssetRegistry();

        SceneAssetId<MeshAssetTag> first = MaterialPreviewGeometry.EnsureSubject(
            assets,
            MaterialPreviewSubjectShape.Torus);
        SceneAssetId<MeshAssetTag> second = MaterialPreviewGeometry.EnsureSubject(
            assets,
            MaterialPreviewSubjectShape.Torus);

        first.Should().Be(second);
        assets.Meshes.Count.Should().Be(1);
        assets.Meshes.TryGet(first, out SceneMeshDefinition? mesh).Should().BeTrue();
        mesh!.Attributes.Should().HaveCount(5);
    }

    [Fact]
    public void EnsureSubject_DefaultsToTheSphere()
    {
        var assets = new SceneAssetRegistry();

        SceneAssetId<MeshAssetTag> id = MaterialPreviewGeometry.EnsureSubject(assets);

        id.Should().Be(SceneAssetId<MeshAssetTag>.FromName(MaterialPreviewGeometry.SphereMeshId));
        assets.Meshes.Contains(id).Should().BeTrue();
    }

    [Fact]
    public void Create_CubeGivesEveryFaceItsOwnSecondUvCell()
    {
        SceneMeshDefinition mesh = Build(MaterialPreviewSubjectShape.Cube);
        var cells = new HashSet<(int, int)>();

        foreach (DecodedVertex vertex in Decode(mesh))
        {
            cells.Add(((int)(vertex.Uv1.X * 3.0f), (int)(vertex.Uv1.Y * 2.0f)));
        }

        cells.Should().HaveCount(6);
    }

    [Fact]
    public void Create_TorusHonoursRequestedTessellation()
    {
        SceneMeshDefinition coarse = MaterialPreviewGeometry.CreateTorus(
            SceneAssetId<MeshAssetTag>.FromName("preview/torus-coarse"),
            radialSegments: 8,
            tubularSegments: 12);
        SceneMeshDefinition fine = MaterialPreviewGeometry.CreateTorus(
            SceneAssetId<MeshAssetTag>.FromName("preview/torus-fine"),
            radialSegments: 24,
            tubularSegments: 36);

        fine.VertexCount.Should().BeGreaterThan(coarse.VertexCount);
        fine.IndexCount.Should().BeGreaterThan(coarse.IndexCount);
        SignedVolume(fine).Should().BePositive();
    }

    [Fact]
    public void Create_RejectsNonPositiveDimensions()
    {
        SceneAssetId<MeshAssetTag> id = SceneAssetId<MeshAssetTag>.FromName("preview/sphere");

        Action sphere = () => MaterialPreviewGeometry.CreateSphere(id, 0.0f);
        Action cube = () => MaterialPreviewGeometry.CreateCube(id, 1.0f, -1.0f, 1.0f);
        Action torus = () => MaterialPreviewGeometry.CreateTorus(id, tube: 0.0f);

        sphere.Should().Throw<SceneAssetException>().Which.Code.Should().Be(SceneAssetErrorCodes.Invalid);
        cube.Should().Throw<SceneAssetException>().Which.Code.Should().Be(SceneAssetErrorCodes.Invalid);
        torus.Should().Throw<SceneAssetException>().Which.Code.Should().Be(SceneAssetErrorCodes.Invalid);
    }

    [Fact]
    public void BuildTangentBasis_RejectsNullCollections()
    {
        var vertices = new List<MaterialPreviewVertex>();

        Action nullVertices = () => MaterialPreviewGeometry.BuildTangentBasis(null!, [0U, 1U, 2U]);
        Action nullIndices = () => MaterialPreviewGeometry.BuildTangentBasis(vertices, null!);

        nullVertices.Should().Throw<ArgumentNullException>();
        nullIndices.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Attributes_ExposeTheSharedLayout()
    {
        MaterialPreviewGeometry.Attributes.Should().HaveCount(5);
        MaterialPreviewGeometry.Attributes[0].Semantic.Should().Be(SceneMeshSemantic.Position);
    }

    private static SceneMeshDefinition Build(MaterialPreviewSubjectShape shape) =>
        MaterialPreviewGeometry.Create(
            SceneAssetId<MeshAssetTag>.FromName(MaterialPreviewGeometry.ResolveMeshId(shape)),
            shape);

    private static DecodedVertex[] Decode(SceneMeshDefinition mesh)
    {
        ReadOnlySpan<byte> bytes = mesh.Vertices.Span;
        int count = bytes.Length / VertexStride;
        var decoded = new DecodedVertex[count];
        for (int i = 0; i < count; i++)
        {
            int origin = i * VertexStride;
            decoded[i] = new DecodedVertex(
                ReadVector(bytes, origin + PositionOffset),
                ReadVector(bytes, origin + NormalOffset),
                ReadVector(bytes, origin + Uv0Offset),
                ReadVector(bytes, origin + Uv1Offset),
                ReadVector4(bytes, origin + TangentOffset));
        }

        return decoded;
    }

    private static Vec3 ReadVector(ReadOnlySpan<byte> bytes, int offset) =>
        new(
            BitConverter.ToSingle(bytes.Slice(offset, sizeof(float))),
            BitConverter.ToSingle(bytes.Slice(offset + 4, sizeof(float))),
            BitConverter.ToSingle(bytes.Slice(offset + 8, sizeof(float))));

    private static Vec4 ReadVector4(ReadOnlySpan<byte> bytes, int offset) =>
        new(
            BitConverter.ToSingle(bytes.Slice(offset, sizeof(float))),
            BitConverter.ToSingle(bytes.Slice(offset + 4, sizeof(float))),
            BitConverter.ToSingle(bytes.Slice(offset + 8, sizeof(float))),
            BitConverter.ToSingle(bytes.Slice(offset + 12, sizeof(float))));

    private static uint[] TriangleIndices(SceneMeshDefinition mesh)
    {
        ReadOnlySpan<byte> bytes = mesh.Indices.Span;
        var indices = new uint[bytes.Length / sizeof(uint)];
        for (int i = 0; i < indices.Length; i++)
        {
            indices[i] = BitConverter.ToUInt32(bytes.Slice(i * sizeof(uint), sizeof(uint)));
        }

        return indices;
    }

    private static float SignedVolume(SceneMeshDefinition mesh)
    {
        DecodedVertex[] vertices = Decode(mesh);
        uint[] indices = TriangleIndices(mesh);
        float sum = 0.0f;
        for (int i = 0; i + 2 < indices.Length; i += 3)
        {
            Vec3 a = vertices[indices[i]].Position;
            Vec3 b = vertices[indices[i + 1]].Position;
            Vec3 c = vertices[indices[i + 2]].Position;
            sum += Vec3.Dot(a, Vec3.Cross(b - a, c - a));
        }

        return sum / 6.0f;
    }

    private static float SignedAreaTowardsViewer(SceneMeshDefinition mesh)
    {
        DecodedVertex[] vertices = Decode(mesh);
        uint[] indices = TriangleIndices(mesh);
        float sum = 0.0f;
        for (int i = 0; i + 2 < indices.Length; i += 3)
        {
            Vec3 a = vertices[indices[i]].Position;
            Vec3 b = vertices[indices[i + 1]].Position;
            Vec3 c = vertices[indices[i + 2]].Position;
            sum += Vec3.Cross(b - a, c - a).Z;
        }

        return sum * 0.5f;
    }

    private static bool FacesAlignWithVertexNormals(SceneMeshDefinition mesh)
    {
        DecodedVertex[] vertices = Decode(mesh);
        uint[] indices = TriangleIndices(mesh);
        for (int i = 0; i + 2 < indices.Length; i += 3)
        {
            Vec3 a = vertices[indices[i]].Position;
            Vec3 b = vertices[indices[i + 1]].Position;
            Vec3 c = vertices[indices[i + 2]].Position;
            Vec3 faceNormal = Vec3.Cross(b - a, c - a);
            if (faceNormal.LengthSquared() < 1e-12f)
            {
                continue;
            }

            Vec3 averaged = vertices[indices[i]].Normal
                + vertices[indices[i + 1]].Normal
                + vertices[indices[i + 2]].Normal;
            if (Vec3.Dot(Vec3.Normalize(faceNormal), averaged) <= 0.0f)
            {
                return false;
            }
        }

        return true;
    }

    private readonly record struct DecodedVertex(Vec3 Position, Vec3 Normal, Vec3 Uv0, Vec3 Uv1, Vec4 Tangent);
}
