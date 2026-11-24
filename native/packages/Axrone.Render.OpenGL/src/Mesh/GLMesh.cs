
namespace Axrone.Render.OpenGL.Mesh;

/// <summary>
/// High-level mesh resource that owns vertex/index buffers and a VAO.
/// Provides draw methods and bounds computation.
/// Implements <see cref="IGLResource"/> for context-loss recovery.
/// </summary>
public sealed class GLMesh : IGLResource, IDisposable
{
    private readonly GLContext _context;
    private readonly byte[] _vertexDataSnapshot;
    private readonly byte[]? _indexDataSnapshot;
    private int _disposed;

    /// <summary>
    /// Replaces the vertex payload. The new data must match the layout and vertex
    /// count; the snapshot used for context-loss recovery is updated as well.
    /// </summary>
    public void UpdateVertices(ReadOnlySpan<byte> vertexData)
    {
        if (vertexData.Length != VertexCount * Layout.VertexStride)
            ThrowHelper.ThrowInvalidArgument(
                $"Vertex data length ({vertexData.Length}) must match {VertexCount} vertices at stride {Layout.VertexStride}");

        VertexBuffer.Update(vertexData);
        vertexData.CopyTo(_vertexDataSnapshot);
    }

    /// <summary>
    /// Gets the vertex array object for this mesh.
    /// </summary>
    public GLVertexArray VertexArray { get; private set; }

    /// <summary>
    /// Gets the vertex buffer.
    /// </summary>
    public GLBuffer VertexBuffer { get; private set; }

    /// <summary>
    /// Gets the index buffer, or <c>null</c> if this mesh is not indexed.
    /// </summary>
    public GLBuffer? IndexBuffer { get; private set; }

    /// <summary>
    /// Gets the vertex layout descriptor.
    /// </summary>
    public VertexLayout Layout { get; }

    /// <summary>
    /// Gets the vertex count.
    /// </summary>
    public int VertexCount { get; }

    /// <summary>
    /// Gets the index count (0 if not indexed).
    /// </summary>
    public int IndexCount { get; }

    /// <summary>
    /// Gets the index element type (UnsignedInt when not indexed).
    /// </summary>
    public uint IndexType { get; } = GLConst.UnsignedInt;

