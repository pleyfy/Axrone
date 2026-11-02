namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Batched sprite renderer. Sprites are grouped into contiguous runs keyed by
/// texture and material; short runs are expanded into world-space quads on the
/// CPU, long runs go through a per-instance fast path that keeps one base quad
/// and uploads an instance block. Buffers and scratch arrays are reused, so a
/// steady frame allocates nothing on the managed heap.
/// </summary>
/// <remarks>
/// A material id of zero/default keeps the historical texture-only grouping;
/// any material change inside a texture run starts a new group so material
/// state can be bound between draws. The instanced path is selected by a
/// deterministic run-length threshold owned by <see cref="SceneSpriteBatchPlanner"/>.
/// </remarks>
public sealed class SceneGlSpriteBatchRenderer : IDisposable
{
    private const int InitialSpriteCapacity = 256;
    private const int VerticesPerSprite = 4;
    private const int IndicesPerSprite = 6;

    private const string ViewProjectionUniform = "u_ViewProjection";
    private const string TextureUniform = "u_Texture";

    private const string MaskFunctionSource = """
        float maskFactor()
        {
            if (v_MaskParams.x < 0.5)
            {
                return 1.0;
            }

            vec2 size = max(v_MaskRect.zw, vec2(1e-5));
            vec2 p = (v_Local - v_MaskRect.xy) / size;
            float feather = max(v_MaskExtra.x, 1e-4);
            float corner = clamp(v_MaskExtra.y, 0.0, 0.5);
            float inside;

            if (v_MaskParams.y < 0.5 || v_MaskParams.y > 1.5)
            {
                vec2 q = abs(p - 0.5) - (0.5 - corner);
                float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
                inside = 1.0 - smoothstep(0.0, feather, d);
            }
            else
            {
                vec2 q = (p * 2.0) - 1.0;
                float d = length(q) - 1.0;
                inside = 1.0 - smoothstep(0.0, feather * 2.0, d);
            }

            return v_MaskParams.z > 0.5 ? 1.0 - inside : inside;
        }
        """;

    private const string FragmentBodySource = """
        void main()
        {
            float mask = maskFactor();
            vec4 color = texture(u_Texture, v_Uv) * v_Color;
            color.a *= mask;
            if (color.a <= 0.001)
            {
                discard;
            }

            fragColor = color;
        }
        """;

