namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Instanced mesh batch renderer. Each distinct mesh gets a generated program
/// and VAO that append four matrix rows plus a tint to the mesh's own layout;
/// instances are uploaded from a pinned array and drawn with one
/// <c>DrawElementsInstanced</c> per planned group. The non-instanced mesh path
/// in <see cref="SceneGlDrawExecutor"/> is untouched.
/// </summary>
/// <remarks>
/// The generated vertex shader consumes the mesh's first three- or four-component
/// attribute as position and requires every mesh attribute location to be below
/// 11 so the instance block at 11..15 never collides.
/// </remarks>
public sealed class SceneGlInstancedMeshRenderer : IDisposable
{
    private const int InitialInstanceCapacity = 256;
    private const int InstanceStride = 80;
    private const int InstanceBaseLocation = 11;

    private const string ViewProjectionUniform = "u_ViewProjection";

    private const string FragmentShaderSource = """
        #version 330 core
        in vec4 v_Color;

        out vec4 fragColor;

        void main()
        {
            fragColor = v_Color;
        }
        """;

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly GLBuffer _instanceBuffer;
    private readonly Dictionary<SceneAssetId<MeshAssetTag>, MeshPipeline> _pipelines = new();

    private SceneInstanceTransform[] _instances;
    private bool _disposed;

