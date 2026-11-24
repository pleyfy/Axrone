using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

namespace Axrone.Geometry.Tests;

/// <summary>
/// Locks triangle winding against vertex normals. The GL renderer culls
/// back faces with the default counter-clockwise front face, so a reversed
/// generator renders inside-out primitives.
/// </summary>
public sealed class MeshWindingTests
{
    [Fact]
    public void BoxTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitBox<MeshSink, VertexP3N3T2, ushort>(ref sink, new BoxConfig());
        AssertOutward(sink, "box");
    }

    [Fact]
    public void PlaneTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitPlane<MeshSink, VertexP3N3T2, ushort>(ref sink, new PlaneConfig());
        AssertOutward(sink, "plane");
    }

    [Fact]
    public void SphereTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitSphere<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new SphereConfig
            {
                WidthSegments = new SegmentResolution(8),
                HeightSegments = new SegmentResolution(6),
            });
        AssertOutward(sink, "sphere");
    }

    [Fact]
    public void CylinderTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitCylinder<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new CylinderConfig
            {
                RadiusTop = new Metric(0.5f),
                RadiusBottom = new Metric(0.5f),
                Height = new Metric(1f),
                RadialSegments = new SegmentResolution(12),
            });
        AssertOutward(sink, "cylinder");
    }

    [Fact]
    public void CapsuleTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitCapsule<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new CapsuleConfig
            {
                Radius = new Metric(0.5f),
                Length = Metric.One,
                CapSegments = new SegmentResolution(6),
                RadialSegments = new SegmentResolution(12),
            });
        AssertOutward(sink, "capsule");
    }

    [Fact]
    public void TorusTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitTorus<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new TorusConfig
            {
                Radius = new Metric(0.5f),
                Tube = new Metric(0.2f),
                RadialSegments = new SegmentResolution(12),
                TubularSegments = new SegmentResolution(16),
            });
        AssertOutward(sink, "torus");
    }

    [Fact]
    public void TubeTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitTube<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new Metric(0.5f),
            new Metric(0.3f),
            new Metric(1f),
            new SegmentResolution(12),
            new SegmentResolution(4));
        AssertOutward(sink, "tube");
    }

    [Fact]
    public void TorusKnotTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitTorusKnot<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new Metric(0.5f),
            new Metric(0.15f),
            new SegmentResolution(24),
            new SegmentResolution(8),
            2,
            3);
        AssertOutward(sink, "torus knot");
    }

    [Fact]
    public void SpringTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitSpring<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new Metric(0.5f),
            new Metric(0.1f),
            new Metric(1f),
            3,
            new SegmentResolution(32),
            new SegmentResolution(8));
        AssertOutward(sink, "spring");
    }

    [Fact]
    public void RingTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitRing<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new Metric(0.3f),
            new Metric(0.5f),
            new SegmentResolution(16),
            new SegmentResolution(2));
        AssertOutward(sink, "ring");
    }

    [Fact]
    public void GridTriangles_WindTowardTheirNormals()
    {
        var sink = new MeshSink();
        ProceduralPrimitives.EmitGrid<MeshSink, VertexP3N3T2, ushort>(
            ref sink,
            new Metric(2f),
            new Metric(2f),
            new SegmentResolution(4),
            new SegmentResolution(4));
        AssertOutward(sink, "grid");
    }

    private static void AssertOutward(MeshSink sink, string name)
    {
        int backwards = 0;

        for (int index = 0; index + 2 < sink.Indices.Count; index += 3)
        {
            VertexP3N3T2 a = sink.Vertices[sink.Indices[index]];
            VertexP3N3T2 b = sink.Vertices[sink.Indices[index + 1]];
            VertexP3N3T2 c = sink.Vertices[sink.Indices[index + 2]];
            Vec3 cross = Vec3.Cross(b.Position.ToVec3() - a.Position.ToVec3(), c.Position.ToVec3() - a.Position.ToVec3());

            if (cross.LengthSquared() <= 1e-10f)
            {
                continue;
            }

            Vec3 normal = a.Normal.ToVec3() + b.Normal.ToVec3() + c.Normal.ToVec3();

            if (Vec3.Dot(cross, normal) < 0f)
            {
                backwards++;
            }
        }

        backwards.Should().Be(0, $"{name} must wind counter-clockwise toward its vertex normals");
    }

    private struct MeshSink : IMeshSink<VertexP3N3T2, ushort>
    {
        public readonly List<VertexP3N3T2> Vertices = new();
        public readonly List<ushort> Indices = new();

        public MeshSink()
        {
        }

        public uint CurrentVertexCount => (uint)Vertices.Count;

        public void AppendVertex(in VertexP3N3T2 vertex) => Vertices.Add(vertex);

        public void AppendTriangle(ushort i0, ushort i1, ushort i2)
        {
            Indices.Add(i0);
            Indices.Add(i1);
            Indices.Add(i2);
        }
    }
}