    /// <summary>
    /// Gets a value indicating whether this mesh uses an index buffer.
    /// </summary>
    public bool IsIndexed
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => IndexBuffer != null;
    }

    /// <summary>
    /// Gets the axis-aligned bounding box of this mesh.
    /// </summary>
    public Aabb3D Bounds { get; }

    /// <summary>
    /// Gets the debug label.
    /// </summary>
    public string Label { get; }

    /// <summary>
    /// Gets the primitive topology used for drawing.
    /// </summary>
    public uint Topology { get; }

    /// <inheritdoc/>
    public DescriptorHandle<GLResourceNode> RegistryHandle { get; set; }

    /// <inheritdoc/>
    public int RebuildPriority => 20;

    /// <summary>
    /// Gets a value indicating whether this mesh has been disposed.
    /// </summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <summary>
    /// Initializes a new instance of the <see cref="GLMesh"/> class.
    /// </summary>
    /// <param name="context">The GL context.</param>
    /// <param name="layout">The vertex layout descriptor.</param>
    /// <param name="vertexData">The raw vertex data to upload.</param>
    /// <param name="indexData">Optional raw index data to upload.</param>
    /// <param name="bounds">The axis-aligned bounding box.</param>
    /// <param name="topology">The primitive topology (default: <see cref="GLConst.Triangles"/>).</param>
    /// <param name="label">The debug label.</param>
    /// <param name="indexType">The index element type (default: <see cref="GLConst.UnsignedInt"/>).</param>
    public GLMesh(
        GLContext context,
        VertexLayout layout,
        ReadOnlySpan<byte> vertexData,
        ReadOnlySpan<byte> indexData,
        Aabb3D bounds,
        uint topology = GLConst.Triangles,
        string label = "mesh",
        uint indexType = GLConst.UnsignedInt)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(layout);

        if (vertexData.Length == 0)
            ThrowHelper.ThrowInvalidArgument("Vertex data cannot be empty");

        if (vertexData.Length % layout.VertexStride != 0)
            ThrowHelper.ThrowInvalidArgument(
                $"Vertex data length ({vertexData.Length}) is not a multiple of vertex stride ({layout.VertexStride})");

        _context = context;
        Layout = layout;
        VertexCount = vertexData.Length / layout.VertexStride;
        Bounds = bounds;
        Label = label;
        Topology = topology;

        // Snapshot for context-loss recovery
        _vertexDataSnapshot = vertexData.ToArray();

        // Create vertex buffer and upload data
        VertexBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.StaticDraw, vertexData.Length, $"{label}_vbo");
        VertexBuffer.Update(vertexData);

        // Create index buffer if index data provided
        if (!indexData.IsEmpty)
        {
            IndexType = indexType;
            IndexCount = indexData.Length / IndexElementSize(indexType);
            _indexDataSnapshot = indexData.ToArray();
            IndexBuffer = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.StaticDraw, indexData.Length, $"{label}_ibo");
            IndexBuffer.Update(indexData);
        }

        // Create VAO and configure layout
        VertexArray = IndexBuffer != null
            ? layout.BuildVertexArray(context, VertexBuffer, IndexBuffer, VertexCount, IndexCount, IndexType)
            : layout.BuildVertexArray(context, VertexBuffer, VertexCount);

        // Register this mesh with the resource registry
        context.Registry.Register(this);
    }

    /// <summary>
    /// Draws this mesh by binding its VAO and issuing the draw call.
    /// </summary>
    public void Draw()
    {
        EnsureAlive();
        VertexArray.Draw(Topology);
    }

    /// <summary>
    /// Draws this mesh with instancing.
    /// </summary>
    /// <param name="instanceCount">The number of instances to draw.</param>
    public void DrawInstanced(int instanceCount)
    {
        EnsureAlive();

        if (instanceCount <= 0)
            ThrowHelper.ThrowInvalidArgument("Instance count must be positive");

        VertexArray.DrawInstanced(instanceCount, Topology);
    }

    /// <inheritdoc/>
    public void Invalidate()
    {
        VertexArray.Invalidate();
        VertexBuffer.Invalidate();
        IndexBuffer?.Invalidate();
    }

    /// <inheritdoc/>
    public void OnContextLost()
    {
        VertexArray.OnContextLost();
        VertexBuffer.OnContextLost();
        IndexBuffer?.OnContextLost();
    }

    /// <inheritdoc/>
    public void Rebuild() => OnContextRestored();

    /// <inheritdoc/>
    public void OnContextRestored()
    {
        if (IsDisposed)
            return;

        // Rebuild buffers first (they have lower priority = 10)
        VertexBuffer.Rebuild();
        VertexBuffer.Update(_vertexDataSnapshot);

        if (IndexBuffer != null && _indexDataSnapshot != null)
        {
            IndexBuffer.Rebuild();
            IndexBuffer.Update(_indexDataSnapshot);
        }

        // Rebuild VAO (priority = 20)
        VertexArray.Rebuild();

        // Reconfigure the VAO layout
        if (IndexBuffer != null)
        {
            VertexArray.ConfigureLayout(VertexBuffer, IndexBuffer, Layout.Attributes, VertexCount, IndexCount, IndexType);
        }
        else
        {
            VertexArray.ConfigureLayout(VertexBuffer, Layout.Attributes, VertexCount);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            VertexArray.Dispose();
            VertexBuffer.Dispose();
            IndexBuffer?.Dispose();

            _context.Registry.Unregister(this);
        }
    }

    /// <summary>
    /// Returns the byte size of an index element type (UNSIGNED_BYTE/SHORT/INT).
    /// </summary>
    private static int IndexElementSize(uint indexType)
    {
        switch (indexType)
        {
            case GLConst.UnsignedByte:
                return 1;
            case GLConst.UnsignedShort:
                return 2;
            case GLConst.UnsignedInt:
                return 4;
            default:
                ThrowHelper.ThrowInvalidArgument($"Unsupported index element type 0x{indexType:X4}");
                return 4; // Unreachable, satisfies compiler
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EnsureAlive()
    {
        if (IsDisposed)
            ThrowHelper.ThrowObjectDisposed(nameof(GLMesh));

        if (_context.IsLost)
            ThrowHelper.ThrowContextLost();
    }

    /// <inheritdoc/>
    public override string ToString() =>
        $"GLMesh: \"{Label}\", Vertices={VertexCount}, Indices={IndexCount}, " +
        $"Indexed={IsIndexed}, Topology=0x{Topology:X4}, Bounds={Bounds}";
}
