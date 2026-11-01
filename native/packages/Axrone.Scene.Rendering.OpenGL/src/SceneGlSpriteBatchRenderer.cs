namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Batched sprite renderer. Sprites are expanded into world-space quads on the
/// CPU, grouped by texture in collection order and submitted with one draw per
/// contiguous texture run. Buffers and scratch arrays are reused, so a steady
/// frame allocates nothing on the managed heap.
/// </summary>
public sealed class SceneGlSpriteBatchRenderer : IDisposable
{
    private const int InitialSpriteCapacity = 256;
    private const int VerticesPerSprite = 4;
    private const int IndicesPerSprite = 6;

    private const string ViewProjectionUniform = "u_ViewProjection";
    private const string TextureUniform = "u_Texture";

    private const string VertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 1) in vec2 a_Uv;
        layout(location = 2) in vec4 a_Color;
        layout(location = 3) in vec2 a_Local;
        layout(location = 4) in vec4 a_MaskRect;
        layout(location = 5) in vec3 a_MaskParams;

        uniform mat4 u_ViewProjection;

        out vec2 v_Uv;
        out vec4 v_Color;
        out vec2 v_Local;
        out vec4 v_MaskRect;
        out vec3 v_MaskParams;

        void main()
        {
            v_Uv = a_Uv;
            v_Color = a_Color;
            v_Local = a_Local;
            v_MaskRect = a_MaskRect;
            v_MaskParams = a_MaskParams;
            gl_Position = vec4(a_Position, 1.0) * u_ViewProjection;
        }
        """;

    private const string FragmentShaderSource = """
        #version 330 core
        in vec2 v_Uv;
        in vec4 v_Color;
        in vec2 v_Local;
        in vec4 v_MaskRect;
        in vec3 v_MaskParams;

        uniform sampler2D u_Texture;

        out vec4 fragColor;

        float maskFactor()
        {
            if (v_MaskParams.x < 0.5)
            {
                return 1.0;
            }

            vec2 size = max(v_MaskRect.zw, vec2(1e-5));
            vec2 p = (v_Local - v_MaskRect.xy) / size;
            float inside;
            if (v_MaskParams.y < 0.5)
            {
                inside = (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) ? 1.0 : 0.0;
            }
            else
            {
                vec2 d = (p * 2.0) - 1.0;
                inside = dot(d, d) <= 1.0 ? 1.0 : 0.0;
            }

            return v_MaskParams.z > 0.5 ? 1.0 - inside : inside;
        }

        void main()
        {
            float mask = maskFactor();
            if (mask <= 0.0)
            {
                discard;
            }

            fragColor = texture(u_Texture, v_Uv) * v_Color * mask;
        }
        """;

    private static readonly int VertexStride = Unsafe.SizeOf<SpriteVertex>();

    private static readonly VertexAttribute[] s_layout =
    [
        new VertexAttribute(0, 3, GLConst.Float, false, VertexStride, 0, 0, false),
        new VertexAttribute(1, 2, GLConst.Float, false, VertexStride, 12, 0, false),
        new VertexAttribute(2, 4, GLConst.Float, false, VertexStride, 20, 0, false),
        new VertexAttribute(3, 2, GLConst.Float, false, VertexStride, 36, 0, false),
        new VertexAttribute(4, 4, GLConst.Float, false, VertexStride, 44, 0, false),
        new VertexAttribute(5, 3, GLConst.Float, false, VertexStride, 60, 0, false)
    ];

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneGlShader _shader;
    private readonly GLVertexArray _vao;
    private readonly GLBuffer _vertexBuffer;
    private readonly GLBuffer _indexBuffer;

    private SpriteVertex[] _vertices;
    private uint[] _indices;
    private int _vertexCount;
    private int _indexCount;
    private bool _disposed;

    /// <summary>Creates a sprite batch renderer over an uploaded asset cache.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);

        _context = context;
        _assets = assets;
        _shader = new SceneGlShader(context, "scene-sprite-batch", VertexShaderSource, FragmentShaderSource);

        int vertexCapacity = InitialSpriteCapacity * VerticesPerSprite;
        int indexCapacity = InitialSpriteCapacity * IndicesPerSprite;
        _vertices = new SpriteVertex[vertexCapacity];
        _indices = new uint[indexCapacity];

        _vertexBuffer = new GLBuffer(
            context,
            GLConst.ArrayBuffer,
            GLConst.DynamicDraw,
            vertexCapacity * VertexStride,
            "scene-sprite-vertices");
        _indexBuffer = new GLBuffer(
            context,
            GLConst.ElementArrayBuffer,
            GLConst.DynamicDraw,
            indexCapacity * sizeof(uint),
            "scene-sprite-indices");

        _vao = new GLVertexArray(context, "scene-sprite-batch");
        _vao.ConfigureLayout(
            _vertexBuffer,
            _indexBuffer,
            s_layout,
            vertexCapacity,
            indexCapacity,
            GLConst.UnsignedInt);
    }

    /// <summary>Number of sprites submitted by the last render call.</summary>
    public int LastSpriteCount { get; private set; }

    /// <summary>Renders one sprite pass and returns the number of draw calls.</summary>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneSpriteRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        _context.AssertRenderThread();
        LastSpriteCount = 0;

        if (items.Length == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        ApplyState(pass);

        _shader.Bind();
        _shader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);
        _shader.SetInt(TextureUniform, 0);

        int drawCalls = 0;
        SceneAssetId<TextureAssetTag> currentTexture = default;
        bool hasTexture = false;
        int submitted = 0;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneSpriteRenderItem item = ref items[i];

            if (!_assets.TryGetTexture(item.TextureId, out GLTexture? texture))
            {
                continue;
            }

            bool textureChanged = !hasTexture || item.TextureId != currentTexture;
            if (textureChanged)
            {
                if (hasTexture)
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

            AppendSprite(world, in item);
            submitted++;
        }

        if (_indexCount > 0)
        {
            Flush();
            drawCalls++;
        }

        LastSpriteCount = submitted;
        frameState.RecordDraw(submitted << 1, drawCalls);
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
        _shader.Dispose();
        _disposed = true;
    }

    private void ApplyState(SceneRenderPassDefinition pass)
    {
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

    private void AppendSprite(SceneWorld world, ref readonly SceneSpriteRenderItem item)
    {
        if (_vertexCount + VerticesPerSprite > _vertices.Length ||
            _indexCount + IndicesPerSprite > _indices.Length)
        {
            Grow();
        }

        Mat4 worldMatrix = world.HasTransform2D
            ? SceneBounds.FromAffine2D(world.GetWorldMatrix2D(item.Actor))
            : world.GetWorldMatrix3D(item.Actor);

        float left = -item.Anchor.X * item.Size.X;
        float right = left + item.Size.X;
        float bottom = -item.Anchor.Y * item.Size.Y;
        float top = bottom + item.Size.Y;

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

        Vec4 bl = worldMatrix * new Vec4(left, bottom, 0.0f, 1.0f);
        Vec4 br = worldMatrix * new Vec4(right, bottom, 0.0f, 1.0f);
        Vec4 tr = worldMatrix * new Vec4(right, top, 0.0f, 1.0f);
        Vec4 tl = worldMatrix * new Vec4(left, top, 0.0f, 1.0f);

        Vec3 maskParams = new(
            item.HasMask ? 1.0f : 0.0f,
            item.MaskKind == SceneSpriteMaskKind.Ellipse ? 1.0f : 0.0f,
            item.MaskInvert ? 1.0f : 0.0f);
        Vec4 maskRect = item.HasMask ? item.MaskRect : default;

        Span<SpriteVertex> vertices = _vertices.AsSpan(_vertexCount, VerticesPerSprite);
        vertices[0] = new SpriteVertex(new Vec3(bl.X, bl.Y, bl.Z), new Vec2(u0, v0), item.Color, new Vec2(0.0f, 0.0f), maskRect, maskParams);
        vertices[1] = new SpriteVertex(new Vec3(br.X, br.Y, br.Z), new Vec2(u1, v0), item.Color, new Vec2(1.0f, 0.0f), maskRect, maskParams);
        vertices[2] = new SpriteVertex(new Vec3(tr.X, tr.Y, tr.Z), new Vec2(u1, v1), item.Color, new Vec2(1.0f, 1.0f), maskRect, maskParams);
        vertices[3] = new SpriteVertex(new Vec3(tl.X, tl.Y, tl.Z), new Vec2(u0, v1), item.Color, new Vec2(0.0f, 1.0f), maskRect, maskParams);

        // Batches restart their vertex base at zero, so indices must be written
        // relative to this batch rather than the global sprite slot.
        uint baseIndex = (uint)_vertexCount;
        int indexOffset = _indexCount;
        _indices[indexOffset] = baseIndex;
        _indices[indexOffset + 1] = baseIndex + 1;
        _indices[indexOffset + 2] = baseIndex + 2;
        _indices[indexOffset + 3] = baseIndex;
        _indices[indexOffset + 4] = baseIndex + 2;
        _indices[indexOffset + 5] = baseIndex + 3;

        _vertexCount += VerticesPerSprite;
        _indexCount += IndicesPerSprite;
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

    private void Grow()
    {
        int spriteCapacity = _vertices.Length / VerticesPerSprite;
        int newSpriteCapacity = spriteCapacity * 2;

        Array.Resize(ref _vertices, newSpriteCapacity * VerticesPerSprite);
        Array.Resize(ref _indices, newSpriteCapacity * IndicesPerSprite);

        _vertexBuffer.Resize(_vertices.Length * VertexStride);
        _indexBuffer.Resize(_indices.Length * sizeof(uint));
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlSpriteBatchRenderer));
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct SpriteVertex
    {
        public SpriteVertex(
            in Vec3 position,
            in Vec2 uv,
            in Vec4 color,
            in Vec2 local,
            in Vec4 maskRect,
            in Vec3 maskParams)
        {
            Position = position;
            Uv = uv;
            Color = color;
            Local = local;
            MaskRect = maskRect;
            MaskParams = maskParams;
        }

        public readonly Vec3 Position;

        public readonly Vec2 Uv;

        public readonly Vec4 Color;

        public readonly Vec2 Local;

        public readonly Vec4 MaskRect;

        public readonly Vec3 MaskParams;
    }
}