    /// <summary>Creates the renderer and its dynamic instance buffer.</summary>
    public SceneGlInstancedMeshRenderer(GLContext context, SceneGlAssetCache assets)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);

        _context = context;
        _assets = assets;
        _instances = GC.AllocateArray<SceneInstanceTransform>(InitialInstanceCapacity, pinned: true);
        _instanceBuffer = new GLBuffer(
            context,
            GLConst.ArrayBuffer,
            GLConst.DynamicDraw,
            InitialInstanceCapacity * InstanceStride,
            "scene-instanced-mesh");

        if (Unsafe.SizeOf<SceneInstanceTransform>() != InstanceStride)
        {
            _instanceBuffer.Dispose();
            throw new SceneConfigurationException(
                $"Instanced transform layout must be {InstanceStride} bytes; measured {Unsafe.SizeOf<SceneInstanceTransform>()}.");
        }

        context.Lifecycle.ContextRestored += OnContextRestored;
    }

    /// <summary>Number of instances submitted by the last render call.</summary>
    public int LastInstanceCount { get; private set; }

    /// <summary>Number of draw calls issued by the last render call.</summary>
    public int LastBatchCount { get; private set; }

    /// <summary>Batches skipped for missing assets or an unsupported mesh layout.</summary>
    public int SkippedBatches { get; private set; }

    /// <summary>Number of cached per-mesh pipelines.</summary>
    public int PipelineCount => _pipelines.Count;

    /// <summary>Renders planned instanced batches and returns the draw-call count.</summary>
    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope", Justification = "Pipeline lifetime is owned by the per-mesh cache and released in Dispose.")]
    public unsafe int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneInstancedMeshItem> items,
        SceneInstanceRegistry registry,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        _context.AssertRenderThread();
        LastInstanceCount = 0;
        LastBatchCount = 0;
        SkippedBatches = 0;

        if (items.Length == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        ApplyState(pass);

        int drawCalls = 0;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneInstancedMeshItem item = ref items[i];
            if (!_assets.TryGetMesh(item.MeshId, out GLMesh? mesh) ||
                !_assets.TryGetMaterial(item.MaterialId, out _) ||
                !registry.TryGet(item.InstanceGroupId, out ReadOnlySpan<SceneInstanceTransform> group) ||
                group.Length == 0)
            {
                SkippedBatches++;
                continue;
            }

            if (!TryGetOrCreatePipeline(item.MeshId, mesh, out MeshPipeline? pipeline))
            {
                SkippedBatches++;
                continue;
            }

            EnsureInstanceCapacity(group.Length);
            Mat4 groupMatrix = world.GetWorldMatrix3D(item.Actor);

            for (int instance = 0; instance < group.Length; instance++)
            {
                _instances[instance] = new SceneInstanceTransform(
                    groupMatrix * group[instance].Matrix,
                    group[instance].Color);
            }

            _instanceBuffer.Update(MemoryMarshal.AsBytes(_instances.AsSpan(0, group.Length)));

            pipeline.Shader.Bind();
            pipeline.Shader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);
            _context.State.BindVertexArray(pipeline.VertexArray.Id);

            if (mesh.IsIndexed)
            {
                _context.GL.DrawElementsInstanced(
                    mesh.Topology,
                    (uint)mesh.IndexCount,
                    mesh.IndexType,
                    null,
                    (uint)group.Length);
                frameState.RecordDraw((mesh.IndexCount / 3) * group.Length, 1);
            }
            else
            {
                _context.GL.DrawArraysInstanced(
                    mesh.Topology,
                    0,
                    (uint)mesh.VertexCount,
                    (uint)group.Length);
                frameState.RecordDraw((mesh.VertexCount / 3) * group.Length, 1);
            }

            _context.State.BindVertexArray(0);
            drawCalls++;
            LastInstanceCount += group.Length;
        }

        LastBatchCount = drawCalls;
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

        foreach (MeshPipeline pipeline in _pipelines.Values)
        {
            pipeline.Dispose();
        }

        _pipelines.Clear();
        _instanceBuffer.Dispose();
        _disposed = true;
    }

    private void OnContextRestored(object? sender, EventArgs e)
    {
        foreach (MeshPipeline pipeline in _pipelines.Values)
        {
            ConfigureInstanceAttributes(pipeline.VertexArray);
        }
    }

    private bool TryGetOrCreatePipeline(
        SceneAssetId<MeshAssetTag> meshId,
        GLMesh mesh,
        [NotNullWhen(true)] out MeshPipeline? pipeline)
    {
        if (_pipelines.TryGetValue(meshId, out pipeline))
        {
            return true;
        }

        MeshPipeline? built = BuildPipeline(mesh);
        if (built is null)
        {
            pipeline = null;
            return false;
        }

        _pipelines.Add(meshId, built);
        pipeline = built;
        return true;
    }

    private MeshPipeline? BuildPipeline(GLMesh mesh)
    {
        ReadOnlySpan<VertexAttribute> meshAttributes = mesh.Layout.Attributes;
        int positionLocation = -1;
        int positionComponents = 0;

        for (int i = 0; i < meshAttributes.Length; i++)
        {
            VertexAttribute attribute = meshAttributes[i];
            if (attribute.Location >= InstanceBaseLocation)
            {
                return null;
            }

            if (positionLocation < 0 && attribute.ComponentCount >= 3)
            {
                positionLocation = attribute.Location;
                positionComponents = attribute.ComponentCount;
            }
        }

        if (positionLocation < 0)
        {
            return null;
        }

        VertexAttribute[] meshAttributesCopy = meshAttributes.ToArray();
        SceneGlShader shader = new(
            _context,
            $"scene-instanced-{mesh.Label}",
            BuildVertexSource(positionLocation, positionComponents),
            FragmentShaderSource);
        GLVertexArray vertexArray = new(_context, $"scene-instanced-{mesh.Label}");

        if (mesh.IsIndexed)
        {
            vertexArray.ConfigureLayout(
                mesh.VertexBuffer,
                mesh.IndexBuffer!,
                meshAttributesCopy,
                mesh.VertexCount,
                mesh.IndexCount,
                mesh.IndexType);
        }
        else
        {
            vertexArray.ConfigureLayout(mesh.VertexBuffer, meshAttributesCopy, mesh.VertexCount);
        }

        ConfigureInstanceAttributes(vertexArray);
        return new MeshPipeline(shader, vertexArray);
    }

    private unsafe void ConfigureInstanceAttributes(GLVertexArray vertexArray)
    {
        _context.State.BindVertexArray(vertexArray.Id);
        _context.State.BindArrayBuffer(_instanceBuffer.Id);

        for (uint row = 0; row < 4; row++)
        {
            uint location = InstanceBaseLocation + row;
            _context.GL.EnableVertexAttribArray(location);
            _context.GL.VertexAttribPointer(
                location,
                4,
                GLConst.Float,
                false,
                InstanceStride,
                (void*)(row * 16));
            _context.GL.VertexAttribDivisor(location, 1);
        }

        _context.GL.EnableVertexAttribArray(InstanceBaseLocation + 4);
        _context.GL.VertexAttribPointer(
            InstanceBaseLocation + 4,
            4,
            GLConst.Float,
            false,
            InstanceStride,
            (void*)64);
        _context.GL.VertexAttribDivisor(InstanceBaseLocation + 4, 1);

        _context.State.BindVertexArray(0);
    }

    private static string BuildVertexSource(int positionLocation, int positionComponents)
    {
        string inputType = positionComponents == 4 ? "vec4" : "vec3";
        string position = positionComponents == 4 ? "a_Position" : "vec4(a_Position, 1.0)";

        return $$"""
            #version 330 core
            layout(location = {{positionLocation}}) in {{inputType}} a_Position;
            layout(location = 11) in vec4 a_Row0;
            layout(location = 12) in vec4 a_Row1;
            layout(location = 13) in vec4 a_Row2;
            layout(location = 14) in vec4 a_Row3;
            layout(location = 15) in vec4 a_Color;

            uniform mat4 u_ViewProjection;

            out vec4 v_Color;

            void main()
            {
                mat4 model = mat4(a_Row0, a_Row1, a_Row2, a_Row3);
                gl_Position = {{position}} * model * u_ViewProjection;
                v_Color = a_Color;
            }
            """;
    }

    private void ApplyState(SceneRenderPassDefinition pass)
    {
        bool depthTest = pass.DepthTest ?? true;
        bool blend = pass.Blend ?? true;

        _context.State.SetDepthTest(depthTest);
        _context.State.SetDepthMask(depthTest);
        _context.State.SetCullFace(pass.Cull ?? true);
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

        _instances = GC.AllocateArray<SceneInstanceTransform>(capacity, pinned: true);
        _instanceBuffer.Resize(capacity * InstanceStride);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlInstancedMeshRenderer));
        }
    }

    private sealed class MeshPipeline : IDisposable
    {
        public MeshPipeline(SceneGlShader shader, GLVertexArray vertexArray)
        {
            Shader = shader;
            VertexArray = vertexArray;
        }

        public SceneGlShader Shader { get; }

        public GLVertexArray VertexArray { get; }

        public void Dispose()
        {
            VertexArray.Dispose();
            Shader.Dispose();
        }
    }
}