    private const string ImmediateVertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 1) in vec2 a_Uv;
        layout(location = 2) in vec4 a_Color;
        layout(location = 3) in vec2 a_Local;
        layout(location = 4) in vec4 a_MaskRect;
        layout(location = 5) in vec3 a_MaskParams;
        layout(location = 6) in vec2 a_MaskExtra;

        uniform mat4 u_ViewProjection;

        out vec2 v_Uv;
        out vec4 v_Color;
        out vec2 v_Local;
        out vec4 v_MaskRect;
        out vec3 v_MaskParams;
        out vec2 v_MaskExtra;

        void main()
        {
            v_Uv = a_Uv;
            v_Color = a_Color;
            v_Local = a_Local;
            v_MaskRect = a_MaskRect;
            v_MaskParams = a_MaskParams;
            v_MaskExtra = a_MaskExtra;
            gl_Position = vec4(a_Position, 1.0) * u_ViewProjection;
        }
        """;

    private const string InstancedVertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec2 a_Corner;
        layout(location = 1) in vec4 a_Row0;
        layout(location = 2) in vec4 a_Row1;
        layout(location = 3) in vec4 a_Row2;
        layout(location = 4) in vec4 a_Row3;
        layout(location = 5) in vec4 a_Color;
        layout(location = 6) in vec4 a_UvRect;
        layout(location = 7) in vec4 a_MaskRect;
        layout(location = 8) in vec4 a_MaskParams;
        layout(location = 9) in vec4 a_MaskExtra;
        layout(location = 10) in vec4 a_Geometry;

        uniform mat4 u_ViewProjection;

        out vec2 v_Uv;
        out vec4 v_Color;
        out vec2 v_Local;
        out vec4 v_MaskRect;
        out vec3 v_MaskParams;
        out vec2 v_MaskExtra;

        void main()
        {
            vec2 local = (a_Corner - a_Geometry.zw) * a_Geometry.xy;
            mat4 model = mat4(a_Row0, a_Row1, a_Row2, a_Row3);
            gl_Position = vec4(local, 0.0, 1.0) * model * u_ViewProjection;
            v_Uv = a_UvRect.xy + (a_Corner * a_UvRect.zw);
            v_Color = a_Color;
            v_Local = a_Corner;
            v_MaskRect = a_MaskRect;
            v_MaskParams = a_MaskParams.xyz;
            v_MaskExtra = vec2(a_MaskParams.w, a_MaskExtra.x);
        }
        """;

    private const string ImmediateFragmentHeaderSource = """
        #version 330 core
        in vec2 v_Uv;
        in vec4 v_Color;
        in vec2 v_Local;
        in vec4 v_MaskRect;
        in vec3 v_MaskParams;
        in vec2 v_MaskExtra;

        uniform sampler2D u_Texture;

        out vec4 fragColor;
        """;

    private const string InstancedFragmentHeaderSource = """
        #version 330 core
        in vec2 v_Uv;
        in vec4 v_Color;
        in vec2 v_Local;
        in vec4 v_MaskRect;
        in vec3 v_MaskParams;
        in vec2 v_MaskExtra;

        uniform sampler2D u_Texture;

        out vec4 fragColor;
        """;

    private const string ImmediateFragmentShaderSource =
        ImmediateFragmentHeaderSource + "\n" + MaskFunctionSource + "\n" + FragmentBodySource;

    private const string InstancedFragmentShaderSource =
        InstancedFragmentHeaderSource + "\n" + MaskFunctionSource + "\n" + FragmentBodySource;

    private static readonly int VertexStride = Unsafe.SizeOf<SpriteVertex>();
    private static readonly int InstanceStride = Unsafe.SizeOf<SpriteInstance>();
    private static readonly int QuadStride = Unsafe.SizeOf<QuadCorner>();

    private static readonly VertexAttribute[] s_layout =
    [
        new VertexAttribute(0, 3, GLConst.Float, false, VertexStride, 0, 0, false),
        new VertexAttribute(1, 2, GLConst.Float, false, VertexStride, 12, 0, false),
        new VertexAttribute(2, 4, GLConst.Float, false, VertexStride, 20, 0, false),
        new VertexAttribute(3, 2, GLConst.Float, false, VertexStride, 36, 0, false),
        new VertexAttribute(4, 4, GLConst.Float, false, VertexStride, 44, 0, false),
        new VertexAttribute(5, 3, GLConst.Float, false, VertexStride, 60, 0, false),
        new VertexAttribute(6, 2, GLConst.Float, false, VertexStride, 72, 0, false)
    ];

    private static readonly VertexAttribute[] s_quadLayout =
    [
        new VertexAttribute(0, 2, GLConst.Float, false, QuadStride, 0, 0, false)
    ];

    private static readonly QuadCorner[] s_quadCorners =
    [
        new QuadCorner(new Vec2(0.0f, 0.0f)),
        new QuadCorner(new Vec2(1.0f, 0.0f)),
        new QuadCorner(new Vec2(1.0f, 1.0f)),
        new QuadCorner(new Vec2(0.0f, 1.0f))
    ];

    private static readonly uint[] s_quadIndices = [0u, 1u, 2u, 0u, 2u, 3u];

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneSpriteBatchPlanner _planner;
    private readonly SceneGlShader _shader;
    private readonly GLVertexArray _vao;
    private readonly GLBuffer _vertexBuffer;
    private readonly GLBuffer _indexBuffer;
    private readonly SceneGlShader _instancedShader;
    private readonly GLVertexArray _instancedVao;
    private readonly GLBuffer _quadBuffer;
    private readonly GLBuffer _quadIndexBuffer;
    private readonly GLBuffer _instanceBuffer;

    private SpriteVertex[] _vertices;
    private uint[] _indices;
    private SpriteInstance[] _instances;
    private int _vertexCount;
    private int _indexCount;
    private bool _disposed;

    /// <summary>Creates a sprite batch renderer over an uploaded asset cache.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets)
        : this(context, assets, new SceneSpriteBatchPlanner())
    {
    }

    /// <summary>Creates a sprite batch renderer with an explicit fast-path threshold.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets, int minInstancesForFastPath)
        : this(context, assets, new SceneSpriteBatchPlanner(64, minInstancesForFastPath))
    {
    }

    /// <summary>Creates a sprite batch renderer with an explicit run planner.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets, SceneSpriteBatchPlanner planner)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(planner);

        _context = context;
        _assets = assets;
        _planner = planner;
        _shader = new SceneGlShader(context, "scene-sprite-batch", ImmediateVertexShaderSource, ImmediateFragmentShaderSource);
        _instancedShader = new SceneGlShader(context, "scene-sprite-batch-instanced", InstancedVertexShaderSource, InstancedFragmentShaderSource);

        int vertexCapacity = InitialSpriteCapacity * VerticesPerSprite;
        int indexCapacity = InitialSpriteCapacity * IndicesPerSprite;
        _vertices = new SpriteVertex[vertexCapacity];
        _indices = new uint[indexCapacity];
        _instances = GC.AllocateArray<SpriteInstance>(InitialSpriteCapacity, pinned: true);

        _vertexBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, vertexCapacity * VertexStride, "scene-sprite-vertices");
        _indexBuffer = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.DynamicDraw, indexCapacity * sizeof(uint), "scene-sprite-indices");
        _vao = new GLVertexArray(context, "scene-sprite-batch");
        _vao.ConfigureLayout(_vertexBuffer, _indexBuffer, s_layout, vertexCapacity, indexCapacity, GLConst.UnsignedInt);

        _quadBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.StaticDraw, s_quadCorners.Length * QuadStride, "scene-sprite-quad");
        _quadIndexBuffer = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.StaticDraw, s_quadIndices.Length * sizeof(uint), "scene-sprite-quad-indices");
        _instanceBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, InitialSpriteCapacity * InstanceStride, "scene-sprite-instances");
        _instancedVao = new GLVertexArray(context, "scene-sprite-batch-instanced");
        _instancedVao.ConfigureLayout(_quadBuffer, _quadIndexBuffer, s_quadLayout, s_quadCorners.Length, s_quadIndices.Length, GLConst.UnsignedInt);

        if (InstanceStride != 160)
        {
            _instancedVao.Dispose();
            _instanceBuffer.Dispose();
            _quadIndexBuffer.Dispose();
            _quadBuffer.Dispose();
            _vao.Dispose();
            _indexBuffer.Dispose();
            _vertexBuffer.Dispose();
            _shader.Dispose();
            _instancedShader.Dispose();
            throw new SceneConfigurationException(
                $"Sprite instance layout must be 160 bytes; measured {InstanceStride}.");
        }

        UploadQuadGeometry();
        ConfigureInstanceAttributes();
        context.Lifecycle.ContextRestored += OnContextRestored;
    }

    /// <summary>Number of sprites submitted by the last render call.</summary>
    public int LastSpriteCount { get; private set; }

    /// <summary>Number of sprites drawn through the instanced fast path.</summary>
    public int LastInstancedSpriteCount { get; private set; }

    /// <summary>Number of sprites drawn through the immediate path.</summary>
    public int LastImmediateSpriteCount { get; private set; }

    /// <summary>Number of instanced runs drawn.</summary>
    public int LastInstancedRunCount { get; private set; }

    /// <summary>Number of immediate runs drawn.</summary>
    public int LastImmediateRunCount { get; private set; }

    /// <summary>Gets the deterministic run-length threshold for the fast path.</summary>
    public int MinInstancesForFastPath => _planner.MinInstancesForFastPath;

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
        ResetCounters();

        if (items.Length == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        ApplyState(pass);

        int drawCalls = 0;
        int submitted = 0;
        int groupCount = _planner.Plan(items);
        ReadOnlySpan<SceneSpriteInstanceGroup> groups = _planner.Groups;
        for (int groupIndex = 0; groupIndex < groupCount; groupIndex++)
        {
            ref readonly SceneSpriteInstanceGroup group = ref groups[groupIndex];
            if (!_assets.TryGetTexture(group.TextureId, out GLTexture? texture))
            {
                continue;
            }

            BindTexture(group.TextureId, texture);

            if (group.Instanced)
            {
                DrawInstanced(world, camera, items, in group);
                LastInstancedRunCount++;
                LastInstancedSpriteCount += group.Count;
            }
            else
            {
                for (int itemIndex = 0; itemIndex < group.Count; itemIndex++)
                {
                    AppendSprite(world, in items[group.FirstItem + itemIndex]);
                }

                FlushImmediate(camera);
                LastImmediateRunCount++;
                LastImmediateSpriteCount += group.Count;
            }

            submitted += group.Count;
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

        _context.Lifecycle.ContextRestored -= OnContextRestored;

        _instancedVao.Dispose();
        _instanceBuffer.Dispose();
        _quadIndexBuffer.Dispose();
        _quadBuffer.Dispose();
        _instancedShader.Dispose();
        _vao.Dispose();
        _vertexBuffer.Dispose();
        _indexBuffer.Dispose();
        _shader.Dispose();
        _disposed = true;
    }

    private void ResetCounters()
    {
        LastSpriteCount = 0;
        LastInstancedSpriteCount = 0;
        LastImmediateSpriteCount = 0;
        LastInstancedRunCount = 0;
        LastImmediateRunCount = 0;
    }

    private void BindTexture(SceneAssetId<TextureAssetTag> textureId, GLTexture texture)
    {
        _assets.TryGetTextureSampler(textureId, out GLSampler? sampler);
        _context.State.BindTexture2D(0, texture.Id);
        _ = sampler!.Bind(0);
    }

    private unsafe void DrawInstanced(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneSpriteRenderItem> items,
        in SceneSpriteInstanceGroup group)
    {
        EnsureInstanceCapacity(group.Count);
        for (int i = 0; i < group.Count; i++)
        {
            _instances[i] = BuildInstance(world, in items[group.FirstItem + i]);
        }

        _instanceBuffer.Update(MemoryMarshal.AsBytes(_instances.AsSpan(0, group.Count)));
        _instancedShader.Bind();
        _instancedShader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);
        _instancedShader.SetInt(TextureUniform, 0);
        _context.State.BindVertexArray(_instancedVao.Id);
        _context.GL.DrawElementsInstanced(
            GLConst.Triangles,
            IndicesPerSprite,
            GLConst.UnsignedInt,
            null,
            (uint)group.Count);
        _context.State.BindVertexArray(0);
    }

    private void FlushImmediate(SceneCameraFrame camera)
    {
        if (_indexCount == 0)
        {
            return;
        }

        _shader.Bind();
        _shader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);
        _shader.SetInt(TextureUniform, 0);
        Flush();
    }

    private static SpriteInstance BuildInstance(SceneWorld world, in SceneSpriteRenderItem item)
    {
        Mat4 worldMatrix = world.HasTransform2D
            ? SceneBounds.FromAffine2D(world.GetWorldMatrix2D(item.Actor))
            : world.GetWorldMatrix3D(item.Actor);

        float u0 = item.UvRect.X;
        float v0 = item.UvRect.Y;
        float u1 = u0 + item.UvRect.Z;
        float v1 = v0 + item.UvRect.W;
        float du = item.UvRect.Z;
        float dv = item.UvRect.W;

        if (item.FlipX)
        {
            (u0, u1) = (u1, u0);
            du = -du;
        }

        if (item.FlipY)
        {
            (v0, v1) = (v1, v0);
            dv = -dv;
        }

        Vec4 uvRect = new(u0, v0, du, dv);
        Vec4 maskRect = item.HasMask ? item.MaskRect : default;
        Vec4 maskParams = item.HasMask
            ? new Vec4(1.0f, item.MaskKind switch
            {
                SceneSpriteMaskKind.Ellipse => 1.0f,
                SceneSpriteMaskKind.RoundedRect => 2.0f,
                _ => 0.0f
            }, item.MaskInvert ? 1.0f : 0.0f, item.MaskFeather)
            : default;
        Vec4 maskExtra = item.HasMask ? new Vec4(item.MaskCornerRadius, 0.0f, 0.0f, 0.0f) : default;
        Vec4 geometry = new(item.Size.X, item.Size.Y, item.Anchor.X, item.Anchor.Y);
        return new SpriteInstance(worldMatrix, item.Color, uvRect, maskRect, maskParams, maskExtra, geometry);
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
            item.MaskKind switch
            {
                SceneSpriteMaskKind.Ellipse => 1.0f,
                SceneSpriteMaskKind.RoundedRect => 2.0f,
                _ => 0.0f
            },
            item.MaskInvert ? 1.0f : 0.0f);
        Vec4 maskRect = item.HasMask ? item.MaskRect : default;
        Vec2 maskExtra = item.HasMask ? new Vec2(item.MaskFeather, item.MaskCornerRadius) : Vec2.Zero;

        Span<SpriteVertex> vertices = _vertices.AsSpan(_vertexCount, VerticesPerSprite);
        vertices[0] = new SpriteVertex(new Vec3(bl.X, bl.Y, bl.Z), new Vec2(u0, v0), item.Color, new Vec2(0.0f, 0.0f), maskRect, maskParams, maskExtra);
        vertices[1] = new SpriteVertex(new Vec3(br.X, br.Y, br.Z), new Vec2(u1, v0), item.Color, new Vec2(1.0f, 0.0f), maskRect, maskParams, maskExtra);
        vertices[2] = new SpriteVertex(new Vec3(tr.X, tr.Y, tr.Z), new Vec2(u1, v1), item.Color, new Vec2(1.0f, 1.0f), maskRect, maskParams, maskExtra);
        vertices[3] = new SpriteVertex(new Vec3(tl.X, tl.Y, tl.Z), new Vec2(u0, v1), item.Color, new Vec2(0.0f, 1.0f), maskRect, maskParams, maskExtra);

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

    private void UploadQuadGeometry()
    {
        _quadBuffer.Update(MemoryMarshal.AsBytes(s_quadCorners.AsSpan()));
        _quadIndexBuffer.Update(MemoryMarshal.AsBytes(s_quadIndices.AsSpan()));
    }

    private unsafe void ConfigureInstanceAttributes()
    {
        _context.State.BindVertexArray(_instancedVao.Id);
        _context.State.BindArrayBuffer(_instanceBuffer.Id);

        for (uint row = 0; row < 4; row++)
        {
            SetInstanceAttribute(1 + row, 4, (int)(row * 16));
        }

        SetInstanceAttribute(5, 4, 64);
        SetInstanceAttribute(6, 4, 80);
        SetInstanceAttribute(7, 4, 96);
        SetInstanceAttribute(8, 4, 112);
        SetInstanceAttribute(9, 4, 128);
        SetInstanceAttribute(10, 4, 144);

        _context.State.BindVertexArray(0);
    }

    private unsafe void SetInstanceAttribute(uint location, int components, int offset)
    {
        _context.GL.EnableVertexAttribArray(location);
        _context.GL.VertexAttribPointer(
            location,
            components,
            GLConst.Float,
            false,
            (uint)InstanceStride,
            (void*)offset);
        _context.GL.VertexAttribDivisor(location, 1);
    }

    private void OnContextRestored(object? sender, EventArgs e)
    {
        UploadQuadGeometry();
        ConfigureInstanceAttributes();
    }

    private void EnsureInstanceCapacity(int required)
    {
        if (required <= _instances.Length)
        {
            return;
        }

        int capacity = _instances.Length;
        while (capacity < required)
        {
            capacity = capacity > int.MaxValue / 2 ? required : capacity * 2;
        }

        _instances = GC.AllocateArray<SpriteInstance>(capacity, pinned: true);
        _instanceBuffer.Resize(capacity * InstanceStride);
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
            in Vec3 maskParams,
            in Vec2 maskExtra)
        {
            Position = position;
            Uv = uv;
            Color = color;
            Local = local;
            MaskRect = maskRect;
            MaskParams = maskParams;
            MaskExtra = maskExtra;
        }

        public readonly Vec3 Position;

        public readonly Vec2 Uv;

        public readonly Vec4 Color;

        public readonly Vec2 Local;

        public readonly Vec4 MaskRect;

        public readonly Vec3 MaskParams;

        public readonly Vec2 MaskExtra;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct QuadCorner
    {
        public QuadCorner(in Vec2 corner) => Corner = corner;

        public readonly Vec2 Corner;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct SpriteInstance
    {
        public SpriteInstance(
            in Mat4 matrix,
            in Vec4 color,
            in Vec4 uvRect,
            in Vec4 maskRect,
            in Vec4 maskParams,
            in Vec4 maskExtra,
            in Vec4 geometry)
        {
            Matrix = matrix;
            Color = color;
            UvRect = uvRect;
            MaskRect = maskRect;
            MaskParams = maskParams;
            MaskExtra = maskExtra;
            Geometry = geometry;
        }

        public readonly Mat4 Matrix;

        public readonly Vec4 Color;

        public readonly Vec4 UvRect;

        public readonly Vec4 MaskRect;

        public readonly Vec4 MaskParams;

        public readonly Vec4 MaskExtra;

        public readonly Vec4 Geometry;
    }
}
