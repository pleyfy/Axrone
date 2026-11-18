namespace Axrone.Scene.Gltf;

/// <summary>Subject shapes available to a material preview viewport.</summary>
public enum MaterialPreviewSubjectShape
{
    /// <summary>UV sphere.</summary>
    Sphere = 0,

    /// <summary>Axis-aligned cube.</summary>
    Cube = 1,

    /// <summary>Single-quad plane.</summary>
    Plane = 2,

    /// <summary>Y-aligned cylinder with caps.</summary>
    Cylinder = 3,

    /// <summary>Capsule: cylinder with hemispherical caps.</summary>
    Capsule = 4,

    /// <summary>Torus ring.</summary>
    Torus = 5,

    /// <summary>Icosphere shader ball with an even triangle density.</summary>
    ShaderBall = 6
}

/// <summary>
/// Builds the procedural subject meshes a material preview renders, with the full
/// five-attribute layout the scene shaders expect: position, normal, both UV sets and a
/// tangent frame.
/// </summary>
/// <remarks>
/// <para>
/// Topology and primary UVs come from the engine primitive generators, so a preview subject and
/// an imported model travel the same upload path. The second UV set is filled afterwards: it
/// duplicates the primary set except on the cube, where each face gets its own atlas cell so a
/// lightmap-style sampler bound to <c>a_UV1</c> never reads across a seam.
/// </para>
/// <para>
/// Tangents are derived from the generated positions and UVs rather than assumed, then
/// orthonormalized against the smooth normal. That keeps the tangent frame consistent with the
/// UV layout the generator produced, which is what a normal-mapped preview actually samples.
/// </para>
/// </remarks>
public static class MaterialPreviewGeometry
{
    /// <summary>Preview sphere mesh id, shared with the editor material workspace.</summary>
    public const string SphereMeshId = "editor/material-workspace/mesh/sphere";

    /// <summary>Preview cube mesh id.</summary>
    public const string CubeMeshId = "editor/material-workspace/mesh/cube";

    /// <summary>Preview plane mesh id.</summary>
    public const string PlaneMeshId = "editor/material-workspace/mesh/plane";

    /// <summary>Preview cylinder mesh id.</summary>
    public const string CylinderMeshId = "editor/material-workspace/mesh/cylinder";

    /// <summary>Preview capsule mesh id.</summary>
    public const string CapsuleMeshId = "editor/material-workspace/mesh/capsule";

    /// <summary>Preview torus mesh id.</summary>
    public const string TorusMeshId = "editor/material-workspace/mesh/torus";

    /// <summary>Preview shader-ball mesh id.</summary>
    public const string ShaderBallMeshId = "editor/material-workspace/mesh/shader-ball";

    /// <summary>Default preview subject.</summary>
    public const MaterialPreviewSubjectShape DefaultSubject = MaterialPreviewSubjectShape.Sphere;

    private const int PositionOffset = 0;
    private const int NormalOffset = 12;
    private const int Uv0Offset = 24;
    private const int Uv1Offset = 32;
    private const int TangentOffset = 40;
    private const int StrideBytes = 56;
    private const float DegenerateDenominator = 1e-8f;

    private static readonly SceneVertexAttribute[] AttributeLayout =
    [
        new SceneVertexAttribute(SceneMeshSemantic.Position, 3, PositionOffset, StrideBytes),
        new SceneVertexAttribute(SceneMeshSemantic.Normal, 3, NormalOffset, StrideBytes),
        new SceneVertexAttribute(SceneMeshSemantic.Uv0, 2, Uv0Offset, StrideBytes),
        new SceneVertexAttribute(SceneMeshSemantic.Uv1, 2, Uv1Offset, StrideBytes),
        new SceneVertexAttribute(SceneMeshSemantic.Tangent, 4, TangentOffset, StrideBytes)
    ];

    /// <summary>Interleaved attribute layout for every preview subject.</summary>
    public static IReadOnlyList<SceneVertexAttribute> Attributes => AttributeLayout;

    /// <summary>Byte stride of one preview vertex.</summary>
    public const int VertexStride = StrideBytes;

