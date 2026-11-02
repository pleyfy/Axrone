namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Batched renderer for billboards, lines and trails. All three expand to
/// world-space quads on the CPU and share one vertex/index buffer and VAO;
/// billboards bind a texture per run while lines and trails use the untextured
/// program. Buffers are reused, so a steady frame allocates nothing.
/// </summary>
public sealed class SceneGlPrimitiveBatchRenderer : IDisposable
{
    private const int InitialQuadCapacity = 256;
    private const int VerticesPerQuad = 4;
    private const int IndicesPerQuad = 6;

    private const string ViewProjectionUniform = "u_ViewProjection";
    private const string TextureUniform = "u_Texture";

    private const string VertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 1) in vec2 a_Uv;
        layout(location = 2) in vec4 a_Color;

        uniform mat4 u_ViewProjection;

        out vec2 v_Uv;
        out vec4 v_Color;

        void main()
        {
            v_Uv = a_Uv;
            v_Color = a_Color;
            gl_Position = vec4(a_Position, 1.0) * u_ViewProjection;
        }
        """;

    private const string TexturedFragmentSource = """
        #version 330 core
        in vec2 v_Uv;
        in vec4 v_Color;

        uniform sampler2D u_Texture;

        out vec4 fragColor;

        void main()
        {
            fragColor = texture(u_Texture, v_Uv) * v_Color;
        }
        """;

    private const string ColorFragmentSource = """
        #version 330 core
        in vec2 v_Uv;
        in vec4 v_Color;

        out vec4 fragColor;

        void main()
        {
            fragColor = v_Color;
        }
        """;

    private static readonly int VertexStride = Unsafe.SizeOf<PrimitiveVertex>();

    private static readonly VertexAttribute[] s_layout =
    [
        new VertexAttribute(0, 3, GLConst.Float, false, VertexStride, 0, 0, false),
        new VertexAttribute(1, 2, GLConst.Float, false, VertexStride, 12, 0, false),
        new VertexAttribute(2, 4, GLConst.Float, false, VertexStride, 20, 0, false)
    ];

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneGlShader _texturedShader;
    private readonly SceneGlShader _colorShader;
    private readonly GLVertexArray _vao;
    private readonly GLBuffer _vertexBuffer;
    private readonly GLBuffer _indexBuffer;

    private PrimitiveVertex[] _vertices;
    private uint[] _indices;
    private int _vertexCount;
    private int _indexCount;
    private readonly Vec3[] _corners = new Vec3[4];
    private readonly Vec3[] _joinScratch = new Vec3[SceneLineGeometry.MaxJoinVertices];
    private readonly Vec3[] _capScratch = new Vec3[SceneLineGeometry.MaxCapVertices];
    private bool _disposed;

    /// <summary>Creates the primitive batch renderer.</summary>
    public SceneGlPrimitiveBatchRenderer(GLContext context, SceneGlAssetCache assets)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);

        _context = context;
        _assets = assets;
        _texturedShader = new SceneGlShader(context, "scene-primitive-textured", VertexShaderSource, TexturedFragmentSource);
        _colorShader = new SceneGlShader(context, "scene-primitive-color", VertexShaderSource, ColorFragmentSource);

        int vertexCapacity = InitialQuadCapacity * VerticesPerQuad;
        int indexCapacity = InitialQuadCapacity * IndicesPerQuad;
        _vertices = new PrimitiveVertex[vertexCapacity];
        _indices = new uint[indexCapacity];

        _vertexBuffer = new GLBuffer(
            context,
            GLConst.ArrayBuffer,
            GLConst.DynamicDraw,
            vertexCapacity * VertexStride,
            "scene-primitive-vertices");
        _indexBuffer = new GLBuffer(
            context,
            GLConst.ElementArrayBuffer,
            GLConst.DynamicDraw,
            indexCapacity * sizeof(uint),
            "scene-primitive-indices");

        _vao = new GLVertexArray(context, "scene-primitive-batch");
        _vao.ConfigureLayout(
            _vertexBuffer,
            _indexBuffer,
            s_layout,
            vertexCapacity,
            indexCapacity,
            GLConst.UnsignedInt);
    }

    /// <summary>Number of quads submitted by the last render call.</summary>
    public int LastQuadCount { get; private set; }

    /// <summary>Number of draw calls issued by the last render call.</summary>
    public int LastDrawCalls { get; private set; }

    /// <summary>Renders billboards, grouping consecutive items by texture.</summary>
    public int RenderBillboards(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneBillboardRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        Begin(pass, camera);
        if (items.Length == 0)
        {
            return 0;
        }

        _texturedShader.Bind();
        _texturedShader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);
        _texturedShader.SetInt(TextureUniform, 0);

        Vec3 cameraRight = camera.Rotation * Vec3.UnitX;
        Vec3 cameraUp = camera.Rotation * Vec3.UnitY;

        int drawCalls = 0;
        int submitted = 0;
        SceneAssetId<TextureAssetTag> currentTexture = default;
        bool hasTexture = false;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneBillboardRenderItem item = ref items[i];
            if (!_assets.TryGetTexture(item.TextureId, out GLTexture? texture))
            {
                continue;
            }

            if (!hasTexture || item.TextureId != currentTexture)
            {
                if (_indexCount > 0)
                {
                    Flush();
                    drawCalls++;
                }

                _assets.TryGetTextureSampler(item.TextureId, out GLSampler? sampler);
                _context.State.BindTexture2D(0, texture.Id);
                _ = sampler!.Bind(0);
                currentTexture = item.TextureId;
                hasTexture = true;
            }

            Vec3 center = world.GetWorldPosition3D(item.Actor);
            Vec3 right = cameraRight;
            Vec3 up = cameraUp;
            if (item.Mode == SceneBillboardMode.Cylindrical)
            {
                Vec3 towardCamera = camera.Position - center;
                Vec3 side = Vec3.Cross(Vec3.UnitY, towardCamera);
                if (side.LengthSquared() > 1e-8f)
                {
                    right = Vec3.Normalize(side);
                }

                up = Vec3.UnitY;
            }

            AppendBillboard(in item, in center, in right, in up);
            submitted++;
        }

        if (_indexCount > 0)
        {
            Flush();
            drawCalls++;
        }

        LastDrawCalls = drawCalls;
        LastQuadCount = submitted;
        frameState.RecordDraw(submitted * 2, drawCalls);
        return drawCalls;
    }

    /// <summary>Renders world-space line segments with camera-facing ribbons.</summary>
    public int RenderLines(
        SceneCameraFrame camera,
        ReadOnlySpan<SceneLineRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        Begin(pass, camera);
        if (items.Length == 0)
        {
            return 0;
        }

        _colorShader.Bind();
        _colorShader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);

        bool closed = items.Length > 1 && items[0].Start == items[^1].End;
        int submitted = 0;
        int triangles = 0;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneLineRenderItem item = ref items[i];
            Vec3 delta = item.End - item.Start;
            float lengthSquared = delta.LengthSquared();
            if (lengthSquared < 1e-12f)
            {
                continue;
            }

            Vec3 direction = delta / MathF.Sqrt(lengthSquared);
            Vec3 middle = (item.Start + item.End) * 0.5f;
            Vec3 toCamera = camera.Position - middle;
            Vec3 view = toCamera.LengthSquared() > 1e-8f ? Vec3.Normalize(toCamera) : Vec3.UnitZ;

            SceneLineRenderItem previous = Previous(i, items, closed);
            SceneLineRenderItem next = Next(i, items, closed);
            bool hasPrevious = IsAdjacent(in previous, in item, previous.End, item.Start);
            bool hasNext = IsAdjacent(in item, in next, item.End, next.Start);

            Span<Vec3> corners = _corners;
            if (SceneLineGeometry.BuildRibbon(in item.Start, in item.End, item.Width, in view, SceneLineCap.Butt, corners) == 0)
            {
                continue;
            }

            float extension = item.Width * 0.5f;
            if (!hasPrevious && (item.Cap == SceneLineCap.Square || item.Cap == SceneLineCap.Round))
            {
                corners[0] -= direction * extension;
                corners[1] -= direction * extension;
            }

            if (!hasNext && (item.Cap == SceneLineCap.Square || item.Cap == SceneLineCap.Round))
            {
                corners[2] += direction * extension;
                corners[3] += direction * extension;
            }

            AppendQuad(corners, item.Color, item.Color, new Vec2(0, 0), new Vec2(1, 1));
            submitted++;
            triangles += 2;

            if (hasPrevious)
            {
                Vec3 previousDirection = Vec3.Normalize(previous.End - previous.Start);
                int count = SceneLineGeometry.BuildJoin(
                    in item.Start,
                    in previousDirection,
                    in direction,
                    item.Width,
                    in view,
                    item.Join,
                    _joinScratch);
                triangles += AppendFan(in item.Start, _joinScratch.AsSpan(0, count), item.Color);
            }

            if (!hasPrevious && item.Cap == SceneLineCap.Round)
            {
                int count = SceneLineGeometry.BuildRoundCap(in item.Start, in direction, item.Width, in view, _capScratch);
                triangles += AppendFan(in item.Start, _capScratch.AsSpan(0, count), item.Color);
            }

            if (!hasNext && item.Cap == SceneLineCap.Round)
            {
                int count = SceneLineGeometry.BuildRoundCap(in item.End, in direction, item.Width, in view, _capScratch);
                triangles += AppendFan(in item.End, _capScratch.AsSpan(0, count), item.Color);
            }
        }

        int drawCalls = 0;
        if (_indexCount > 0)
        {
            Flush();
            drawCalls = 1;
        }

        LastDrawCalls = drawCalls;
        LastQuadCount = submitted;
        frameState.RecordDraw(triangles, drawCalls);
        return drawCalls;
    }

    /// <summary>Renders fading trail segments with per-endpoint alpha.</summary>
    public int RenderTrails(
        SceneCameraFrame camera,
        ReadOnlySpan<SceneTrailRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        Begin(pass, camera);
        if (items.Length == 0)
        {
            return 0;
        }

        _colorShader.Bind();
        _colorShader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);

        int submitted = 0;
        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneTrailRenderItem item = ref items[i];
            Vec3 middle = (item.Start + item.End) * 0.5f;
            Vec3 toCamera = camera.Position - middle;
            Vec3 view = toCamera.LengthSquared() > 1e-8f ? Vec3.Normalize(toCamera) : Vec3.UnitZ;
            Span<Vec3> corners = _corners;
            if (SceneLineGeometry.BuildRibbon(in item.Start, in item.End, item.Width, in view, SceneLineCap.Butt, corners) == 0)
            {
                continue;
            }

            Vec4 startColor = new(item.Color.X, item.Color.Y, item.Color.Z, item.Color.W * item.StartAlpha);
            Vec4 endColor = new(item.Color.X, item.Color.Y, item.Color.Z, item.Color.W * item.EndAlpha);
            AppendQuad(corners, startColor, endColor, new Vec2(0, 0), new Vec2(1, 1));
            submitted++;
        }

        int drawCalls = 0;
        if (_indexCount > 0)
        {
            Flush();
            drawCalls = 1;
        }

        LastDrawCalls = drawCalls;
        LastQuadCount = submitted;
        frameState.RecordDraw(submitted * 2, drawCalls);
        return drawCalls;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _vao.Dispose();
        _vertexBuffer.Dispose();
        _indexBuffer.Dispose();
        _texturedShader.Dispose();
        _colorShader.Dispose();
        _disposed = true;
    }

    private void Begin(SceneRenderPassDefinition pass, SceneCameraFrame camera)
    {
        _context.AssertRenderThread();
        LastQuadCount = 0;
        LastDrawCalls = 0;
        _vertexCount = 0;
        _indexCount = 0;

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        bool depthTest = pass.DepthTest ?? true;
        bool blend = pass.Blend ?? true;

        _context.State.SetDepthTest(depthTest);
        _context.State.SetDepthMask(depthTest);
        _context.State.SetCullFace(pass.Cull ?? false);
        _context.State.SetCullMode(GLConst.Back);
        _context.State.SetBlend(blend);

        if (blend)
        {
            _context.State.SetBlendFuncSeparate(
                GLConst.SrcAlpha,
                GLConst.OneMinusSrcAlpha,
                GLConst.One,
                GLConst.OneMinusSrcAlpha);
        }
    }

    private void AppendBillboard(
        in SceneBillboardRenderItem item,
        in Vec3 center,
        in Vec3 right,
        in Vec3 up)
    {
        float left = -item.Anchor.X * item.Size.X;
        float rightExtent = left + item.Size.X;
        float bottom = -item.Anchor.Y * item.Size.Y;
        float top = bottom + item.Size.Y;

        Span<Vec3> corners = _corners;
        corners[0] = center + (right * left) + (up * bottom);
        corners[1] = center + (right * rightExtent) + (up * bottom);
        corners[2] = center + (right * rightExtent) + (up * top);
        corners[3] = center + (right * left) + (up * top);

        float u0 = item.UvRect.X;
        float v0 = item.UvRect.Y;
        float u1 = u0 + item.UvRect.Z;
        float v1 = v0 + item.UvRect.W;

        if (item.FlipX)
        {
            (u0, u1) = (u1, u0);
        }

        if (item.FlipY)
        {
            (v0, v1) = (v1, v0);
        }

        AppendQuad(corners, item.Color, item.Color, new Vec2(u0, v0), new Vec2(u1, v1));
    }

    private static SceneLineRenderItem Previous(
        int index,
        ReadOnlySpan<SceneLineRenderItem> items,
        bool closed) =>
        index > 0 ? items[index - 1] : closed ? items[^1] : items[index];

    private static SceneLineRenderItem Next(
        int index,
        ReadOnlySpan<SceneLineRenderItem> items,
        bool closed) =>
        index + 1 < items.Length ? items[index + 1] : closed ? items[0] : items[index];

    private static bool IsAdjacent(
        in SceneLineRenderItem previous,
        in SceneLineRenderItem current,
        in Vec3 previousEnd,
        in Vec3 currentStart) =>
        previous.Actor == current.Actor &&
        previous.Width == current.Width &&
        previousEnd == currentStart;

    private int AppendFan(in Vec3 center, ReadOnlySpan<Vec3> points, in Vec4 color)
    {
        if (points.Length < 2)
        {
            return 0;
        }

        for (int i = 0; i < points.Length - 1; i++)
        {
            AppendTriangle(in center, in points[i], in points[i + 1], in color);
        }

        return points.Length - 1;
    }

    private void AppendTriangle(in Vec3 a, in Vec3 b, in Vec3 c, in Vec4 color)
    {
        EnsureCapacity();

        uint baseIndex = (uint)_vertexCount;
        Span<PrimitiveVertex> vertices = _vertices.AsSpan(_vertexCount, 3);
        vertices[0] = new PrimitiveVertex(in a, Vec2.Zero, in color);
        vertices[1] = new PrimitiveVertex(in b, Vec2.Zero, in color);
        vertices[2] = new PrimitiveVertex(in c, Vec2.Zero, in color);

        Span<uint> indices = _indices.AsSpan(_indexCount, 3);
        indices[0] = baseIndex;
        indices[1] = baseIndex + 1;
        indices[2] = baseIndex + 2;

        _vertexCount += 3;
        _indexCount += 3;
    }

    private void AppendQuad(
        ReadOnlySpan<Vec3> corners,
        in Vec4 startColor,
        in Vec4 endColor,
        in Vec2 uvMin,
        in Vec2 uvMax)
    {
        EnsureCapacity();

        uint baseIndex = (uint)_vertexCount;
        Span<PrimitiveVertex> vertices = _vertices.AsSpan(_vertexCount, VerticesPerQuad);
        vertices[0] = new PrimitiveVertex(corners[0], new Vec2(uvMin.X, uvMin.Y), startColor);
        vertices[1] = new PrimitiveVertex(corners[1], new Vec2(uvMax.X, uvMin.Y), startColor);
        vertices[2] = new PrimitiveVertex(corners[2], new Vec2(uvMax.X, uvMax.Y), endColor);
        vertices[3] = new PrimitiveVertex(corners[3], new Vec2(uvMin.X, uvMax.Y), endColor);

        Span<uint> indices = _indices.AsSpan(_indexCount, IndicesPerQuad);
        indices[0] = baseIndex;
        indices[1] = baseIndex + 1;
        indices[2] = baseIndex + 2;
        indices[3] = baseIndex;
        indices[4] = baseIndex + 2;
        indices[5] = baseIndex + 3;

        _vertexCount += VerticesPerQuad;
        _indexCount += IndicesPerQuad;
    }

    private unsafe void Flush()
    {
        if (_indexCount == 0)
        {
            return;
        }

        _vertexBuffer.Update(MemoryMarshal.AsBytes(_vertices.AsSpan(0, _vertexCount)));
        _indexBuffer.Update(MemoryMarshal.AsBytes(_indices.AsSpan(0, _indexCount)));
        _vao.Bind();
        _context.GL.DrawElements(GLConst.Triangles, (uint)_indexCount, GLConst.UnsignedInt, null);

        _vertexCount = 0;
        _indexCount = 0;
    }

    private void EnsureCapacity()
    {
        if (_vertexCount + VerticesPerQuad <= _vertices.Length &&
            _indexCount + IndicesPerQuad <= _indices.Length)
        {
            return;
        }

        int quadCapacity = (_vertices.Length / VerticesPerQuad) * 2;
        _vertices = new PrimitiveVertex[quadCapacity * VerticesPerQuad];
        _indices = new uint[quadCapacity * IndicesPerQuad];
        _vertexBuffer.Resize(_vertices.Length * VertexStride);
        _indexBuffer.Resize(_indices.Length * sizeof(uint));
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlPrimitiveBatchRenderer));
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct PrimitiveVertex
    {
        public PrimitiveVertex(in Vec3 position, in Vec2 uv, in Vec4 color)
        {
            Position = position;
            Uv = uv;
            Color = color;
        }

        public readonly Vec3 Position;

        public readonly Vec2 Uv;

        public readonly Vec4 Color;
    }
}