    /// <summary>Resolves the mesh id a subject shape registers under.</summary>
    /// <param name="shape">Subject shape.</param>
    /// <returns>The stable preview mesh id.</returns>
    public static string ResolveMeshId(MaterialPreviewSubjectShape shape) => shape switch
    {
        MaterialPreviewSubjectShape.Cube => CubeMeshId,
        MaterialPreviewSubjectShape.Plane => PlaneMeshId,
        MaterialPreviewSubjectShape.Cylinder => CylinderMeshId,
        MaterialPreviewSubjectShape.Capsule => CapsuleMeshId,
        MaterialPreviewSubjectShape.Torus => TorusMeshId,
        MaterialPreviewSubjectShape.ShaderBall => ShaderBallMeshId,
        _ => SphereMeshId
    };

    /// <summary>
    /// Registers the subject mesh when it is missing and returns its id, mirroring the editor
    /// preview runtime so a scene only ever holds one copy per shape.
    /// </summary>
    /// <param name="assets">Scene asset registry.</param>
    /// <param name="shape">Subject shape.</param>
    /// <returns>The mesh id of the registered subject.</returns>
    public static SceneAssetId<MeshAssetTag> EnsureSubject(
        SceneAssetRegistry assets,
        MaterialPreviewSubjectShape shape = DefaultSubject)
    {
        ArgumentNullException.ThrowIfNull(assets);

        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>(ResolveMeshId(shape));
        if (!assets.Meshes.Contains(id))
        {
            assets.Meshes.Register(Create(id, shape));
        }

        return id;
    }

    /// <summary>Builds a preview subject with the shape's studio defaults.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="shape">Subject shape.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition Create(SceneAssetId<MeshAssetTag> id, MaterialPreviewSubjectShape shape)
    {
        switch (shape)
        {
            case MaterialPreviewSubjectShape.Cube:
                return CreateCube(id, 1.7f, 1.7f, 1.7f);
            case MaterialPreviewSubjectShape.Plane:
                return CreatePlane(id, 2.0f, 2.0f);
            case MaterialPreviewSubjectShape.Cylinder:
                return CreateCylinder(id, 0.5f, 1.0f, 24);
            case MaterialPreviewSubjectShape.Capsule:
                return CreateCapsule(id, 0.6f, 1.2f, 12, 24);
            case MaterialPreviewSubjectShape.Torus:
                return CreateTorus(id, 0.9f, 0.28f, 24, 36);
            case MaterialPreviewSubjectShape.ShaderBall:
                return CreateShaderBall(id, 1.0f, 2);
            default:
                return CreateSphere(id, 1.0f, 48);
        }
    }

    /// <summary>Builds a UV sphere preview subject.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="radius">Sphere radius.</param>
    /// <param name="segments">Longitude and latitude divisions.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateSphere(
        SceneAssetId<MeshAssetTag> id,
        float radius = 1.0f,
        int segments = 48)
    {
        ValidatePositive(radius, nameof(radius));
        var sink = new PreviewSink();
        var config = new SphereConfig
        {
            Radius = new Metric(radius),
            WidthSegments = new SegmentResolution((uint)Math.Max(3, segments)),
            HeightSegments = new SegmentResolution((uint)Math.Max(2, segments))
        };

        ProceduralPrimitives.EmitSphere<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>Builds an axis-aligned cube preview subject.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="width">X size.</param>
    /// <param name="height">Y size.</param>
    /// <param name="depth">Z size.</param>
    /// <param name="segments">Divisions per axis.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateCube(
        SceneAssetId<MeshAssetTag> id,
        float width = 1.7f,
        float height = 1.7f,
        float depth = 1.7f,
        int segments = 1)
    {
        ValidatePositive(width, nameof(width));
        ValidatePositive(height, nameof(height));
        ValidatePositive(depth, nameof(depth));

        int divisions = Math.Max(1, segments);
        var sink = new PreviewSink();
        var config = new BoxConfig
        {
            Width = new Metric(width),
            Height = new Metric(height),
            Depth = new Metric(depth),
            WidthSegments = new SegmentResolution((uint)divisions),
            HeightSegments = new SegmentResolution((uint)divisions),
            DepthSegments = new SegmentResolution((uint)divisions)
        };

        ProceduralPrimitives.EmitBox<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: true);
    }

    /// <summary>Builds a single-sided plane preview subject facing +Z.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="width">X size.</param>
    /// <param name="height">Y size.</param>
    /// <param name="widthSegments">X divisions.</param>
    /// <param name="heightSegments">Y divisions.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreatePlane(
        SceneAssetId<MeshAssetTag> id,
        float width = 2.0f,
        float height = 2.0f,
        int widthSegments = 1,
        int heightSegments = 1)
    {
        ValidatePositive(width, nameof(width));
        ValidatePositive(height, nameof(height));

        var sink = new PreviewSink();
        var config = new PlaneConfig
        {
            Width = new Metric(width),
            Height = new Metric(height),
            WidthSegments = new SegmentResolution((uint)Math.Max(1, widthSegments)),
            HeightSegments = new SegmentResolution((uint)Math.Max(1, heightSegments))
        };

        ProceduralPrimitives.EmitPlane<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>Builds a Y-aligned cylinder preview subject with caps.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="radius">Top and bottom radius.</param>
    /// <param name="height">Cylinder height.</param>
    /// <param name="radialSegments">Divisions around the axis.</param>
    /// <param name="openEnded">Whether caps are omitted.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateCylinder(
        SceneAssetId<MeshAssetTag> id,
        float radius = 0.5f,
        float height = 1.0f,
        int radialSegments = 24,
        bool openEnded = false)
    {
        ValidatePositive(radius, nameof(radius));
        ValidatePositive(height, nameof(height));

        var sink = new PreviewSink();
        var config = new CylinderConfig
        {
            RadiusTop = new Metric(radius),
            RadiusBottom = new Metric(radius),
            Height = new Metric(height),
            RadialSegments = new SegmentResolution((uint)Math.Max(3, radialSegments)),
            OpenEnded = openEnded
        };

        ProceduralPrimitives.EmitCylinder<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>Builds a capsule preview subject aligned to +Y.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="radius">Cap and body radius.</param>
    /// <param name="length">Cylindrical body length.</param>
    /// <param name="capSegments">Divisions per cap.</param>
    /// <param name="radialSegments">Divisions around the axis.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateCapsule(
        SceneAssetId<MeshAssetTag> id,
        float radius = 0.6f,
        float length = 1.2f,
        int capSegments = 12,
        int radialSegments = 24)
    {
        ValidatePositive(radius, nameof(radius));
        ValidatePositive(length, nameof(length));

        var sink = new PreviewSink();
        var config = new CapsuleConfig
        {
            Radius = new Metric(radius),
            Length = new Metric(length),
            CapSegments = new SegmentResolution((uint)Math.Max(1, capSegments)),
            RadialSegments = new SegmentResolution((uint)Math.Max(3, radialSegments))
        };

        ProceduralPrimitives.EmitCapsule<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>Builds a torus preview subject lying in the XZ plane.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="radius">Ring radius.</param>
    /// <param name="tube">Tube radius.</param>
    /// <param name="radialSegments">Divisions around the tube.</param>
    /// <param name="tubularSegments">Divisions around the ring.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateTorus(
        SceneAssetId<MeshAssetTag> id,
        float radius = 0.9f,
        float tube = 0.28f,
        int radialSegments = 24,
        int tubularSegments = 36)
    {
        ValidatePositive(radius, nameof(radius));
        ValidatePositive(tube, nameof(tube));

        var sink = new PreviewSink();
        var config = new TorusConfig
        {
            Radius = new Metric(radius),
            Tube = new Metric(tube),
            RadialSegments = new SegmentResolution((uint)Math.Max(3, radialSegments)),
            TubularSegments = new SegmentResolution((uint)Math.Max(3, tubularSegments))
        };

        ProceduralPrimitives.EmitTorus<PreviewSink, MaterialPreviewVertex, uint>(ref sink, in config);
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>Builds an icosphere shader ball: pole-free, even triangle density.</summary>
    /// <param name="id">Mesh id.</param>
    /// <param name="radius">Ball radius.</param>
    /// <param name="subdivisions">Subdivision levels, clamped at six by the generator.</param>
    /// <returns>An uploadable mesh definition.</returns>
    public static SceneMeshDefinition CreateShaderBall(
        SceneAssetId<MeshAssetTag> id,
        float radius = 1.0f,
        int subdivisions = 2)
    {
        ValidatePositive(radius, nameof(radius));

        var sink = new PreviewSink();
        ProceduralPrimitives.EmitIcosphere<PreviewSink, MaterialPreviewVertex, uint>(
            ref sink,
            new Metric(radius),
            (uint)Math.Max(1, subdivisions));
        return CreateDefinition(id, sink, perFaceUv1: false);
    }

    /// <summary>
    /// Computes one tangent frame per vertex from the generated positions and UVs
    /// (Lengyel's per-triangle basis, accumulated, then orthonormalized against the smooth
    /// normal). Vertices whose triangles contribute no usable UV gradient fall back to a
    /// basis built from the normal.
    /// </summary>
    /// <param name="vertices">Vertices to write tangents into.</param>
    /// <param name="indices">Triangle list.</param>
    public static void BuildTangentBasis(
        IList<MaterialPreviewVertex> vertices,
        IReadOnlyList<uint> indices)
    {
        ArgumentNullException.ThrowIfNull(vertices);
        ArgumentNullException.ThrowIfNull(indices);

        int vertexCount = vertices.Count;
        if (vertexCount == 0 || indices.Count < 3)
        {
            return;
        }

        var sums = new TangentAccumulator[vertexCount];
        int triangleCount = indices.Count - (indices.Count % 3);
        for (int i = 0; i < triangleCount; i += 3)
        {
            int i0 = (int)indices[i];
            int i1 = (int)indices[i + 1];
            int i2 = (int)indices[i + 2];
            if ((uint)i0 >= (uint)vertexCount || (uint)i1 >= (uint)vertexCount || (uint)i2 >= (uint)vertexCount)
            {
                continue;
            }

            MaterialPreviewVertex v0 = vertices[i0];
            MaterialPreviewVertex v1 = vertices[i1];
            MaterialPreviewVertex v2 = vertices[i2];

            Vec3 p0 = v0.Position.ToVec3();
            Vec3 edge1 = v1.Position.ToVec3() - p0;
            Vec3 edge2 = v2.Position.ToVec3() - p0;
            Vec2 uv1 = new(v1.Uv0.U - v0.Uv0.U, v1.Uv0.V - v0.Uv0.V);
            Vec2 uv2 = new(v2.Uv0.U - v0.Uv0.U, v2.Uv0.V - v0.Uv0.V);

            float denominator = (uv1.X * uv2.Y) - (uv2.X * uv1.Y);
            if (MathF.Abs(denominator) < DegenerateDenominator)
            {
                continue;
            }

            float r = 1.0f / denominator;
            var tangent = new Vec3(
                (uv2.Y * edge1.X) - (uv1.Y * edge2.X),
                (uv2.Y * edge1.Y) - (uv1.Y * edge2.Y),
                (uv2.Y * edge1.Z) - (uv1.Y * edge2.Z)) * r;
            var bitangent = new Vec3(
                (uv1.X * edge2.X) - (uv2.X * edge1.X),
                (uv1.X * edge2.Y) - (uv2.X * edge1.Y),
                (uv1.X * edge2.Z) - (uv2.X * edge1.Z)) * r;
            float handedness = Vec3.Dot(Vec3.Cross(v0.Normal.ToVec3(), tangent), bitangent) < 0.0f ? -1.0f : 1.0f;

            Accumulate(sums, i0, tangent, bitangent, handedness);
            Accumulate(sums, i1, tangent, bitangent, handedness);
            Accumulate(sums, i2, tangent, bitangent, handedness);
        }

        for (int i = 0; i < vertexCount; i++)
        {
            MaterialPreviewVertex vertex = vertices[i];
            Vec3 normal = vertex.Normal.ToVec3();
            Vec3 tangent = sums[i].Tangent;
            if (tangent.LengthSquared() < DegenerateDenominator)
            {
                tangent = FallbackTangent(normal);
            }
            else
            {
                tangent = Vec3.Normalize(tangent - (normal * Vec3.Dot(normal, tangent)));
                if (tangent.LengthSquared() < DegenerateDenominator)
                {
                    tangent = FallbackTangent(normal);
                }
                else
                {
                    tangent = Vec3.Normalize(tangent);
                }
            }

            float w = sums[i].Handedness >= 0.0f ? 1.0f : -1.0f;
            vertices[i] = vertex.WithTangent(new Tangent4D(tangent.X, tangent.Y, tangent.Z, w));
        }
    }

    private static void Accumulate(
        TangentAccumulator[] sums,
        int index,
        Vec3 tangent,
        Vec3 bitangent,
        float handedness)
    {
        TangentAccumulator current = sums[index];
        sums[index] = new TangentAccumulator(
            current.Tangent + tangent,
            current.Bitangent + bitangent,
            current.Handedness + handedness);
    }

    private static Vec3 FallbackTangent(Vec3 normal)
    {
        Vec3 reference = MathF.Abs(normal.Y) > 0.99f ? Vec3.UnitX : Vec3.UnitY;
        Vec3 tangent = Vec3.Cross(reference, normal);
        return tangent.LengthSquared() < DegenerateDenominator
            ? Vec3.Cross(Vec3.UnitZ, normal)
            : Vec3.Normalize(tangent);
    }

    private static SceneMeshDefinition CreateDefinition(SceneAssetId<MeshAssetTag> id, PreviewSink sink, bool perFaceUv1)
    {
        FillSecondUvSet(sink.Vertices, perFaceUv1);
        BuildTangentBasis(sink.Vertices, sink.Indices);

        byte[] vertexBytes = MemoryMarshal.AsBytes(
            System.Runtime.InteropServices.CollectionsMarshal.AsSpan(sink.Vertices)).ToArray();
        byte[] indexBytes = MemoryMarshal.AsBytes(
            System.Runtime.InteropServices.CollectionsMarshal.AsSpan(sink.Indices)).ToArray();

        var definition = new SceneMeshDefinition(
            id,
            vertexBytes,
            AttributeLayout,
            sink.Vertices.Count,
            indexBytes,
            SceneIndexFormat.UInt32,
            sink.Indices.Count,
            SceneMeshTopology.Triangles);

        return SceneMeshBounds.TryCompute(definition, out BoundingSphere3 bounds)
            ? new SceneMeshDefinition(
                id,
                vertexBytes,
                AttributeLayout,
                sink.Vertices.Count,
                indexBytes,
                SceneIndexFormat.UInt32,
                sink.Indices.Count,
                SceneMeshTopology.Triangles,
                bounds)
            : definition;
    }

    private static void FillSecondUvSet(List<MaterialPreviewVertex> vertices, bool perFaceUv1)
    {
        for (int i = 0; i < vertices.Count; i++)
        {
            MaterialPreviewVertex vertex = vertices[i];
            vertices[i] = perFaceUv1
                ? vertex.WithSecondUv(FaceCellUv(vertex.Normal, vertex.Uv0))
                : vertex.WithSecondUv(vertex.Uv0);
        }
    }

    private static TexCoord FaceCellUv(in Normal3D normal, in TexCoord uv)
    {
        Vec3 value = normal.ToVec3();
        float ax = MathF.Abs(value.X);
        float ay = MathF.Abs(value.Y);
        float az = MathF.Abs(value.Z);

        int face = ax >= ay && ax >= az
            ? (value.X >= 0.0f ? 0 : 1)
            : ay >= az
                ? (value.Y >= 0.0f ? 2 : 3)
                : (value.Z >= 0.0f ? 4 : 5);

        int column = face % 3;
        int row = face / 3;
        const float cellWidth = 1.0f / 3.0f;
        const float cellHeight = 0.5f;
        const float margin = 0.01f;

        float u = (column * cellWidth) + margin + (uv.U * (cellWidth - (2.0f * margin)));
        float v = (row * cellHeight) + margin + (uv.V * (cellHeight - (2.0f * margin)));
        return new TexCoord(u, v);
    }

    private static void ValidatePositive(float value, string name)
    {
        if (!float.IsFinite(value) || value <= 0.0f)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Preview mesh '{name}' must be finite and positive; received {value}.");
        }
    }

    private readonly record struct TangentAccumulator(Vec3 Tangent, Vec3 Bitangent, float Handedness);

    private sealed class PreviewSink : IMeshSink<MaterialPreviewVertex, uint>
    {
        public List<MaterialPreviewVertex> Vertices { get; } = [];

        public List<uint> Indices { get; } = [];

        public uint MaxIndex { get; private set; }

        public uint CurrentVertexCount => (uint)Vertices.Count;

        public void AppendVertex(in MaterialPreviewVertex vertex) => Vertices.Add(vertex);

        public void AppendTriangle(uint i0, uint i1, uint i2)
        {
            Indices.Add(i0);
            Indices.Add(i1);
            Indices.Add(i2);
            MaxIndex = Math.Max(MaxIndex, Math.Max(i0, Math.Max(i1, i2)));
        }
    }
}
